#!/usr/bin/env bash
# Removes the Geeboard node agent service from a Linux machine.
#
#   sudo bash deploy/linux/uninstall.sh [--purge]
#
# `bash …` rather than `./…`, the same as the installers: a checkout that
# arrived without its execute bits still has to be able to undo itself.
#
# Stops and disables the unit and removes it. The agent's settings in
# /etc/geeboard and the servers in /var/lib/geeboard are left alone unless
# --purge is given — and even then the game containers themselves are not
# touched: delete servers from the panel first, or remove the containers
# by hand, because a directory removed under a running container is not
# a clean end to anything. Remove the node from the panel afterwards.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo." >&2
  exit 1
fi

systemctl disable --now geeboard-agent 2>/dev/null || true
rm -f /etc/systemd/system/geeboard-agent.service
systemctl daemon-reload
docker rm -f geeboard-agent >/dev/null 2>&1 || true

if [ "${1:-}" = "--purge" ]; then
  rm -rf /etc/geeboard
  rm -rf /var/lib/geeboard
  echo "Removed the service, its settings and the data root."
else
  echo "Removed the service. Settings stay in /etc/geeboard and servers in /var/lib/geeboard (--purge removes both)."
fi
