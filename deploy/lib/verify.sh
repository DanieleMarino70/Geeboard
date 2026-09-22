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

echo "== the host out of an address =="

is "host_of https" "panel.example.com" "$(host_of https://panel.example.com)"
is "host_of port" "10.0.0.5" "$(host_of http://10.0.0.5:8080/x)"
is "host_of ipv6" "[::1]" "$(host_of 'https://[::1]:443')"

echo "== where the panel listens =="

is "bind default" "http://127.0.0.1:3000" "$(panel_bind_url 127.0.0.1:3000)"
is "bind wildcard" "http://127.0.0.1:3100" "$(panel_bind_url 0.0.0.0:3100)"
is "bind port only" "http://127.0.0.1:3500" "$(panel_bind_url 3500)"

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

echo
if [ "$FAILED" -eq 0 ]; then
  printf '%s[%s]%s %s checks passed.\n' "$GB_G" "$GB_TICK" "$GB_0" "$PASSED"
else
  printf '%s[!]%s %s passed, %s failed.\n' "$GB_R" "$GB_0" "$PASSED" "$FAILED"
  exit 1
fi
