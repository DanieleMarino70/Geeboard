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
    GB_COMPOSE="docker-compose"
    warn "Using the old docker-compose command. The plugin (docker compose) is what this is tested with."
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
  case "$1" in
    localhost|127.0.0.1|::1) return 0 ;;
  esac
  local_addresses | grep -qx "$1"
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
  _ca=""
  [ -z "${2:-}" ] || _ca="--cacert $2"
  _code=""
  if have curl; then
    # shellcheck disable=SC2086
    _code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 $_ca "$1" 2>/dev/null)"
  elif have wget; then
    if wget -q -O /dev/null --timeout=10 "$1" 2>/dev/null; then _code="200"; fi
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
  _live=0
  [ ! -t 1 ] || _live=1
  [ "$_live" = "0" ] || printf '%s[·]%s %s' "$GB_DIM" "$GB_0" "$_what"
  while [ "$_waited" -lt "$_limit" ]; do
    if "$@" >/dev/null 2>&1; then
      [ "$_live" = "0" ] || printf '\r\033[K'
      ok "$_what"
      return 0
    fi
    sleep 1
    _waited=$((_waited + 1))
    [ "$_live" = "0" ] || printf '.'
  done
  [ "$_live" = "0" ] || printf '\r\033[K'
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
# every other line including the comments. The file keeps its mode, and a
# new one is made readable by its owner only.
#
# The value never passes through a tool that reads escapes or replacement
# syntax of its own. sed would rewrite a `&` in a secret and awk -v would
# eat a backslash, and a secret that comes back subtly different from the
# one that was written is the hardest bug in here to find.
env_set() {
  _file="$1"; _key="$2"; _value="$3"
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
}

# env_default <file> <key> <value> — writes it only when it is not there.
# This is the rule that keeps an installer from regenerating a secret on
# its second run: nothing already in the file is ever changed by it.
env_default() {
  env_has "$1" "$2" || env_set "$1" "$2" "$3"
}
