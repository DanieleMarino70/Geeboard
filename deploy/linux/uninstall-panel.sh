#!/usr/bin/env bash
# Takes the Geeboard panel down, and says what it left.
#
#   sudo bash deploy/linux/uninstall-panel.sh [--volumes] [--env] [--caddyfile] [--images] [--yes]
#
# With no option it stops and removes the panel, the poller and the database containers, and leaves
# everything that is data: the database's volume (accounts, nodes, servers, backups' records), the
# secrets in deploy/panel/.env, Caddy's configuration and the images. Nothing is lost, and
# `sudo bash deploy/linux/install-panel.sh` brings it back as it was — which is also how to move a
# panel's stack, or to change its address.
#
#   --volumes     also delete the database. This is the one that cannot be undone, so it takes a
#                 dump first (into /var/backups/geeboard, readable by root only, with the secrets
#                 beside it) and asks for a word. --no-backup skips the dump if you have your own.
#   --env         also delete deploy/panel/.env. Only with --volumes: the database without the
#                 secrets it is read with is a database nobody can open.
#   --caddyfile   also take away /etc/caddy/Caddyfile — only if it is the one this installer wrote
#                 (its first line says so) — put back the one that was there before, if a copy was
#                 kept, and reload Caddy. Also removes /etc/geeboard/panel-ca.crt.
#   --images      also remove the panel's images.
#   --yes         no question (for a script). --volumes still takes its dump.
#
# It never removes a game server, a node or an agent: those are the node's, and
# deploy/linux/uninstall.sh removes it. Remove the nodes from the panel first if the panel is going
# for good, or they will keep calling an address nobody answers.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# shellcheck source=../lib/common.sh
. "$REPO/deploy/lib/common.sh"
# shellcheck source=../lib/caddy.sh
. "$REPO/deploy/lib/caddy.sh"
# shellcheck source=../lib/upgrade.sh
. "$REPO/deploy/lib/upgrade.sh"

COMPOSE_FILE="$REPO/deploy/panel/docker-compose.yml"
ENV_FILE="$REPO/deploy/panel/.env"
VOLUMES=0; REMOVE_ENV=0; REMOVE_CADDY=0; REMOVE_IMAGES=0; NO_BACKUP=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --volumes) VOLUMES=1; shift ;;
    --env) REMOVE_ENV=1; shift ;;
    --caddyfile) REMOVE_CADDY=1; shift ;;
    --images) REMOVE_IMAGES=1; shift ;;
    --no-backup) NO_BACKUP=1; shift ;;
    --yes|-y) GEEBOARD_ASSUME_YES=1; shift ;;
    --help|-h)
      awk 'NR > 1 && /^#/ { print; next } NR > 1 { exit }' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "I do not know the option $1." "Nothing was changed." "Run it with --help to see the ones there are." ;;
  esac
done

need_root "deploy/linux/uninstall-panel.sh"
[ -f "$COMPOSE_FILE" ] || die "This is not a Geeboard checkout." "$COMPOSE_FILE is not here." "Run it from the directory git clone made."
detect_os || true
require_docker
require_compose
gb_init_run

if [ "$REMOVE_ENV" = "1" ] && [ "$VOLUMES" != "1" ]; then
  die "--env needs --volumes." \
    "Keeping the database and deleting the secrets it is read with leaves a database nobody can open. Nothing was changed." \
    "Either keep both (no options), or remove both: --volumes --env."
fi

compose() { $GB_COMPOSE ${ENV_FILE:+--env-file "$ENV_FILE"} -f "$COMPOSE_FILE" "$@"; }
[ -f "$ENV_FILE" ] || { warn "There is no deploy/panel/.env, so compose is told nothing it needs: only what can be done without it is done."; ENV_FILE=""; }

# What is here, before anything goes.
RUNNING="$(compose ps -q 2>/dev/null | grep -c . || true)"
PROJECT="${COMPOSE_PROJECT_NAME:-geeboard-panel}"
VOLUME_NAME="$(docker volume ls -q 2>/dev/null | grep -x "${PROJECT}_db" || true)"
say ""
say "  The panel's stack: $RUNNING container(s) here."
say "  The database: ${VOLUME_NAME:-no volume found}."
say ""

# A dump first, whenever the database is about to go.
if [ "$VOLUMES" = "1" ]; then
  if [ "$NO_BACKUP" != "1" ]; then
    DB_CONTAINER="$(compose ps -q db 2>/dev/null | head -n 1 || true)"
    if [ -z "$DB_CONTAINER" ] && [ -n "$ENV_FILE" ]; then
      compose up -d db >/dev/null 2>&1 || true
      for _ in $(seq 1 30); do
        [ "$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q db 2>/dev/null | head -n 1)" 2>/dev/null || true)" = "healthy" ] && break
        sleep 1
      done
    fi
    BACKUP_DIR="$GB_BACKUP_DIR_DEFAULT"
    (umask 077; mkdir -p "$BACKUP_DIR")
    STAMP="$(upgrade_stamp)"
    DUMP="$BACKUP_DIR/geeboard-$STAMP-before-removal.dump"
    if (umask 077; compose exec -T db pg_dump -U geeboard -Fc geeboard > "$DUMP.partial" 2>/dev/null) && [ -s "$DUMP.partial" ]; then
      mv "$DUMP.partial" "$DUMP"
      [ -z "$ENV_FILE" ] || (umask 077; cp "$ENV_FILE" "$BACKUP_DIR/panel-$STAMP.env")
      ok "Database dumped before it goes: $DUMP ($(human_bytes "$(wc -c < "$DUMP" | tr -d ' ')"))"
      note "With its secrets beside it. Both are readable by root only; keep them off this machine."
    else
      rm -f "$DUMP.partial"
      die "The database could not be dumped, so it is not being deleted." \
        "Nothing was changed." \
        "Start it (compose up -d db) and run this again, or run with --no-backup if you have a dump of your own."
    fi
  else
    warn "No dump: --no-backup. Once the volume is gone the accounts, nodes and servers' records are gone with it."
  fi
  if [ "${GEEBOARD_ASSUME_YES:-0}" != "1" ]; then
    gb_interactive || die "There is nobody to ask, and this deletes the database." "Nothing was changed except the dump." "Run it at a terminal, or add --yes."
    _word="$(ask 'Type "delete the database" to go on' '')"
    [ "$_word" = "delete the database" ] || die "Not confirmed. The database is still here." "" "The dump, if one was taken, is where it says above."
  fi
fi

# The containers.
if [ -n "$ENV_FILE" ] || [ "$RUNNING" != "0" ]; then
  if [ "$VOLUMES" = "1" ]; then
    compose down -v --remove-orphans >/dev/null 2>&1 && ok "The panel, the poller and the database are removed, and the database's volume with them" || die "compose down did not finish." "" "$GB_COMPOSE -f deploy/panel/docker-compose.yml down -v says why."
  else
    compose down --remove-orphans >/dev/null 2>&1 && ok "The panel, the poller and the database are stopped and removed; the database's volume is kept" || die "compose down did not finish." "" "$GB_COMPOSE -f deploy/panel/docker-compose.yml down says why."
  fi
fi

# The nightly dump's timer: a panel that is gone has nothing to dump, and a timer that fails every night is noise. The dumps it made stay.
if [ -f /etc/systemd/system/geeboard-dump.timer ] && have systemctl; then
  systemctl disable --now geeboard-dump.timer >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/geeboard-dump.timer /etc/systemd/system/geeboard-dump.service
  systemctl daemon-reload >/dev/null 2>&1 || true
  ok "The nightly dump's timer is removed; the dumps it made are kept in $GB_BACKUP_DIR_DEFAULT"
fi

# The updater's timer, for the same reason: there is no panel left to ask for an upgrade.
if [ -f /etc/systemd/system/geeboard-self-update.timer ] && have systemctl; then
  systemctl disable --now geeboard-self-update.timer >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/geeboard-self-update.timer /etc/systemd/system/geeboard-self-update.service
  systemctl daemon-reload >/dev/null 2>&1 || true
  ok "The timer that upgraded from the Updates page is removed"
fi

if [ "$REMOVE_ENV" = "1" ] && [ -f "$REPO/deploy/panel/.env" ]; then
  rm -f "$REPO/deploy/panel/.env"
  ok "deploy/panel/.env is removed (the dump's secrets copy is in /var/backups/geeboard)"
fi

if [ "$REMOVE_CADDY" = "1" ]; then
  if [ -f "$CADDYFILE" ] && head -n 1 "$CADDYFILE" | grep -q "$CADDY_MARKER"; then
    # shellcheck disable=SC2012
    _before="$(ls -1t "$CADDYFILE".before-geeboard.* 2>/dev/null | tail -n 1 || true)"
    if [ -n "$_before" ]; then
      cp -p "$_before" "$CADDYFILE"
      ok "The Caddyfile that was there before is back ($_before)"
    else
      : > "$CADDYFILE"
      ok "The Caddyfile this installer wrote is emptied: there was none before it"
    fi
    if caddy_has_unit && systemctl is-active --quiet caddy; then systemctl reload caddy >/dev/null 2>&1 || systemctl restart caddy >/dev/null 2>&1 || true; fi
    rm -f /etc/geeboard/panel-ca.crt
  elif [ -f "$CADDYFILE" ]; then
    warn "$CADDYFILE is not the one this installer wrote (its first line does not say so), so it was left alone."
  fi
fi

if [ "$REMOVE_IMAGES" = "1" ]; then
  _images="$(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -E '(^|/)geeboard-panel:' || true)"
  if [ -n "$_images" ]; then
    # shellcheck disable=SC2086
    docker rmi $_images >/dev/null 2>&1 && ok "Removed the panel's images" || warn "An image is still in use: docker images | grep geeboard-panel"
  fi
fi

say ""
say "What is left:"
[ "$VOLUMES" = "1" ] || say "  the database, in the volume ${VOLUME_NAME:-geeboard-panel_db}; install-panel.sh brings the panel back on it"
[ -f "$REPO/deploy/panel/.env" ] && say "  deploy/panel/.env, with the secrets the database is read with"
[ "$REMOVE_CADDY" = "1" ] || say "  Caddy and its configuration ($CADDYFILE); the package stays whatever this does: sudo apt remove caddy"
[ "$REMOVE_IMAGES" = "1" ] || say "  the images (--images removes the panel's)"
say "  every node and every agent: the nodes keep calling the panel's address until they are removed from it, or the panel comes back"
