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
#   --terminal               allow the panel to open a shell on this machine
#                            (inside the agent's container); --no-terminal
#                            takes it back. Decided here, on the machine, and
#                            kept across upgrades. Off unless you say so.
#   --check                  say what this machine is and what is in the way,
#                            and change nothing
#   --community-games        let games that somebody wrote, and an owner of
#                            the panel approved, run on this machine. Their
#                            images run as root in their containers and reach
#                            what the machine's network reaches; read
#                            docs/community-games.md first. Declared when the
#                            node joins, so it goes on the command that joins.
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

# Everything that is not --panel-ca or --terminal is the join's business, in order.
JOIN=()
PANEL_CA="${GEEBOARD_PANEL_CA:-}"
# Empty: leave the terminal as it is. 1 or 0: write it into the agent's
# environment, which wins over agent.json and survives an upgrade.
TERMINAL=""
COMMUNITY=0
CHECK=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --panel-ca)
      PANEL_CA="${2:-}"
      [ -n "${PANEL_CA}" ] || die "--panel-ca needs a file, or 'auto'." "" "It is the panel's certificate authority, as a PEM file."
      shift 2
      ;;
    --check)
      CHECK=1
      shift
      ;;
    --panel-ca=*)
      PANEL_CA="${1#--panel-ca=}"
      shift
      ;;
    --terminal)
      TERMINAL=1
      shift
      ;;
    --no-terminal)
      TERMINAL=0
      shift
      ;;
    --community-games)
      COMMUNITY=1
      shift
      ;;
    --help|-h)
      sed -n '2,41p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      JOIN+=("$1")
      shift
      ;;
  esac
done
# --community-games is one more capability, declared with the others: put it
# in the list the join is given, whether or not there was one.
if [ "${COMMUNITY}" = "1" ]; then
  if [ "${#JOIN[@]}" -lt 2 ]; then
    die "--community-games is declared when a node joins." \
      "This run has no panel address and token, so there is nothing to declare it with." \
      "On a machine that has already joined, add the line GEEBOARD_CAPABILITIES=<what it declares now>,community-games to /etc/geeboard/agent.env, then run this installer again with no options."
  fi
  mapfile -t JOIN < <(join_with_capability community-games "${JOIN[@]}")
fi
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
# A directory of its own for the run's files, removed however it ends; a log of what it printed unless it only looks. The
# panel's installer, which runs this one, has opened the log already, and this writes into it.
gb_init_run "/etc/geeboard/agent.env.next /etc/geeboard/agent.env.terminal"
if [ "${CHECK}" != "1" ]; then
  gb_log /var/log/geeboard-install.log
  note "This run is also written to /var/log/geeboard-install.log"
fi

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

# The port the agent listens on: the one it has (agent.json), the one the join is told, or 8080. Another service on it is a
# crash loop under Restart=always, and the panel is told an address that points at somebody else's program: Wings, AMP and a
# CI server all like 8080, and a game host is where they live.
AGENT_PORT=""
if [ -r /etc/geeboard/agent.json ]; then
  AGENT_PORT="$(sed -n 's/.*"port"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' /etc/geeboard/agent.json | head -n 1)"
fi
for _i in "${!JOIN[@]}"; do
  case "${JOIN[$_i]}" in
    --port) AGENT_PORT="${JOIN[$((_i + 1))]:-$AGENT_PORT}" ;;
    --port=*) AGENT_PORT="${JOIN[$_i]#--port=}" ;;
  esac
done
AGENT_PORT="${AGENT_PORT:-8080}"
case "$AGENT_PORT" in *[!0-9]*|"") AGENT_PORT=8080 ;; esac

gb_preflight "$AGENT_PORT"
if [ "${CHECK}" = "1" ]; then
  say ""
  if [ "$GB_WARNINGS" -gt 0 ]; then
    say "$GB_WARNINGS thing(s) above are worth a look before installing. Nothing was changed."
    exit 1
  fi
  say "Nothing in the way that this can see. Nothing was changed."
  exit 0
fi
# Held by this agent, which the restart below frees, is not in the way; held by anything else is.
if ! port_free "$AGENT_PORT" && [ -z "$(docker ps -q --filter name='^/?geeboard-agent$' 2>/dev/null)" ]; then
  _holder="$(port_holder "$AGENT_PORT" || true)"
  die "Port $AGENT_PORT is already in use${_holder:+, by $_holder}." \
    "The agent listens on it, and so does whatever has it now. The agent would not start, or would start and be the wrong thing answering at the address the panel is given. Nothing was changed." \
    "Stop that, or give the agent another port when it joins: ... join --port 8081 (the panel is told the address it really has)."
fi

# ── 2 ────────────────────────────────────────────────────────────────
stage "Preparing the machine"

repair_permissions "$REPO/deploy" || true
explain_mode_only_changes "$REPO"

install -d -m 0700 /etc/geeboard
install -d -m 0755 /var/lib/geeboard /var/lib/geeboard/servers
ok "Settings in /etc/geeboard, servers in /var/lib/geeboard"

# ── 3 ────────────────────────────────────────────────────────────────
stage "Getting the agent"

# The cheap question first. The image is hundreds of megabytes, and a panel that cannot be reached from here is a join that
# cannot work, whatever the image does. Only that something answers; the certificate is the next stage's business.
if [ "${#JOIN[@]}" -ge 2 ]; then
  case "$(http_code_insecure "${JOIN[0]}/sign-in")" in
    000)
      warn "${JOIN[0]} does not answer from this machine."
      note "Joining needs it to: this machine calls the panel to register, and the panel calls it back. A wrong address, a firewall, or a panel that is not up yet are the usual reasons."
      confirm "Pull the agent image anyway?" no || die \
        "Stopped before anything was downloaded or changed." \
        "${JOIN[0]} did not answer. Look at the address in the command, and from this machine: curl -sk -o /dev/null -w '%{http_code}\n' ${JOIN[0]}/sign-in" \
        "Run this again when it does."
      ;;
  esac
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
  ok "Using ${IMAGE}, as told"
elif PULL_OUT="$(docker pull "${PUBLISHED}:${TAG}" 2>&1)"; then
  IMAGE="${PUBLISHED}:${TAG}"
  ok "Pulled ${IMAGE}"
elif docker image inspect "${PUBLISHED}:${TAG}" >/dev/null 2>&1; then
  # A registry that is down at upgrade time must not replace a working image with a build.
  IMAGE="${PUBLISHED}:${TAG}"
  warn "${IMAGE} could not be pulled: $(printf '%s' "$PULL_OUT" | tail -n 1 | cut -c1-160)"
  ok "Using the copy of it that is already on this machine"
elif [ -d "${REPO}/daemon" ]; then
  # A checkout ahead of any release, a registry that is down, a machine
  # with no way out. Same source either way.
  IMAGE="geeboard-agent:local"
  info "${PUBLISHED}:${TAG} could not be pulled: $(printf '%s' "$PULL_OUT" | tail -n 1 | cut -c1-160)"
  info "Building ${IMAGE} from this checkout (minutes, with nothing printed until it ends)"
  BUILD_LOG="$(gb_tmp)"
  if ! docker build -t "${IMAGE}" "${REPO}/daemon" > "$BUILD_LOG" 2>&1; then
    tail -n 25 "$BUILD_LOG" | sed 's/^/    /' >&2
    die "The agent image did not build." "Nothing was installed or changed." "The lines above say what failed."
  fi
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
# The node terminal: the consent lives on this machine, in this file. A
# run that says nothing leaves the line as it was, so an upgrade neither
# switches a shell on nor takes one away.
if [ -n "${TERMINAL}" ]; then
  grep -v -e '^GEEBOARD_TERMINAL=' /etc/geeboard/agent.env.next > /etc/geeboard/agent.env.terminal || true
  mv /etc/geeboard/agent.env.terminal /etc/geeboard/agent.env.next
  printf 'GEEBOARD_TERMINAL=%s\n' "${TERMINAL}" >> /etc/geeboard/agent.env.next
fi
chmod 0600 /etc/geeboard/agent.env.next
mv /etc/geeboard/agent.env.next /etc/geeboard/agent.env

# ── 5 ────────────────────────────────────────────────────────────────
stage "Joining the panel"

if [ "${#JOIN[@]}" -ge 2 ]; then
  info "Registering with ${JOIN[0]}"
  # The consent is the GEEBOARD_TERMINAL line in agent.env, which the
  # agent reads at every start; it is not passed to join, which an agent
  # from before the terminal would refuse as an option it does not know,
  # and the panel learns it from the first heartbeat either way.
  # The same network, mounts and environment the service will have, so
  # the address it works out, the data root it records and the
  # authorities it trusts are the ones that will be used.
  JOIN_OUT="$(gb_tmp)"
  if ! docker run --rm --network host \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v /var/lib/geeboard:/var/lib/geeboard \
    -v /etc/geeboard:/etc/geeboard \
    --env-file /etc/geeboard/agent.env \
    "${IMAGE}" join "${JOIN[@]}" > "$JOIN_OUT" 2>&1; then
    cat "$JOIN_OUT" >&2
    # The agent's own words are above. What they usually mean, said once, for the three that are somebody's to fix.
    _why="The lines above are what the agent said when it tried."
    case "$(cat "$JOIN_OUT")" in
      *xpired*|*"not valid"*|*"already used"*|*"was used"*|*"not bound"*|*"different node name"*)
        _why="The registration token is the usual cause: it works once, for one name, for a day. In the panel: Nodes → Add a node → Create the command, and paste the new one." ;;
      *ertificate*|*CERT*|*SSL*|*TLS*)
        _why="The certificate is the usual cause: this machine does not trust the panel's. At an address the panel signs its own (Caddy's \`tls internal\`): copy its authority over, and name it with --panel-ca. At a name, check the clock on this machine." ;;
      *ECONNREFUSED*|*ENOTFOUND*|*ETIMEDOUT*|*"fetch failed"*)
        _why="The panel is not reachable from here, or the address in the command is wrong. Nothing was joined." ;;
    esac
    die "The panel did not take this machine." \
      "Registering failed, so there is nothing for the agent to start with. Nothing else was changed. $_why" \
      "Run it again with a new command when that is sorted."
  fi
  cat "$JOIN_OUT"
  ok "Registered. The panel has it as waiting for approval"
elif [ -f /etc/geeboard/agent.json ]; then
  ok "Already joined: keeping the settings in /etc/geeboard/agent.json"
  if [ -n "${TERMINAL}" ]; then
    ok "Node terminal switched $([ "${TERMINAL}" = "1" ] && echo on || echo off); the agent picks it up when it restarts below"
  fi
else
  die "This machine has not joined a panel yet." \
    "There is no /etc/geeboard/agent.json, so there is nothing to start." \
    "In the panel: Nodes → Add a node → Create the command, and paste what it gives you. It looks like:

  sudo bash $0 https://panel.example.com 'gbn_…'"
fi

# ── 6 ────────────────────────────────────────────────────────────────
stage "Starting the agent"

install -m 0644 "${HERE}/geeboard-agent.service" /etc/systemd/system/geeboard-agent.service
# The unit names /usr/bin/docker, and the installer accepts any docker on the path: the unit has to start the one that was found.
DOCKER_BIN="$(command -v docker)"
if [ "$DOCKER_BIN" != "/usr/bin/docker" ]; then
  sed -i "s#/usr/bin/docker#$DOCKER_BIN#g" /etc/systemd/system/geeboard-agent.service
  note "The unit starts $DOCKER_BIN, the docker this was run with"
fi
systemctl daemon-reload
systemctl enable geeboard-agent >/dev/null
# Taken before the restart: the journal read below is this start's, and not the one a failed run a minute ago left behind.
RESTARTED_AT="$(date '+%Y-%m-%d %H:%M:%S')"
systemctl restart geeboard-agent
ok "geeboard-agent installed, and starts at boot"

agent_answers() {
  case "$(http_code "http://127.0.0.1:${AGENT_PORT}/health")" in 2*) return 0 ;; *) return 1 ;; esac
}
if wait_for 30 "The agent is answering on this machine" agent_answers; then
  :
else
  warn "The agent did not answer on http://127.0.0.1:${AGENT_PORT}/health."
  note "systemctl status geeboard-agent, and journalctl -u geeboard-agent -n 50, say why."
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
live="$GB_LIVE"
[ "$live" = "0" ] || printf '%s[·]%s The panel can reach this machine' "$GB_DIM" "$GB_0" >&"$GB_LIVE_FD"
for _ in $(seq 1 20); do
  said="$(journalctl -u geeboard-agent --since "$RESTARTED_AT" --no-pager 2>/dev/null || true)"
  case "${said}" in
    *"the panel cannot reach this node"*) verdict="unreachable"; break ;;
    *"heartbeat failed"*|*"registration failed"*) verdict="no-panel"; break ;;
  esac
  sleep 1
  [ "$live" = "0" ] || printf '.' >&"$GB_LIVE_FD"
done
[ "$live" = "0" ] || printf '\r\033[K' >&"$GB_LIVE_FD"

case "${verdict}" in
  unreachable)
    warn "The panel cannot call this machine back, so it will take no servers."
    _line="$(printf '%s\n' "${said}" | grep 'the panel cannot reach this node' | tail -1 || true)"
    printf '%s\n' "$_line" | sed 's/^/    /' || true
    # The address it was given, from either form of the line (JSON under systemd, words at a terminal).
    _adv="$(printf '%s' "$_line" | sed -n 's/.*"advertised":"\([^"]*\)".*/\1/p; s/.*advertised=\([^ ]*\).*/\1/p' | head -n 1)"
    case "$_adv" in
      http://10.*|http://192.168.*|http://172.1[6-9].*|http://172.2[0-9].*|http://172.3[01].*)
        note "$_adv is a private address. A panel elsewhere on the internet cannot call it: join again with --advertise <a public address of this machine, or its address on a VPN both can reach>, or forward the port." ;;
    esac
    note "Open port ${AGENT_PORT} to the panel, or join again with --advertise <an address the panel can use>."
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
say "  2. Close port ${AGENT_PORT} to everybody but the panel. Its token is all that stands"
say "     between that port and every container on this machine:"
_panel_host="$(host_of "${PANEL_ADDRESS:-}")"
if [ -n "$_panel_host" ] && is_local_address "$_panel_host"; then
  # The panel is on this machine, and what calls the agent is its container, from a Docker bridge: a rule for the panel's
  # address would be a rule that blocks it.
  say "     (the panel is on this machine, and reaches the agent from a Docker network)"
  say "       sudo ufw allow from 172.16.0.0/12 to any port ${AGENT_PORT} proto tcp"
elif is_ipv4 "${_panel_host:-x}"; then
  say "       sudo ufw allow from $_panel_host to any port ${AGENT_PORT} proto tcp"
else
  say "       sudo ufw allow from <the panel's address> to any port ${AGENT_PORT} proto tcp"
fi
say ""
say "  journalctl -u geeboard-agent -f               watch it"
say "  sudo bash deploy/linux/install.sh             upgrade, after a git pull"
say "  sudo bash deploy/linux/uninstall.sh           remove it"
say ""
