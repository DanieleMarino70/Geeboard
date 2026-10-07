#!/usr/bin/env bash
# Puts a panel's database back from a dump, with the key it was sealed with — on this machine, or on a new one.
#
#   sudo bash deploy/linux/restore-panel.sh --dump <file.dump> --env <panel-….env> [--yes]
#
# For a machine that was lost: install the panel on the new one first (deploy/linux/install-panel.sh — it makes an empty database
# and its own secrets), then run this with the last dump and the secrets copied beside it (deploy/linux/dump-panel.sh makes both,
# every night). It:
#
#   1. reads the dump back, and checks the env copy holds a SECRETS_KEY;
#   2. stops the panel and the poller, and dumps what is in the database now, with this machine's .env, so that this can be undone;
#   3. replaces the database with the dump, and applies the migrations this release has that the dump does not;
#   4. puts the dump's SECRETS_KEY (and SESSION_SECRET, so that people stay signed in) into deploy/panel/.env, and starts again.
#
# SECRETS_KEY is what every stored node token, bucket key, DNS token, webhook address and two-factor secret was sealed with: without
# it the panel opens, and none of them can be read. POSTGRES_PASSWORD is not taken from the copy — it belongs to the database
# volume this machine made — and neither is PANEL_URL, which is this machine's address.
#
# What it cannot do: the game servers are on the nodes and are not touched, but the nodes call the panel at the address they were
# joined with. A panel at another address leaves them unreachable until each node is joined again (docs/nodes.md).
#
#   --dump <file>   the dump (geeboard-scheduled-….dump, or the one an upgrade took)
#   --env <file>    the .env copy taken beside it (panel-scheduled-….env)
#   --yes           do not ask
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# shellcheck source=../lib/common.sh
. "$REPO/deploy/lib/common.sh"
# shellcheck source=../lib/panel-env.sh
. "$REPO/deploy/lib/panel-env.sh"
# shellcheck source=../lib/upgrade.sh
. "$REPO/deploy/lib/upgrade.sh"

COMPOSE_FILE="$REPO/deploy/panel/docker-compose.yml"
ENV_FILE="$REPO/deploy/panel/.env"
DUMP_FILE=""; OLD_ENV=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dump) need_value --dump "$#" "${2:-}"; DUMP_FILE="$2"; shift 2 ;;
    --dump=*) DUMP_FILE="${1#--dump=}"; shift ;;
    --env) need_value --env "$#" "${2:-}"; OLD_ENV="$2"; shift 2 ;;
    --env=*) OLD_ENV="${1#--env=}"; shift ;;
    --yes|-y) GEEBOARD_ASSUME_YES=1; shift ;;
    --help|-h)
      awk 'NR > 1 && /^#/ { print; next } NR > 1 { exit }' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) die "Unknown option: $1" "" "--help lists them." ;;
  esac
done

need_root "deploy/linux/restore-panel.sh"
[ -n "$DUMP_FILE" ] && [ -n "$OLD_ENV" ] || die "Both a dump and its env copy are needed." "The database without the key it was sealed with is a database nobody can open." "sudo bash deploy/linux/restore-panel.sh --dump <file.dump> --env <panel-….env>"
[ -r "$DUMP_FILE" ] || die "Cannot read $DUMP_FILE."
[ -r "$OLD_ENV" ] || die "Cannot read $OLD_ENV."
require_docker
require_compose
compose() { $GB_COMPOSE --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

[ -f "$ENV_FILE" ] || die "The panel is not installed on this machine." "There is no $ENV_FILE, so there is no database to restore into." "Install it first — it makes the empty database and this machine's own secrets — then run this again:

  sudo bash deploy/linux/install-panel.sh"
compose ps -q db 2>/dev/null | grep -q . || die "The database container is not running." "" "sudo docker compose -f deploy/panel/docker-compose.yml up -d db"

OLD_KEY="$(env_get "$OLD_ENV" SECRETS_KEY || true)"
OLD_SESSION="$(env_get "$OLD_ENV" SESSION_SECRET || true)"
[ -n "$OLD_KEY" ] || die "$OLD_ENV has no SECRETS_KEY." "Without it nothing the dump holds sealed (node tokens, bucket keys, two-factor secrets) can be read." "Use the .env copy that was taken beside this dump."

ENTRIES="$(compose exec -T db pg_restore --list < "$DUMP_FILE" 2>/dev/null | grep -c '^[0-9][0-9]*;' || true)"
[ "${ENTRIES:-0}" -ge 1 ] || die "$DUMP_FILE does not read as a dump (pg_restore finds ${ENTRIES:-0} objects in it)." "Nothing was changed."
ok "The dump reads back: $ENTRIES objects"

NEW_KEY="$(env_get "$ENV_FILE" SECRETS_KEY || true)"
if [ "$OLD_KEY" = "$NEW_KEY" ]; then info "This machine already holds the dump's SECRETS_KEY"; else info "This machine's SECRETS_KEY is not the dump's; the dump's is put in once the database is back"; fi

say ""
say "This replaces the panel's database on this machine with $DUMP_FILE."
say "What is in it now is dumped first, with this machine's .env, so that it can be put back."
if [ "$GEEBOARD_ASSUME_YES" != "1" ]; then
  gb_interactive || die "This asks before it replaces a database, and nobody can be asked here." "Nothing was changed." "Run it from a terminal, or add --yes."
  confirm "Go on?" no || die "Nothing was changed."
fi

STAMP="$(upgrade_stamp)"
DIR="$GB_BACKUP_DIR_DEFAULT"
(umask 077; mkdir -p "$DIR") && chmod 700 "$DIR" 2>/dev/null || true
BEFORE="$DIR/geeboard-before-restore-$STAMP.dump"
BEFORE_ENV="$DIR/panel-before-restore-$STAMP.env"

info "Stopping the panel and the poller"
compose stop panel poller >/dev/null 2>&1 || true

undo() {
  say ""
  say "To put back what was here before this:"
  say "  $GB_COMPOSE -f deploy/panel/docker-compose.yml stop panel poller"
  say "  $GB_COMPOSE -f deploy/panel/docker-compose.yml exec -T db sh -c 'dropdb -U geeboard geeboard && createdb -U geeboard geeboard'"
  say "  $GB_COMPOSE -f deploy/panel/docker-compose.yml exec -T db pg_restore -U geeboard -d geeboard < $BEFORE"
  say "  cp $BEFORE_ENV deploy/panel/.env   # then: $GB_COMPOSE -f deploy/panel/docker-compose.yml up -d"
}

if ! (umask 077; compose exec -T db pg_dump -U geeboard -Fc geeboard > "$BEFORE.partial"); then
  rm -f "$BEFORE.partial"
  compose start panel poller >/dev/null 2>&1 || true
  die "What is in the database now could not be dumped." "The panel was started again and nothing was changed."
fi
mv "$BEFORE.partial" "$BEFORE"
(umask 077; cp "$ENV_FILE" "$BEFORE_ENV")
ok "What was here is kept: $BEFORE"

info "Replacing the database"
if ! compose exec -T db sh -c 'dropdb -U geeboard geeboard && createdb -U geeboard geeboard'; then
  undo
  die "The database could not be recreated." "The panel is stopped."
fi
if ! compose exec -T db pg_restore -U geeboard -d geeboard < "$DUMP_FILE"; then
  undo
  die "The dump could not be restored." "The panel is stopped, and the database is what pg_restore left."
fi
ok "The dump is restored"

info "Applying the migrations this release has that the dump does not"
if ! compose run --rm panel migrate; then
  undo
  die "A migration did not apply." "The panel is stopped. The lines above are what Prisma said."
fi

# Last, and only now: the database is whole, so the key that opens it goes in. env_set writes a new file and moves it into place.
env_set "$ENV_FILE" SECRETS_KEY "$OLD_KEY"
[ -z "$OLD_SESSION" ] || env_set "$ENV_FILE" SESSION_SECRET "$OLD_SESSION"
ok "SECRETS_KEY is the dump's; people who were signed in stay signed in"

compose up -d >/dev/null
info "Starting the panel"
PANEL_LOCAL="$(panel_bind_url "$(env_get "$ENV_FILE" PANEL_BIND || true)")"
panel_answers() { [ "$(http_code "$PANEL_LOCAL/api/health")" = "200" ]; }
wait_for 90 "The panel answers on $PANEL_LOCAL" panel_answers \
  || warn "$GB_COMPOSE -f deploy/panel/docker-compose.yml logs panel says why"

say ""
say "The panel is back with the accounts, nodes, servers, schedules and records of backups the dump held."
say "Its nodes call it at the address they were joined with: $(env_get "$ENV_FILE" PANEL_URL || true) is this machine's."
say "If that is not the address of the panel that was lost, each node has to be joined again (docs/nodes.md)."
undo
