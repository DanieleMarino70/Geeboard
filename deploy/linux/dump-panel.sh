#!/usr/bin/env bash
# Takes a dump of the panel's database, with the secrets beside it, and keeps the last few.
#
#   sudo bash deploy/linux/dump-panel.sh [--dir <dir>] [--keep <n>]
#
# The installer sets a timer that runs this every night (geeboard-dump.timer; --no-nightly-dump leaves it out). The panel's
# database is where the accounts, the nodes, the servers, the schedules and every record of a backup live, and `deploy/panel/.env`
# holds the key every stored node token and bucket key is sealed with: a machine that dies with only one of the two leaves nothing
# that can be opened. Before this, the only dump was the one an upgrade takes, and a panel that was not upgraded had none.
# deploy/linux/restore-panel.sh puts them back, on this machine or a new one. Copy the directory off the machine.
#
#   --dir <dir>    where the dumps go (default /var/backups/geeboard, readable by root only)
#   --keep <n>     how many nightly dumps to keep (default 14); the dumps an upgrade takes are never removed by this
#
# A dump that does not read back is not kept and the run fails, so that a timer that has stopped working shows as a failed unit.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# shellcheck source=../lib/common.sh
. "$REPO/deploy/lib/common.sh"
# shellcheck source=../lib/upgrade.sh
. "$REPO/deploy/lib/upgrade.sh"

COMPOSE_FILE="$REPO/deploy/panel/docker-compose.yml"
ENV_FILE="$REPO/deploy/panel/.env"
DIR="$GB_BACKUP_DIR_DEFAULT"
KEEP=14

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dir) need_value --dir "$#" "${2:-}"; DIR="$2"; shift 2 ;;
    --dir=*) DIR="${1#--dir=}"; shift ;;
    --keep) need_value --keep "$#" "${2:-}"; KEEP="$2"; shift 2 ;;
    --keep=*) KEEP="${1#--keep=}"; shift ;;
    --help|-h)
      awk 'NR > 1 && /^#/ { print; next } NR > 1 { exit }' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) die "Unknown option: $1" "" "--help lists them." ;;
  esac
done
case "$KEEP" in ''|*[!0-9]*|0) die "--keep needs a whole number of one or more." ;; esac

need_root "deploy/linux/dump-panel.sh"
require_docker
require_compose
compose() { $GB_COMPOSE --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

[ -f "$ENV_FILE" ] || die "There is no $ENV_FILE." "This is not a machine the panel is installed on, or its configuration was moved." "deploy/linux/install-panel.sh installs it."
compose ps -q db 2>/dev/null | grep -q . || die "The database container is not running." "There is nothing to dump." "sudo docker compose -f deploy/panel/docker-compose.yml up -d db"

(umask 077; mkdir -p "$DIR") || die "Could not make $DIR."
chmod 700 "$DIR" 2>/dev/null || true

DB_BYTES="$(compose exec -T db psql -U geeboard -d geeboard -Atc "select pg_database_size('geeboard')" 2>/dev/null | tr -dc '0-9' || true)"
NEED="$(dump_room_needed "${DB_BYTES:-0}")"
FREE_KB="$(df -Pk "$DIR" 2>/dev/null | awk 'NR==2 {print $4}' || true)"
if [ -n "$FREE_KB" ] && [ $((FREE_KB * 1024)) -lt "$NEED" ]; then
  die "Not enough room for the dump: it needs about $(human_bytes "$NEED"), and $DIR has $(human_bytes $((FREE_KB * 1024))) free." "Nothing was written." "Free some room, or give --dir another place."
fi

STAMP="$(upgrade_stamp)"
DUMP="$DIR/geeboard-scheduled-$STAMP.dump"
if ! (umask 077; compose exec -T db pg_dump -U geeboard -Fc geeboard > "$DUMP.partial"); then
  rm -f "$DUMP.partial"
  die "The database could not be dumped." "Nothing was kept."
fi
ENTRIES="$(compose exec -T db pg_restore --list < "$DUMP.partial" 2>/dev/null | grep -c '^[0-9][0-9]*;' || true)"
if [ "${ENTRIES:-0}" -lt 1 ]; then
  rm -f "$DUMP.partial"
  die "The dump does not read back (pg_restore finds ${ENTRIES:-0} objects in it)." "It was not kept."
fi
mv "$DUMP.partial" "$DUMP"
(umask 077; cp "$ENV_FILE" "$DIR/panel-scheduled-$STAMP.env")
chmod 600 "$DUMP" "$DIR/panel-scheduled-$STAMP.env"

# The oldest nightly dumps beyond the last $KEEP, each with the secrets copied beside it. The names sort by time. An upgrade's dump
# (geeboard-<stamp>-from-<version>.dump) does not match, and is the owner's to remove.
REMOVED=0
# shellcheck disable=SC2012
for old in $(ls -1 "$DIR"/geeboard-scheduled-*.dump 2>/dev/null | sort | head -n "-$KEEP"); do
  rm -f "$old" "$DIR/panel-scheduled-$(basename "$old" .dump | sed 's/^geeboard-scheduled-//').env"
  REMOVED=$((REMOVED + 1))
done

ok "Dumped the database: $DUMP ($(human_bytes "$(wc -c < "$DUMP")"), $ENTRIES objects), and the secrets beside it"
[ "$REMOVED" = "0" ] || info "Removed $REMOVED older nightly dump(s); the last $KEEP are kept"
note "Copy $DIR off this machine: a dump on the disk that fails is no use."
