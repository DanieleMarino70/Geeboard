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
# shellcheck source=upgrade.sh
. "$HERE/upgrade.sh"

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

echo "== what a run was, in a word =="

is "nothing before" "installed" "$(run_kind 0 "" 0.9.0)"
is "the same release again" "refreshed" "$(run_kind 1 0.9.0 0.9.0)"
is "another release" "upgraded" "$(run_kind 1 0.8.1 0.9.0)"
is "a release that cannot say which it was" "upgraded" "$(run_kind 1 "" 0.9.0)"
is "the version in an image tag" "0.8.1" "$(image_version_from_ref ghcr.io/danielemarino70/geeboard-panel:0.8.1)"
is "a prerelease tag" "0.9.0-rc.1" "$(image_version_from_ref ghcr.io/x/geeboard-panel:0.9.0-rc.1)"
is "a local build says nothing" "" "$(image_version_from_ref geeboard-panel:local)"
is "no tag says nothing" "" "$(image_version_from_ref geeboard-panel)"
is "a registry port is not a tag" "" "$(image_version_from_ref localhost:5000/geeboard-panel)"

echo "== a re-run keeps the way the panel is served =="

SITE_DIR="$WORK/site"; mkdir -p "$SITE_DIR"
printf '# geeboard-managed: written by deploy/linux/install-panel.sh\n\npanel.example.com {\n\ttls admin@example.com\n\treverse_proxy 127.0.0.1:3000 {\n\t}\n}\n' > "$SITE_DIR/domain.caddyfile"
printf '# geeboard-managed: written by deploy/linux/install-panel.sh\n\n203.0.113.10 {\n\ttls internal\n\treverse_proxy 127.0.0.1:3000 {\n\t}\n}\n' > "$SITE_DIR/ip.caddyfile"
printf 'panel.example.com {\n\treverse_proxy 127.0.0.1:3000\n}\n' > "$SITE_DIR/theirs.caddyfile"
printf ':80 {\n\trespond "caddy"\n}\n' > "$SITE_DIR/package.caddyfile"

site() { existing_site "$@" 2>/dev/null || echo none; }
is "nothing recorded and no url: a first installation" "none" "$(site "" "" "" "$SITE_DIR/none")"
is "a domain panel, read from the Caddyfile the installer wrote" "domain panel.example.com admin@example.com" "$(site https://panel.example.com "" "" "$SITE_DIR/domain.caddyfile")"
is "an address panel, read from the Caddyfile" "ip 203.0.113.10" "$(site https://203.0.113.10 "" "" "$SITE_DIR/ip.caddyfile")"
is "a Caddyfile somebody else wrote: the https is theirs" "given panel.example.com" "$(site https://panel.example.com "" "" "$SITE_DIR/theirs.caddyfile")"
is "the package's own placeholder Caddyfile says nothing, so the address decides (a name)" "domain panel.example.com" "$(site https://panel.example.com "" "" "$SITE_DIR/package.caddyfile")"
is "the same, for an address" "ip 203.0.113.10" "$(site https://203.0.113.10 "" "" "$SITE_DIR/package.caddyfile")"
is "no Caddyfile at all: the address decides" "ip 203.0.113.10" "$(site https://203.0.113.10 "" "" "$SITE_DIR/none")"
is "an IPv6 address is an address" "ip [2001:db8::1]" "$(site 'https://[2001:db8::1]' "" "" "$SITE_DIR/none")"
# What the installer recorded wins over what it can only infer.
is "recorded: domain, with its email" "domain panel.example.com me@example.com" "$(site https://panel.example.com domain me@example.com "$SITE_DIR/ip.caddyfile")"
is "recorded: ip" "ip 203.0.113.10" "$(site https://203.0.113.10 ip "" "$SITE_DIR/domain.caddyfile")"
is "recorded: given, whatever is in the Caddyfile" "given panel.example.com" "$(site https://panel.example.com given "" "$SITE_DIR/domain.caddyfile")"

echo "== an upgrade takes a dump first, and says how to go back =="

is "bytes, small" "1 MB" "$(human_bytes 100)"
is "bytes, megabytes" "320 MB" "$(human_bytes 335544320)"
is "bytes, gigabytes" "1.5 GB" "$(human_bytes 1610612736)"
# The database's own size and half again, and 200 MB for whatever else writes to the same disk.
is "room for a dump of nothing" "209715200" "$(dump_room_needed 0)"
is "room for a dump of 1 GiB" "$((1073741824 + 536870912 + 209715200))" "$(dump_room_needed 1073741824)"

PRISMA_OUT='Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "geeboard"

3 migrations found in prisma/migrations

Applying migration `20261004100000_dns_records`
Applying migration `20261004110000_metrics`

The following migration(s) have been applied:

migrations/
  └─ 20261004100000_dns_records/
    └─ migration.sql
  └─ 20261004110000_metrics/
    └─ migration.sql

All migrations have been successfully applied.'
is "the migrations Prisma applied, once each" "20261004100000_dns_records 20261004110000_metrics" "$(printf '%s' "$PRISMA_OUT" | migration_names | tr '\n' ' ' | sed 's/ $//')"
is "nothing applied, no names" "" "$(printf 'No pending migrations to apply.\n' | migration_names)"
# Under set -e, the way the installer runs: no name must not end the script.
( set -eo pipefail; X="$(printf 'No pending migrations to apply.\n' | migration_names)"; [ -z "$X" ] ) && ok_test || bad_test "migration_names with nothing to find ends a script that runs under set -e"

UNDO="$(undo_text "docker compose -f deploy/panel/docker-compose.yml" /var/backups/geeboard/geeboard-20261007T101500Z-from-0.8.1.dump /var/backups/geeboard/panel-20261007T101500Z.env geeboard-panel:before-20261007T101500Z)"
case "$UNDO" in
  *"stop panel poller"*"dropdb -U geeboard geeboard && createdb -U geeboard geeboard"*"pg_restore -U geeboard -d geeboard < /var/backups/geeboard/geeboard-20261007T101500Z-from-0.8.1.dump"*"GEEBOARD_PANEL_IMAGE=geeboard-panel:before-20261007T101500Z"*"up -d"*) ok_test ;;
  *) bad_test "the undo commands are not the five a person has to run, in order, with this dump and this image" ;;
esac
case "$(undo_text c /d /e '')" in
  *GEEBOARD_PANEL_IMAGE=*) bad_test "with no previous image the text must not invent one" ;;
  *) ok_test ;;
esac

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

echo "== an IPv6 address is hex groups, not a colon =="

v6_ok() { if is_ipv6 "$1"; then ok_test; else bad_test "is_ipv6 '$1' should have been accepted"; fi; }
v6_bad() { if is_ipv6 "$1"; then bad_test "is_ipv6 '$1' should have been refused"; else ok_test; fi; }
v6_ok "2001:db8::1"
v6_ok "[2001:db8::1]"
v6_ok "::1"
v6_ok "::"
v6_ok "1::"
v6_ok "fe80::1"
v6_ok "2001:db8:0:0:0:0:0:1"
v6_ok "2001:DB8::AbCd"
# What used to pass, and built a certificate for a site called ":".
v6_bad ":"
v6_bad "1:2"
v6_bad "::1::2"
v6_bad ":::"
v6_bad "12345::1"
v6_bad "gggg::1"
v6_bad "2001:db8:0:0:0:0:0:0:1"
v6_bad "1:2:3:4:5:6:7"
v6_bad ":1:2:3:4:5:6:7"
v6_bad "1:2:3:4:5:6:7:"
rejects ":"
rejects "1:2"
accepts "2001:db8::1"

is "an address is bracketed once, for a URL and a Caddy site" "[2001:db8::1]" "$(bracket_host 2001:db8::1)"
is "and not again" "[2001:db8::1]" "$(bracket_host '[2001:db8::1]')"
is "an IPv4 address is left alone" "203.0.113.10" "$(bracket_host 203.0.113.10)"
is "so is a name" "panel.example.com" "$(bracket_host panel.example.com)"
is "a panel at an IPv6 address has a URL Node can parse" "https://[2001:db8::1]" "https://$(bracket_host 2001:db8::1)"
if is_local_address '[::1]'; then ok_test; else bad_test "a bracketed loopback is this machine (a bracket is a character class to grep)"; fi
if is_local_address 'localhost'; then ok_test; else bad_test "localhost is this machine"; fi
if is_local_address '[2001:db8:dead:beef::99]'; then bad_test "an address nobody here holds is not this machine"; else ok_test; fi
if is_local_host 'localhost'; then ok_test; else bad_test "localhost is this machine, by is_local_host as well"; fi
if is_local_host 'name-nobody-has.invalid'; then bad_test "a name that resolves to nothing is not this machine"; else ok_test; fi
if is_local_host '[2001:db8:dead:beef::99]'; then bad_test "an address nobody here holds is not this machine, by is_local_host as well"; else ok_test; fi

echo "== which addresses are not the public internet =="

priv_yes() { if is_private_address "$1"; then ok_test; else bad_test "is_private_address '$1' should be true"; fi; }
priv_no() { if is_private_address "$1"; then bad_test "is_private_address '$1' should be false"; else ok_test; fi; }
priv_yes 10.0.0.5
priv_yes 192.168.1.20
priv_yes 172.16.0.1
priv_yes 172.31.255.254
priv_yes 127.0.0.1
priv_yes 169.254.169.254
priv_yes 100.64.1.1
priv_yes 100.127.255.255
priv_yes ::1
priv_yes fd12:3456::1
priv_yes fe80::1
priv_yes '[fd00::5]'
priv_no 203.0.113.10
priv_no 8.8.8.8
priv_no 172.15.0.1
priv_no 172.32.0.1
priv_no 100.63.0.1
priv_no 100.128.0.1
priv_no 192.169.0.1
priv_no 2001:db8::1
priv_no panel.example.com
priv_no ""
is "an address stands for itself" "203.0.113.10" "$(panel_addresses 203.0.113.10)"
is "a bracketed IPv6 address too" "2001:db8::1" "$(panel_addresses '[2001:db8::1]')"

echo "== an option that takes a value, and was given none =="

( need_value --domain 1 "" ) >/dev/null 2>&1 && bad_test "a value missing at the end of the line must be refused" || ok_test
( need_value --domain 2 "--email" ) >/dev/null 2>&1 && bad_test "another option where the value should be must be refused" || ok_test
( need_value --domain 2 "panel.example.com" ) >/dev/null 2>&1 && ok_test || bad_test "a value is a value"
case "$( ( need_value --domain 1 "" ) 2>&1 )" in *"--domain needs a value"*) ok_test ;; *) bad_test "it says which option, in a sentence" ;; esac

echo "== a node told where the panel has moved =="

NODE_INSTALLER="$HERE/../linux/install.sh"
told() { bash "$NODE_INSTALLER" "$@" 2>&1 || true; }
case "$(told --panel-url)" in *"--panel-url needs the panel's new address"*) ok_test ;; *) bad_test "no value is refused, naming the option" ;; esac
case "$(told --panel-url ftp://panel.example.com)" in *"is not an address"*) ok_test ;; *) bad_test "an address that is not http or https is refused" ;; esac
case "$(told --panel-url 'https://panel.example.com/a;b')" in *"has a character an address does not"*) ok_test ;; *) bad_test "a character that has no place in agent.json is refused before anything is written" ;; esac
case "$(told --panel-url https://panel.example.com https://other.example.com gbn_token)" in *"is for a machine that has already joined"*) ok_test ;; *) bad_test "a join carries its own address, so both together are refused" ;; esac

echo "== a Caddyfile is replaced when it is empty, ours, or the placeholder, and otherwise it is somebody's =="

# shellcheck disable=SC2034 # read by caddy_replaceable
cf() { CADDYFILE="$SITE_DIR/$1"; caddy_replaceable; }
should_replace() { if cf "$1"; then ok_test; else bad_test "$1 should have been replaceable: $2"; fi; }
should_keep() { if cf "$1"; then bad_test "$1 would have been overwritten: $2"; else ok_test; fi; }
REAL_DEFAULT='# The Caddyfile is an easy way to configure your Caddy web server.
#
# Unless the file starts with a global options block, the first
# uncommented line is always the address of your site.

:80 {
	# Set this path to your site'"'"'s directory.
	root * /usr/share/caddy

	# Enable the static file server.
	file_server

	# Another common task is to set up a reverse proxy:
	# reverse_proxy localhost:8080

	# Or serve a PHP site through php-fpm:
	# php_fastcgi localhost:9000
}

# Refer to the Caddy docs for more information:
# https://caddyserver.com/docs/caddyfile
'
printf '%s' "$REAL_DEFAULT" > "$SITE_DIR/default.caddyfile"
: > "$SITE_DIR/empty.caddyfile"
printf '# nothing yet

   
' > "$SITE_DIR/comments.caddyfile"
printf 'example.com {
	root * /var/www/site
	file_server
}
' > "$SITE_DIR/static.caddyfile"
printf 'example.com {
	root * /var/www/site
	php_fastcgi unix//run/php/php-fpm.sock
	file_server
}
' > "$SITE_DIR/php.caddyfile"
printf 'example.com {
	redir https://www.example.com{uri}
}
' > "$SITE_DIR/redir.caddyfile"
printf 'import /etc/caddy/sites/*
' > "$SITE_DIR/import.caddyfile"
printf ':80 {
	root * /usr/share/caddy
	file_server
	reverse_proxy /api/* localhost:9000
}
' > "$SITE_DIR/default-edited.caddyfile"
should_replace none.caddyfile "there is no file"
should_replace empty.caddyfile "it is empty"
should_replace comments.caddyfile "nothing but comments and blank lines"
should_replace default.caddyfile "the packaged placeholder, untouched, as Debian and Ubuntu write it"
should_replace ip.caddyfile "the one this installer wrote"
should_keep theirs.caddyfile "a site that proxies"
should_keep static.caddyfile "a site that serves files: this was overwritten before 0.9, and the static site with it"
should_keep php.caddyfile "a PHP site"
should_keep redir.caddyfile "a site that redirects"
should_keep import.caddyfile "a file that only imports others"
should_keep default-edited.caddyfile "the placeholder with something added to it is somebody's work"

echo "== the Caddyfile is filled in by position, not by pattern =="

if [ -r "$TEMPLATE" ]; then
  # An address cannot have these, but an email in a tls line can, and the renderer is not the place to find out.
  OUT="$(caddy_render "$TEMPLATE" 'a&b.example\c' 'tls me+x&y@example.com' 'unix//run/geeboard\1.sock')"
  case "$OUT" in *'a&b.example\c {'*) ok_test ;; *) bad_test "an ampersand and a backslash in the site were changed" ;; esac
  case "$OUT" in *'tls me+x&y@example.com'*) ok_test ;; *) bad_test "an ampersand in the tls line was changed" ;; esac
  case "$OUT" in *'reverse_proxy unix//run/geeboard\1.sock'*) ok_test ;; *) bad_test "a backslash in the upstream was changed" ;; esac
fi

echo "== the engine this will not run on =="

# A docker and a docker-compose that are not the real ones, first on the path, in a directory of their own.
SHIM="$WORK/shim"
mkdir -p "$SHIM/snap/bin" "$SHIM/v1" "$SHIM/v2only"
printf '#!/bin/sh\nexit 0\n' > "$SHIM/snap/bin/docker"
printf '#!/bin/sh\ncase "$1" in info) exit 0 ;; compose) exit 1 ;; --version) echo "Docker version 24.0.5" ;; esac\n' > "$SHIM/v1/docker"
printf '#!/bin/sh\nif [ "$1" = version ]; then echo 1.29.2; fi\n' > "$SHIM/v1/docker-compose"
printf '#!/bin/sh\ncase "$1" in info) exit 0 ;; compose) exit 1 ;; --version) echo "Docker version 29.0.0" ;; esac\n' > "$SHIM/v2only/docker"
printf '#!/bin/sh\nif [ "$1" = version ]; then echo 2.40.3; fi\n' > "$SHIM/v2only/docker-compose"
chmod +x "$SHIM"/snap/bin/docker "$SHIM"/v1/* "$SHIM"/v2only/*

SNAP_SAYS="$( ( PATH="$SHIM/snap/bin:$PATH"; require_docker ) 2>&1 || true )"
case "$SNAP_SAYS" in *"installed as a snap"*) ok_test ;; *) bad_test "a Docker under /snap/ should be refused, and was not: $SNAP_SAYS" ;; esac
( PATH="$SHIM/snap/bin:$PATH"; require_docker ) >/dev/null 2>&1 && bad_test "require_docker should exit for a snap" || ok_test

V1_SAYS="$( ( PATH="$SHIM/v1:$PATH"; require_compose ) 2>&1 || true )"
case "$V1_SAYS" in *"Compose v1"*"cannot read this file"*) ok_test ;; *) bad_test "docker-compose 1.29.2 should be refused as Compose v1: $V1_SAYS" ;; esac
( PATH="$SHIM/v1:$PATH"; require_compose ) >/dev/null 2>&1 && bad_test "require_compose should exit for Compose v1" || ok_test
V2_SAYS="$( ( PATH="$SHIM/v2only:$PATH"; require_compose; printf 'uses %s\n' "$GB_COMPOSE" ) 2>&1 || true )"
case "$V2_SAYS" in *"uses docker-compose"*) ok_test ;; *) bad_test "the standalone Compose v2 is fine: $V2_SAYS" ;; esac

echo "== a run leaves a log, and nothing behind =="

if have mkfifo && [ -e /dev/fd/1 ]; then
  RUN_LOG="$WORK/run.log"
  RUN_NOTE="$WORK/run.note"
  # The run is killed the way a dropped SSH session kills it, from inside: SIGHUP, with a secret in a temporary file.
  set +e
  bash -c '
    . "$1/common.sh"
    gb_init_run "$2/never.*"
    gb_log "$3"
    GB_B=$(printf "\033[1m"); GB_0=$(printf "\033[0m")
    ok "a stage that finished"
    printf "%s\n" "$GB_RUN_DIR" > "$4"
    printf "secret" > "$(gb_tmp)"
    : > "$2/never.1"
    warn "the line before the end"
    kill -HUP $$
    sleep 5
  ' _ "$HERE" "$WORK" "$RUN_LOG" "$RUN_NOTE" > "$WORK/run.screen" 2>&1
  RUN_STATUS=$?
  set -e
  is "the run ends with the code a hang-up gives" "129" "$RUN_STATUS"
  RUN_DIR="$(cat "$RUN_NOTE" 2>/dev/null || true)"
  if [ -n "$RUN_DIR" ] && [ ! -e "$RUN_DIR" ]; then ok_test; else bad_test "the run's own directory was left behind ($RUN_DIR)"; fi
  if [ ! -e "$WORK/never.1" ]; then ok_test; else bad_test "a file named for cleanup at the end was left behind"; fi
  case "$(cat "$RUN_LOG" 2>/dev/null)" in *"a stage that finished"*"the line before the end"*) ok_test ;; *) bad_test "the log has what the run printed, up to the hang-up" ;; esac
  case "$(cat "$RUN_LOG" 2>/dev/null)" in *$'\033'*) bad_test "the log has the terminal's colour codes in it" ;; *) ok_test ;; esac
  case "$(cat "$WORK/run.screen" 2>/dev/null)" in *"the line before the end"*) ok_test ;; *) bad_test "the terminal still got what the run printed" ;; esac
  # A file system with modes (not NTFS under Git Bash).
  if [ "$(uname -s)" != "Linux" ] || [ "$(stat -c %a "$RUN_LOG" 2>/dev/null)" = "600" ]; then ok_test; else bad_test "the log must be readable by its owner only"; fi
fi

echo
if [ "$FAILED" -eq 0 ]; then
  printf '%s[%s]%s %s checks passed.\n' "$GB_G" "$GB_TICK" "$GB_0" "$PASSED"
else
  printf '%s[!]%s %s passed, %s failed.\n' "$GB_R" "$GB_0" "$PASSED" "$FAILED"
  exit 1
fi
