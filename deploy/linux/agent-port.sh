#!/usr/bin/env bash
# Closes the node agent's port to everybody but the panel.
#
#   sudo bash deploy/linux/agent-port.sh apply [--port 8080] [--allow <address,...>] [--docker-range]
#   sudo bash deploy/linux/agent-port.sh remove
#   sudo bash deploy/linux/agent-port.sh status
#
# Why: the agent listens on every address of the machine, and what stands between that port and
# every container on the machine (the Docker socket is mounted into the agent) is one bearer
# token. On a VPS the port is public from the moment the agent starts, until somebody remembers a
# firewall. deploy/linux/install.sh runs this for you, with the panel's address, and checks that the
# panel can still reach the node afterwards; this is what it runs, and how to undo it.
#
# It uses what the machine has, in this order: ufw (when it is active), firewalld (when it is
# running), and iptables, with its own chain, GEEBOARD-AGENT, that INPUT jumps to for this port.
# The iptables rules are kept across a reboot by a unit, geeboard-agent-port.service, which this
# installs; ufw and firewalld keep theirs themselves.
#
#   --allow <a,b,...>   the panel's addresses (IPv4 or IPv6, or a network like 10.0.0.0/24). Written
#                       to /etc/geeboard/agent-port.conf, so `apply` with nothing after it puts
#                       the same rules back.
#   --docker-range      let Docker's own networks in too (172.16.0.0/12, and the panel's network
#                       if its range is another): for a panel on this very machine, which calls
#                       the agent from a container. Not for a node whose panel is elsewhere: it
#                       would let every game container on this machine at the agent.
#   --port <n>          the agent's port; the one in /etc/geeboard/agent.json, or 8080.
#
# Loopback is always let in. Everything else to this port is refused (with a reset, so a client
# sees a closed port and not a hang).
set -euo pipefail

CONF="/etc/geeboard/agent-port.conf"
AGENT_JSON="/etc/geeboard/agent.json"
COMMENT="geeboard-agent-port"
CHAIN="GEEBOARD-AGENT"
SBIN="/usr/local/sbin/geeboard-agent-port"
UNIT="/etc/systemd/system/geeboard-agent-port.service"
PANEL_NETWORK="geeboard-panel_default"

die() {
  printf '[!] %s\n' "$1" >&2
  shift
  for line in "$@"; do printf '\n%s\n' "$line" >&2; done
  exit 1
}

usage() {
  # The comment at the top, without its hashes: from line 2 up to the first line that is not a comment.
  awk 'NR > 1 && /^#/ { print; next } NR > 1 { exit }' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
}

ACTION="${1:-}"
case "${ACTION}" in
  --help|-h) usage ;;
  "") die "Say what to do: apply, remove or status." "sudo bash deploy/linux/agent-port.sh apply --allow <the panel's address>" ;;
esac
shift

PORT=""
ALLOW=""
DOCKER_RANGE=""
KEEP_CONFIG=0
NO_SERVICE=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --port) [ "$#" -ge 2 ] || die "--port needs a number."; PORT="$2"; shift 2 ;;
    --port=*) PORT="${1#--port=}"; shift ;;
    --allow) [ "$#" -ge 2 ] || die "--allow needs the panel's address."; ALLOW="$(printf '%s' "$2" | tr ',' ' ')"; shift 2 ;;
    --allow=*) ALLOW="$(printf '%s' "${1#--allow=}" | tr ',' ' ')"; shift ;;
    --docker-range) DOCKER_RANGE=1; shift ;;
    --keep-config) KEEP_CONFIG=1; shift ;;
    --no-service) NO_SERVICE=1; shift ;;
    --help|-h) usage ;;
    *) die "Unknown option $1." "Options: --port, --allow, --docker-range. --help says what each does." ;;
  esac
done

[ "$(id -u)" = "0" ] || die "This changes the firewall, so it has to run as root." "sudo bash deploy/linux/agent-port.sh ${ACTION}"

# What was applied last time is what `apply` with no options applies again, and what `remove` takes away.
saved_port=""; saved_allow=""; saved_range=""
if [ -r "${CONF}" ]; then
  # shellcheck disable=SC1090
  . "${CONF}"
  saved_port="${PORT_SAVED:-}"; saved_allow="${ALLOW_SAVED:-}"; saved_range="${DOCKER_RANGE_SAVED:-}"
fi
if [ -z "${PORT}" ]; then
  PORT="${saved_port}"
  if [ -z "${PORT}" ] && [ -r "${AGENT_JSON}" ]; then
    PORT="$(sed -n 's/.*"port"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "${AGENT_JSON}" | head -n 1)"
  fi
  PORT="${PORT:-8080}"
fi
[[ "${PORT}" =~ ^[0-9]{1,5}$ ]] || die "--port has to be a number."
if [ "${ACTION}" = "apply" ]; then
  [ -n "${ALLOW}" ] || ALLOW="${saved_allow}"
  [ -n "${DOCKER_RANGE}" ] || DOCKER_RANGE="${saved_range}"
else
  ALLOW="${ALLOW:-${saved_allow}}"
  DOCKER_RANGE="${DOCKER_RANGE:-${saved_range}}"
fi
for a in ${ALLOW}; do
  [[ "${a}" =~ ^[0-9a-fA-F:.]+(/[0-9]{1,3})?$ ]] || die "\"${a}\" is not an address or a network." "--allow takes IPv4 or IPv6 addresses, or networks like 10.0.0.0/24, separated by commas."
done

# Docker's own networks: the default range, and the panel's network when it is somewhere else.
docker_ranges() {
  printf '%s\n' "172.16.0.0/12"
  if command -v docker >/dev/null 2>&1; then
    docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}}{{"\n"}}{{end}}' "${PANEL_NETWORK}" 2>/dev/null | grep -E '^[0-9.]+/[0-9]+$' || true
  fi
}

detect_mode() {
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | head -n 1 | grep -qi 'status: active'; then
    echo ufw
  elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state 2>/dev/null | grep -qi running; then
    echo firewalld
  elif command -v iptables >/dev/null 2>&1; then
    echo iptables
  else
    echo none
  fi
}

# ── iptables ─────────────────────────────────────────────────────────

ipt() { iptables -w 10 "$@"; }
ip6t() { ip6tables -w 10 "$@"; }

hook_remove() {
  local tool="$1" line
  local -a words
  while IFS= read -r line; do
    [ -n "${line}" ] || continue
    read -r -a words <<<"${line/#-A /-D }"
    "${tool}" "${words[@]}" 2>/dev/null || true
  done < <("${tool}" -S INPUT 2>/dev/null | grep -- "--comment ${COMMENT}" || true)
}

apply_iptables() {
  local tool fam a
  for fam in 4 6; do
    if [ "${fam}" = 4 ]; then tool=ipt; else tool=ip6t; command -v ip6tables >/dev/null 2>&1 || continue; fi
    hook_remove "${tool}"
    "${tool}" -N "${CHAIN}" 2>/dev/null || "${tool}" -F "${CHAIN}"
    "${tool}" -A "${CHAIN}" -i lo -j ACCEPT
    if [ "${fam}" = 4 ] && [ -n "${DOCKER_RANGE}" ]; then
      while IFS= read -r a; do [ -z "${a}" ] || "${tool}" -A "${CHAIN}" -s "${a}" -j ACCEPT; done < <(docker_ranges | awk '!seen[$0]++')
    fi
    for a in ${ALLOW}; do
      if [ "${fam}" = 4 ] && [[ "${a}" != *:* ]]; then "${tool}" -A "${CHAIN}" -s "${a}" -j ACCEPT; fi
      if [ "${fam}" = 6 ] && [[ "${a}" == *:* ]]; then "${tool}" -A "${CHAIN}" -s "${a}" -j ACCEPT; fi
    done
    # -p tcp: a reset is an answer to a TCP connection, and the rule is refused without it ("Invalid argument").
    "${tool}" -A "${CHAIN}" -p tcp -j REJECT --reject-with tcp-reset
    "${tool}" -I INPUT 1 -p tcp --dport "${PORT}" -m comment --comment "${COMMENT}" -j "${CHAIN}"
  done
}

remove_iptables() {
  local tool
  for tool in ipt ip6t; do
    [ "${tool}" = ipt ] || command -v ip6tables >/dev/null 2>&1 || continue
    command -v iptables >/dev/null 2>&1 || continue
    hook_remove "${tool}"
    "${tool}" -F "${CHAIN}" 2>/dev/null || true
    "${tool}" -X "${CHAIN}" 2>/dev/null || true
  done
}

present_iptables() {
  ipt -C INPUT -p tcp --dport "${PORT}" -m comment --comment "${COMMENT}" -j "${CHAIN}" 2>/dev/null
}

# ── ufw ──────────────────────────────────────────────────────────────

remove_ufw() {
  local n
  while n="$(ufw status numbered 2>/dev/null | grep -- "${COMMENT}" | head -n 1 | sed -n 's/^\[ *\([0-9][0-9]*\)\].*/\1/p')" && [ -n "${n}" ]; do
    # --force and not `yes |`: under pipefail yes dies of the pipe it is feeding, the pipeline is a failure, and the loop stopped after the first rule.
    ufw --force delete "${n}" >/dev/null 2>&1 || break
  done
}

apply_ufw() {
  local a
  remove_ufw
  for a in ${ALLOW}; do ufw allow from "${a}" to any port "${PORT}" proto tcp comment "${COMMENT}" >/dev/null; done
  if [ -n "${DOCKER_RANGE}" ]; then
    while IFS= read -r a; do [ -z "${a}" ] || ufw allow from "${a}" to any port "${PORT}" proto tcp comment "${COMMENT}" >/dev/null; done < <(docker_ranges | awk '!seen[$0]++')
  fi
  # ufw's default is to refuse what it has no rule for, and then nothing else is needed. Where somebody changed it, the port is open to everyone but for a rule that says no.
  if ! ufw status verbose 2>/dev/null | grep -Ei '^Default:.*(deny|reject) \(incoming\)' >/dev/null; then
    ufw deny proto tcp from any to any port "${PORT}" comment "${COMMENT}" >/dev/null
  fi
}

present_ufw() { ufw status 2>/dev/null | grep -q -- "${COMMENT}"; }

# ── firewalld ────────────────────────────────────────────────────────

rich_rules() {
  local a
  for a in ${ALLOW}; do
    if [[ "${a}" == *:* ]]; then
      printf 'rule family="ipv6" source address="%s" port port="%s" protocol="tcp" accept\n' "${a}" "${PORT}"
    else
      printf 'rule family="ipv4" source address="%s" port port="%s" protocol="tcp" accept\n' "${a}" "${PORT}"
    fi
  done
  if [ -n "${DOCKER_RANGE}" ]; then
    while IFS= read -r a; do
      [ -z "${a}" ] || printf 'rule family="ipv4" source address="%s" port port="%s" protocol="tcp" accept\n' "${a}" "${PORT}"
    done < <(docker_ranges | awk '!seen[$0]++')
  fi
}

apply_firewalld() {
  local r
  while IFS= read -r r; do
    [ -z "${r}" ] || firewall-cmd --permanent --add-rich-rule="${r}" >/dev/null
  done < <(rich_rules)
  firewall-cmd --reload >/dev/null
}

remove_firewalld() {
  local r
  while IFS= read -r r; do
    [ -z "${r}" ] || firewall-cmd --permanent --remove-rich-rule="${r}" >/dev/null 2>&1 || true
  done < <(rich_rules)
  firewall-cmd --reload >/dev/null 2>&1 || true
}

present_firewalld() { firewall-cmd --list-rich-rules 2>/dev/null | grep -q "port=\"${PORT}\" protocol=\"tcp\" accept"; }

# ── the unit that keeps the iptables rules across a reboot ───────────

install_service() {
  command -v systemctl >/dev/null 2>&1 || { echo "This machine has no systemd, so nothing puts the rules back after a reboot."; return 0; }
  # Run from its own copy (the unit does), it is the file it would copy onto: install refuses, and the unit failed at every boot, with the rules in place.
  if [ "$(readlink -f "${BASH_SOURCE[0]}")" != "$(readlink -f "${SBIN}" 2>/dev/null || true)" ]; then
    install -m 0755 "${BASH_SOURCE[0]}" "${SBIN}"
  fi
  cat > "${UNIT}" <<UNITFILE
# Written by deploy/linux/agent-port.sh. It puts the rules for the agent's port back at boot; remove it with
# \`agent-port.sh remove\`.
[Unit]
Description=Close the Geeboard agent's port to everybody but the panel
Before=geeboard-agent.service
After=network-pre.target
Wants=network-pre.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=${SBIN} apply --no-service
ExecStop=${SBIN} remove --keep-config

[Install]
WantedBy=multi-user.target
UNITFILE
  chmod 0644 "${UNIT}"
  systemctl daemon-reload
  systemctl enable geeboard-agent-port >/dev/null 2>&1
}

remove_service() {
  if command -v systemctl >/dev/null 2>&1; then
    # --now: a oneshot that remains after exit stays "active (exited)" in memory until the next boot if only its file is removed, and
    # systemctl then lists a unit that is not found and active (the uninstaller's own run on the test VPS left one). Stopping it runs
    # ExecStop, which takes the rules off (again; there are none by now), and needs the copy of this script that is removed just below.
    systemctl disable --now geeboard-agent-port >/dev/null 2>&1 || true
  fi
  rm -f "${UNIT}" "${SBIN}"
  if command -v systemctl >/dev/null 2>&1; then systemctl daemon-reload || true; fi
}

# ── the actions ──────────────────────────────────────────────────────

MODE="$(detect_mode)"

case "${ACTION}" in
  apply)
    [ -n "${ALLOW}" ] || [ -n "${DOCKER_RANGE}" ] || die "There is no address to let in." \
      "Closing the port with nobody let in would cut the panel off. Nothing was changed." \
      "Say the panel's address: sudo bash deploy/linux/agent-port.sh apply --allow <the panel's address>"
    case "${MODE}" in
      ufw) apply_ufw ;;
      firewalld) apply_firewalld ;;
      iptables) apply_iptables; [ "${NO_SERVICE}" = "1" ] || install_service ;;
      none) die "This machine has no firewall this can use." "Neither ufw, firewalld nor iptables is here, so the agent's port is open to everyone who can reach the machine." "Install one — sudo apt install -y iptables — and run this again, or close port ${PORT} at your provider's firewall." ;;
    esac
    ( umask 077; { printf 'PORT_SAVED=%s\nALLOW_SAVED="%s"\nDOCKER_RANGE_SAVED=%s\n' "${PORT}" "${ALLOW}" "${DOCKER_RANGE:-}"; } > "${CONF}" )
    printf 'Port %s is closed to everybody but %s%s, and this machine itself (%s).\n' "${PORT}" "${ALLOW}" "${DOCKER_RANGE:+ and the Docker networks}" "${MODE}"
    ;;
  remove)
    case "${MODE}" in
      ufw) remove_ufw ;;
      firewalld) remove_firewalld ;;
    esac
    # iptables rules may be there whatever the mode is now: ufw can have been switched on since.
    if command -v iptables >/dev/null 2>&1; then remove_iptables; fi
    if [ "${KEEP_CONFIG}" != 1 ]; then
      rm -f "${CONF}"
      remove_service
    fi
    printf 'The rules for port %s are removed. The agent is open to everybody who can reach this machine.\n' "${PORT}"
    ;;
  status)
    printf 'Firewall: %s. Port %s. Let in: %s%s, and this machine.\n' "${MODE}" "${PORT}" "${ALLOW:-nobody}" "${DOCKER_RANGE:+, the Docker networks}"
    case "${MODE}" in
      iptables) if present_iptables; then echo "present  INPUT -> ${CHAIN}"; ipt -S "${CHAIN}" | sed 's/^/         /'; else echo "missing  INPUT -> ${CHAIN}"; exit 1; fi ;;
      ufw) if present_ufw; then echo "present  ufw rules for ${COMMENT}"; else echo "missing  ufw rules for ${COMMENT}"; exit 1; fi ;;
      firewalld) if present_firewalld; then echo "present  firewalld rich rules for port ${PORT}"; else echo "missing  firewalld rich rules for port ${PORT}"; exit 1; fi ;;
      none) echo "There is no firewall here: the port is open."; exit 1 ;;
    esac
    ;;
  *)
    die "Unknown action ${ACTION}." "apply, remove or status."
    ;;
esac
