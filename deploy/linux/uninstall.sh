#!/usr/bin/env bash
# Removes the Geeboard node agent service from a Linux machine.
#
#   sudo bash deploy/linux/uninstall.sh [--purge] [--even-with-servers] [--yes]
#
# `bash …` rather than `./…`, the same as the installers: a checkout that
# arrived without its execute bits still has to be able to undo itself.
#
# Stops and disables the unit, removes it, and takes away the rules that closed the agent's port
# (deploy/linux/agent-port.sh): the agent is gone, and so is the port they were for. The agent's
# settings in /etc/geeboard and the servers in /var/lib/geeboard are left alone unless --purge
# is given. The game containers themselves are never touched: delete servers from the panel
# first, or remove the containers by hand, because a directory removed under a running container
# is not a clean end to anything. Remove the node from the panel afterwards.
#
#   --purge               also remove /etc/geeboard (the node's settings and its token, which is
#                         the one the panel holds the other half of) and /var/lib/geeboard (every
#                         server's world, and the node-local backups), the agent's images, and the
#                         container firewall's unit and rules if this machine has them. Lists what
#                         there is and its size, and asks for a word before it deletes anything.
#   --even-with-servers   --purge refuses while a game server's container exists, because a world
#                         removed under one is lost with it. This says it is meant.
#   --yes                 no question (for a script). It does not lift the refusal above.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# shellcheck source=../lib/common.sh
. "$REPO/deploy/lib/common.sh"

PURGE=0
EVEN=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --purge) PURGE=1; shift ;;
    --even-with-servers) EVEN=1; shift ;;
    --yes|-y) GEEBOARD_ASSUME_YES=1; shift ;;
    --help|-h)
      awk 'NR > 1 && /^#/ { print; next } NR > 1 { exit }' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    # Anything else used to run the uninstall: `--help`, `-h`, `--purg`, `--yes`.
    *) die "I do not know the option $1." "Nothing was changed." "Run it with --help to see the ones there are." ;;
  esac
done

need_root "deploy/linux/uninstall.sh"

# What would be lost, said before anything is.
LABEL="gg.geeboard.server"
if [ -r /etc/geeboard/agent.env ]; then
  _l="$(sed -n 's/^GEEBOARD_MANAGED_LABEL=//p' /etc/geeboard/agent.env | head -n 1)"
  [ -z "$_l" ] || LABEL="$_l"
fi
SERVERS=0
if have docker && docker info >/dev/null 2>&1; then
  SERVERS="$(docker ps -aq --filter "label=$LABEL" 2>/dev/null | grep -c . || true)"
fi
SIZE="$(du -sh /var/lib/geeboard 2>/dev/null | cut -f1 || true)"

if [ "$PURGE" = "1" ]; then
  say ""
  say "  --purge removes:"
  say "    /etc/geeboard        the node's settings and its token"
  say "    /var/lib/geeboard    ${SIZE:-nothing here} — every server's files and the backups kept on this node"
  say "    the agent's images, and the container firewall's unit and rules, if they are here"
  say "  and there are $SERVERS game server container(s) on this machine."
  say ""
  if [ "$SERVERS" -gt 0 ] && [ "$EVEN" != "1" ]; then
    die "Not removing the data root: $SERVERS game server container(s) exist." \
      "Removing a world under a container loses it. Nothing was changed, and the agent is still installed." \
      "Delete the servers from the panel (or remove the containers: docker ps -a --filter label=$LABEL), and run this again — or, if you mean it, add --even-with-servers."
  fi
  if [ "${GEEBOARD_ASSUME_YES:-0}" != "1" ]; then
    if ! gb_interactive; then
      die "There is nobody to ask, and this deletes worlds." "Nothing was changed." "Run it at a terminal, or add --yes."
    fi
    _word="$(ask 'Type "delete" to remove them' '')"
    [ "$_word" = "delete" ] || die "Not confirmed. Nothing was changed." "" "The agent is still installed."
  fi
fi

if have systemctl; then
  systemctl disable --now geeboard-agent 2>/dev/null || true
  rm -f /etc/systemd/system/geeboard-agent.service
  systemctl daemon-reload
fi
if have docker; then docker rm -f geeboard-agent >/dev/null 2>&1 || true; fi
ok "The agent's service is removed"

# The rules that closed the agent's port were for the agent. Gone with it.
if [ -f /etc/geeboard/agent-port.conf ] || [ -f /etc/systemd/system/geeboard-agent-port.service ]; then
  if bash "$HERE/agent-port.sh" remove >/dev/null 2>&1; then
    ok "The rules that closed the agent's port are removed"
  else
    warn "The rules that closed the agent's port could not be removed: sudo bash deploy/linux/agent-port.sh remove"
  fi
fi

if [ "$PURGE" = "1" ]; then
  rm -rf /etc/geeboard
  rm -rf /var/lib/geeboard
  ok "Removed /etc/geeboard and /var/lib/geeboard (${SIZE:-empty})"
  if have docker; then
    _images="$(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -E '(^|/)geeboard-agent:' || true)"
    if [ -n "$_images" ]; then
      # shellcheck disable=SC2086
      docker rmi $_images >/dev/null 2>&1 && ok "Removed the agent's image(s)" || warn "An agent image is still in use, or could not be removed: docker images | grep geeboard-agent"
    fi
  fi
  if [ -f /etc/systemd/system/geeboard-container-firewall.service ]; then
    bash "$HERE/container-firewall.sh" uninstall-service >/dev/null 2>&1 && ok "Removed the container firewall's unit and rules" || warn "The container firewall could not be removed: sudo bash deploy/linux/container-firewall.sh uninstall-service"
  fi
  say ""
  say "Remove the node from the panel: Nodes → this node → Remove."
else
  say ""
  say "Settings stay in /etc/geeboard and servers in /var/lib/geeboard${SIZE:+ ($SIZE)} (--purge removes both, after asking)."
  if [ -f /etc/systemd/system/geeboard-container-firewall.service ]; then
    say "The container firewall is still on: sudo bash deploy/linux/container-firewall.sh uninstall-service takes it away."
  fi
fi
