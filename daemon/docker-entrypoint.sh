#!/bin/sh
# The container's verbs: `start` runs the agent from the saved settings,
# `join` registers this machine with a panel and saves them, `terminal`
# switches the node terminal on or off in those settings, `pin-ca` keeps a panel's
# certificate authority (see src/panel-ca.ts).
#
#   docker run --rm ... geeboard-agent join <panel> <token> [--advertise ...] [--terminal]
#   docker run --rm ... geeboard-agent pin-ca <panel> <sha256:fingerprint | file> <where to keep it>
#   docker run --rm ... geeboard-agent terminal on|off
#   docker run -d  ... geeboard-agent            (start)
#
# join never starts the agent here: the service that runs this image does.
set -e
cd /opt/geeboard/daemon

case "${1:-start}" in
  start)
    shift
    exec node --import tsx src/index.ts "$@"
    ;;
  join)
    shift
    exec node --import tsx src/join.ts "$@" --no-start
    ;;
  terminal)
    shift
    exec node --import tsx src/terminal-switch.ts "$@"
    ;;
  pin-ca)
    shift
    exec node --import tsx src/panel-ca.ts "$@"
    ;;
  *)
    exec "$@"
    ;;
esac
