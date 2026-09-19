#!/usr/bin/env bash
# Installs the Geeboard node agent on a Linux machine as a container under
# systemd, and joins it to a panel.
#
#   sudo deploy/linux/install.sh <panel address> <registration token> [join options]
#
# Run from a checkout of this repository, with Docker installed and running.
# What it does, in order, and each step is one you could do by hand:
#
#   1  builds the agent image from daemon/ (nothing is published yet)
#   2  makes /etc/geeboard (settings, root only) and /var/lib/geeboard (servers)
#   3  runs `join` once, in a throw-away container, which registers the
#      machine and writes /etc/geeboard/agent.json — and does not start
#      the agent, because the unit does
#   4  installs and starts the systemd unit
#
# Running it again with a new token re-joins and restarts; running it
# with no arguments rebuilds the image and restarts the unit, which is the
# upgrade. See docs/installation.md.
set -euo pipefail

IMAGE="${GEEBOARD_IMAGE:-geeboard-agent:local}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo: it writes /etc/geeboard and installs a systemd unit." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker is not answering. Install and start it first." >&2
  exit 1
fi

echo "== building ${IMAGE} from ${REPO}/daemon"
docker build -t "${IMAGE}" "${REPO}/daemon"

install -d -m 0700 /etc/geeboard
install -d -m 0755 /var/lib/geeboard /var/lib/geeboard/servers
if [ ! -f /etc/geeboard/agent.env ]; then
  # The unit reads this; the image tag and any GEEBOARD_* override go here.
  printf 'GEEBOARD_IMAGE=%s\n' "${IMAGE}" > /etc/geeboard/agent.env
  chmod 0600 /etc/geeboard/agent.env
fi

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
