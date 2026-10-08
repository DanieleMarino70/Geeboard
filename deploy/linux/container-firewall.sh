#!/usr/bin/env bash
# Keeps the containers of game servers away from what is not theirs on this machine:
# the cloud provider's metadata service, and the machine's own SSH and agent ports.
#
#   sudo bash deploy/linux/container-firewall.sh add [--ports 22,8080] [--except-bridge <name>]...
#   sudo bash deploy/linux/container-firewall.sh remove
#   sudo bash deploy/linux/container-firewall.sh refresh
#   sudo bash deploy/linux/container-firewall.sh status
#   sudo bash deploy/linux/container-firewall.sh install-service [--ports 22,8080]
#   sudo bash deploy/linux/container-firewall.sh uninstall-service
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
#   INPUT         an ACCEPT, above those, for the panel's own network when this machine
#                 runs the panel as well (the compose network geeboard-panel_default), and
#                 for any bridge named with --except-bridge. The panel is a container on a
#                 bridge of its own and calls this machine's agent at its LAN address: the
#                 REJECT above would cut it off its own node, which is the failure this
#                 exemption exists for.
#
# What it does not touch: a game's own published ports, the containers' way out to the
# Internet, DNS, traffic between containers, IPv6 (Docker's bridge has none unless you
# turned it on), and a container started with --network host, which this does not make.
#
# refresh takes away what is there and puts it back with the ports it had and the bridges as they are now: run by the panel's
# installer after it has made the panel's network again, because a rule that names a bridge by an old name lets nothing through.
#
# add and remove change the running firewall only. install-service keeps it across a reboot
# and a restart of Docker: a unit that starts after docker.service and puts the rules back.
# Each rule carries the comment "geeboard-container-firewall", and remove takes away every
# rule that has it, whatever ports or bridges it was added with.

set -euo pipefail

COMMENT="geeboard-container-firewall"
METADATA="169.254.169.254/32"
PORTS="22,8080"
# The network the panel's compose file makes (the project is named in deploy/panel/docker-compose.yml).
PANEL_NETWORK="geeboard-panel_default"
EXCEPT=()
PORTS_GIVEN=0
SBIN="/usr/local/sbin/geeboard-container-firewall"
UNIT="/etc/systemd/system/geeboard-container-firewall.service"

die() {
  printf '[!] %s\n' "$1" >&2
  shift
  for line in "$@"; do printf '\n%s\n' "$line" >&2; done
  exit 1
}

# The comment at the top, without its hashes: everything from line 2 up to the first line that is not a comment.
show_help() {
  awk 'NR > 1 && /^#/ { print; next } NR > 1 { exit }' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

case "${1:-}" in
  --help|-h)
    show_help
    exit 0
    ;;
esac

ACTION="${1:-}"
[ -n "${ACTION}" ] || die "Say what to do: add, remove, refresh, status, install-service or uninstall-service." "sudo bash deploy/linux/container-firewall.sh add"
shift || true
while [ "$#" -gt 0 ]; do
  case "$1" in
    --ports)
      [ "$#" -ge 2 ] || die "--ports needs a list, like 22,8080."
      PORTS="$2"
      PORTS_GIVEN=1
      shift 2
      ;;
    --ports=*)
      PORTS="${1#--ports=}"
      PORTS_GIVEN=1
      shift
      ;;
    --except-bridge)
      [ "$#" -ge 2 ] || die "--except-bridge needs the name of a bridge, like br-0123456789ab."
      EXCEPT+=("$2")
      shift 2
      ;;
    --except-bridge=*)
      EXCEPT+=("${1#--except-bridge=}")
      shift
      ;;
    --help|-h)
      show_help
      exit 0
      ;;
    *)
      die "Unknown option $1." "Options: --ports <comma-separated list>, default 22,8080; --except-bridge <name>."
      ;;
  esac
done
[[ "${PORTS}" =~ ^[0-9]{1,5}(,[0-9]{1,5}){0,14}$ ]] || die "--ports has to be a comma-separated list of port numbers, like 22,8080."
for bridge in "${EXCEPT[@]}"; do
  [[ "${bridge}" =~ ^[A-Za-z0-9_.-]{1,15}$ ]] || die "\"${bridge}\" is not the name of a network interface."
done

[ "$(id -u)" = "0" ] || die "This changes the firewall, so it has to run as root." "sudo bash deploy/linux/container-firewall.sh ${ACTION}"

# iptables, waiting for the lock up to ten seconds. Docker and ufw both take it at boot, and without -w a collision made -C fail
# (read as "no such rule") and -I fail, which ended the run half-way.
ipt() { iptables -w 10 "$@"; }

# The panel's bridge, when this machine runs the panel: its name if Docker was told one, else br- and the first twelve
# characters of the network's id, which is what Docker calls it. Nothing when there is no such network.
panel_bridge() {
  command -v docker >/dev/null 2>&1 || return 1
  local id name
  id="$(docker network inspect -f '{{.Id}}' "${PANEL_NETWORK}" 2>/dev/null)" || return 1
  [ -n "${id}" ] || return 1
  name="$(docker network inspect -f '{{index .Options "com.docker.network.bridge.name"}}' "${PANEL_NETWORK}" 2>/dev/null || true)"
  case "${name}" in ""|"<no value>") name="br-${id:0:12}" ;; esac
  printf '%s' "${name}"
}

# Every bridge let through: the panel's, and the ones named.
excepted() {
  {
    panel_bridge || true
    for bridge in "${EXCEPT[@]}"; do printf '%s\n' "${bridge}"; done
  } | awk 'NF && !seen[$0]++'
}

# The nftables backend of iptables is the default on current Debian and Ubuntu, and it is fine; what is not is a Docker that has
# not made its chain. Said as what it is.
need_docker_chain() {
  command -v iptables >/dev/null 2>&1 || die "iptables is not installed." "The rules this makes are iptables rules, and nothing was changed." "Install it (Debian and Ubuntu: apt-get install iptables; Fedora and Rocky: dnf install iptables-nft) and run this again, or close the same ports with the firewall you do have: docs/community-games.md says which." "On Ubuntu and Debian: sudo apt-get install iptables"
  ipt -n -L DOCKER-USER >/dev/null 2>&1 || die "Docker has not made its DOCKER-USER chain." \
    "Either Docker is not running — sudo systemctl start docker — or it manages the firewall some other way (its nftables option, firewalld's own integration), in which case these rules are not the way to do this on this machine. $(ipt --version 2>/dev/null || true)"
}

# One rule, as the arguments of -I/-C/-D after the chain, so add, status and the service cannot disagree.
rules() {
  printf '%s\n' "DOCKER-USER|-d ${METADATA} -m comment --comment ${COMMENT} -j REJECT"
  printf '%s\n' "INPUT|-i docker0 -p tcp -m multiport --dports ${PORTS} -m comment --comment ${COMMENT} -j REJECT --reject-with tcp-reset"
  printf '%s\n' "INPUT|-i br-+ -p tcp -m multiport --dports ${PORTS} -m comment --comment ${COMMENT} -j REJECT --reject-with tcp-reset"
  # After the REJECTs, because each is inserted at the top: these end up above them, and a packet from the panel's bridge never meets them.
  local bridge
  while IFS= read -r bridge; do
    [ -z "${bridge}" ] || printf '%s\n' "INPUT|-i ${bridge} -p tcp -m multiport --dports ${PORTS} -m comment --comment ${COMMENT} -j ACCEPT"
  done < <(excepted)
}

each() {
  local verb="$1" chain spec
  while IFS='|' read -r chain spec; do
    # shellcheck disable=SC2086 # the rule is words on purpose
    "${verb}" "${chain}" ${spec}
  done < <(rules)
}

present() { ipt -C "$@" >/dev/null 2>&1; }
put() { present "$@" || ipt -I "$@"; }

# Every rule that carries the comment, in either chain, whatever it was added with: a remove that rebuilt the list from --ports
# missed everything added with other ports, and said it had removed it.
remove_all() {
  local chain line removed=0
  local -a words
  for chain in INPUT DOCKER-USER; do
    while IFS= read -r line; do
      [ -n "${line}" ] || continue
      read -r -a words <<<"${line/#-A /-D }"
      if ipt "${words[@]}" 2>/dev/null; then removed=$((removed + 1)); fi
    done < <(ipt -S "${chain}" 2>/dev/null | grep -- "--comment ${COMMENT}" || true)
  done
  printf '%s' "${removed}"
}

case "${ACTION}" in
  add)
    need_docker_chain
    each put
    printf 'Containers on this machine can no longer reach 169.254.169.254, or TCP ports %s on the machine itself.\n' "${PORTS}"
    let_through="$(excepted | paste -sd, -)"
    if [ -n "${let_through}" ]; then
      printf 'Let through to those ports: %s.\n' "${let_through}"
      if panel_bridge >/dev/null 2>&1; then printf 'That includes the panel'"'"'s own network, %s, which calls the agent from a bridge of its own.\n' "${PANEL_NETWORK}"; fi
    else
      printf 'No panel network (%s) was found on this machine, so nothing is let through: a panel on another machine is not affected.\n' "${PANEL_NETWORK}"
    fi
    ;;
  remove)
    command -v iptables >/dev/null 2>&1 || die "iptables is not installed." "There are no rules to take away, and nothing was changed."
    n="$(remove_all)"
    printf 'The geeboard-container-firewall rules are removed (%s).\n' "${n}"
    ;;
  refresh)
    need_docker_chain
    # The ports it had, unless told others: read off a rule that is there. Nothing there is nothing to refresh.
    had="$(ipt -S INPUT 2>/dev/null | grep -- "--comment ${COMMENT}" | sed -n 's/.*--dports \([0-9,]*\) .*/\1/p' | head -n 1)"
    if [ -z "${had}" ]; then
      printf 'There are no geeboard-container-firewall rules to refresh.\n'
      exit 0
    fi
    [ "${PORTS_GIVEN:-0}" = "1" ] || PORTS="${had}"
    remove_all >/dev/null
    each put
    printf 'The geeboard-container-firewall rules are put back for ports %s, with the bridges as they are now: %s.\n' "${PORTS}" "$(excepted | paste -sd, - || true)"
    ;;
  status)
    need_docker_chain
    found=0
    expected=0
    while IFS='|' read -r chain spec; do
      expected=$((expected + 1))
      # shellcheck disable=SC2086
      if present "${chain}" ${spec}; then
        printf 'present  %s  %s\n' "${chain}" "${spec%% -m comment*}"
        found=$((found + 1))
      else
        printf 'missing  %s  %s\n' "${chain}" "${spec%% -m comment*}"
      fi
    done < <(rules)
    if bridge="$(panel_bridge)"; then
      printf 'The panel network %s is %s, and is let through.\n' "${PANEL_NETWORK}" "${bridge}"
    else
      printf 'No panel network (%s) on this machine.\n' "${PANEL_NETWORK}"
    fi
    # The rules go in at the top of INPUT, ahead of ufw's and firewalld's jumps; if something else has put itself above them, a reject is not the first word.
    first="$(ipt -S INPUT 2>/dev/null | sed -n '2p' || true)"
    case "${first}" in
      *"${COMMENT}"*) printf 'They are first in INPUT.\n' ;;
      *) printf 'Something else is above them in INPUT: %s\n' "${first}" ;;
    esac
    [ "${found}" = "${expected}" ]
    ;;
  install-service)
    command -v systemctl >/dev/null 2>&1 || die "This machine has no systemd to keep the rules with." "The rules would be gone at the next reboot, so none were added." "Put `bash $0 add` in whatever your system runs at boot, after Docker starts, and run it once now to see what it does."
    need_docker_chain
    # Not onto itself: run from its own copy, install refuses with "the same file".
    if [ "$(readlink -f "${BASH_SOURCE[0]}")" != "$(readlink -f "${SBIN}" 2>/dev/null || true)" ]; then
      install -m 0755 "${BASH_SOURCE[0]}" "${SBIN}"
    fi
    extra=""
    for bridge in "${EXCEPT[@]}"; do extra="${extra} --except-bridge ${bridge}"; done
    cat > "${UNIT}" <<UNITFILE
# Written by deploy/linux/container-firewall.sh install-service. Remove it with uninstall-service.
[Unit]
Description=Keep game containers away from this machine's own services and the cloud metadata service
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=${SBIN} add --ports ${PORTS}${extra}
ExecStop=${SBIN} remove

[Install]
WantedBy=multi-user.target
UNITFILE
    chmod 0644 "${UNIT}"
    systemctl daemon-reload
    systemctl enable geeboard-container-firewall >/dev/null
    systemctl restart geeboard-container-firewall
    printf 'The rules are in, and a unit puts them back at boot and when Docker restarts: %s\n' "${UNIT}"
    ;;
  uninstall-service)
    if command -v systemctl >/dev/null 2>&1; then
      systemctl disable --now geeboard-container-firewall >/dev/null 2>&1 || true
    fi
    rm -f "${UNIT}"
    command -v systemctl >/dev/null 2>&1 && systemctl daemon-reload || true
    if command -v iptables >/dev/null 2>&1; then
      n="$(remove_all)"
      printf 'The unit is removed, and so are the rules (%s).\n' "${n}"
    fi
    rm -f "${SBIN}"
    ;;
  *)
    die "Unknown action ${ACTION}." "add, remove, refresh, status, install-service or uninstall-service."
    ;;
esac
