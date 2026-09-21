#!/usr/bin/env bash
# Installs the Geeboard node agent on a Linux machine as a container under
# systemd, and joins it to a panel.
#
#   sudo deploy/linux/install.sh <panel address> <registration token> [join options]
#   sudo deploy/linux/install.sh <panel address> <token> --panel-ca auto
#
# --panel-ca <file|auto> is for a panel whose https certificate is signed
# by a certificate authority this machine does not already trust: Caddy's
# `tls internal`, which a panel reached by IP address rather than by name
# has to use. The file is copied to /etc/geeboard/panel-ca.crt and the
# agent is given it as NODE_EXTRA_CA_CERTS — one more authority it
# trusts, alongside the public ones, rather than no checking at all.
# `auto` means Caddy's own root on this machine:
#   /var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt
# A panel with a certificate from a public authority needs none of this.
#
# Run from a checkout of this repository, with Docker installed and running.
# What it does, in order, and each step is one you could do by hand:
#
#   1  gets the agent image: pulls the published one, and builds it from
#      daemon/ if the pull does not work — an air-gapped machine, a
#      registry that is down, or a checkout ahead of any release
#   2  makes /etc/geeboard (settings, root only) and /var/lib/geeboard
#      (servers), and puts the panel's certificate authority in place when
#      --panel-ca names one
#   3  runs `join` once, in a throw-away container, which registers the
#      machine and writes /etc/geeboard/agent.json — and does not start
#      the agent, because the unit does
#   4  installs and starts the systemd unit
#   5  waits for the agent's first heartbeat and says whether the panel
#      could call this machine back — the direction registering does not
#      prove, and the one every server placed here depends on
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
CADDY_ROOT="/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt"
# Where the agent reads the extra authority, on the host and in the
# container: /etc/geeboard is mounted at the same path in both.
CA_FILE="/etc/geeboard/panel-ca.crt"

# Everything that is not --panel-ca is the join's business, in order.
JOIN=()
PANEL_CA="${GEEBOARD_PANEL_CA:-}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --panel-ca)
      PANEL_CA="${2:-}"
      [ -n "${PANEL_CA}" ] || { echo "--panel-ca needs a file, or 'auto'." >&2; exit 2; }
      shift 2
      ;;
    --panel-ca=*)
      PANEL_CA="${1#--panel-ca=}"
      shift
      ;;
    *)
      JOIN+=("$1")
      shift
      ;;
  esac
done
[ "${PANEL_CA}" != "auto" ] || PANEL_CA="${CADDY_ROOT}"

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

# The panel's certificate authority, when this panel needs one naming it.
#
# A certificate, not a secret: what it does is let this machine check a
# certificate it would otherwise refuse. Copied here rather than read
# where it lies, because Caddy's own directory is root-only on some
# installations and the agent's container mounts this one already.
if [ -n "${PANEL_CA}" ]; then
  if [ ! -r "${PANEL_CA}" ]; then
    echo "Cannot read ${PANEL_CA}." >&2
    [ "${PANEL_CA}" != "${CADDY_ROOT}" ] || echo "Caddy writes it the first time it serves with 'tls internal'. Is the panel up, on this machine?" >&2
    exit 1
  fi
  if ! grep -q 'BEGIN CERTIFICATE' "${PANEL_CA}"; then
    echo "${PANEL_CA} is not a PEM certificate." >&2
    exit 1
  fi
  install -m 0644 "${PANEL_CA}" "${CA_FILE}"
  echo "== the agent will trust ${PANEL_CA} (copied to ${CA_FILE})"
fi
# The unit reads this; the image tag and any GEEBOARD_* override go here.
#
# The image line is rewritten every run and everything else in the file is
# kept. It used to be written once and never again, which was harmless
# while there was one tag called `local` and is not now: an upgrade would
# have pulled the new image and left the unit starting the old one.
touch /etc/geeboard/agent.env
chmod 0600 /etc/geeboard/agent.env
grep -v -e '^GEEBOARD_IMAGE=' -e '^NODE_EXTRA_CA_CERTS=' /etc/geeboard/agent.env > /etc/geeboard/agent.env.next || true
printf 'GEEBOARD_IMAGE=%s\n' "${IMAGE}" >> /etc/geeboard/agent.env.next
# Kept across upgrades: a run with no arguments must not stop trusting
# the authority a previous one was given. Remove the line to stop.
if [ -f "${CA_FILE}" ]; then
  printf 'NODE_EXTRA_CA_CERTS=%s\n' "${CA_FILE}" >> /etc/geeboard/agent.env.next
fi
chmod 0600 /etc/geeboard/agent.env.next
mv /etc/geeboard/agent.env.next /etc/geeboard/agent.env

if [ "${#JOIN[@]}" -ge 2 ]; then
  echo "== joining ${JOIN[0]}"
  # The same network, mounts and environment the service will have, so
  # the address it works out, the data root it records and the
  # authorities it trusts are the ones that will be used.
  docker run --rm --network host \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v /var/lib/geeboard:/var/lib/geeboard \
    -v /etc/geeboard:/etc/geeboard \
    --env-file /etc/geeboard/agent.env \
    "${IMAGE}" join "${JOIN[@]}"
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

# The agent's first heartbeat asks the panel to call this machine back,
# and the panel's answer is the one thing neither half can work out
# alone: everything here can be perfect and the node still take no
# servers. Twenty seconds covers a start and two beats.
#
# The journal is read into a variable and matched there. Through a pipe
# into `grep -q`, the match closes the pipe, journalctl dies of it, and
# `pipefail` reports the whole pipeline as failed — so a complaint that
# was found would have been read as none.
echo
echo "== asking the agent whether the panel reached it"
verdict="quiet"
for _ in $(seq 1 20); do
  said="$(journalctl -u geeboard-agent --since '-2 min' --no-pager 2>/dev/null || true)"
  case "${said}" in
    *"the panel cannot reach this node"*) verdict="unreachable"; break ;;
    *"heartbeat failed"*|*"registration failed"*) verdict="no-panel"; break ;;
  esac
  sleep 1
done

case "${verdict}" in
  unreachable)
    echo "${said}" | grep 'the panel cannot reach this node' | tail -1 || true
    echo "The node is registered and the panel cannot call it back, so it will take no servers."
    echo "Open the agent's port to the panel, or join again with --advertise <an address the panel can use>."
    echo "  docs/installation.md#when-the-panel-cannot-reach-the-node"
    ;;
  no-panel)
    echo "The agent is not getting through to the panel:"
    echo "${said}" | grep 'heartbeat failed\|registration failed' | tail -1 || true
    ;;
  *)
    echo "No complaint from the agent: it is running, and the panel reached it."
    ;;
esac

echo
echo "The agent runs as the geeboard-agent service and starts at boot."
echo "  journalctl -u geeboard-agent -f      to watch it"
echo "  sudo $0                              to upgrade (rebuild and restart)"
echo "  sudo ${HERE}/uninstall.sh            to remove it"
