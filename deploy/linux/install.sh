#!/usr/bin/env bash
# Installs the Geeboard node agent on a Linux machine as a container under
# systemd, and joins it to a panel.
#
#   sudo deploy/linux/install.sh <panel address> <registration token> [join options]
#
# Run from a checkout of this repository, with Docker installed and running.
# What it does, in order, and each step is one you could do by hand:
#
#   1  gets the agent image: pulls the published one, and builds it from
#      daemon/ if the pull does not work — an air-gapped machine, a
#      registry that is down, or a checkout ahead of any release
#   2  makes /etc/geeboard (settings, root only) and /var/lib/geeboard (servers)
#   3  runs `join` once, in a throw-away container, which registers the
#      machine and writes /etc/geeboard/agent.json — and does not start
#      the agent, because the unit does
#   4  installs and starts the systemd unit
#
# Running it again with a new token re-joins and restarts; running it
# with no arguments gets the image again and restarts the unit, which is
# the upgrade. See docs/installation.md.
#
# GEEBOARD_IMAGE names an image to use as it is, and nothing is pulled or
# built. GEEBOARD_AGENT_TAG picks another published tag.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PUBLISHED="ghcr.io/danielemarino70/geeboard-agent"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo: it writes /etc/geeboard and installs a systemd unit." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker is not answering. Install and start it first." >&2
  exit 1
fi

# The version this checkout is, so a machine gets the agent that matches
# the panel it will join rather than whatever `latest` happens to be. No
# node on the box to read JSON with, so: sed.
version=""
if [ -f "${REPO}/daemon/package.json" ]; then
  version="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${REPO}/daemon/package.json" | head -1)"
fi
TAG="${GEEBOARD_AGENT_TAG:-${version:-latest}}"

if [ -n "${GEEBOARD_IMAGE:-}" ]; then
  IMAGE="${GEEBOARD_IMAGE}"
  echo "== using ${IMAGE}, as told"
elif docker pull "${PUBLISHED}:${TAG}" >/dev/null 2>&1; then
  IMAGE="${PUBLISHED}:${TAG}"
  echo "== pulled ${IMAGE}"
elif [ -d "${REPO}/daemon" ]; then
  # A checkout ahead of any release, a registry that is down, a machine
  # with no way out. Same source either way.
  IMAGE="geeboard-agent:local"
  echo "== ${PUBLISHED}:${TAG} could not be pulled; building ${IMAGE} from ${REPO}/daemon"
  docker build -t "${IMAGE}" "${REPO}/daemon"
else
  echo "Could not pull ${PUBLISHED}:${TAG}, and there is no daemon/ here to build from." >&2
  exit 1
fi

install -d -m 0700 /etc/geeboard
install -d -m 0755 /var/lib/geeboard /var/lib/geeboard/servers
# The unit reads this; the image tag and any GEEBOARD_* override go here.
#
# The image line is rewritten every run and everything else in the file is
# kept. It used to be written once and never again, which was harmless
# while there was one tag called `local` and is not now: an upgrade would
# have pulled the new image and left the unit starting the old one.
touch /etc/geeboard/agent.env
chmod 0600 /etc/geeboard/agent.env
grep -v '^GEEBOARD_IMAGE=' /etc/geeboard/agent.env > /etc/geeboard/agent.env.next || true
printf 'GEEBOARD_IMAGE=%s\n' "${IMAGE}" >> /etc/geeboard/agent.env.next
chmod 0600 /etc/geeboard/agent.env.next
mv /etc/geeboard/agent.env.next /etc/geeboard/agent.env

if [ "$#" -ge 2 ]; then
  echo "== joining $1"
  # The same network and mounts the service will have, so the address it
  # works out and the data root it records are the ones that will be used.
  docker run --rm --network host \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v /var/lib/geeboard:/var/lib/geeboard \
    -v /etc/geeboard:/etc/geeboard \
    "${IMAGE}" join "$@"
elif [ ! -f /etc/geeboard/agent.json ]; then
  echo "No /etc/geeboard/agent.json yet: give the panel address and a registration token." >&2
  echo "  sudo $0 https://panel.example 'gbn_…'" >&2
  exit 1
fi

echo "== installing the unit"
install -m 0644 "${HERE}/geeboard-agent.service" /etc/systemd/system/geeboard-agent.service
systemctl daemon-reload
systemctl enable geeboard-agent >/dev/null
systemctl restart geeboard-agent
sleep 2
systemctl --no-pager --lines=5 status geeboard-agent || true

echo
echo "The agent runs as the geeboard-agent service and starts at boot."
echo "  journalctl -u geeboard-agent -f      to watch it"
echo "  sudo $0                              to upgrade (rebuild and restart)"
echo "  sudo ${HERE}/uninstall.sh            to remove it"
