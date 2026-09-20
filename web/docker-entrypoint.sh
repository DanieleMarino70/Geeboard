#!/bin/sh
# The image's verbs. See the Dockerfile for why one image does all of them.
set -e
cd /app

verb="${1:-panel}"
[ "$#" -gt 0 ] && shift

case "$verb" in
  panel)
    # Refuses to start on a missing, short or example secret — src/instrumentation.ts.
    exec node_modules/.bin/next start -p "${PORT:-3000}" -H "${HOSTNAME:-0.0.0.0}"
    ;;
  poller)
    exec node_modules/.bin/tsx --conditions=react-server scripts/poller.mts "$@"
    ;;
  migrate)
    exec node_modules/.bin/prisma migrate deploy
    ;;
  setup)
    exec node_modules/.bin/tsx --conditions=react-server scripts/setup.mts "$@"
    ;;
  recover)
    exec node_modules/.bin/tsx --conditions=react-server scripts/admin-recover.mts "$@"
    ;;
  sync)
    exec node_modules/.bin/tsx --conditions=react-server scripts/sync-games.mts "$@"
    ;;
  *)
    echo "geeboard: unknown command '$verb'. One of: panel, poller, migrate, setup, recover, sync." >&2
    exit 64
    ;;
esac
