#!/usr/bin/env bash
# Keeps the containers of game servers away from what is not theirs on this machine:
# the cloud provider's metadata service, and the machine's own SSH and agent ports.
#
#   sudo bash deploy/linux/container-firewall.sh add [--ports 22,8080]
#   sudo bash deploy/linux/container-firewall.sh remove [--ports 22,8080]
#   sudo bash deploy/linux/container-firewall.sh status
#
# Why: a container on Docker's default bridge reaches the machine it runs on and the
# network behind it — SSH on the bridge's gateway address, the agent's port, and on a
# cloud machine the metadata service at 169.254.169.254, which can hold credentials.
# That is true of every game Geeboard hosts. It matters most for a community game,
# whose image somebody chose: docs/community-games.md says what an image can do and
# why this is worth running on a node that has said --community-games.
#
# What it adds, and nothing else:
#
#   DOCKER-USER   a REJECT for 169.254.169.254. Traffic from a container to the network
#                 goes through the machine's FORWARD chain, where Docker leaves this one
#                 chain for you.
#   INPUT         a REJECT for TCP to the given ports, from docker0 and from the bridges
#                 Docker makes (br-*). Traffic from a container to the machine itself does
#                 not go through FORWARD, so DOCKER-USER cannot stop it.
#
# What it does not touch: a game's own published ports, the containers' way out to the
# Internet, DNS, traffic between containers, IPv6 (Docker's bridge has none unless you
# turned it on), and a container started with --network host, which this does not make.
#
# It changes the running firewall only. To keep it across a reboot, run `add` from a
# systemd unit that starts after docker.service — docs/community-games.md has one.
# Each rule carries the comment "geeboard-container-firewall", so `remove` takes away
# exactly what `add` put there.

set -euo pipefail

COMMENT="geeboard-container-firewall"
METADATA="169.254.169.254/32"
PORTS="22,8080"

die() {
  printf '[!] %s\n' "$1" >&2
  shift
  for line in "$@"; do printf '\n%s\n' "$line" >&2; done
  exit 1
}

case "${1:-}" in
  --help|-h)
    sed -n '2,33p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
esac

ACTION="${1:-}"
[ -n "${ACTION}" ] || die "Say what to do: add, remove or status." "sudo bash deploy/linux/container-firewall.sh add"
shift || true
while [ "$#" -gt 0 ]; do
  case "$1" in
    --ports)
      PORTS="${2:-}"
      shift 2
      ;;
    --ports=*)
      PORTS="${1#--ports=}"
      shift
      ;;
    *)
      die "Unknown option $1." "Options: --ports <comma-separated list>, default 22,8080."
      ;;
  esac
done
[[ "${PORTS}" =~ ^[0-9]{1,5}(,[0-9]{1,5}){0,14}$ ]] || die "--ports has to be a comma-separated list of port numbers, like 22,8080."

[ "$(id -u)" = "0" ] || die "This changes the firewall, so it has to run as root." "sudo bash deploy/linux/container-firewall.sh ${ACTION}"
command -v iptables >/dev/null 2>&1 || die "iptables is not installed." "On Ubuntu and Debian: sudo apt-get install iptables"

# Docker makes DOCKER-USER when it starts; without it there is nothing to attach to.
iptables -n -L DOCKER-USER >/dev/null 2>&1 || die "Docker has not made its DOCKER-USER chain." "Start Docker first, then run this again: sudo systemctl start docker"

# One rule, as the arguments of -I/-C/-D after the chain, so add, remove and status cannot disagree.
rules() {
  printf '%s\n' "DOCKER-USER|-d ${METADATA} -m comment --comment ${COMMENT} -j REJECT"
  printf '%s\n' "INPUT|-i docker0 -p tcp -m multiport --dports ${PORTS} -m comment --comment ${COMMENT} -j REJECT --reject-with tcp-reset"
  printf '%s\n' "INPUT|-i br-+ -p tcp -m multiport --dports ${PORTS} -m comment --comment ${COMMENT} -j REJECT --reject-with tcp-reset"
}

each() {
  local verb="$1" chain spec
  while IFS='|' read -r chain spec; do
    # shellcheck disable=SC2086 -- the rule is words on purpose
    "${verb}" "${chain}" ${spec}
  done < <(rules)
}

present() { iptables -C "$@" >/dev/null 2>&1; }
put() { present "$@" || iptables -I "$@"; }
take() { if present "$@"; then iptables -D "$@"; fi; }

case "${ACTION}" in
  add)
    each put
    printf 'Containers on this machine can no longer reach 169.254.169.254, or TCP ports %s on the machine itself.\n' "${PORTS}"
    ;;
  remove)
    each take
    printf 'The geeboard-container-firewall rules are removed.\n'
    ;;
  status)
    found=0
    while IFS='|' read -r chain spec; do
      # shellcheck disable=SC2086
      if present "${chain}" ${spec}; then
        printf 'present  %s  %s\n' "${chain}" "${spec%% -m comment*}"
        found=$((found + 1))
      else
        printf 'missing  %s  %s\n' "${chain}" "${spec%% -m comment*}"
      fi
    done < <(rules)
    [ "${found}" = "3" ]
    ;;
  *)
    die "Unknown action ${ACTION}." "add, remove or status."
    ;;
esac
