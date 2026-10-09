#!/usr/bin/env bash
# The machine's half of the Updates page's button: upgrades the panel to the release an owner asked for.
#
#   sudo bash deploy/linux/self-update.sh
#
# Run every minute by geeboard-self-update.timer, which the panel's installer sets (--no-self-update leaves it out). The panel
# cannot upgrade itself: it is a container, and an upgrade stops it. So the button writes a row (panel_update_requests), and this
# reads it, from this machine, as root: it checks the release is one this checkout's origin has tagged and is newer than what
# runs, moves the checkout to it, runs the installer with --yes (which takes a dump, migrates, and stops by itself when a server is
# in the middle of an operation), and writes back how it went with the end of what the installer printed, the way back included.
#
# It asks the panel's database nothing but that row, and writes nothing but that row and the time it last looked
# (update_checks."updaterSeenAt", which is how the page knows this machine has an updater). It never installs anything a row
# names but a tag of the checkout's own origin that is newer than the running release.
set -euo pipefail

# Everything is in a function, called on the last line: the checkout is moved to another release while this runs, which
# rewrites this very file, and bash reads a script as it goes. A function is read whole before any of it runs.
main() {
  local here repo compose_file env_file log_dir
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  repo="$(cd "$here/../.." && pwd)"
  compose_file="$repo/deploy/panel/docker-compose.yml"
  env_file="$repo/deploy/panel/.env"
  log_dir="/var/log/geeboard"

  # shellcheck source=../lib/common.sh
  . "$repo/deploy/lib/common.sh"
  [ -f "$env_file" ] || exit 0
  require_compose >/dev/null 2>&1 || exit 0

  q() { $GB_COMPOSE --env-file "$env_file" -f "$compose_file" exec -T db psql -U geeboard -d geeboard -v ON_ERROR_STOP=1 -qtAX -c "$1"; }

  # Alive, whether there is anything to do or not. A database that is not up (or not at the release that has the column) is not
  # a failure of this unit: the next minute asks again.
  q "INSERT INTO update_checks (id, \"updaterSeenAt\", \"updatedAt\") VALUES ('panel', now(), now()) ON CONFLICT (id) DO UPDATE SET \"updaterSeenAt\" = now()" >/dev/null 2>&1 || exit 0

  local row id version
  row="$(q "SELECT id || ' ' || version FROM panel_update_requests WHERE state = 'PENDING' ORDER BY \"requestedAt\" LIMIT 1" 2>/dev/null || true)"
  [ -n "$row" ] || exit 0
  id="${row%% *}"
  version="${row#* }"
  # The row is the database's; what goes back into a statement or a command is held to these shapes first.
  [[ "$id" =~ ^[a-z0-9]{8,40}$ ]] || exit 0

  # Not local: the EXIT trap below reads it after main has returned.
  GB_SELF_UPDATE_ANSWERED=0
  finish() {
    local state="$1" text="$2" escaped
    GB_SELF_UPDATE_ANSWERED=1
    # Lines, not bytes (a byte cut can split a character the database then refuses), without the installer's colours.
    escaped="$(printf '%s\n' "$text" | tail -n 80 | sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' -e "s/'/''/g")"
    q "UPDATE panel_update_requests SET state = '$state', \"finishedAt\" = now(), log = '$escaped' WHERE id = '$id'" >/dev/null 2>&1 || true
  }

  unanswered() {
    local code=$?
    [ "$GB_SELF_UPDATE_ANSWERED" = 1 ] || finish FAILED "The updater stopped (exit $code) before the installer was done. On the machine: journalctl -u geeboard-self-update -n 50."
  }

  if ! [[ "$version" =~ ^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}$ ]]; then
    finish REFUSED "\"$version\" is not a release number."
    exit 0
  fi
  # Claimed, so a second run (or a second machine on the same database) does not take it too.
  local claimed
  claimed="$(q "UPDATE panel_update_requests SET state = 'RUNNING', \"startedAt\" = now() WHERE id = '$id' AND state = 'PENDING' RETURNING id" 2>/dev/null || true)"
  [ "$claimed" = "$id" ] || exit 0
  # Claimed, it is answered whatever happens next: a step that fails under set -e would otherwise leave the row "running" for good,
  # and the page waiting on a machine that has stopped.
  trap unanswered EXIT

  cd "$repo"
  local running
  running="$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' web/package.json | head -n 1)"
  if [ "$(printf '%s\n%s\n' "$running" "$version" | sort -V | tail -n 1)" != "$version" ] || [ "$running" = "$version" ]; then
    finish REFUSED "This machine runs $running, and $version is not newer. Nothing was changed."
    exit 0
  fi
  if ! git fetch --quiet --tags origin 2>/tmp/geeboard-self-update-fetch.log; then
    finish FAILED "git fetch from this checkout's origin failed, so nothing was changed: $(tail -n 3 /tmp/geeboard-self-update-fetch.log)"
    exit 0
  fi
  if ! git rev-parse -q --verify "refs/tags/v$version^{commit}" >/dev/null; then
    finish REFUSED "v$version is not a tag of this checkout's origin ($(git remote get-url origin 2>/dev/null || echo 'no origin')). Nothing was changed."
    exit 0
  fi
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    finish REFUSED "The checkout at $repo has changes of its own, and moving it to v$version would mix them in. Nothing was changed. On the machine: git status, then git stash or git checkout -- the files, and ask again."
    exit 0
  fi

  # On the stable branch it moves forward to the tag, so a person's later `git pull` still works; anywhere else it checks the tag out.
  local branch
  branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
  if [ "$branch" = "stable" ] && git merge-base --is-ancestor HEAD "v$version" 2>/dev/null; then
    git merge --quiet --ff-only "v$version"
  else
    git -c advice.detachedHead=false checkout --quiet "v$version"
  fi

  install -d -m 0700 "$log_dir" 2>/dev/null || log_dir="$(mktemp -d)"
  local log
  log="$log_dir/self-update-$(date -u +%Y%m%dT%H%M%SZ)-$version.log"
  if bash "$repo/deploy/linux/install-panel.sh" --yes > "$log" 2>&1; then
    finish DONE "$(tail -n 40 "$log")"
  else
    finish FAILED "$(tail -n 60 "$log")

The whole of it is on the machine, in $log."
  fi
}

main "$@"
exit $?
