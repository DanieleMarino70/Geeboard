#!/bin/sh
# The container's two verbs: `start` runs the agent from the saved
# settings, `join` registers this machine with a panel and saves them.
#
#   docker run --rm ... geeboard-agent join <panel> <token> [--advertise ...]
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
  *)
    exec "$@"
    ;;
esac
