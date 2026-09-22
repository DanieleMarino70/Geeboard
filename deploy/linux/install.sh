#!/usr/bin/env bash
# Installs the Geeboard node agent on a Linux machine as a container under
# systemd, and joins it to a panel.
#
#   sudo bash deploy/linux/install.sh <panel address> <registration token> [options]
#
# The panel writes this command for you: Nodes → Add a node → Create the
# command. Paste it on the machine that will run the game servers.
#
# Options, all of them optional:
#
#   --advertise <url>        where the panel can reach this machine, when it
#                            is not the address this machine sees itself at
#   --capabilities <list>    steamcmd,java — what this machine is willing to run
#   --panel-ca <file|auto>   the panel's certificate authority, for a panel
#                            whose certificate a public authority did not sign
#
# You are not meant to decide about --panel-ca. The panel writes it into
# the command it hands you whenever it is reached at an address rather than
# a name, because that is exactly when its certificate is signed by an
# authority of its own. `auto` means "that authority, from this machine" —
# where the panel's installer left it, or where Caddy keeps it — so on the
# panel's own machine there is nothing to do. On a node somewhere else the
# file is not here, and this says so and names the one command that fixes
# it: copy it over and pass its path instead.
#
# Either way the file goes to /etc/geeboard/panel-ca.crt and the agent is
# given it as NODE_EXTRA_CA_CERTS — one more authority it trusts, alongside
# the public ones, rather than no checking at all.
#
# Run from a checkout of this repository, with Docker installed and running.
# What it does, in order, and each step is one you could do by hand:
#
#   1  fixes the execute bits on the scripts in deploy/, which a checkout
#      copied from Windows or unpacked from a zip arrives without
#   2  gets the agent image: pulls the published one, and builds it from
#      daemon/ if the pull does not work — an air-gapped machine, a
#      registry that is down, or a checkout ahead of any release
#   3  makes /etc/geeboard (settings, root only) and /var/lib/geeboard
#      (servers), and puts the panel's certificate authority in place when
#      there is one to put
#   4  runs `join` once, in a throw-away container, which registers the
#      machine and writes /etc/geeboard/agent.json — and does not start
#      the agent, because the unit does
#   5  installs and starts the systemd unit
#   6  asks the agent whether it is up, and whether the panel could call
#      this machine back — the direction registering does not prove, and
#      the one every server placed here depends on
#
# Running it again with a new token re-joins and restarts; running it
# with no arguments gets the image again and restarts the unit, which is
# the upgrade. Nothing it does removes a server, a volume or a setting.
# See docs/production.md.
#
# GEEBOARD_IMAGE names an image to use as it is, and nothing is pulled or
# built. GEEBOARD_AGENT_TAG picks another published tag.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

# shellcheck source=../lib/common.sh
. "$REPO/deploy/lib/common.sh"
# shellcheck source=../lib/caddy.sh
. "$REPO/deploy/lib/caddy.sh"

PUBLISHED="ghcr.io/danielemarino70/geeboard-agent"
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
      [ -n "${PANEL_CA}" ] || die "--panel-ca needs a file, or 'auto'." "" "It is the panel's certificate authority, as a PEM file."
      shift 2
      ;;
    --panel-ca=*)
      PANEL_CA="${1#--panel-ca=}"
      shift
      ;;
    --help|-h)
      sed -n '2,29p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      JOIN+=("$1")
      shift
      ;;
  esac
done
# `auto` is "the panel's authority, if it is on this machine", not a
# particular file. The panel writes it into the command it hands out
# whenever it is reached at an address rather than a name, so it arrives
# on machines that are the panel's and on machines that are not — and on
# the second kind it has to say what to do rather than fail on a path the
# reader never typed.
PANEL_CA_AUTO=0
if [ "${PANEL_CA}" = "auto" ]; then
  PANEL_CA_AUTO=1
  PANEL_CA=""
fi

gb_stages 6

printf '\n%sGeeboard — installing a node agent%s\n' "$GB_B" "$GB_0"

# ── 1 ────────────────────────────────────────────────────────────────
stage "Checking the system"

need_root "deploy/linux/install.sh ${JOIN[*]:-}"

if detect_os; then ok "$GB_OS_NAME"; else
  die "This installer is for Linux." \
    "A node runs the agent as a container under systemd." \
    "On Windows, use deploy\\windows\\install-node.ps1 instead — the panel writes that command too."
fi
require_docker
ok "Docker is running"
have systemctl || die "This machine has no systemd." \
  "The agent is installed as a service so that it starts at boot, and systemd is what starts it here." \
  "Run the agent yourself instead — docs/installation.md, 'Bare, by hand' — or install it on a machine with systemd."

# ── 2 ────────────────────────────────────────────────────────────────
stage "Preparing the machine"

repair_permissions "$REPO/deploy" || true

install -d -m 0700 /etc/geeboard
install -d -m 0755 /var/lib/geeboard /var/lib/geeboard/servers
ok "Settings in /etc/geeboard, servers in /var/lib/geeboard"

# ── 3 ────────────────────────────────────────────────────────────────
stage "Getting the agent"

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
  ok "Using ${IMAGE}, as told"
elif docker pull "${PUBLISHED}:${TAG}" >/dev/null 2>&1; then
  IMAGE="${PUBLISHED}:${TAG}"
  ok "Pulled ${IMAGE}"
elif [ -d "${REPO}/daemon" ]; then
  # A checkout ahead of any release, a registry that is down, a machine
  # with no way out. Same source either way.
  IMAGE="geeboard-agent:local"
  info "${PUBLISHED}:${TAG} could not be pulled; building ${IMAGE} from this checkout"
  docker build -t "${IMAGE}" "${REPO}/daemon" >/dev/null 2>&1 || docker build -t "${IMAGE}" "${REPO}/daemon"
  ok "Built ${IMAGE}"
else
  die "The agent image could not be pulled, and there is nothing here to build it from." \
    "${PUBLISHED}:${TAG} did not answer and there is no daemon/ directory in ${REPO}." \
    "Check this machine's way out to the internet, or run the installer from a full checkout."
fi

# ── 4 ────────────────────────────────────────────────────────────────
stage "The panel's certificate"

PANEL_ADDRESS="${JOIN[0]:-}"

# Two ways of being told to look for the panel's own authority here, and
# they find the same two files.
#
#   --panel-ca auto   the panel put it in the command, because it is
#                     reached at an address rather than a name
#   worked out        a panel reached over https at an address this
#                     machine holds is the panel on this machine
#
# Either way nobody had to know that certificate authorities were going to
# come into it, which was the paragraph this replaces.
LOCAL_PANEL=0
CA_WANTED=0
if [ -n "${PANEL_ADDRESS}" ]; then
  case "${PANEL_ADDRESS}" in
    https://*) is_local_address "$(host_of "${PANEL_ADDRESS}")" && LOCAL_PANEL=1 || LOCAL_PANEL=0 ;;
  esac
fi

if [ -z "${PANEL_CA}" ] && { [ "${PANEL_CA_AUTO}" = "1" ] || [ "${LOCAL_PANEL}" = "1" ]; }; then
  for candidate in "${PANEL_CA_COPY}" "${CADDY_CA_ROOT}"; do
    if [ -r "${candidate}" ] && grep -q 'BEGIN CERTIFICATE' "${candidate}" 2>/dev/null; then
      PANEL_CA="${candidate}"
      if [ "${LOCAL_PANEL}" = "1" ]; then
        info "The panel is on this machine, and signs its own certificate"
      else
        info "Using the panel's certificate authority found on this machine"
      fi
      break
    fi
  done
  # Asked for by the command, and not here: this is a node somewhere else,
  # which is the one case that needs a person. Said rather than fatal —
  # the check further down tells the panel being unreachable apart from
  # its certificate being unknown, and that is the more useful message.
  if [ -z "${PANEL_CA}" ] && [ "${PANEL_CA_AUTO}" = "1" ]; then
    CA_WANTED=1
    warn "This panel signs its own certificates, and its authority is not on this machine."
    note "That is normal for a node away from the panel. On the panel's machine:"
    note "sudo cat ${PANEL_CA_COPY}"
    note "Save it here as /root/panel-ca.crt and run this again with --panel-ca /root/panel-ca.crt."
  fi
fi

if [ -n "${PANEL_CA}" ]; then
  if [ ! -r "${PANEL_CA}" ]; then
    extra="The file is the panel's root certificate. On the panel's machine Caddy writes it at
${CADDY_CA_ROOT} the first time it serves https, and the panel installer copies it to
${PANEL_CA_COPY}."
    [ "${PANEL_CA}" != "${CADDY_CA_ROOT}" ] || extra="Caddy writes it the first time it serves with 'tls internal'. Is the panel up, on this machine?"
    die "Cannot read ${PANEL_CA}." "Nothing was changed." "${extra}"
  fi
  if ! grep -q 'BEGIN CERTIFICATE' "${PANEL_CA}"; then
    die "${PANEL_CA} is not a certificate." \
      "It has no BEGIN CERTIFICATE line, so it is not the PEM file this needs." \
      "Copy ${PANEL_CA_COPY} from the panel's machine and pass that."
  fi
  # On the panel's own machine the authority is already at the path the
  # agent reads it from, because the panel's installer put it there.
  # `install` refuses a copy onto itself, which is how that came to light.
  if [ "${PANEL_CA}" = "${CA_FILE}" ]; then
    chmod 0644 "${CA_FILE}" 2>/dev/null || true
  else
    install -m 0644 "${PANEL_CA}" "${CA_FILE}"
  fi
  ok "The agent will trust the panel's authority (${PANEL_CA})"
elif [ -f "${CA_FILE}" ]; then
  ok "Keeping the authority this node was already given"
elif [ "${CA_WANTED}" = "1" ]; then
  # Already said, above, and saying "not needed" under it would contradict it.
  :
else
  ok "Not needed: the panel's certificate is signed by a public authority"
fi

# Told before joining rather than after it fails, and the two failures are
# not the same failure.
if [ -n "${PANEL_ADDRESS}" ]; then
  ca_for_probe=""
  [ ! -f "${CA_FILE}" ] || ca_for_probe="${CA_FILE}"
  case "$(http_code "${PANEL_ADDRESS}/sign-in" "${ca_for_probe}")" in
    2*|3*) ok "The panel answers at ${PANEL_ADDRESS}" ;;
    *)
      case "$(http_code_insecure "${PANEL_ADDRESS}/sign-in")" in
        2*|3*)
          die "The panel is there, and this machine does not trust its certificate." \
            "${PANEL_ADDRESS} answered, but its certificate is signed by an authority this machine does not know — which is what a panel behind Caddy's \`tls internal\` has." \
            "Copy the panel's authority over and name it:

  sudo cat ${PANEL_CA_COPY}          # on the panel's machine, into /root/panel-ca.crt here
  sudo bash $0 ${PANEL_ADDRESS} 'gbn_…' --panel-ca /root/panel-ca.crt

Turning the checking off is the other way, and it is the wrong one: it would
apply to every certificate this agent ever sees, on the channel that carries
the orders this machine obeys." ;;
        *) warn "${PANEL_ADDRESS} did not answer from this machine — joining will say why" ;;
      esac ;;
  esac
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

# ── 5 ────────────────────────────────────────────────────────────────
stage "Joining the panel"

if [ "${#JOIN[@]}" -ge 2 ]; then
  info "Registering with ${JOIN[0]}"
  # The same network, mounts and environment the service will have, so
  # the address it works out, the data root it records and the
  # authorities it trusts are the ones that will be used.
  docker run --rm --network host \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v /var/lib/geeboard:/var/lib/geeboard \
    -v /etc/geeboard:/etc/geeboard \
    --env-file /etc/geeboard/agent.env \
    "${IMAGE}" join "${JOIN[@]}"
  ok "Registered. The panel has it as waiting for approval"
elif [ -f /etc/geeboard/agent.json ]; then
  ok "Already joined: keeping the settings in /etc/geeboard/agent.json"
else
  die "This machine has not joined a panel yet." \
    "There is no /etc/geeboard/agent.json, so there is nothing to start." \
    "In the panel: Nodes → Add a node → Create the command, and paste what it gives you. It looks like:

  sudo bash $0 https://panel.example.com 'gbn_…'"
fi

# ── 6 ────────────────────────────────────────────────────────────────
stage "Starting the agent"

install -m 0644 "${HERE}/geeboard-agent.service" /etc/systemd/system/geeboard-agent.service
systemctl daemon-reload
systemctl enable geeboard-agent >/dev/null
systemctl restart geeboard-agent
ok "geeboard-agent installed, and starts at boot"

agent_answers() {
  case "$(http_code http://127.0.0.1:8080/health)" in 2*) return 0 ;; *) return 1 ;; esac
}
if wait_for 30 "The agent is answering on this machine" agent_answers; then
  :
else
  warn "The agent did not answer on http://127.0.0.1:8080/health."
  note "systemctl status geeboard-agent, and journalctl -u geeboard-agent -n 50, say why."
  note "A different --port at join time moves it; the check above assumes the default."
fi

# The agent's first heartbeat asks the panel to call this machine back,
# and the panel's answer is the one thing neither half can work out
# alone: everything here can be perfect and the node still take no
# servers. Twenty seconds covers a start and two beats.
#
# The journal is read into a variable and matched there. Through a pipe
# into `grep -q`, the match closes the pipe, journalctl dies of it, and
# `pipefail` reports the whole pipeline as failed — so a complaint that
# was found would have been read as none.
verdict="quiet"
said=""
live=0
[ ! -t 1 ] || live=1
[ "$live" = "0" ] || printf '%s[·]%s The panel can reach this machine' "$GB_DIM" "$GB_0"
for _ in $(seq 1 20); do
  said="$(journalctl -u geeboard-agent --since '-2 min' --no-pager 2>/dev/null || true)"
  case "${said}" in
    *"the panel cannot reach this node"*) verdict="unreachable"; break ;;
    *"heartbeat failed"*|*"registration failed"*) verdict="no-panel"; break ;;
  esac
  sleep 1
  [ "$live" = "0" ] || printf '.'
done
[ "$live" = "0" ] || printf '\r\033[K'

case "${verdict}" in
  unreachable)
    warn "The panel cannot call this machine back, so it will take no servers."
    echo "${said}" | grep 'the panel cannot reach this node' | tail -1 | sed 's/^/    /' || true
    note "Open port 8080 to the panel, or join again with --advertise <an address the panel can use>."
    note "docs/production.md#the-panel-cannot-reach-the-node"
    ;;
  no-panel)
    warn "The agent is not getting through to the panel:"
    echo "${said}" | grep 'heartbeat failed\|registration failed' | tail -1 | sed 's/^/    /' || true
    ;;
  *)
    # Silence is the good answer here, and only from an agent new enough
    # to complain: one from before this existed says nothing either way.
    ok "The panel has not complained that it cannot reach this machine"
    ;;
esac

printf '\n%sThis machine is a Geeboard node.%s\n\n' "$GB_B" "$GB_0"
say "Next:"
say "  1. Approve it in the panel — Nodes, or the dialog that wrote this command."
say "     Nothing is placed on a node until somebody does."
say "  2. Close port 8080 to everybody but the panel. Its token is all that stands"
say "     between that port and every container on this machine:"
say "       sudo ufw allow from <the panel's address> to any port 8080 proto tcp"
say ""
say "  journalctl -u geeboard-agent -f               watch it"
say "  sudo bash deploy/linux/install.sh             upgrade, after a git pull"
say "  sudo bash deploy/linux/uninstall.sh           remove it"
say ""
