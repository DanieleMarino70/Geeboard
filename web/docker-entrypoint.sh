#!/bin/sh
# The image's verbs. See the Dockerfile for why one image does all of them.
set -e
cd /app

# So a script can tell where it is running and name the right command back.
# `setup` prints the way to recover a lost temporary password, and the way
# differs: a verb on this image here, an npm script in a checkout.
export GEEBOARD_IN_IMAGE=1

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
    # Applies this release's migrations and nothing else: it never resets, never seeds, never prompts.
    node_modules/.bin/prisma migrate deploy
    # Then the catalog, from the definitions this image carries and with no network: a migration can add a
    # table or move data, and the games and versions this release ships have to be rows before a server is
    # made from one, not whenever the poller next asks upstream.
    exec node_modules/.bin/tsx --conditions=react-server scripts/sync-games.mts --offline
    ;;
  status)
    # Which migrations the database has applied, and which this image has that it does not.
    exec node_modules/.bin/prisma migrate status
    ;;
  resolve)
    # After a migration failed half-way and its cause was put right: `resolve --rolled-back <name>` (it will be
    # run again by `migrate`) or `resolve --applied <name>` (it was finished by hand). docs/upgrading.md.
    exec node_modules/.bin/prisma migrate resolve "$@"
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
  node-token)
    # A registration token for one node, for the panel installer: the secret alone on stdout.
    exec node_modules/.bin/tsx --conditions=react-server scripts/node-token.mts "$@"
    ;;
  rekey)
    # Change the key stored secrets are sealed with. The new key comes from the environment: -e SECRETS_KEY_NEW.
    exec node_modules/.bin/tsx --conditions=react-server scripts/rekey.mts "$@"
    ;;
  *)
    echo "geeboard: unknown command '$verb'. One of: panel, poller, migrate, status, resolve, setup, recover, sync, node-token, rekey." >&2
    exit 64
    ;;
esac
