#!/usr/bin/env bash
# What the installers' shared helpers claim, proved.
#
#   bash deploy/lib/verify.sh
#
# The panel and the agent have verify scripts of their own; the shell that
# installs them had none, and the first thing it got wrong was a question
# whose answer nobody checked. An installation answered `y` to "the
# address browsers will use" — one line after a question that really was
# yes or no — and every later stage did exactly as it was told: PANEL_URL
# became https://y, Caddy was configured for a site called y and issued a
# certificate for it, and the panel came up perfectly behind an address
# that does not exist.
#
# Pure functions only: nothing here installs, writes outside a temporary
# directory, or needs Docker. That is what lets it run on every push.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
. "$HERE/common.sh"
# shellcheck source=panel-env.sh
. "$HERE/panel-env.sh"
# shellcheck source=caddy.sh
. "$HERE/caddy.sh"

PASSED=0
FAILED=0

ok_test() { PASSED=$((PASSED + 1)); }
bad_test() {
  FAILED=$((FAILED + 1))
  printf '  %s[fail]%s %s\n' "$GB_R" "$GB_0" "$1" >&2
}

# is <what> <expected> <got>
is() {
  if [ "$2" = "$3" ]; then ok_test; else bad_test "$1: expected '$2', got '$3'"; fi
}

# accepts <host> / rejects <host>
accepts() {
  if valid_site_host "$1"; then ok_test; else bad_test "valid_site_host '$1' should have been accepted"; fi
}
rejects() {
  if valid_site_host "$1"; then bad_test "valid_site_host '$1' should have been refused"; else ok_test; fi
}

echo "== an address is an address =="

# The answer that started this. A word is not an address.
rejects "y"
rejects "n"
rejects "Y"
rejects "yes"
rejects ""
rejects "localhost"
rejects "panel"
rejects "panel example.com"
rejects "http://1.2.3.4"
rejects ".com"
rejects "example."

# Digits and dots that are not an address are a mistyped address, not a
# hostname that happens to look numeric.
rejects "1.2.3"
rejects "1.2.3.4.5"
rejects "256.0.0.1"
rejects "1.2.3.999"

accepts "217.182.128.27"
accepts "203.0.113.10"
accepts "10.0.0.5"
accepts "0.0.0.0"
accepts "255.255.255.255"
accepts "panel.example.com"
accepts "geeboard.local"
accepts "a.b"
accepts "[2001:db8::1]"
accepts "2001:db8::1"
accepts "[::1]"

echo "== a node name out of a hostname =="

# What the panel's own rule takes; the installer offers the hostname made to fit.
is "a plain hostname" "game-box" "$(node_name_from_hostname game-box)"
is "lowercased" "gamebox" "$(node_name_from_hostname GameBox)"
is "cut at the first dot" "vps-01" "$(node_name_from_hostname vps-01.example.com)"
is "other characters become dashes" "my-pc-2" "$(node_name_from_hostname 'my_pc 2')"
is "runs of dashes fold, and the ends are trimmed" "a-b" "$(node_name_from_hostname '--a__b--')"
is "cut to thirty-nine" "$(printf '%.39s' "abcdefghijklmnopqrstuvwxyz0123456789abcdefghij")" "$(node_name_from_hostname abcdefghijklmnopqrstuvwxyz0123456789abcdefghij)"
is "nothing sensible left" "this-machine" "$(node_name_from_hostname '...')"
is "a single letter is too short" "this-machine" "$(node_name_from_hostname a)"
node_name_ok() { if valid_node_name "$1"; then ok_test; else bad_test "valid_node_name '$1' should have been accepted"; fi; }
node_name_bad() { if valid_node_name "$1"; then bad_test "valid_node_name '$1' should have been refused"; else ok_test; fi; }
node_name_ok "fra-node-03"
node_name_ok "01"
node_name_bad "Fra-Node"
node_name_bad "-node"
node_name_bad "a"
node_name_bad "node.one"
node_name_bad ""

echo "== the host out of an address =="

is "host_of https" "panel.example.com" "$(host_of https://panel.example.com)"
is "host_of port" "10.0.0.5" "$(host_of http://10.0.0.5:8080/x)"
is "host_of ipv6" "[::1]" "$(host_of 'https://[::1]:443')"

echo "== where the panel listens =="

is "bind default" "http://127.0.0.1:3000" "$(panel_bind_url 127.0.0.1:3000)"
is "bind wildcard" "http://127.0.0.1:3100" "$(panel_bind_url 0.0.0.0:3100)"
is "bind port only" "http://127.0.0.1:3500" "$(panel_bind_url 3500)"

echo "== --community-games is one more capability, in the list the join declares =="

joined() { join_with_capability "$@" | tr '\n' ' '; }
is "no list: an option of its own" "https://p tok --capabilities community-games " "$(joined community-games https://p tok)"
is "a list: added to it" "https://p tok --capabilities steamcmd,java,community-games " "$(joined community-games https://p tok --capabilities steamcmd,java)"
is "the equals form: added to it" "https://p tok --capabilities=java,community-games --advertise http://x:8080 " "$(joined community-games https://p tok --capabilities=java --advertise http://x:8080)"
is "an option after the list is kept where it was" "https://p tok --capabilities java,community-games --port 8081 " "$(joined community-games https://p tok --capabilities java --port 8081)"
is "said twice, it is there once" "https://p tok --capabilities community-games,java " "$(joined community-games https://p tok --capabilities community-games,java)"
is "a name that only contains it is another name" "https://p tok --capabilities not-community-games,community-games " "$(joined community-games https://p tok --capabilities not-community-games)"
is "an empty list is not given a leading comma" "https://p tok --capabilities community-games " "$(joined community-games https://p tok --capabilities '')"

echo "== a secret already written is never rewritten =="

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

panel_env_ensure "$WORK/.env"
is "a new file is created" "1" "$GB_ENV_CREATED"
FIRST="$(env_get "$WORK/.env" SECRETS_KEY)"
panel_env_ensure "$WORK/.env"
is "the second run keeps it" "0" "$GB_ENV_CREATED"
is "SECRETS_KEY is untouched" "$FIRST" "$(env_get "$WORK/.env" SECRETS_KEY)"

# A value that every tool in the way would have mangled: sed's ampersand,
# awk's backslash escape, printf's per cent.
env_set "$WORK/.env" STEAM_API_KEY 'a/b&c\d"e%s$x'
is "a value comes back as it went in" 'a/b&c\d"e%s$x' "$(env_get "$WORK/.env" STEAM_API_KEY)"

env_set "$WORK/.env" PANEL_URL "https://one.example"
env_set "$WORK/.env" PANEL_URL "https://two.example"
is "a key is written once" "1" "$(grep -c '^PANEL_URL=' "$WORK/.env")"
is "and holds the last value" "https://two.example" "$(env_get "$WORK/.env" PANEL_URL)"

echo "== the Caddyfile is the template, filled in =="

TEMPLATE="$HERE/../panel/caddy/panel.caddyfile.tmpl"
if [ -r "$TEMPLATE" ]; then
  # The renderer itself, not a copy of it.
  OUT="$(caddy_render "$TEMPLATE" "203.0.113.10" "tls internal" "127.0.0.1:3100")"
  case "$OUT" in
    *"203.0.113.10 {"*) ok_test ;;
    *) bad_test "the site was not filled in" ;;
  esac
  case "$OUT" in
    *"tls internal"*) ok_test ;;
    *) bad_test "the tls line was not filled in" ;;
  esac
  case "$OUT" in
    *"reverse_proxy 127.0.0.1:3100"*) ok_test ;;
    *) bad_test "PANEL_BIND did not reach the proxy line" ;;
  esac
  case "$OUT" in
    *__SITE__*|*__TLS__*|*__UPSTREAM__*) bad_test "a placeholder was left in the rendered file" ;;
    *) ok_test ;;
  esac
else
  bad_test "the Caddyfile template is missing"
fi

echo "== a checkout whose scripts only differ in their permission bit says so =="

if have git; then
  CHECKOUT="$WORK/checkout"
  mkdir -p "$CHECKOUT"
  (
    cd "$CHECKOUT"
    git init -q . && git config user.email t@example.test && git config user.name t
    printf '#!/bin/sh\necho one\n' > a.sh && printf 'text\n' > b.txt
    git add . && git commit -q -m one
    chmod +x a.sh
  )
  # Where the file system keeps an execute bit at all (not NTFS under Git Bash), the checkout is now "modified".
  if [ -n "$(git -C "$CHECKOUT" -c core.fileMode=true diff --name-only)" ]; then
    is "one script, permission only" "1" "$(mode_only_changes "$CHECKOUT")"
    is "the cure is printed" "1" "$(explain_mode_only_changes "$CHECKOUT" 2>&1 | grep -c 'core.fileMode false')"
    printf '#!/bin/sh\necho two\n' > "$CHECKOUT/a.sh"
    if mode_only_changes "$CHECKOUT" >/dev/null; then bad_test "an edited script is not a permission-only change"; else ok_test; fi
    is "and nothing is said about it" "0" "$(explain_mode_only_changes "$CHECKOUT" 2>&1 | grep -c 'core.fileMode false')"
  fi
  CLEAN="$WORK/clean"
  mkdir -p "$CLEAN" && (cd "$CLEAN" && git init -q . && printf 'x\n' > f && git add f && git -c user.email=t@e.t -c user.name=t commit -q -m x)
  if mode_only_changes "$CLEAN" >/dev/null; then bad_test "a clean checkout has no permission-only changes"; else ok_test; fi
  if mode_only_changes "$WORK" >/dev/null; then bad_test "a directory that is not a checkout has none either"; else ok_test; fi
fi

echo
if [ "$FAILED" -eq 0 ]; then
  printf '%s[%s]%s %s checks passed.\n' "$GB_G" "$GB_TICK" "$GB_0" "$PASSED"
else
  printf '%s[!]%s %s passed, %s failed.\n' "$GB_R" "$GB_0" "$PASSED" "$FAILED"
  exit 1
fi
