# What an upgrade of the panel does around its migration. Sourced by deploy/linux/install-panel.sh, never run.
#
# Re-running the installer is the upgrade — the README says so — and what it did until 0.9 was to run `migrate`
# under the old panel and poller, which were still reading and writing the database, with no copy of it anywhere;
# to say "no data was changed" when a migration failed, though a migration that stops half-way is not rolled back;
# and to print nothing about how to go back. A 0.7.0 migration moves data and drops columns: there is no going
# back from it without a dump.
#
# POSIX sh, like common.sh. The words and the arithmetic are here, as functions of their arguments, so that
# deploy/lib/verify.sh holds them; what touches Docker is in the installer, which defines `compose`.

GB_BACKUP_DIR_DEFAULT="/var/backups/geeboard"

# upgrade_stamp — a sortable UTC time, 20261007T101500Z, for names that have to be unique and ordered.
upgrade_stamp() { date -u +%Y%m%dT%H%M%SZ; }

# human_bytes <bytes> — 1.5 GB, 320 MB.
human_bytes() {
  awk -v b="$1" 'BEGIN { if (b >= 1073741824) printf "%.1f GB", b / 1073741824; else { m = b / 1048576; printf "%d MB", (m < 1 ? 1 : m) } }'
}

# dump_room_needed <database bytes> — what a dump needs free: the database's own size and half as much again (a
# custom-format dump is usually far smaller, and this is not the moment to find out it was not), and 200 MB for
# whatever else is writing to the same disk.
dump_room_needed() {
  printf '%s\n' $(( $1 + $1 / 2 + 200 * 1024 * 1024 ))
}

# image_version_from_ref <image reference> — the version in an image's tag, when the tag is one
# (ghcr.io/…/geeboard-panel:0.8.1 gives 0.8.1; geeboard-panel:local gives nothing). A published image carries
# its version as a label, and one built from a checkout does not: this is what the words at the end fall back on.
image_version_from_ref() {
  _tag="${1##*:}"
  case "$1" in *:*) ;; *) return 0 ;; esac
  case "$_tag" in
    [0-9]*.[0-9]*.[0-9]*) printf '%s\n' "$_tag" ;;
  esac
}

# run_kind <had a panel: 0|1> <version before> <version now> — what this run was, in a word: "installed" when there
# was nothing, "upgraded" when what was there was another release (or one that cannot say which), "refreshed" when
# it was this release again. The words at the end follow it, so that a re-run does not tell somebody who has been
# using the panel for a year to open it and set up two-factor.
run_kind() {
  if [ "$1" != "1" ]; then printf 'installed\n'
  elif [ -n "$2" ] && [ "$2" = "$3" ]; then printf 'refreshed\n'
  else printf 'upgraded\n'
  fi
}

# migration_names — reads the output of `prisma migrate deploy` on stdin and prints the migrations it applied,
# one per line. Prisma draws them as a tree: `└─ 20261004100000_dns_records/`.
migration_names() {
  # No migration in the output is an answer, not a failure: grep says 1 for it, and the installer runs under set -e.
  grep -oE '[0-9]{14}_[A-Za-z0-9_]+' | sort -u || true
}

# undo_text <compose command> <dump> <secrets copy> <previous image> — the exact commands that put the panel back
# as it was before this upgrade, printed where a person will be looking for them: when a migration failed, and at
# the end of one that worked. The dump was taken with the panel and the poller stopped, so it is not "about" the
# state before — it is that state.
undo_text() {
  _c="$1"; _dump="$2"; _env="$3"; _img="$4"
  say "  The dump was taken with the panel stopped, so restoring it puts the data back exactly as it was."
  say "  From this checkout:"
  say ""
  say "    $_c stop panel poller"
  say "    $_c exec -T db sh -c 'dropdb -U geeboard geeboard && createdb -U geeboard geeboard'"
  say "    $_c exec -T db pg_restore -U geeboard -d geeboard < $_dump"
  if [ -n "$_img" ]; then
    say "    # then the old image, in deploy/panel/.env:  GEEBOARD_PANEL_IMAGE=$_img"
  else
    say "    # then the old image, in deploy/panel/.env: the GEEBOARD_PANEL_IMAGE the line above this one replaced"
  fi
  say "    $_c up -d"
  say ""
  say "  Its secrets file is at $_env; the upgrade does not change any secret, so it is only a copy."
}
