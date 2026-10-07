#!/usr/bin/env bash
# Installs the Geeboard panel on a Linux machine, from a clone to a panel
# somebody can sign in to over https.
#
#   git clone https://github.com/DanieleMarino70/Geeboard.git
#   cd Geeboard
#   sudo bash deploy/linux/install-panel.sh
#
# `bash …` rather than `./…` in that line on purpose: a checkout copied
# from Windows, unpacked from a zip or restored from a backup arrives with
# no execute bit on anything, and the first command somebody runs should
# not be the one that fails. This script repairs the rest of them.
#
# It asks three questions — whether there is a domain name, who the first
# owner is, and whether this machine runs game servers too — and does
# everything else itself: the secrets, deploy/panel/.env, the Caddyfile,
# https, the containers, the database, the first owner, a check that the
# whole of it answers — on this machine, which says nothing of the firewall
# between it and the rest of the world; the last words say how to look — and,
# if you said yes, the node agent beside the panel, registered with it and
# waiting for your approval.
#
# What it prints is also kept, without its colours, in /var/log/geeboard-install.log
# (readable by root only), so that a session that drops leaves something to read.
#
# Running it again is the upgrade and the repair. It never regenerates a
# secret that is already there, never removes a volume, and never touches a
# game server: SECRETS_KEY is what every stored node token is encrypted
# under and POSTGRES_PASSWORD is read when the database's volume is made, so
# a second run that refreshed either would lock the panel out of its own
# data. A machine that is already a node is not registered again: its agent
# is upgraded, as `install.sh` with no arguments does.
#
# An upgrade of a panel that is already running does this, in this order: looks
# at what is in flight, stops the panel and the poller (a pass in progress is
# finished first), takes a dump of the database into a directory only root can
# read, checks the dump reads back, applies the migrations, and starts them
# again. It ends by printing the commands that undo it. A migration that fails
# leaves them stopped and says so; nothing is started on a schema that is half
# changed.
#
# Options, none of them needed for the ordinary case:
#
#   --domain <name> --email <address>   a public certificate, from Let's Encrypt
#   --ip [<address>]                    https on an address, with Caddy's own authority
#   --panel-url <url>                   an address you have arranged https for yourself
#   --owner-email <address> --owner-name "<name>"
#   --node | --no-node                  answer "run game servers here too?" (default: no)
#   --node-name <name>                  the node's name; the hostname, made to fit, otherwise
#   --terminal                          allow the panel a shell on this node; see docs/nodes.md
#   --bind <host:port>                  where the panel listens for the proxy
#   --image <reference> | --build       the panel image, instead of this release's
#   --no-caddy                          leave the reverse proxy to you
#   --no-backup                         an upgrade does not dump the database first (you have your own)
#   --backup-dir <dir>                  where the dump goes (default /var/backups/geeboard)
#   --force                             go on although something is in the middle of an operation
#   --check                             say what this machine is and what is in the way, and change nothing
#   --yes                               take every default; ask nothing
#   --help
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

# shellcheck source=../lib/common.sh
. "$REPO/deploy/lib/common.sh"
# shellcheck source=../lib/panel-env.sh
. "$REPO/deploy/lib/panel-env.sh"
# shellcheck source=../lib/caddy.sh
. "$REPO/deploy/lib/caddy.sh"
# shellcheck source=../lib/upgrade.sh
. "$REPO/deploy/lib/upgrade.sh"

COMPOSE_FILE="$REPO/deploy/panel/docker-compose.yml"
ENV_FILE="$REPO/deploy/panel/.env"
CADDY_TEMPLATE="$REPO/deploy/panel/caddy/panel.caddyfile.tmpl"
PUBLISHED="ghcr.io/danielemarino70/geeboard-panel"
# The name the panel image gets when it is built here rather than pulled.
LOCAL_IMAGE="geeboard-panel:local"

OPT_DOMAIN=""; OPT_EMAIL=""; OPT_IP=""; OPT_MODE=""
OPT_PANEL_URL=""; OPT_BIND=""; OPT_IMAGE=""; OPT_BUILD=0
OPT_OWNER_EMAIL=""; OPT_OWNER_NAME=""; OPT_NO_CADDY=0
# Empty: ask, when there is somebody to ask; otherwise no. A scripted
# installation must not gain an agent nobody asked for.
OPT_NODE=""; OPT_NODE_NAME=""; OPT_TERMINAL=0
OPT_NO_BACKUP=0; OPT_BACKUP_DIR=""; OPT_FORCE=0; OPT_CHECK=0

usage() {
  sed -n '2,/^#   --help$/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
}

# An address given on the command line is refused here, before the machine
# is touched at all, rather than in the stage that would have built on it.
check_address() {
  valid_site_host "$1" && return 0
  die "\"$1\" is not an address." \
    "PANEL_URL, the Caddyfile and the certificate Caddy issues would all have been made from it." \
    "Give this machine's public address, like 203.0.113.10, or a domain with --domain."
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --domain) need_value --domain "$#" "${2:-}"; OPT_DOMAIN="$2"; OPT_MODE="domain"; shift 2 ;;
    --domain=*) OPT_DOMAIN="${1#--domain=}"; OPT_MODE="domain"; shift ;;
    --email) need_value --email "$#" "${2:-}"; OPT_EMAIL="$2"; shift 2 ;;
    --email=*) OPT_EMAIL="${1#--email=}"; shift ;;
    --ip) OPT_MODE="ip"
          case "${2:-}" in ""|--*) shift ;; *) OPT_IP="$2"; check_address "$OPT_IP"; shift 2 ;; esac ;;
    --ip=*) OPT_IP="${1#--ip=}"; check_address "$OPT_IP"; OPT_MODE="ip"; shift ;;
    --panel-url) need_value --panel-url "$#" "${2:-}"; OPT_PANEL_URL="$2"; shift 2 ;;
    --panel-url=*) OPT_PANEL_URL="${1#--panel-url=}"; shift ;;
    --bind) need_value --bind "$#" "${2:-}"; OPT_BIND="$2"; shift 2 ;;
    --bind=*) OPT_BIND="${1#--bind=}"; shift ;;
    --image) need_value --image "$#" "${2:-}"; OPT_IMAGE="$2"; shift 2 ;;
    --image=*) OPT_IMAGE="${1#--image=}"; shift ;;
    --build) OPT_BUILD=1; shift ;;
    --owner-email) need_value --owner-email "$#" "${2:-}"; OPT_OWNER_EMAIL="$2"; shift 2 ;;
    --owner-email=*) OPT_OWNER_EMAIL="${1#--owner-email=}"; shift ;;
    --owner-name) need_value --owner-name "$#" "${2:-}"; OPT_OWNER_NAME="$2"; shift 2 ;;
    --owner-name=*) OPT_OWNER_NAME="${1#--owner-name=}"; shift ;;
    --no-caddy) OPT_NO_CADDY=1; shift ;;
    --node) OPT_NODE=1; shift ;;
    --no-node) OPT_NODE=0; shift ;;
    --node-name) need_value --node-name "$#" "${2:-}"; OPT_NODE_NAME="$2"; OPT_NODE=1; shift 2 ;;
    --node-name=*) OPT_NODE_NAME="${1#--node-name=}"; OPT_NODE=1; shift ;;
    --terminal) OPT_TERMINAL=1; shift ;;
    --no-backup) OPT_NO_BACKUP=1; shift ;;
    --backup-dir) need_value --backup-dir "$#" "${2:-}"; OPT_BACKUP_DIR="$2"; shift 2 ;;
    --backup-dir=*) OPT_BACKUP_DIR="${1#--backup-dir=}"; shift ;;
    --force) OPT_FORCE=1; shift ;;
    --check) OPT_CHECK=1; shift ;;
    --yes|-y) GEEBOARD_ASSUME_YES=1; shift ;;
    --help|-h) usage ;;
    *) die "I do not know the option $1." "" "Run it with --help to see the ones there are." ;;
  esac
done

compose() { $GB_COMPOSE --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

# Refused here, before anything is touched, like an address is.
if [ -n "$OPT_NODE_NAME" ] && ! valid_node_name "$OPT_NODE_NAME"; then
  die "\"$OPT_NODE_NAME\" is not a node name." \
    "The panel takes 2 to 39 lowercase letters, digits and dashes, starting with a letter or digit." \
    "Something like --node-name game-box."
fi

gb_stages 9

printf '\n%sGeeboard — installing the panel%s\n' "$GB_B" "$GB_0"
note "$REPO"

# ── 1 ────────────────────────────────────────────────────────────────
stage "Checking the system"

need_root "deploy/linux/install-panel.sh"
# A directory of its own for the run's files, removed however it ends; a log of what it printed unless it only looks.
gb_init_run "$ENV_FILE.next.*"
if [ "$OPT_CHECK" != "1" ]; then
  gb_log /var/log/geeboard-install.log
  note "This run is also written to /var/log/geeboard-install.log"
fi

if ! detect_os; then
  die "This installer is for Linux." \
    "The panel runs as containers under Docker Compose, started by systemd's own Docker service." \
    "On Windows or macOS, run it inside a Linux virtual machine, or follow docs/advanced-install.md."
fi
if os_is_debian_like || os_is_rhel_like; then
  ok "$GB_OS_NAME"
else
  warn "$GB_OS_NAME is not one this has been tested on."
  note "Everything below still only needs Docker, Compose and systemd."
  confirm "Carry on anyway?" yes || exit 1
fi

require_docker
ok "Docker is running"
require_compose
ok "Docker Compose is available"
gb_preflight "80 443 3000"
if [ "$OPT_CHECK" = "1" ]; then
  say ""
  if [ "$GB_WARNINGS" -gt 0 ]; then
    say "$GB_WARNINGS thing(s) above are worth a look before installing. Nothing was changed."
    exit 1
  fi
  say "Nothing in the way that this can see. Nothing was changed."
  exit 0
fi

[ -f "$COMPOSE_FILE" ] || die "This is not a Geeboard checkout." \
  "$COMPOSE_FILE is not here, and it is what starts the panel." \
  "Run this from the directory git clone made:

  cd Geeboard && sudo bash deploy/linux/install-panel.sh"

# A database here and the file that holds its secrets gone: a new .env would hold a
# POSTGRES_PASSWORD the database does not have, and a SECRETS_KEY that none of the
# stored node tokens can be read with — a panel that cannot reach its own data, made
# in the name of a repair. Refused before anything is written.
if [ ! -f "$ENV_FILE" ] && docker volume ls -q 2>/dev/null | grep -qx "geeboard-panel_db"; then
  die "There is a database here already, and the file that holds its secrets is gone." \
    "deploy/panel/.env is missing and the volume geeboard-panel_db is not. A new .env would hold a new database password that database does not have, and a new SECRETS_KEY that no stored node token can be read with. Nothing was changed." \
    "Put deploy/panel/.env back from your backup (an upgrade copies it to $GB_BACKUP_DIR_DEFAULT/panel-<time>.env). To start over with an empty database, remove the old one first, which deletes it:

  docker compose -f deploy/panel/docker-compose.yml down -v"
fi

# ── 2 ────────────────────────────────────────────────────────────────
stage "Detecting the network"

PUBLIC_IP=""
if PUBLIC_IP="$(public_ip)"; then
  ok "Public IP: $PUBLIC_IP"
else
  PUBLIC_IP=""
  warn "This machine's public address could not be worked out."
  note "No way out to the internet, or all three lookup services were down."
fi

LAN_IP="$(local_addresses | grep -v '^127\.' | grep -v ':' | head -n 1 || true)"
[ -z "$LAN_IP" ] || info "This machine also answers on $LAN_IP"
GLOBAL_IP6="$(global_ipv6 || true)"
[ -z "$GLOBAL_IP6" ] || info "It has the IPv6 address $GLOBAL_IP6"
# The address the internet sees is not one this machine holds: a router in between, or a provider that maps one address to
# another. Everything that comes in has to be forwarded, and the check at the end of this run cannot see across it.
BEHIND_NAT=0
if [ -n "$PUBLIC_IP" ] && ! is_local_address "$PUBLIC_IP"; then
  BEHIND_NAT=1
  warn "The internet sees this machine at $PUBLIC_IP, which it does not hold itself."
  note "That is NAT: forward 80 and 443 to ${LAN_IP:-this machine}, or nothing from outside reaches the panel."
fi

# ── 3 ────────────────────────────────────────────────────────────────
stage "Configuring HTTPS"

# https is not a preference here. Session cookies are Secure in production,
# so a panel on plain http cannot sign anybody in at all.
SITE=""; TLS_LINE=""; PANEL_URL=""; HTTPS_MODE=""

# A panel that is already installed is served the way it is. The question below defaults to "no domain", and a
# re-run that took the default wrote `tls internal` over a Let's Encrypt site while the final check, which only
# asks whether the address answers, passed. What the machine says is used unless a flag says otherwise.
if [ -z "$OPT_MODE" ] && [ -z "$OPT_PANEL_URL" ] && [ -f "$ENV_FILE" ]; then
  if EXISTING="$(existing_site "$(env_get "$ENV_FILE" PANEL_URL || true)" "$(env_get "$ENV_FILE" PANEL_TLS_MODE || true)" "$(env_get "$ENV_FILE" ACME_EMAIL || true)" "$CADDYFILE")"; then
    # shellcheck disable=SC2086
    set -- $EXISTING
    case "$1" in
      domain) OPT_MODE="domain"; OPT_DOMAIN="$2"; [ -z "${3:-}" ] || OPT_EMAIL="$3" ;;
      ip) OPT_MODE="ip"; OPT_IP="$2" ;;
      given) OPT_PANEL_URL="$(env_get "$ENV_FILE" PANEL_URL)" ;;
    esac
    info "Keeping the way this panel is served: $1, $2 (--domain, --ip or --panel-url says otherwise)"
  fi
fi

if [ -n "$OPT_PANEL_URL" ]; then
  PANEL_URL="$OPT_PANEL_URL"
  SITE="$(host_of "$PANEL_URL")"
  case "$PANEL_URL" in
    http://*|https://*) ;;
    *) die "--panel-url needs the scheme: $PANEL_URL" "" "It should read like https://panel.example.com." ;;
  esac
  valid_site_host "$SITE" || die "\"$SITE\" is not an address or a name." \
    "It is what PANEL_URL would be set to, and what every node agent would be told to reach." \
    "It should read like https://panel.example.com or https://203.0.113.10."
  HTTPS_MODE="given"
  OPT_NO_CADDY=1
  ok "Using the address you gave: $PANEL_URL"
  note "Nothing here will write a Caddyfile: the https in front of the panel is yours."
elif [ "$OPT_MODE" = "domain" ] || { [ -z "$OPT_MODE" ] && confirm "Do you have a domain name pointing at this machine?" no; }; then
  HTTPS_MODE="domain"
  [ -n "$OPT_DOMAIN" ] || OPT_DOMAIN="$(ask_required "The domain, without https:// (panel.example.com)")"
  case "$OPT_DOMAIN" in
    *[!a-zA-Z0-9.-]*|-*|*.|.*|"") die "$OPT_DOMAIN does not look like a domain name." "" "It should read like panel.example.com — no scheme, no path, no port." ;;
    *.*) ;;
    *) die "$OPT_DOMAIN has no dot in it, so it is not a domain name." "" "It should read like panel.example.com." ;;
  esac
  [ -n "$OPT_EMAIL" ] || OPT_EMAIL="$(ask_required "An email address for the certificate (Let's Encrypt writes to it if one is about to expire)")"
  case "$OPT_EMAIL" in *@*.*) ;; *) die "$OPT_EMAIL is not an email address." "" "Let's Encrypt uses it to warn you about a certificate that has not renewed." ;; esac

  SITE="$OPT_DOMAIN"
  TLS_LINE="tls $OPT_EMAIL"
  PANEL_URL="https://$OPT_DOMAIN"
  ok "Domain: $OPT_DOMAIN"

  # Worth saying now rather than at the certificate failure in four minutes. Both families: Let's Encrypt prefers IPv6 when
  # there is an AAAA record, so one that points at some other server fails the validation, while the A record is right.
  RESOLVED=""; RESOLVED6=""
  if have getent; then
    RESOLVED="$(getent ahostsv4 "$OPT_DOMAIN" 2>/dev/null | awk '{print $1}' | head -n 1 || true)"
    RESOLVED6="$(getent ahostsv6 "$OPT_DOMAIN" 2>/dev/null | awk '$1 !~ /^::ffff:/ {print $1; exit}' || true)"
  fi
  if [ -z "$RESOLVED" ] && [ -z "$RESOLVED6" ]; then
    warn "$OPT_DOMAIN does not resolve from this machine yet."
    note "Point an A record at ${PUBLIC_IP:-the address of this machine} first, or the certificate cannot be issued."
  else
    if [ -z "$RESOLVED" ]; then
      info "$OPT_DOMAIN has no A record, only an AAAA; it is reached over IPv6 only"
    elif [ -z "$PUBLIC_IP" ]; then
      # Said as what it is: a name that resolves, and nothing to compare it with.
      info "$OPT_DOMAIN resolves to $RESOLVED; this machine's public address could not be worked out, so that is not compared"
    elif [ "$RESOLVED" = "$PUBLIC_IP" ] || is_local_address "$RESOLVED"; then
      ok "$OPT_DOMAIN's A record is this machine ($RESOLVED)"
    else
      warn "$OPT_DOMAIN's A record is $RESOLVED, and this machine is $PUBLIC_IP."
      note "Let's Encrypt asks this machine for the name it is issuing, so the record has to point here. A CNAME to a proxy (Cloudflare's orange cloud) does this too."
    fi
    if [ -n "$RESOLVED6" ]; then
      if is_local_address "$RESOLVED6"; then
        ok "$OPT_DOMAIN's AAAA record is this machine ($RESOLVED6)"
      else
        warn "$OPT_DOMAIN has an AAAA record, $RESOLVED6, and this machine does not hold it."
        note "Let's Encrypt tries IPv6 first when there is one. If that address is another server, the certificate is refused: remove the AAAA record, or point it here${GLOBAL_IP6:+ ($GLOBAL_IP6)}."
      fi
    fi
  fi
else
  HTTPS_MODE="ip"
  DEFAULT_IP="${OPT_IP:-${PUBLIC_IP:-$LAN_IP}}"
  [ -n "$DEFAULT_IP" ] || DEFAULT_IP="$(ask_required "This machine's address, as browsers will reach it")"
  # The wording earns its length. This question follows a yes-or-no one,
  # and somebody answered this one `y` — so it says what pressing Enter
  # does, and what comes back is checked before anything is built on it.
  if [ -z "$OPT_IP" ]; then
    while :; do
      OPT_IP="$(ask "The address browsers will use (Enter accepts the one in brackets)" "$DEFAULT_IP")"
      valid_site_host "$OPT_IP" && break
      warn "\"$OPT_IP\" is not an address."
      note "Give this machine's public address, like 203.0.113.10 — or press Enter for $DEFAULT_IP."
      gb_interactive || break
    done
  fi
  valid_site_host "$OPT_IP" || die "\"$OPT_IP\" is not an address browsers can reach." \
    "Everything after this would have been built on it: PANEL_URL, the Caddyfile, and the certificate Caddy issues." \
    "Run it again and give the machine's public address:

  sudo bash deploy/linux/install-panel.sh --ip ${PUBLIC_IP:-203.0.113.10}"

  # An IPv6 address is bracketed once, here, and everything built from it — the Caddy site, PANEL_URL, what the agents are
  # told — is built from the bracketed form: https://2001:db8::1 is not a URL, and Node refuses it.
  SITE="$(bracket_host "$OPT_IP")"
  TLS_LINE="tls internal"
  PANEL_URL="https://$SITE"
  ok "IP-based HTTPS selected: $PANEL_URL"
  say ""
  say "  Caddy will sign this certificate with an authority of its own, because no"
  say "  public authority issues certificates for a bare address. The connection is"
  say "  encrypted and checked exactly as any other — what is different is that no"
  say "  other machine knows that authority yet:"
  say ""
  say "    · your browser will warn once, and you accept it"
  say "    · a node agent is given the authority itself, which this installer"
  say "      leaves at $PANEL_CA_COPY for it"
  say ""
  say "  A domain name avoids both. It is the better answer whenever you have one."
fi

# ── 4 ────────────────────────────────────────────────────────────────
stage "Preparing Geeboard"

repair_permissions "$REPO/deploy" || true
explain_mode_only_changes "$REPO"

panel_env_ensure "$ENV_FILE"
if [ "$GB_ENV_CREATED" = "1" ]; then
  ok "Secrets generated, in $ENV_FILE"
  note "They were not printed. Back this file up with the database."
else
  ok "Secrets kept: $ENV_FILE already has them"
  note "Nothing already in that file was changed."
fi

# What was decided is written down, so that the next run reads it instead of guessing from a Caddyfile.
env_set "$ENV_FILE" PANEL_TLS_MODE "$HTTPS_MODE"
[ "$HTTPS_MODE" != "domain" ] || env_set "$ENV_FILE" ACME_EMAIL "$OPT_EMAIL"

CURRENT_URL="$(env_get "$ENV_FILE" PANEL_URL || true)"
if [ -z "$CURRENT_URL" ] || [ "$CURRENT_URL" = "$PANEL_URL" ]; then
  env_set "$ENV_FILE" PANEL_URL "$PANEL_URL"
elif [ -n "$OPT_MODE" ] || [ -n "$OPT_PANEL_URL" ] || confirm "PANEL_URL is $CURRENT_URL. Change it to $PANEL_URL?" no; then
  env_set "$ENV_FILE" PANEL_URL "$PANEL_URL"
  warn "PANEL_URL changed from $CURRENT_URL"
  note "Nodes joined at the old address keep working; new ones are given the new one."
else
  PANEL_URL="$CURRENT_URL"
  SITE="$(host_of "$PANEL_URL")"
  info "Keeping PANEL_URL=$PANEL_URL"
fi
ok "PANEL_URL: $PANEL_URL"

# Where the panel listens for the proxy. Loopback, always: it speaks plain
# HTTP, and the certificate belongs to what is in front of it.
BIND="${OPT_BIND:-$(env_get "$ENV_FILE" PANEL_BIND || true)}"
[ -n "$BIND" ] || BIND="127.0.0.1:3000"
BIND_PORT="${BIND##*:}"
if [ -z "$OPT_BIND" ] && ! port_free "$BIND_PORT" && ! compose ps -q panel 2>/dev/null | grep -q .; then
  for candidate in 3000 3100 3200 3300; do
    if port_free "$candidate"; then
      warn "Port $BIND_PORT is already taken by something else on this machine."
      BIND="127.0.0.1:$candidate"; BIND_PORT="$candidate"
      note "The panel will listen on $BIND instead."
      break
    fi
  done
fi
env_set "$ENV_FILE" PANEL_BIND "$BIND"
ok "The panel will listen on $BIND, for the proxy only"

# Is there a panel here already, and which image is it running? That image is
# given a name of its own before anything is pulled or built: a build from this
# checkout replaces geeboard-panel:local, and the one that was running would
# then be nowhere to go back to. Its version is read off the image, which the
# published ones label.
STAMP="$(upgrade_stamp)"
PREV_REF=""; PREV_VERSION=""
PREV_CONTAINER="$(compose ps -aq panel 2>/dev/null | head -n 1 || true)"
if [ -n "$PREV_CONTAINER" ]; then
  PREV_ID="$(docker inspect -f '{{.Image}}' "$PREV_CONTAINER" 2>/dev/null || true)"
  if [ -n "$PREV_ID" ]; then
    PREV_VERSION="$(docker inspect -f '{{index .Config.Labels "org.opencontainers.image.version"}}' "$PREV_ID" 2>/dev/null || true)"
    PREV_REF="geeboard-panel:before-$STAMP"
    docker tag "$PREV_ID" "$PREV_REF" >/dev/null 2>&1 || PREV_REF=""
  fi
fi

# pull_image <reference> — three tries, a few seconds apart, and what Docker said last in PULL_OUT. A release with no image
# ("manifest unknown") is not tried again: waiting does not make one.
pull_image() {
  _try=0
  while [ "$_try" -lt 3 ]; do
    if PULL_OUT="$(docker pull "$1" 2>&1)"; then return 0; fi
    _try=$((_try + 1))
    case "$PULL_OUT" in *"manifest unknown"*|*"not found"*|*"denied"*) return 1 ;; esac
    [ "$_try" -ge 3 ] || sleep 3
  done
  return 1
}

# The image: this release's published one, the one already chosen, or a
# build from this checkout when there is no pulling to be done.
VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$REPO/web/package.json" | head -1)"
# The image is this checkout's version, and the installer and docs are this checkout's own: on a branch that is
# ahead of its last tag they may be newer than the image they pull. Said once, as a warning and no more.
if have git && git -C "$REPO" rev-parse --is-inside-work-tree >/dev/null 2>&1 && ! git -C "$REPO" describe --exact-match --tags HEAD >/dev/null 2>&1; then
  warn "This checkout is not at a release tag ($(git -C "$REPO" describe --tags --always 2>/dev/null || echo unknown)); the image it pulls is for ${VERSION:-an unknown version}."
  note "git checkout v${VERSION:-<the release>} makes the installer, the compose file and the docs match that image."
fi
CURRENT_IMAGE="$(env_get "$ENV_FILE" GEEBOARD_PANEL_IMAGE || true)"
# A published image labels its version; one built here does not, and its tag may still say.
[ -n "$PREV_VERSION" ] || PREV_VERSION="$(image_version_from_ref "$CURRENT_IMAGE")"
IMAGE=""
if [ -n "$OPT_IMAGE" ]; then
  IMAGE="$OPT_IMAGE"
  info "Using $IMAGE, as told"
elif [ "$OPT_BUILD" = "1" ]; then
  IMAGE="$LOCAL_IMAGE"
elif [ -n "$CURRENT_IMAGE" ] && [ "$CURRENT_IMAGE" != "$LOCAL_IMAGE" ] && ! printf '%s' "$CURRENT_IMAGE" | grep -q "^$PUBLISHED:"; then
  # An image this installer did not choose. The two it does choose — this
  # release's published one, and the one it builds when that cannot be
  # pulled — are replaced every run, so an upgrade gets the new version and
  # a machine that was offline last time tries the registry again.
  IMAGE="$CURRENT_IMAGE"
  info "Keeping the image you chose: $IMAGE"
elif pull_image "$PUBLISHED:${VERSION:-latest}"; then
  IMAGE="$PUBLISHED:${VERSION:-latest}"
  ok "Panel image: $IMAGE"
elif docker image inspect "$PUBLISHED:${VERSION:-latest}" >/dev/null 2>&1; then
  # A registry that is down at upgrade time used to replace a working published image with a local build, minutes long, on
  # the machine the players are on. The copy that is already here is this release's: it is used.
  IMAGE="$PUBLISHED:${VERSION:-latest}"
  warn "$IMAGE could not be pulled: $(printf '%s' "$PULL_OUT" | tail -n 1 | cut -c1-160)"
  ok "Using the copy of it that is already on this machine"
else
  IMAGE="$LOCAL_IMAGE"
  # Its own last line, not a guess: "manifest unknown" is a release with no image, "no such host" is a machine with no way out.
  info "$PUBLISHED:${VERSION:-latest} could not be pulled: $(printf '%s' "$PULL_OUT" | tail -n 1 | cut -c1-160)"
  info "Building it from this checkout instead"
fi
env_set "$ENV_FILE" GEEBOARD_PANEL_IMAGE "$IMAGE"

if [ "$IMAGE" = "$LOCAL_IMAGE" ]; then
  info "Building takes several minutes and about 2 GB of memory, and prints nothing until it ends."
  note "A connection that drops meanwhile ends it: tmux, or screen, keeps it going. The log is /var/log/geeboard-install.log."
  case "$(uname -m)" in
    aarch64|arm64) note "No arm64 image is published, so this is the only way on this machine." ;;
  esac
  _avail_kb="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo 2>/dev/null || true)"
  case "$_avail_kb" in
    ''|*[!0-9]*) ;;
    *) if [ "$_avail_kb" -lt 2000000 ]; then
         warn "Only $((_avail_kb / 1024)) MB of memory is available, and a build wants about 2 GB. The build can be killed for it, and so can anything else on this machine."
         confirm "Build anyway?" yes || die "Stopped before the build." "Nothing was changed." "Add swap, or give --image a published image, and run this again."
       fi ;;
  esac
  # Once, with its output kept: a failed build used to be run a second time just to be shown.
  BUILD_LOG="$(gb_tmp)"
  if compose build panel > "$BUILD_LOG" 2>&1; then
    rm -f "$BUILD_LOG"
  else
    tail -n 25 "$BUILD_LOG" | sed 's/^/    /' >&2
    rm -f "$BUILD_LOG"
    die "The panel image did not build." \
      "Nothing was started, and nothing already installed was changed." \
      "The lines above say what failed. A machine with no way out to the internet cannot build it either: it pulls a base image."
  fi
  ok "Panel image built from this checkout"
fi

# ── 5 ────────────────────────────────────────────────────────────────
stage "Starting the services"

if ! compose config -q 2>/dev/null; then
  warn "Compose will not accept the configuration:"
  compose config -q 2>&1 | sed 's/^/    /' >&2 || true
  die "The Compose configuration is not valid." \
    "Nothing was started." \
    "The lines above name what is wrong. A variable with no value in deploy/panel/.env is the usual cause."
fi
ok "Compose configuration is valid"

# A panel network made before this release has a bridge that Docker named br-<id>, and compose cannot give it the name this release
# pins (gb-panel, in the compose file) while anything is attached to it: it fails with "network has active endpoints", and this run
# used to say the database did not start. So the first run of this release takes the stack down, volumes untouched, and lets `up`
# make the network again. A few seconds more of the downtime an upgrade has anyway.
PANEL_NET="geeboard-panel_default"
if docker network inspect "$PANEL_NET" >/dev/null 2>&1; then
  _bridge="$(docker network inspect -f '{{index .Options "com.docker.network.bridge.name"}}' "$PANEL_NET" 2>/dev/null || true)"
  if [ "$_bridge" != "gb-panel" ]; then
    info "The panel's network gets a bridge with a name of its own, once: the stack is taken down (its data is not) and brought up again"
    if ! DOWN_OUT="$(compose down --remove-orphans 2>&1)"; then
      printf '%s\n' "$DOWN_OUT" | tail -n 12 | sed 's/^/    /' >&2
      die "The panel's containers could not be taken down." \
        "Nothing was removed: the database's volume and everything in it are still there." \
        "Compose's own words are above. $GB_COMPOSE -f deploy/panel/docker-compose.yml down, then run this again."
    fi
  fi
fi

if ! UP_OUT="$(compose up -d db 2>&1)"; then
  printf '%s\n' "$UP_OUT" | tail -n 12 | sed 's/^/    /' >&2
  die "The database did not start." \
    "Nothing was removed: its volume and everything in it are still there." \
    "Compose's own words are above. Usually a port in use, no disk space, or an image that could not be downloaded (Docker Hub limits pulls from a shared address). Fix that and run this again."
fi

db_healthy() {
  _cid="$(compose ps -q db 2>/dev/null)"
  [ -n "$_cid" ] || return 1
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$_cid" 2>/dev/null)" = "healthy" ]
}
wait_for 120 "Database healthy" db_healthy || die \
  "The database did not come up." \
  "Nothing was removed: its volume and everything in it are still there." \
  "This says why:

  $GB_COMPOSE -f deploy/panel/docker-compose.yml logs db"

# One value out of the panel's database, through the db container; nothing when it cannot say.
db_scalar() {
  compose exec -T db psql -U geeboard -d geeboard -tAc "$1" 2>/dev/null | tr -d '[:space:]' || true
}

# A database that has applied migrations is a panel that has been installed.
# Everything below that is about not hurting it happens only then.
UPGRADING=0
APPLIED="$(db_scalar 'select count(*) from "_prisma_migrations"')"
case "$APPLIED" in ''|*[!0-9]*) APPLIED=0 ;; esac
[ "$APPLIED" -gt 0 ] && UPGRADING=1

DUMP=""; ENV_COPY=""
BACKUP_DIR="${OPT_BACKUP_DIR:-$GB_BACKUP_DIR_DEFAULT}"

restart_after_refusal() {
  compose start panel poller >/dev/null 2>&1 || true
}

if [ "$UPGRADING" = "1" ]; then
  info "A panel is installed here already: $APPLIED migrations applied${PREV_VERSION:+, running $PREV_VERSION}"

  # What is in flight: stopping the panel under it leaves it half done — a backup row that stays "running" for
  # good, a restore that stops after the world was replaced.
  BUSY_SERVERS="$(db_scalar "select count(*) from servers where state::text in ('UPDATING','BACKING_UP','MIGRATING','INSTALLING')")"
  BUSY_BACKUPS="$(db_scalar "select count(*) from backups where state::text = 'RUNNING'")"
  case "$BUSY_SERVERS" in ''|*[!0-9]*) BUSY_SERVERS=0 ;; esac
  case "$BUSY_BACKUPS" in ''|*[!0-9]*) BUSY_BACKUPS=0 ;; esac
  if [ $((BUSY_SERVERS + BUSY_BACKUPS)) -gt 0 ]; then
    warn "$BUSY_SERVERS server(s) are in the middle of an operation, and $BUSY_BACKUPS backup(s) are running."
    note "Stopping the panel now leaves each half done. Wait for them (the Servers page shows which), or go on knowing that."
    if [ "$OPT_FORCE" = "1" ]; then
      warn "Going on, as --force says"
    else
      confirm "Stop the panel anyway?" no || die \
        "Stopped, before anything was changed." \
        "The panel is still running and nothing was touched." \
        "Run this again when they have finished, or with --force."
    fi
  fi

  # Stopped before the dump and the migration, not after: with the old panel and poller still running, a dump
  # is a moment in a stream of writes, and a migration runs under code that does not know its new shape.
  info "Stopping the panel and the poller (a pass in progress is finished first, up to two minutes)"
  if ! STOP_OUT="$(compose stop panel poller 2>&1)"; then
    printf '%s\n' "$STOP_OUT" | sed 's/^/    /' >&2
    die "The panel and the poller did not stop." "Nothing was changed." "The lines above say why."
  fi

  if [ "$OPT_NO_BACKUP" = "1" ]; then
    warn "No dump: --no-backup. If the migrations go wrong there is nothing to go back to but what you took yourself."
  else
    (umask 077; mkdir -p "$BACKUP_DIR") || { restart_after_refusal; die \
      "Could not make $BACKUP_DIR for the dump." "The panel was started again and nothing was changed." "Give it another place with --backup-dir, or run with --no-backup if you have your own."; }
    chmod 700 "$BACKUP_DIR" 2>/dev/null || true

    DB_BYTES="$(db_scalar "select pg_database_size('geeboard')")"
    case "$DB_BYTES" in ''|*[!0-9]*) DB_BYTES=0 ;; esac
    NEED="$(dump_room_needed "$DB_BYTES")"
    FREE_KB="$(df -Pk "$BACKUP_DIR" 2>/dev/null | awk 'NR==2 {print $4}' || true)"
    case "$FREE_KB" in ''|*[!0-9]*) FREE_KB=0 ;; esac
    if [ $((FREE_KB * 1024)) -lt "$NEED" ]; then
      restart_after_refusal
      die "Not enough room for the dump: it needs about $(human_bytes "$NEED"), and $BACKUP_DIR has $(human_bytes $((FREE_KB * 1024))) free." \
        "The panel was started again and nothing was changed." \
        "Free some space, give the dump another place with --backup-dir, or run with --no-backup if you have your own."
    fi

    DUMP="$BACKUP_DIR/geeboard-$STAMP${PREV_VERSION:+-from-$PREV_VERSION}.dump"
    ENV_COPY="$BACKUP_DIR/panel-$STAMP.env"
    if ! (umask 077; compose exec -T db pg_dump -U geeboard -Fc geeboard > "$DUMP.partial" 2> "$DUMP.err"); then
      sed 's/^/    /' "$DUMP.err" >&2 || true
      rm -f "$DUMP.partial" "$DUMP.err"
      restart_after_refusal
      die "The database could not be dumped." "The panel was started again and nothing was changed." "The lines above are what pg_dump said."
    fi
    rm -f "$DUMP.err"
    # A dump nobody has read back is a hope: the table of contents has to be there.
    DUMP_ENTRIES="$(compose exec -T db pg_restore --list < "$DUMP.partial" 2>/dev/null | grep -c '^[0-9][0-9]*;' || true)"
    case "$DUMP_ENTRIES" in ''|*[!0-9]*) DUMP_ENTRIES=0 ;; esac
    if [ "$DUMP_ENTRIES" -lt 10 ]; then
      rm -f "$DUMP.partial"
      restart_after_refusal
      die "The dump does not read back (pg_restore finds $DUMP_ENTRIES objects in it)." "The panel was started again and nothing was changed." "Try again; if it keeps happening, run with --no-backup only if you have a dump of your own."
    fi
    mv "$DUMP.partial" "$DUMP"
    (umask 077; cp "$ENV_FILE" "$ENV_COPY")
    ok "Database dumped: $DUMP ($(human_bytes "$(wc -c < "$DUMP" | tr -d ' ')"), $DUMP_ENTRIES objects, read back)"
    note "Secrets copied to $ENV_COPY. Both are readable by root only; keep them off this machine too."
  fi
fi

# Applying the migrations before the panel starts, rather than letting the
# first request find a schema that is a release behind — once, with what Prisma
# said kept: a failure used to be run a second time to be shown, and was
# described as having changed no data, which a migration that stops half-way
# has not promised.
MIGRATE_LOG="$(gb_tmp)"
if compose run --rm -T panel migrate > "$MIGRATE_LOG" 2>&1; then
  APPLIED_NAMES="$(migration_names < "$MIGRATE_LOG")"
  N_APPLIED="$(printf '%s\n' "$APPLIED_NAMES" | grep -c . || true)"
  if grep -q "No pending migrations" "$MIGRATE_LOG" || [ "$N_APPLIED" = "0" ]; then
    ok "Database schema up to date"
  else
    ok "Database schema up to date ($N_APPLIED migration$([ "$N_APPLIED" = 1 ] || echo s) applied)"
    # Each one's time, from Prisma's own table: the 0.7.0 migration moves data, and how long it takes is what to know.
    for _name in $APPLIED_NAMES; do
      _took="$(db_scalar "select round(extract(epoch from (finished_at - started_at))::numeric, 2) from \"_prisma_migrations\" where migration_name = '$_name'")"
      note "$_name  ${_took:-?}s"
    done
  fi
  rm -f "$MIGRATE_LOG"
else
  sed 's/^/    /' "$MIGRATE_LOG" >&2
  rm -f "$MIGRATE_LOG"
  warn "The migrations did not apply."
  say ""
  say "  The panel and the poller are stopped, so nothing is writing to the database. It may be partly"
  say "  changed: a migration that stops half-way is not rolled back. Prisma's own words are above."
  say ""
  if [ -n "$DUMP" ]; then
    say "  Either put the cause right, mark the failed migration, and run this again:"
    say "    $GB_COMPOSE -f deploy/panel/docker-compose.yml run --rm panel resolve --rolled-back <the migration's name>"
    say "  or go back to the dump:"
    say ""
    undo_text "$GB_COMPOSE -f deploy/panel/docker-compose.yml" "$DUMP" "$ENV_COPY" "$PREV_REF"
  else
    say "  You ran this with --no-backup, so there is no dump of this installation; the way forward is to mark the"
    say "  failed migration once its cause is put right, and run this again:"
    say "    $GB_COMPOSE -f deploy/panel/docker-compose.yml run --rm panel resolve --rolled-back <the migration's name>"
  fi
  say ""
  exit 1
fi

if ! UP_OUT="$(compose up -d 2>&1)"; then
  printf '%s\n' "$UP_OUT" | tail -n 12 | sed 's/^/    /' >&2
  die "The panel did not start." \
    "The database is up and nothing was removed." \
    "Compose's own words are above. $GB_COMPOSE -f deploy/panel/docker-compose.yml logs panel says what the panel itself said."
fi
ok "Panel and poller started"

# The container firewall (community games) lets the panel's network through by the name of its bridge. An upgrade to the release that
# gave that bridge a name of its own, and any run that made the network again, leaves a rule with the old name: it matches nothing, and
# the panel is rejected from its own node. Put back with the bridge as it is now, whenever the rules are there.
if have iptables && iptables -w 10 -S INPUT 2>/dev/null | grep -q -- "--comment geeboard-container-firewall"; then
  if REFRESH_OUT="$(bash "$HERE/container-firewall.sh" refresh 2>&1)"; then
    ok "The container firewall was put back with the panel's network as it is now"
  else
    printf '%s\n' "$REFRESH_OUT" | sed 's/^/    /' >&2
    warn "The container firewall could not be refreshed, and may be keeping the panel from its own node."
    note "sudo bash deploy/linux/container-firewall.sh refresh"
  fi
fi

PANEL_LOCAL="$(panel_bind_url "$BIND")"
panel_healthy() {
  case "$(http_code "$PANEL_LOCAL/sign-in")" in
    2*|3*) return 0 ;;
    *) return 1 ;;
  esac
}
wait_for 120 "Panel healthy" panel_healthy || die \
  "The panel started but is not answering on $PANEL_LOCAL." \
  "The database is up and nothing was removed." \
  "This says why — a missing secret makes it exit on purpose, naming what is missing:

  $GB_COMPOSE -f deploy/panel/docker-compose.yml logs panel"

# What the panel knows of its own certificate authority, kept in .env (PANEL_CA_B64) so the panel can offer it to a node that is
# joining, and write its fingerprint into the Add a node command. Caddy makes the authority after the panel is up, so the panel is
# told after the fact, and started again once, only when what it was told changes: a second run of this changes nothing.
panel_set_authority() {
  _wanted="$1"
  [ "$(env_get "$ENV_FILE" PANEL_CA_B64 || true)" != "$_wanted" ] || return 1
  env_set "$ENV_FILE" PANEL_CA_B64 "$_wanted"
  if _out="$(compose up -d 2>&1)"; then
    wait_for 120 "Panel healthy" panel_healthy || warn "The panel was started again and is not answering on $PANEL_LOCAL yet."
    return 0
  fi
  printf '%s\n' "$_out" | tail -n 8 | sed 's/^/    /' >&2
  warn "The panel could not be started again with its authority, so it does not offer it yet."
  note "$GB_COMPOSE -f deploy/panel/docker-compose.yml up -d    puts it right once whatever stopped it is dealt with."
  return 0
}

panel_learns_authority() {
  _encoded="$(base64 < "$PANEL_CA_COPY" | tr -d '\n')"
  if panel_set_authority "$_encoded"; then
    ok "The panel knows its own authority now, and hands it to a node that joins (the panel was started again, once)"
  else
    ok "The panel already knows its own authority"
  fi
}

panel_forgets_authority() {
  env_has "$ENV_FILE" PANEL_CA_B64 || return 0
  if panel_set_authority ""; then
    info "This panel is reached at a name now: it no longer offers an authority of its own"
  fi
}

# ── 6 ────────────────────────────────────────────────────────────────
stage "Configuring Caddy"

CA_READY=0
CADDY_NOT_WRITTEN=0
if [ "$OPT_NO_CADDY" = "1" ]; then
  info "Leaving the reverse proxy to you, as asked"
  note "Point it at $PANEL_LOCAL, pass the Host through, and do not buffer: the console is a stream."
  note "docs/advanced-install.md has an nginx server block that does all three."
else
  if caddy_present; then
    ok "Caddy is already installed"
  elif caddy_install && caddy_present; then
    ok "Caddy installed"
  else
    if [ -n "$CADDY_INSTALL_LOG" ]; then
      printf '%s\n' "$CADDY_INSTALL_LOG" | sed 's/^/    /' >&2
    fi
    die "Caddy could not be installed automatically." \
      "The panel is up on $PANEL_LOCAL and waiting for something to put https in front of it. Nothing is lost. What the package manager said last is above." \
      "Install Caddy, then run this installer again:

  sudo apt install -y caddy          # Debian, Ubuntu
  sudo dnf install -y caddy          # Fedora, RHEL

caddyserver.com/docs/install has the rest. Or use a proxy of your own and run
this again with --no-caddy."
  fi

  # Both: 443 is what https is served on, and 80 is what Caddy redirects from and what Let's Encrypt can need. A web server
  # on 80 (an Apache or an nginx that came with the image) made Caddy fail to start while this reported "HTTPS active".
  for _web_port in 80 443; do
    HOLDER="$(port_holder "$_web_port" || true)"
    if [ -n "$HOLDER" ] && [ "$HOLDER" != "caddy" ]; then
      warn "$HOLDER is already listening on $_web_port."
      note "Caddy cannot take the port while it is held, and two proxies on one port is not a thing."
      confirm "Carry on and write the Caddyfile anyway?" no || die \
        "Stopped, with the panel running and no proxy configured." \
        "Nothing was changed outside deploy/panel/. $HOLDER holds $_web_port." \
        "Stop $HOLDER (sudo systemctl stop $HOLDER, and disable it if it should not come back) and run this again, or run this with --no-caddy and configure $HOLDER yourself."
    fi
  done

  if ! caddy_replaceable; then
    warn "$CADDYFILE is somebody's configuration, so it was left alone."
    note "It is not empty, not written by this installer and not the packaged placeholder: it serves or proxies something."
    note "Add this site block to it yourself (or to a file it imports), and reload Caddy:"
    caddy_render "$CADDY_TEMPLATE" "$SITE" "$TLS_LINE" "$BIND" | grep -v '^#' | grep -v '^$' | sed 's/^/    /'
    CADDY_NOT_WRITTEN=1
  else
    RENDERED="$(gb_tmp)"
    caddy_render "$CADDY_TEMPLATE" "$SITE" "$TLS_LINE" "$BIND" > "$RENDERED"
    CADDY_STATUS=0
    caddy_apply "$RENDERED" || CADDY_STATUS=$?
    rm -f "$RENDERED"
    case "$CADDY_STATUS" in
      0) ok "HTTPS active: $CADDYFILE (Caddy is running)" ;;
      2) die "Caddy is not running." \
           "The Caddyfile was written ($CADDYFILE) and Caddy would not start with it, so there is no https. The panel is up on $PANEL_LOCAL and nothing was lost. Caddy's own last lines are above; an address already in use is the usual cause." \
           "Put that right, then: sudo systemctl restart caddy — or run this again." ;;
      *) die "Caddy refused the configuration." \
           "The panel is running and the Caddyfile was not replaced." \
           "The lines above name what it did not like." ;;
    esac
  fi

  if [ "$HTTPS_MODE" != "ip" ]; then
    # A panel that has moved to a name has no authority of its own to offer, and one that goes on offering the old one would put
    # a fingerprint in the Add a node command that nothing at the new address is signed by.
    panel_forgets_authority
  fi

  if [ "$HTTPS_MODE" = "ip" ]; then
    # Caddy writes its authority the first time it serves with `tls
    # internal`, so this is waiting for a file that does not exist yet.
    if caddy_wait_ca 45 && caddy_export_ca; then
      CA_READY=1
      ok "Certificate authority ready for nodes: $PANEL_CA_COPY"
      panel_learns_authority
    else
      warn "Caddy has not written its certificate authority yet."
      note "It appears the first time something asks it for https. Open $PANEL_URL once, then:"
      note "sudo install -m 0644 $CADDY_CA_ROOT $PANEL_CA_COPY"
    fi
  fi
fi

# ── 7 ────────────────────────────────────────────────────────────────
stage "The first owner"

OWNER_DONE=0
OWNER_MADE=0   # made by this run: a temporary password was printed above, and only then does "above" mean anything
if [ -z "$OPT_OWNER_EMAIL" ] && gb_interactive; then
  say "Whoever installs the panel is its administrator. This makes that one account."
  OPT_OWNER_EMAIL="$(ask "Your email, which you will sign in with" "")"
  [ -z "$OPT_OWNER_EMAIL" ] || OPT_OWNER_NAME="$(ask "Your name, as the audit log will show it" "$OPT_OWNER_NAME")"
fi

if [ -n "$OPT_OWNER_EMAIL" ] && [ -n "$OPT_OWNER_NAME" ]; then
  SETUP_OUT="$(gb_tmp)"
  if compose run --rm -T panel setup --email "$OPT_OWNER_EMAIL" --name "$OPT_OWNER_NAME" > "$SETUP_OUT" 2>&1; then
    OWNER_DONE=1
    OWNER_MADE=1
    ok "Owner created: $OPT_OWNER_NAME <$OPT_OWNER_EMAIL>"
    say ""
    # The temporary password is in here, shown this once and stored nowhere
    # it can be read back. It is the one thing that has to reach the screen.
    sed -n '/the first owner/,$p' "$SETUP_OUT"
  elif grep -q "already has an\|already has [0-9]" "$SETUP_OUT"; then
    OWNER_DONE=1
    ok "This installation already has an owner"
    note "Setup makes the first one only. Lost the password, or its day ran out? This prints a new temporary one:"
    note "$GB_COMPOSE -f deploy/panel/docker-compose.yml run --rm panel recover --email $OPT_OWNER_EMAIL"
  else
    warn "The owner was not created:"
    sed 's/^/    /' "$SETUP_OUT" >&2
    note "Everything else is installed. Run it again when this is sorted:"
    note "$GB_COMPOSE -f deploy/panel/docker-compose.yml run --rm panel setup --email you@example.com --name \"Your Name\""
  fi
  rm -f "$SETUP_OUT"
else
  info "No owner made: nobody was named"
  note "Make one whenever you like — it prints a temporary password, once:"
  note "sudo $GB_COMPOSE -f deploy/panel/docker-compose.yml run --rm panel setup --email you@example.com --name \"Your Name\""
fi

# ── 8 ────────────────────────────────────────────────────────────────
stage "Checking it works"

ok "Panel answering on $PANEL_LOCAL"

CA_ARG=""
[ "$CA_READY" = "1" ] && CA_ARG="$PANEL_CA_COPY"
REACHED=0

# Waited for rather than asked once. Caddy gets the certificate after it
# starts serving — a few milliseconds for its own authority, a few seconds
# from Let's Encrypt — and an installer that asked immediately reported a
# failure that had already fixed itself by the time anybody read it.
answers_publicly() {
  case "$(http_code "$PANEL_URL/sign-in" "$CA_ARG")" in
    2*|3*) return 0 ;;
    *) return 1 ;;
  esac
}
# Said as what it is: this machine asking itself. Where the provider binds the public address on the network card (OVH, Hetzner,
# DigitalOcean) the request does not leave the machine at all, and it passes whatever a firewall does to the rest of the world.
case "$PANEL_URL" in
  https://*) FINAL_CHECK="HTTPS answers, asked from this machine, at $PANEL_URL" ;;
  *) FINAL_CHECK="Answers, asked from this machine, at $PANEL_URL" ;;
esac

if wait_for 45 "$FINAL_CHECK" answers_publicly; then
  REACHED=1
else
  CODE="$(http_code "$PANEL_URL/sign-in" "$CA_ARG")"
  case "$CODE" in
    000)
      case "$HTTPS_MODE" in
        domain)
          note "A certificate from Let's Encrypt needs 80 and 443 open to the internet, and the name pointed here:"
          note "sudo ufw allow 80,443/tcp"
          note "systemctl status caddy, and journalctl -u caddy -n 50, say what happened." ;;
        ip)
          note "The certificate is signed by Caddy's own authority; this check used $PANEL_CA_COPY to verify it."
          note "journalctl -u caddy -n 50 says what happened." ;;
        *)
          note "Whatever is in front of the panel is not answering there yet." ;;
      esac ;;
    *) note "$PANEL_URL answered $CODE, which is not what a sign-in page answers." ;;
  esac
fi

# What that check could not see, and the one thing to do about it. "It does not open from my laptop" is the commonest first-run
# failure, and the check above passes through it: it is made here, and the firewall is between here and everybody else.
say ""
info "That was asked from this machine. It says nothing about the firewall between here and the rest of the world."
note "$(gb_firewall)"
[ -z "$GB_FIREWALL_HINT" ] || note "To let the web in: $GB_FIREWALL_HINT"
[ "$BEHIND_NAT" != "1" ] || note "This machine is behind NAT: forward 80 and 443 on the router to ${LAN_IP:-this machine}."
note "The provider has a firewall of its own, under another name (security group, network rules, cloud firewall): 80 and 443 are open there too, or nothing comes in."
note "From another machine, open $PANEL_URL. If it does not answer, that is the first place to look."
[ "$CADDY_NOT_WRITTEN" != "1" ] || note "The Caddyfile here was left alone, so this panel is not served until its site block is added (above)."

# ── 9 ────────────────────────────────────────────────────────────────
stage "This machine as a node"

# The common case at home: one machine, the panel and the game servers on
# it. Until 0.3.5 that took a second trip — the dialog, a command, a paste
# on the very machine the installer was running on. Here the installer
# mints the token through the panel's own verb and runs the node
# installer, which registers this machine as any other; it lands as
# PENDING and waits for approval, because approval is a person's decision
# on every node, this one included.
NODE_DONE=0; NODE_NAME=""; NODE_APPROVED=0
# What a node agent on this machine says about itself: "<agent version> <contract>", or nothing when it does not answer.
agent_facts() {
  [ -r /etc/geeboard/agent.json ] || return 1
  _t="$(sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' /etc/geeboard/agent.json | head -n 1)"
  _p="$(sed -n 's/.*"port"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' /etc/geeboard/agent.json | head -n 1)"
  _body="$(curl -s -m 5 -H "authorization: Bearer $_t" "http://127.0.0.1:${_p:-8080}/version" 2>/dev/null)" || return 1
  _v="$(printf '%s' "$_body" | sed -n 's/.*"agent":"\([^"]*\)".*/\1/p')"
  _c="$(printf '%s' "$_body" | sed -n 's/.*"contract":\([0-9]*\).*/\1/p')"
  [ -n "$_v" ] || return 1
  printf '%s %s\n' "$_v" "${_c:-?}"
}
AGENT_BEFORE=""; AGENT_AFTER=""
# An agent on this machine is part of what is being upgraded, and the run used to say "Not a node" about it.
if [ -z "$OPT_NODE" ] && [ -f /etc/geeboard/agent.json ]; then
  OPT_NODE=1
  info "This machine is a node already, so its agent is upgraded with the panel (--no-node leaves it alone)"
fi
if [ -z "$OPT_NODE" ] && gb_interactive; then
  say "A node is a machine that runs game servers, and this one can be one as well:"
  say "the agent is installed beside the panel and registers with it by itself."
  if confirm "Run game servers on this machine too?" no; then OPT_NODE=1; else OPT_NODE=0; fi
fi

if [ "$OPT_NODE" = "1" ] && [ -f /etc/geeboard/agent.json ]; then
  # Already joined: a second registration would mint a token for a name
  # that may be in service and overwrite an identity that works. The
  # node installer with no arguments is the upgrade, and that is all.
  ok "This machine is already a node: /etc/geeboard/agent.json is here"
  info "Upgrading its agent rather than registering it again"
  AGENT_BEFORE="$(agent_facts || true)"
  NODE_ARGS=()
  [ "$OPT_TERMINAL" != "1" ] || NODE_ARGS+=(--terminal)
  if bash "$REPO/deploy/linux/install.sh" "${NODE_ARGS[@]}"; then
    NODE_DONE=1
    # Asked again, now that it has restarted: the version and the contract it speaks, which is what the panel compares.
    for _try in 1 2 3 4 5 6 7 8; do AGENT_AFTER="$(agent_facts || true)"; [ -z "$AGENT_AFTER" ] || break; sleep 2; done
    if [ -n "$AGENT_AFTER" ]; then
      set -- $AGENT_AFTER
      if [ -n "$AGENT_BEFORE" ] && [ "${AGENT_BEFORE%% *}" != "$1" ]; then
        ok "The agent on this machine is upgraded: ${AGENT_BEFORE%% *} to $1, contract $2"
      else
        ok "The agent on this machine is on $1, contract $2"
      fi
    else
      warn "The agent restarted and did not answer on this machine; journalctl -u geeboard-agent says why."
    fi
  else
    warn "The node installer did not finish; its output above says where."
  fi
elif [ "$OPT_NODE" = "1" ] && [ "$REACHED" != "1" ]; then
  warn "Not made a node: the panel's address is not answering yet, and the agent registers through it."
  note "Once it does: sudo bash deploy/linux/install-panel.sh --node"
elif [ "$OPT_NODE" = "1" ]; then
  DEFAULT_NODE_NAME="$(node_name_from_hostname "$(hostname 2>/dev/null || echo this-machine)")"
  NODE_NAME="${OPT_NODE_NAME:-$DEFAULT_NODE_NAME}"
  if [ -z "$OPT_NODE_NAME" ] && gb_interactive; then
    while :; do
      NODE_NAME="$(ask "Node name, as the panel will show it" "$DEFAULT_NODE_NAME")"
      valid_node_name "$NODE_NAME" && break
      warn "A node name is 2 to 39 lowercase letters, digits and dashes, starting with a letter or digit."
    done
  fi

  info "Minting a registration token for $NODE_NAME"
  # The verb prints the secret alone on stdout, and what it has to say to
  # a person on stderr; compose's own chatter is stderr too.
  TOKEN_OUT="$(gb_tmp)"
  NODE_TOKEN=""
  if compose run --rm -T panel node-token "$NODE_NAME" --label "this machine, by the installer" --json > "$TOKEN_OUT" 2>/dev/null; then
    NODE_TOKEN="$(sed -n 's/.*"token":"\([^"]*\)".*/\1/p' "$TOKEN_OUT" | tail -n 1)"
    # A name that is already a node: registering with this token replaces that node's agent and keeps its approval.
    # That is what a rebuilt machine wants and what a second machine given the same name must not do by accident.
    if grep -q '"replaces":true' "$TOKEN_OUT"; then
      warn "A node called $NODE_NAME already exists in this panel."
      note "Registering this machine under that name replaces its agent and keeps its approval: right for the same machine rebuilt, wrong for another one."
      if [ "${GEEBOARD_ASSUME_YES:-0}" = "1" ] || ! confirm "Replace $NODE_NAME with this machine?" no; then
        rm -f "$TOKEN_OUT"
        die "Stopped before the node was registered." \
          "The panel has a node called $NODE_NAME, and registering would have replaced it. The token that was minted is unused and expires in a day." \
          "Choose another name with --node-name, or run this again by hand and answer the question: sudo bash deploy/linux/install-panel.sh --node"
      fi
    fi
  fi
  rm -f "$TOKEN_OUT"
  case "$NODE_TOKEN" in
    gbn_*) ok "Token minted; it works once, for this name" ;;
    *) die "The panel did not hand out a registration token for $NODE_NAME." \
         "The panel is up, so this is the verb failing; run it by hand to read why:" \
         "$GB_COMPOSE -f deploy/panel/docker-compose.yml run --rm panel node-token $NODE_NAME" ;;
  esac

  # The same command the dialog would have written, with what this
  # installer knows: the panel's address, where the panel's containers
  # reach this host (its LAN address, not loopback, which inside a
  # container is the container's own), and the authority for an https
  # panel at a bare address — on this machine, where it already is.
  NODE_ARGS=("$PANEL_URL" "$NODE_TOKEN")
  [ -z "$LAN_IP" ] || NODE_ARGS+=(--advertise "http://$LAN_IP:8080")
  [ "$HTTPS_MODE" != "ip" ] || NODE_ARGS+=(--panel-ca auto)
  [ "$OPT_TERMINAL" != "1" ] || NODE_ARGS+=(--terminal)
  say ""
  info "Handing over to deploy/linux/install.sh, which prints its own stages:"
  # Its output is kept as well as shown: join says whether the name was
  # already approved — a machine being rebuilt — and the closing line
  # should not tell such a machine to wait for something already done.
  NODE_OUT="$(gb_tmp)"
  if bash "$REPO/deploy/linux/install.sh" "${NODE_ARGS[@]}" 2>&1 | tee "$NODE_OUT"; [ "${PIPESTATUS[0]}" = "0" ]; then
    NODE_DONE=1
    if grep -q "already approved" "$NODE_OUT"; then
      NODE_APPROVED=1
      ok "This machine is registered as $NODE_NAME, already approved: it is in service"
    else
      ok "This machine is registered as $NODE_NAME and waits for your approval"
    fi
  else
    warn "The node installer did not finish; its output above says where."
    note "Run it again when that is sorted: sudo bash deploy/linux/install-panel.sh --node"
  fi
  rm -f "$NODE_OUT"
else
  info "Not a node: game servers run on other machines"
  note "Changed your mind? sudo bash deploy/linux/install-panel.sh --node"
fi

# ── Done ─────────────────────────────────────────────────────────────

ACTION="$(run_kind "$UPGRADING" "${PREV_VERSION:-}" "${VERSION:-}")"
if [ "$REACHED" = "1" ]; then
  case "$ACTION" in
    upgraded) printf '\n%sGeeboard is upgraded%s%s.%s\n\n' "$GB_B" "${PREV_VERSION:+ from $PREV_VERSION}" "${VERSION:+ to $VERSION}" "$GB_0" ;;
    refreshed) printf '\n%sGeeboard %s was already here, and is up.%s\n\n' "$GB_B" "${VERSION:-}" "$GB_0" ;;
    *) printf '\n%sGeeboard is ready.%s\n\n' "$GB_B" "$GB_0" ;;
  esac
else
  # Installed, and not finished. Saying "ready" here would be the one lie
  # that costs the most: somebody opens the address, gets nothing, and has
  # no idea which of the nine stages to look at.
  printf '\n%sGeeboard is installed, and its address is not answering yet.%s\n\n' "$GB_B" "$GB_0"
  say "The panel itself is up on $PANEL_LOCAL. What is in front of it is not."
  say "docs/production.md#the-panels-address-does-not-answer is the order to check things in."
  say ""
fi
printf 'Panel:\n  %s\n\n' "$PANEL_URL"
if [ "$UPGRADING" = "1" ] && [ -n "$DUMP" ]; then
  say "This was an upgrade${PREV_VERSION:+ from $PREV_VERSION}. If it has to be undone:"
  say ""
  undo_text "$GB_COMPOSE -f deploy/panel/docker-compose.yml" "$DUMP" "$ENV_COPY" "$PREV_REF"
  say ""
fi
if [ "$ACTION" = "installed" ]; then
  say "Next:"
  # "The temporary password above" is only true when this run made it.
  if [ "$OWNER_MADE" = "1" ]; then
    SIGN_IN="sign in with the temporary password above"
  elif [ "$OWNER_DONE" = "1" ]; then
    SIGN_IN="sign in"
  else
    SIGN_IN="make the first owner (the command is above), then sign in"
  fi
  if [ "$HTTPS_MODE" = "ip" ]; then
    say "  1. Open the panel. The browser warns once about the certificate's authority,"
    say "     which is Caddy's own on this machine — accept it, then $SIGN_IN."
  else
    say "  1. Open the panel and $SIGN_IN."
  fi
  say "  2. Change that password, then set up two-factor. The panel asks for both"
  say "     before it shows you anything else."
  if [ "$NODE_DONE" = "1" ] && [ -n "$NODE_NAME" ] && [ "$NODE_APPROVED" = "1" ]; then
    say "  3. Nodes → $NODE_NAME is this machine, as a node, already approved and in"
    say "     service. Other machines: Nodes → Add a node."
  elif [ "$NODE_DONE" = "1" ] && [ -n "$NODE_NAME" ]; then
    say "  3. Nodes → $NODE_NAME is waiting for approval: this machine, as a node."
    say "     Approve it, and it takes servers. Other machines: Nodes → Add a node."
  else
    say "  3. Nodes → Add a node, for each machine that will run game servers. The"
    say "     panel writes the command; you paste it on the machine."
  fi
else
  # Somebody who has used this panel before: what they have is where they left it, and what is left to do is the nodes.
  say "Your accounts, nodes, servers and backups are as they were."
  if [ -n "$AGENT_AFTER" ]; then
    set -- $AGENT_AFTER
    say "The agent on this machine is on $1, contract $2."
  fi
  say "Nodes on other machines run agents of their own, and are upgraded on their own machines:"
  say "  sudo bash deploy/linux/install.sh        (docs/upgrading.md#the-nodes says when it is needed)"
fi
if [ "$CA_READY" = "1" ]; then
  say ""
  say "  This panel's certificate authority is at $PANEL_CA_COPY, and the panel hands it out."
  say "  The Add a node command carries its fingerprint (--panel-ca 'sha256:…' on Linux,"
  say "  -PanelCa 'sha256:…' on Windows) because this panel is reached at an address: a node"
  say "  on any machine fetches the authority from the panel and keeps it only if it matches."
  say "  There is nothing to copy."
fi
say ""
say "  docs/production.md is the whole of it, troubleshooting included."
say ""
