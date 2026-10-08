# shellcheck shell=sh disable=SC2034
# Shared by every installer in deploy/. Sourced, never run.
#
#   . "$(dirname "$0")/../lib/common.sh"
#
# POSIX sh, because deploy/panel/init.sh is /bin/sh and the two installers
# are bash: one copy of this, read by all three, is the point. Nothing here
# uses arrays, `local -n`, `[[ ]]` or any other bashism.
#
# What lives here is everything more than one installer would otherwise
# have written twice: the staged output a beginner reads, the checks for
# Docker and the operating system, the permission repair, the address
# detection, and the reading and writing of an env file that must never
# lose a secret it already holds.

# ── Output ───────────────────────────────────────────────────────────
#
# Stages, not shell transcripts. Somebody installing a game server panel
# should not have to read `docker compose` output to find out whether it
# worked, and should be told in a sentence when it did not.

GB_STAGES=0
GB_STAGE=0

# Whether the run started at a terminal, decided before anything is redirected: the dots wait_for draws mean something
# there, and the log gb_log keeps would be full of carriage returns. They are drawn on GB_LIVE_FD, which is 1 until a log
# takes over standard output and then the terminal the run began on.
GB_LIVE=0
[ ! -t 1 ] || GB_LIVE=1
GB_LIVE_FD=1

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  GB_B="$(printf '\033[1m')"; GB_DIM="$(printf '\033[2m')"
  GB_G="$(printf '\033[32m')"; GB_Y="$(printf '\033[33m')"; GB_R="$(printf '\033[31m')"
  GB_0="$(printf '\033[0m')"
else
  GB_B=""; GB_DIM=""; GB_G=""; GB_Y=""; GB_R=""; GB_0=""
fi

# A tick where the terminal can draw one. A box instead of a tick is worse
# than a plain `[ok]`, and a terminal in the C locale draws a box.
case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
  *UTF-8*|*utf8*|*UTF8*) GB_TICK="✓" ;;
  *) GB_TICK="ok" ;;
esac

gb_stages() { GB_STAGES="$1"; GB_STAGE=0; }

stage() {
  GB_STAGE=$((GB_STAGE + 1))
  printf '\n%s[%s/%s] %s%s\n' "$GB_B" "$GB_STAGE" "$GB_STAGES" "$1" "$GB_0"
}

ok()   { printf '%s[%s]%s %s\n' "$GB_G" "$GB_TICK" "$GB_0" "$1"; }
info() { printf '%s[·]%s %s\n' "$GB_DIM" "$GB_0" "$1"; }
warn() { printf '%s[!]%s %s\n' "$GB_Y" "$GB_0" "$1"; }
note() { printf '    %s%s%s\n' "$GB_DIM" "$1" "$GB_0"; }
say()  { printf '%s\n' "$1"; }

# The failure a beginner meets: what happened, why it stops the install,
# and the one thing to do next. Every line of it is a sentence.
#
#   die "Docker is not running." "Geeboard runs in containers." "Start Docker, then run this again."
die() {
  printf '\n%s[!] %s%s\n' "$GB_R" "$1" "$GB_0" >&2
  shift
  # An empty one is skipped rather than printed: a caller that has nothing
  # to say for the middle paragraph passes "", and two blank lines in a row
  # read as something having gone missing.
  for line in "$@"; do
    [ -n "$line" ] || continue
    printf '\n%s\n' "$line" >&2
  done
  printf '\n'
  exit 1
}

# ── Asking ───────────────────────────────────────────────────────────
#
# GEEBOARD_ASSUME_YES (or --yes) answers every question with its default,
# which is also what happens when there is no terminal to ask at: an
# installer run from a script must not hang on a prompt nobody sees.

GEEBOARD_ASSUME_YES="${GEEBOARD_ASSUME_YES:-0}"

gb_interactive() {
  [ "$GEEBOARD_ASSUME_YES" != "1" ] && [ -t 0 ] && [ -r /dev/tty ]
}

# ask <prompt> <default> — prints the answer.
ask() {
  _prompt="$1"; _default="${2:-}"
  if ! gb_interactive; then printf '%s' "$_default"; return 0; fi
  if [ -n "$_default" ]; then
    printf '%s [%s]: ' "$_prompt" "$_default" > /dev/tty
  else
    printf '%s: ' "$_prompt" > /dev/tty
  fi
  IFS= read -r _answer < /dev/tty || _answer=""
  [ -n "$_answer" ] || _answer="$_default"
  printf '%s' "$_answer"
}

# ask_required <prompt> — will not take an empty answer, and will not
# silently give up when there is nobody to ask: an installer run from a
# script has to be told what a terminal would have been asked.
ask_required() {
  while :; do
    _value="$(ask "$1" "")"
    [ -z "$_value" ] || { printf '%s' "$_value"; return 0; }
    gb_interactive || die "There is nobody to ask: $1" \
      "This is running without a terminal, or with --yes, and that answer has no sensible default." \
      "Give it on the command line instead, and run it again. --help lists the options."
    warn "That cannot be empty."
  done
}

# confirm <question> <yes|no default> — true for yes.
confirm() {
  _default="${2:-yes}"
  case "$_default" in yes) _hint="Y/n" ;; *) _hint="y/N" ;; esac
  if ! gb_interactive; then [ "$_default" = "yes" ]; return $?; fi
  while :; do
    printf '%s [%s]: ' "$1" "$_hint" > /dev/tty
    IFS= read -r _answer < /dev/tty || _answer=""
    [ -n "$_answer" ] || _answer="$_default"
    case "$_answer" in
      y|Y|yes|YES|Yes) return 0 ;;
      n|N|no|NO|No) return 1 ;;
      *) warn "Answer yes or no." ;;
    esac
  done
}

# ── The machine ──────────────────────────────────────────────────────

have() { command -v "$1" >/dev/null 2>&1; }

# writer | grep_in <grep options> <pattern> — grep -q for a pipe that is read to its end first.
#
# `writer | grep -q x` stops reading at the first match, and a writer that still has something to say dies of SIGPIPE; under
# `pipefail` the pipeline then reports failure although the line was found. `systemctl list-unit-files caddy.service | grep -q`
# did exactly that on a Debian 13 VPS (the footer is a second write), and the installer said Caddy "has no systemd unit" about a
# machine that has one and then did not reload it. Reading all of the input before looking at it cannot do that. Nothing in
# deploy/ pipes into `grep -q` any more: scripts/check-repo.mjs fails on it.
grep_in() {
  # POSIX on purpose: this file is sourced by /bin/sh as well, and a here-string (<<<) is a syntax error in dash. A here-document is not,
  # and like the here-string it is no pipe: nothing writes into grep that grep can leave unread.
  _gi_all="$(cat)"
  grep "$@" <<EOF_GREP_IN
$_gi_all
EOF_GREP_IN
}

need_root() {
  [ "$(id -u)" -eq 0 ] && return 0
  die "This has to run as root." \
    "It writes files under /etc and installs a system service, which an ordinary account cannot do." \
    "Run it again with sudo:

  sudo bash $1"
}

# Sets GB_OS_ID, GB_OS_NAME, GB_OS_LIKE. Supported means: a Linux this has
# been run on, with systemd and a package manager we know the name of.
detect_os() {
  GB_OS_ID="unknown"; GB_OS_NAME="unknown"; GB_OS_LIKE=""
  [ "$(uname -s)" = "Linux" ] || return 1
  if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    GB_OS_ID="${ID:-unknown}"
    GB_OS_NAME="${PRETTY_NAME:-${NAME:-unknown}}"
    GB_OS_LIKE="${ID_LIKE:-}"
  fi
  return 0
}

os_is_debian_like() {
  case " $GB_OS_ID $GB_OS_LIKE " in *" debian "*|*" ubuntu "*) return 0 ;; esac
  return 1
}

os_is_rhel_like() {
  case " $GB_OS_ID $GB_OS_LIKE " in *" rhel "*|*" fedora "*|*" centos "*) return 0 ;; esac
  return 1
}

# Docker: installed, and answering. Two different failures with two
# different answers, so they are two different messages.
require_docker() {
  have docker || die "Docker is not installed." \
    "Geeboard runs the panel, the database and every game server as containers, so Docker has to be there first." \
    "Install it, then run this again:

  curl -fsSL https://get.docker.com | sudo sh

docs/production.md has the longer version, from Docker's own repository."
  # A snap Docker is confined: it resolves the paths bind-mounted into containers in a namespace of its own, and the
  # agent hands it /var/lib/geeboard to mount into every game. `/snap/bin/docker` is a link to the snap program.
  _docker="$(command -v docker)"
  _real="$(readlink -f "$_docker" 2>/dev/null || printf '%s' "$_docker")"
  case "$_docker $_real" in
    */snap/*|*/bin/snap*) die "This Docker was installed as a snap." \
      "A snap is confined to its own view of the file system, and Geeboard binds the data folder of every game server into a container by its path on this machine. Servers would start with the wrong folder, or fail to." \
      "Install Docker from Docker's own repository (or the distribution's docker.io), then run this again:

  sudo snap remove docker
  curl -fsSL https://get.docker.com | sudo sh

docs/production.md has the longer version." ;;
  esac
  case "$(docker --version 2>/dev/null)" in
    *[Pp]odman*) warn "This docker command is Podman's. Geeboard is built and tested on Docker's own engine, and mounts its socket into the agent; carry on only if you know what that means for Podman." ;;
  esac
  docker info >/dev/null 2>&1 || die "Docker is not running." \
    "Geeboard cannot start anything until Docker is running." \
    "Start it, then run this again:

  sudo systemctl start docker"
}

# Sets GB_COMPOSE to the command that runs compose, with its arguments.
# Word-split on purpose at the call site: \$GB_COMPOSE -f file up -d.
require_compose() {
  if docker compose version >/dev/null 2>&1; then
    GB_COMPOSE="docker compose"
  elif have docker-compose; then
    # Compose v1 rejects the file: it has a top-level `name:`, which v1 does not know, and the lines it answers with name
    # something else. The standalone v2 binary is the same program as the plugin, and is fine.
    _cv="$(docker-compose version --short 2>/dev/null || true)"
    case "$_cv" in
      ""|0.*|1.*) die "docker-compose ${_cv:-(of an unknown version)} is Compose v1, which cannot read this file." \
        "The panel's compose file uses a feature of Compose v2, and v1 stopped being maintained in 2023. It would refuse the file with a message that names a line, and the line is not the problem." \
        "Install the plugin, then run this again:

  sudo apt install -y docker-compose-v2        # Ubuntu, Debian
  sudo apt install -y docker-compose-plugin    # from Docker's own repository
  sudo dnf install -y docker-compose-plugin    # Fedora, RHEL" ;;
    esac
    GB_COMPOSE="docker-compose"
    warn "Using the standalone docker-compose $_cv. The plugin (docker compose) is what this is tested with."
  else
    # Two package names, because `apt install docker.io` — which is how
    # most people get Docker on Ubuntu — does not bring compose with it,
    # and the name in Docker's own repository is not the name in Ubuntu's.
    die "Docker Compose is not installed." \
      "The panel, the poller and the database are started together by Compose, and Docker on its own does not include it." \
      "Install it, then run this again:

  sudo apt install -y docker-compose-v2        # Ubuntu, Debian
  sudo apt install -y docker-compose-plugin    # from Docker's own repository
  sudo dnf install -y docker-compose-plugin    # Fedora, RHEL"
  fi
}

# ── A run, and what is left of it ────────────────────────────────────
#
# An installer that is killed — a dropped SSH session is a SIGHUP — used to leave nothing to read and, rarely, a file with a
# secret in it in /tmp. gb_init_run gives a run a directory of its own (0700, removed however the run ends) and gb_log keeps
# what it printed, so that support is not blind and a secret never outlives the run that made it.

GB_RUN_DIR=""
GB_LOG_PID=""
GB_LOG_FILE=""
# Files beside the real ones that an interrupted write can leave: removed at the end of the run. Globs, unquoted on purpose.
GB_CLEAN_EXTRA=""

# gb_tmp — the name of a new empty file in the run's directory. Nothing else of the run's is ever in /tmp.
gb_tmp() {
  mktemp "${GB_RUN_DIR:-${TMPDIR:-/tmp}}/f.XXXXXX"
}

gb_cleanup() {
  [ -z "$GB_RUN_DIR" ] || rm -rf "$GB_RUN_DIR"
  # shellcheck disable=SC2086
  for _g in $GB_CLEAN_EXTRA; do rm -f $_g 2>/dev/null || true; done
  gb_log_end
}

# gb_init_run [extra globs to remove at the end] — once, after the root check.
gb_init_run() {
  GB_CLEAN_EXTRA="${1:-}"
  GB_RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/geeboard.XXXXXX")" || GB_RUN_DIR=""
  [ -z "$GB_RUN_DIR" ] || chmod 0700 "$GB_RUN_DIR"
  trap gb_cleanup EXIT
  # The exit codes a shell gives for these, so that the trap above runs and the caller sees why.
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap 'exit 129' HUP
}

# gb_log <file> — from here on what the run prints goes to the terminal and, without its colours, to <file> (0600, appended
# to: one file for every run). The terminal keeps its redraw: wait_for draws on the descriptor the run began on. A run that
# another installer started (install-panel.sh runs install.sh) writes into the same log and does not open a second.
gb_log() {
  [ -z "${GB_LOGGING:-}" ] || return 0
  _log="$1"
  ( umask 077; : >> "$_log" ) 2>/dev/null || return 0
  chmod 0600 "$_log" 2>/dev/null || true
  have mkfifo || return 0
  _fifo="${GB_RUN_DIR:-/tmp}/log.$$"
  mkfifo -m 0600 "$_fifo" 2>/dev/null || return 0
  printf '\n=== %s, %s ===\n' "$(basename "$0")" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$_log"
  exec 3>&1
  # Ignores the hang-up a dropped session sends: the log is exactly what is wanted after one.
  ( trap '' HUP; tee /dev/fd/3 < "$_fifo" | sed -u 's/\x1b\[[0-9;]*[A-Za-z]//g' >> "$_log" ) &
  GB_LOG_PID=$!
  exec > "$_fifo" 2>&1
  rm -f "$_fifo"
  GB_LOGGING=1; export GB_LOGGING
  GB_LOG_FILE="$_log"
  [ "$GB_LIVE" = "0" ] || GB_LIVE_FD=3
}

# Closes the pipe and waits for the last of it to reach the file and the terminal.
gb_log_end() {
  [ -n "$GB_LOG_PID" ] || return 0
  exec >&- 2>&-
  wait "$GB_LOG_PID" 2>/dev/null || true
  GB_LOG_PID=""
}

# need_value <option> <number of arguments left> <the next one> — an option that takes a value, and was not given one. It
# was `shift 2` failing under set -e: `--domain` at the end of a line exited 1 and said nothing.
need_value() {
  if [ "$2" -lt 2 ]; then
    die "$1 needs a value." "" "Run it with --help to see how it is used."
  fi
  case "$3" in
    --*) die "$1 needs a value, and the next thing on the line is $3." "" "Run it with --help to see how it is used." ;;
  esac
}

# ── Permissions ──────────────────────────────────────────────────────
#
# A checkout is not always what git recorded. A repository copied with
# scp, unpacked from a zip, or checked out on a file system with no
# execute bit arrives with scripts nobody can run, and the answer that
# gets passed around — `chmod -R 777` — makes every file in the checkout
# writable by every account on the machine.
#
# So: 0755 on the scripts, 0644 on what is only read, and a named command
# printed when the file system will not take either.

# mode_only_changes <repository> — prints how many files git shows as modified in a
# checkout when the only change is the permission bit, and returns 0; returns 1 and
# prints nothing when there are none, or this is not a checkout. That is the state a
# checkout made before 0.9.0 is left in by repair_permissions below: its scripts were
# recorded 0644, and the installer makes them 0755. `git pull` and `git checkout <tag>`
# then refuse over every script that changed in between.
mode_only_changes() {
  have git || return 1
  git -C "$1" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 1
  _changed="$(git -C "$1" -c core.fileMode=true diff --name-only 2>/dev/null | wc -l | tr -d ' ')"
  # A file with a changed line counts for its added or removed lines; a binary one for a dash.
  _content="$(git -C "$1" -c core.fileMode=true diff --numstat 2>/dev/null | awk '$1 == "-" || $1 + $2 > 0' | wc -l | tr -d ' ')"
  [ "$_changed" -gt 0 ] && [ "$_content" -eq 0 ] || return 1
  printf '%s\n' "$_changed"
}

# explain_mode_only_changes <repository> — says so, once, with the cure.
explain_mode_only_changes() {
  _n="$(mode_only_changes "$1")" || return 0
  note "git shows $_n script$([ "$_n" = 1 ] || echo s) in $1 as modified. Only the permission bit changed:"
  note "this checkout recorded them as not executable, and this installer makes them so."
  note "It is why 'git pull' or 'git checkout <tag>' refuses here. Once, to stop it:"
  note "  git -C $1 config core.fileMode false"
}

# repair_permissions <directory> — 0755 for *.sh, and CRLF taken out of
# the ones that have it. A carriage return in the first line of a script
# is "bad interpreter: no such file or directory", which reads like a
# missing file and is not one.
repair_permissions() {
  _dir="$1"; _fixed=0; _crlf=0; _stuck=""
  [ -d "$_dir" ] || return 0

  # One name per line, and the loop in this shell rather than in a pipeline:
  # a `while read` after a pipe counts in a subshell and loses the totals.
  _was_ifs="$IFS"; IFS="$(printf '\n_')"; IFS="${IFS%_}"
  # shellcheck disable=SC2044 # one name per line, and IFS is a newline: the loop stays in this shell on purpose
  for _script in $(find "$_dir" -type f -name '*.sh' 2>/dev/null); do
    if [ ! -x "$_script" ]; then
      if chmod 0755 "$_script" 2>/dev/null && [ -x "$_script" ]; then
        _fixed=$((_fixed + 1))
      else
        _stuck="$_stuck $_script"
      fi
    fi
    # Counted rather than matched: a carriage return is what half the tools
    # on the way here are inclined to swallow, including the grep that
    # would be asked to look for one.
    if [ "$(tr -d '\r' < "$_script" | wc -c)" -ne "$(wc -c < "$_script")" ]; then
      if _tmp="$(mktemp)" && tr -d '\r' < "$_script" > "$_tmp" 2>/dev/null; then
        cat "$_tmp" > "$_script" && _crlf=$((_crlf + 1))
        rm -f "$_tmp"
      else
        _stuck="$_stuck $_script"
      fi
    fi
  done
  IFS="$_was_ifs"

  [ "$_fixed" -eq 0 ] || ok "Permissions fixed on $_fixed script$([ "$_fixed" = 1 ] || echo s)"
  [ "$_crlf" -eq 0 ] || ok "Windows line endings removed from $_crlf script$([ "$_crlf" = 1 ] || echo s)"
  [ "$_fixed" -ne 0 ] || [ "$_crlf" -ne 0 ] || ok "Permissions are already right"

  if [ -n "$_stuck" ]; then
    warn "Some files could not be repaired, and have to be made executable by hand:"
    for _script in $_stuck; do note "chmod 0755 $_script"; done
    note "A file system mounted noexec, or read-only, is the usual reason."
    return 1
  fi
  return 0
}

# ── Addresses ────────────────────────────────────────────────────────

# The address the rest of the internet sees this machine at. Three
# services, so one being down is not the end of it; empty when the machine
# has no way out, which is a perfectly good answer.
public_ip() {
  for _url in https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com; do
    _ip="$(_http_body "$_url" 5)"
    _ip="$(printf '%s' "$_ip" | tr -d '[:space:]')"
    case "$_ip" in
      *[!0-9.]*) continue ;;
      ?*.?*.?*.?*) printf '%s' "$_ip"; return 0 ;;
    esac
  done
  return 1
}

# Every address this machine holds, one per line.
local_addresses() {
  if have ip; then
    ip -o addr show 2>/dev/null | awk '{print $4}' | cut -d/ -f1
  elif have hostname; then
    hostname -I 2>/dev/null | tr ' ' '\n'
  fi
}

# is_local_address <host> — true when <host> is this machine. Used to
# decide, without asking, whether the panel a node is joining is the panel
# on this very machine, which is what makes the certificate authority
# findable.
is_local_address() {
  _h="$1"
  # host_of keeps an IPv6 address in its brackets, and a bracket in a pattern is a character class.
  case "$_h" in \[*\]) _h="${_h#\[}"; _h="${_h%\]}" ;; esac
  case "$_h" in
    localhost|127.0.0.1|::1) return 0 ;;
  esac
  local_addresses | grep_in -qixF "$_h"
}

# is_local_host <host> — is_local_address, and also a NAME that resolves to an address this machine holds. For deciding that the panel
# is on this machine (so the Docker networks may reach the agent's port, which is how a panel in a container calls its own node), and
# not for the certificate: a name has a public certificate, and is_local_address alone is what finds Caddy's own authority.
# The panel at https://panel.example.com on the machine that is also its node was taken for a panel somewhere else, the agent's port
# was closed to the container that calls it, and the node went DEGRADED (a Debian 13 VPS, 2026-10-08). A machine that holds its
# public address nowhere (NAT: AWS, Oracle) does not resolve to itself; the panel's own installer says so with --panel-here.
is_local_host() {
  is_local_address "$1" && return 0
  have getent || return 1
  _ilh_name="${1#\[}"; _ilh_name="${_ilh_name%\]}"
  _ilh_addrs="$(getent ahosts "$_ilh_name" 2>/dev/null | awk '{print $1}' | sort -u)" || _ilh_addrs=""
  for _ilh_a in $_ilh_addrs; do
    is_local_address "$_ilh_a" && return 0
  done
  return 1
}

# port_holder <port> — the program that is listening on it, when there is one and this can tell. Not the address it is
# bound to: a program on 127.0.0.1 and one on every address are both in the way of a proxy that wants the port.
port_holder() {
  if have ss; then
    ss -ltnp 2>/dev/null | awk -v p=":$1\$" '$4 ~ p { print $0 }' | sed -n 's/.*users:(("\([^"]*\)".*/\1/p' | head -n 1
  fi
}

# port_free <port> — true when nothing is listening on it here.
port_free() {
  if have ss; then
    ! ss -ltn 2>/dev/null | awk '{print $4}' | grep_in -qE "[:.]$1\$"
  elif have netstat; then
    ! netstat -ltn 2>/dev/null | awk '{print $4}' | grep_in -qE "[:.]$1\$"
  else
    return 0
  fi
}

# is_private_address <address> — true for an address that does not cross the public internet to get anywhere: loopback, the
# private ranges, link-local, carrier-grade NAT (Tailscale and most VPNs live there), and IPv6's unique-local and link-local.
# A name is not an address: false. Used to say when the panel reaches a node in clear across the internet.
is_private_address() {
  _a="$1"
  case "$_a" in \[*\]) _a="${_a#\[}"; _a="${_a%\]}" ;; esac
  if is_ipv4 "$_a"; then
    _o1="${_a%%.*}"; _rest="${_a#*.}"; _o2="${_rest%%.*}"
    case "$_o1" in
      10|127) return 0 ;;
      192) [ "$_o2" = "168" ] && return 0 ;;
      172) [ "$_o2" -ge 16 ] && [ "$_o2" -le 31 ] && return 0 ;;
      169) [ "$_o2" = "254" ] && return 0 ;;
      100) [ "$_o2" -ge 64 ] && [ "$_o2" -le 127 ] && return 0 ;;
    esac
    return 1
  fi
  if is_ipv6 "$_a"; then
    case "$(printf '%s' "$_a" | tr 'A-Z' 'a-z')" in
      ::1|fc*|fd*|fe8*|fe9*|fea*|feb*) return 0 ;;
    esac
    return 1
  fi
  return 1
}

# panel_addresses <host> — the addresses to let through for a panel: itself when it is one, else what the name resolves to, one per line.
panel_addresses() {
  _h="$1"
  case "$_h" in \[*\]) _h="${_h#\[}"; _h="${_h%\]}" ;; esac
  if is_ipv4 "$_h" || is_ipv6 "$_h"; then printf '%s\n' "$_h"; return 0; fi
  have getent || return 0
  getent ahosts "$_h" 2>/dev/null | awk '{print $1}' | sort -u
}

# bracket_host <host> — an IPv6 literal in the brackets a URL and a Caddy site need; anything else as it is. A bare one
# in a URL is not a URL: PANEL_URL=https://2001:db8::1 is an error in Node, and the agent could not call the panel.
bracket_host() {
  case "$1" in
    \[*\]) printf '%s' "$1" ;;
    *) if is_ipv6 "$1"; then printf '[%s]' "$1"; else printf '%s' "$1"; fi ;;
  esac
}

# global_ipv6 — the first global IPv6 address this machine holds, one that is not still being made or going away. Empty (and
# non-zero) when it has none.
global_ipv6() {
  have ip || return 1
  _g6="$(ip -6 -o addr show scope global 2>/dev/null | awk '!/deprecated|tentative/ { split($4, a, "/"); print a[1]; exit }')"
  [ -n "$_g6" ] || return 1
  printf '%s' "$_g6"
}

# gb_firewall — what the machine's firewall is, in words, and (in GB_FIREWALL_HINT) the command that opens the web ports
# for it. A firewall in the way is the commonest reason a panel answers on the machine and nowhere else, and nothing used
# to look: the only mention of ufw was a hint after a failure.
GB_FIREWALL_HINT=""
gb_firewall() {
  GB_FIREWALL_HINT=""
  if have ufw && ufw status 2>/dev/null | head -n 1 | grep -qi 'status: active'; then
    if ufw status 2>/dev/null | grep_in -Eq '(^|[[:space:]])(443(/tcp)?|https|80,443/tcp|Nginx Full|Caddy)[[:space:]]+ALLOW'; then
      printf 'ufw is active, and it has a rule for 443\n'
    else
      printf 'ufw is active, and has no rule that opens 443\n'
      GB_FIREWALL_HINT="sudo ufw allow 80,443/tcp"
    fi
  elif have firewall-cmd && firewall-cmd --state 2>/dev/null | grep_in -qi running; then
    if firewall-cmd --list-services 2>/dev/null | tr ' ' '\n' | grep_in -qx https; then
      printf 'firewalld is running, and https is allowed\n'
    else
      printf 'firewalld is running, and https is not allowed\n'
      GB_FIREWALL_HINT="sudo firewall-cmd --permanent --add-service=http --add-service=https && sudo firewall-cmd --reload"
    fi
  elif have iptables && iptables -S INPUT 2>/dev/null | head -n 1 | grep -Eq -- '-P INPUT (DROP|REJECT)'; then
    printf 'iptables drops what it has no rule for, on INPUT\n'
    GB_FIREWALL_HINT="sudo iptables -I INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT"
  else
    printf 'no firewall on this machine that this could see\n'
  fi
}

# ── A node's name, from the machine's ────────────────────────────────
#
# The panel's rule for a node name (web/src/lib/agent-command.ts, NODE_NAME):
# two to thirty-nine lowercase letters, digits and dashes, starting with a
# letter or digit. A hostname is nearly one already, so the installer
# offers the hostname made to fit: lowercased, cut at the first dot, every
# other character a dash, dashes trimmed from the ends, cut to length.
# Nothing sensible left — a hostname of dots — gives `this-machine`.
valid_node_name() {
  case "$1" in
    *[!a-z0-9-]*|-*|"") return 1 ;;
  esac
  [ "${#1}" -ge 2 ] && [ "${#1}" -le 39 ]
}

node_name_from_hostname() {
  _name="$(printf '%s' "$1" | tr 'A-Z' 'a-z')"
  _name="${_name%%.*}"
  _name="$(printf '%s' "$_name" | tr -c 'a-z0-9\n' '-')"
  # Runs of dashes into one, then none at either end.
  _name="$(printf '%s' "$_name" | tr -s '-')"
  _name="${_name#-}"
  _name="${_name%-}"
  _name="$(printf '%s' "$_name" | cut -c1-39)"
  _name="${_name%-}"
  valid_node_name "$_name" || _name="this-machine"
  printf '%s' "$_name"
}

# ── Is that an address? ──────────────────────────────────────────────
#
# Asked because an installation answered `y` to "the address browsers
# will use", one line after a question that really was yes or no. It was
# taken at its word: PANEL_URL became https://y, Caddy was configured for
# a site called y and issued a certificate for it, and the panel came up
# perfectly behind an address that does not exist. Nothing downstream can
# tell that from a real answer, so it is caught here.

is_ipv4() {
  case "$1" in
    ""|*[!0-9.]*) return 1 ;;
  esac
  _rest="$1"; _count=0
  while [ -n "$_rest" ]; do
    case "$_rest" in
      *.*) _octet="${_rest%%.*}"; _rest="${_rest#*.}" ;;
      *) _octet="$_rest"; _rest="" ;;
    esac
    [ -n "$_octet" ] || return 1
    [ "$_octet" -le 255 ] 2>/dev/null || return 1
    _count=$((_count + 1))
  done
  [ "$_count" -eq 4 ]
}

is_ipv6() {
  case "$1" in
    \[*\]) _inner="$(printf '%s' "$1" | sed 's/^\[//; s/\]$//')" ;;
    *) _inner="$1" ;;
  esac
  case "$_inner" in
    *:*) ;;
    *) return 1 ;;
  esac
  case "$_inner" in
    *[!0-9a-fA-F:]*|*:::*) return 1 ;;
  esac
  # Hex groups of one to four digits; eight of them, or fewer with one `::` standing for the rest; no lone colon at
  # either end. `:` and `1:2` used to pass, and `--ip 1:2` built a certificate for a site called that.
  printf '%s' "$_inner" | awk '
    {
      s = $0
      if (s ~ /^:[^:]/ || s ~ /[^:]:$/) exit 1
      two = (index(s, "::") > 0)
      rest = s; sub("::", ":", rest)
      n = split(rest, g, ":"); count = 0
      for (i = 1; i <= n; i++) {
        if (g[i] == "") continue
        if (g[i] !~ /^[0-9a-fA-F][0-9a-fA-F]?[0-9a-fA-F]?[0-9a-fA-F]?$/) exit 1
        count++
      }
      if (two ? count > 7 : count != 8) exit 1
      if (index(substr(s, index(s, "::") + 2), "::") > 0) exit 1
      exit 0
    }'
}

# What a browser can actually be pointed at: an IP address, or a name
# with a dot in it. Not `y`, not `localhost`, not a word.
#
# It checks the shape, not the registry: a name nobody has registered
# passes, and the certificate that fails to issue is what says so. What it
# will not do is let something through that was never an address.
valid_site_host() {
  [ -n "$1" ] || return 1
  is_ipv4 "$1" && return 0
  is_ipv6 "$1" && return 0
  # Digits and dots and it is not a valid address means a mistyped one —
  # 1.2.3, or 256.0.0.1 — and not a hostname that happens to look numeric.
  # Left to the rule below, both would have passed as names.
  case "$1" in
    *[!0-9.]*) ;;
    *) return 1 ;;
  esac
  case "$1" in
    *[!a-zA-Z0-9.-]*) return 1 ;;
    -*|*-|.*|*.) return 1 ;;
    *.*) return 0 ;;
  esac
  return 1
}

# host_of <url> — the host out of an http(s) address, port and path gone.
host_of() {
  _rest="${1#*://}"
  _rest="${_rest%%/*}"
  _rest="${_rest%%\?*}"
  case "$_rest" in
    \[*\]*) printf '%s' "${_rest%%\]*}]" ;;          # [::1]:443
    *:*) printf '%s' "${_rest%%:*}" ;;
    *) printf '%s' "$_rest" ;;
  esac
}

# nat_address <https url> — true for a panel reached at an ADDRESS (not a name) that this machine does not hold: behind NAT, where a
# request for the router's address from the inside does not come back. A name is asked the way a browser asks, DNS and all.
nat_address() {
  case "$1" in https://*) ;; *) return 1 ;; esac
  _h="$(host_of "$1")"
  case "$_h" in
    \[*\]) ;;
    *[!0-9.]*|"") return 1 ;;
  esac
  is_local_address "$_h" && return 1
  return 0
}

# http_code_local <host> <path> [<authority file>] — the status of an https request made to Caddy on THIS machine, for a site that is an
# address. openssl and not curl, because curl sends no SNI for an address, so Caddy looks a certificate up for the address the
# connection arrived on (127.0.0.1) and has none; openssl names the address in the handshake, as a browser does. With an authority
# file the certificate is checked against it and the address. 000 when there is no openssl, no answer, or a certificate that fails.
http_code_local() {
  have openssl || { printf '000'; return 0; }
  _bare="${1#\[}"; _bare="${_bare%\]}"
  _line="$(printf 'GET %s HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n' "$2" "$1" |
    timeout 15 openssl s_client -connect 127.0.0.1:443 -servername "$_bare" ${3:+-CAfile "$3" -verify_ip "$_bare" -verify_return_error} -quiet 2>/dev/null |
    head -n 1 | tr -d '\r' || true)"
  case "$_line" in
    HTTP/*\ [0-9][0-9][0-9]*) set -- $_line; printf '%s' "$2" ;;
    *) printf '000' ;;
  esac
}

# ── HTTP, without assuming curl ──────────────────────────────────────

_http_body() {
  if have curl; then
    curl -fsS --max-time "${2:-10}" "$1" 2>/dev/null
  elif have wget; then
    wget -qO- --timeout="${2:-10}" "$1" 2>/dev/null
  fi
}

# http_code <url> [ca file] — the status, or 000 when nothing answered.
# A status is enough: what is being asked is whether the thing is there.
#
# curl prints `000` itself when it could not connect, *and* exits non-zero.
# A `|| printf 000` after it therefore prints six characters, which read as
# a status nobody has ever seen. The answer is taken once and checked.
http_code() {
  _code=""
  if have curl; then
    # ${2:+...}: the option and its file are one word each, however the path is spelled.
    _code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 ${2:+--cacert "$2"} "$1" 2>/dev/null)"
  elif have wget; then
    if wget -q -O /dev/null --timeout=10 ${2:+--ca-certificate="$2"} "$1" 2>/dev/null; then _code="200"; fi
  fi
  case "$_code" in
    [0-9][0-9][0-9]) printf '%s' "$_code" ;;
    *) printf '000' ;;
  esac
}

# The same request with the certificate check turned off, and for one
# purpose only: telling "nothing is there" apart from "something is there
# and this machine does not trust its certificate". Nothing is read from
# the answer, and nothing acts on it — it decides which sentence to print.
http_code_insecure() {
  _code=""
  if have curl; then
    _code="$(curl -s -k -o /dev/null -w '%{http_code}' --max-time 10 "$1" 2>/dev/null)"
  elif have wget; then
    if wget -q -O /dev/null --no-check-certificate --timeout=10 "$1" 2>/dev/null; then _code="200"; fi
  fi
  case "$_code" in
    [0-9][0-9][0-9]) printf '%s' "$_code" ;;
    *) printf '000' ;;
  esac
}

# wait_for <seconds> <description> <command...> — one dot per second,
# then the verdict. Returns 1 when the time ran out.
#
# The dots are redrawn over, which only means anything on a terminal. Into
# a log or a pipe it prints the verdict alone: a file full of carriage
# returns and half-erased lines is worse than no progress at all.
wait_for() {
  _limit="$1"; _what="$2"; shift 2
  _waited=0
  _live="$GB_LIVE"
  [ "$_live" = "0" ] || printf '%s[·]%s %s' "$GB_DIM" "$GB_0" "$_what" >&"$GB_LIVE_FD"
  while [ "$_waited" -lt "$_limit" ]; do
    if "$@" >/dev/null 2>&1; then
      [ "$_live" = "0" ] || printf '\r\033[K' >&"$GB_LIVE_FD"
      ok "$_what"
      return 0
    fi
    sleep 1
    _waited=$((_waited + 1))
    [ "$_live" = "0" ] || printf '.' >&"$GB_LIVE_FD"
  done
  [ "$_live" = "0" ] || printf '\r\033[K' >&"$GB_LIVE_FD"
  warn "$_what — not after ${_limit}s"
  return 1
}

# ── Secrets and env files ────────────────────────────────────────────

# URL-safe: one of these goes into a connection string.
gb_secret() {
  if have openssl; then
    openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-48
  else
    head -c 96 /dev/urandom | base64 | tr -d '\n=+/' | cut -c1-48
  fi
}

# env_get <file> <key> — the value, or empty.
env_get() {
  [ -f "$1" ] || return 1
  sed -n "s/^$2=//p" "$1" | head -n 1
}

# env_has <file> <key> — true when the key is there with a value.
env_has() {
  _value="$(env_get "$1" "$2" 2>/dev/null || true)"
  [ -n "$_value" ]
}

# env_set <file> <key> <value> — replaces the line, keeps its place, keeps
# every other line including the comments. The file that results is a new one,
# readable by its owner only, which is what an env file with secrets in it is.
#
# The value never passes through a tool that reads escapes or replacement
# syntax of its own. sed would rewrite a `&` in a secret and awk -v would
# eat a backslash, and a secret that comes back subtly different from the
# one that was written is the hardest bug in here to find.
env_set() {
  _file="$1"; _key="$2"; _value="$3"
  # 077 for this file and the caller's own afterwards: it used to leak into the rest of the run, and into an installer
  # started as a child of this one.
  _umask="$(umask)"
  umask 077
  [ -f "$_file" ] || : > "$_file"
  _tmp="$_file.next.$$"
  _done=0
  : > "$_tmp"
  while IFS= read -r _line || [ -n "$_line" ]; do
    case "$_line" in
      "$_key"=*)
        # The first one is replaced and any later one is dropped, so the
        # value written here is the one compose reads.
        if [ "$_done" = "0" ]; then printf '%s=%s\n' "$_key" "$_value" >> "$_tmp"; _done=1; fi
        ;;
      *) printf '%s\n' "$_line" >> "$_tmp" ;;
    esac
  done < "$_file"
  [ "$_done" = "1" ] || printf '%s=%s\n' "$_key" "$_value" >> "$_tmp"
  mv "$_tmp" "$_file"
  umask "$_umask"
}

# env_default <file> <key> <value> — writes it only when it is not there.
# This is the rule that keeps an installer from regenerating a secret on
# its second run: nothing already in the file is ever changed by it.
env_default() {
  env_has "$1" "$2" || env_set "$1" "$2" "$3"
}

# join_with_capability <capability> <the join's arguments…> — the same
# arguments, one per line, with the capability in the list the join declares:
# added to a --capabilities that is there, or as an option of its own when
# there is none. Said twice it is still there once. This is how an installer
# flag that is only a name for one capability (--community-games) reaches the
# agent without the agent needing to know the flag.
join_with_capability() {
  _cap="$1"; shift
  _added=0
  _skip=0
  for _arg in "$@"; do
    if [ "$_skip" = "1" ]; then
      _skip=0
      case ",${_arg}," in
        *",${_cap},"*) printf '%s\n' "$_arg" ;;
        *) printf '%s\n' "${_arg:+${_arg},}${_cap}" ;;
      esac
      continue
    fi
    case "$_arg" in
      --capabilities)
        _added=1
        _skip=1
        printf '%s\n' "$_arg"
        ;;
      --capabilities=*)
        _added=1
        case ",${_arg#--capabilities=}," in
          *",${_cap},"*) printf '%s\n' "$_arg" ;;
          *) printf '%s\n' "${_arg},${_cap}" ;;
        esac
        ;;
      *) printf '%s\n' "$_arg" ;;
    esac
  done
  if [ "$_added" = "0" ]; then printf '%s\n%s\n' "--capabilities" "$_cap"; fi
}

# ── What this machine is, said before anything is installed ──────────
#
# The checks that must stop a run are in require_docker and require_compose. These are the ones that explain a failure that
# would otherwise come three stages later, as something else: a build that is killed for memory, a code that never matches
# because the clock is wrong, an agent that cannot read its own folder under SELinux, a proxy that cannot take a port. Each
# is a sentence and, where there is one, the command. Nothing here changes the machine, so `--check` is these alone.

GB_WARNINGS=0
gb_warn() { warn "$1"; [ -z "${2:-}" ] || note "$2"; GB_WARNINGS=$((GB_WARNINGS + 1)); }

# gb_preflight <ports to look at, space separated>
gb_preflight() {
  GB_WARNINGS=0
  _dv="$(docker version --format '{{.Server.Version}}' 2>/dev/null || true)"
  _cv=""
  [ -z "${GB_COMPOSE:-}" ] || _cv="$($GB_COMPOSE version --short 2>/dev/null || true)"
  ok "Docker ${_dv:-of an unknown version}${_cv:+, Compose $_cv}"

  if have systemctl; then
    case "$(systemctl is-enabled docker 2>/dev/null || true)" in
      enabled) ;;
      *) gb_warn "Docker does not start at boot." "Without it the panel and every game server stay down after a reboot: sudo systemctl enable docker" ;;
    esac
  fi

  _avail_kb="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo 2>/dev/null || true)"
  _swap_kb="$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo 2>/dev/null || true)"
  case "$_avail_kb" in
    ''|*[!0-9]*) ;;
    *)
      _swap_kb="${_swap_kb:-0}"
      case "$_swap_kb" in *[!0-9]*) _swap_kb=0 ;; esac
      info "Memory: $((_avail_kb / 1024)) MB available, $((_swap_kb / 1024)) MB of swap"
      if [ $((_avail_kb + _swap_kb)) -lt 1500000 ]; then
        gb_warn "Less than 1.5 GB of memory is free." "Building the panel image from this checkout needs about 2 GB and is killed without a word when there is less (a published image does not build). Add swap, or give --image a published one."
      fi ;;
  esac

  _disk_at="/var/lib/docker"
  [ -d "$_disk_at" ] || _disk_at="/var/lib"
  _free_kb="$(df -Pk "$_disk_at" 2>/dev/null | awk 'NR==2 {print $4}' || true)"
  case "$_free_kb" in
    ''|*[!0-9]*) ;;
    *)
      info "Disk: $((_free_kb / 1024 / 1024)) GB free under $_disk_at"
      if [ "$_free_kb" -lt 5000000 ]; then
        gb_warn "Less than 5 GB is free under $_disk_at." "The panel's image alone is about 1.7 GB, and game servers and their backups are more."
      fi ;;
  esac

  _arch="$(uname -m 2>/dev/null || echo unknown)"
  case "$_arch" in
    x86_64|amd64) info "Architecture: $_arch" ;;
    aarch64|arm64) info "Architecture: $_arch"; note "The published images are built for amd64 (docs/production.md); on this machine they are built from the checkout, which takes minutes and about 2 GB of memory." ;;
    *) gb_warn "Architecture $_arch is not one the images are built for." "They will be built from the checkout, if Docker can." ;;
  esac

  if have timedatectl; then
    case "$(timedatectl show -p NTPSynchronized --value 2>/dev/null || true)" in
      yes) ;;
      no) gb_warn "The clock is not synchronised." "A two-factor code and a certificate both depend on it: sudo timedatectl set-ntp true" ;;
    esac
  fi

  if have getenforce && [ "$(getenforce 2>/dev/null || true)" = "Enforcing" ]; then
    gb_warn "SELinux is enforcing." "Docker's bind mounts and its socket carry no label options here, so the agent can be refused its own data folder. Not tested; the panel's containers use volumes and are less likely to meet it."
  fi

  for _p in ${1:-}; do
    _holder="$(port_holder "$_p" || true)"
    if [ -n "$_holder" ]; then
      case "$_p:$_holder" in
        80:caddy|443:caddy|8080:MainThread|8080:node|3000:docker-proxy) info "Port $_p: $_holder is listening on it already" ;;
        *) gb_warn "Port $_p is held by $_holder." "Whatever needs $_p will not get it while that runs." ;;
      esac
    elif ! port_free "$_p"; then
      gb_warn "Port $_p is in use, by something this could not name."
    fi
  done

  _fw="$(gb_firewall)"
  case "$_fw" in
    *"has no rule"*|*"not allowed"*|*"drops what"*) gb_warn "$_fw." "To let the web in from outside: $GB_FIREWALL_HINT" ;;
    *) info "$_fw" ;;
  esac
}
