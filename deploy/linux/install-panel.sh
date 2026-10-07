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
# whole of it answers from outside, and, if you said yes, the node agent
# beside the panel, registered with it and waiting for your approval.
#
# Running it again is the upgrade and the repair. It never regenerates a
# secret that is already there, never removes a volume, and never touches a
# game server: SECRETS_KEY is what every stored node token is encrypted
# under and POSTGRES_PASSWORD is read when the database's volume is made, so
# a second run that refreshed either would lock the panel out of its own
# data. A machine that is already a node is not registered again: its agent
# is upgraded, as `install.sh` with no arguments does.
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

usage() {
  sed -n '2,42p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
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
    --domain) OPT_DOMAIN="${2:-}"; OPT_MODE="domain"; shift 2 ;;
    --domain=*) OPT_DOMAIN="${1#--domain=}"; OPT_MODE="domain"; shift ;;
    --email) OPT_EMAIL="${2:-}"; shift 2 ;;
    --email=*) OPT_EMAIL="${1#--email=}"; shift ;;
    --ip) OPT_MODE="ip"
          case "${2:-}" in ""|--*) shift ;; *) OPT_IP="$2"; check_address "$OPT_IP"; shift 2 ;; esac ;;
    --ip=*) OPT_IP="${1#--ip=}"; check_address "$OPT_IP"; OPT_MODE="ip"; shift ;;
    --panel-url) OPT_PANEL_URL="${2:-}"; shift 2 ;;
    --panel-url=*) OPT_PANEL_URL="${1#--panel-url=}"; shift ;;
    --bind) OPT_BIND="${2:-}"; shift 2 ;;
    --bind=*) OPT_BIND="${1#--bind=}"; shift ;;
    --image) OPT_IMAGE="${2:-}"; shift 2 ;;
    --image=*) OPT_IMAGE="${1#--image=}"; shift ;;
    --build) OPT_BUILD=1; shift ;;
    --owner-email) OPT_OWNER_EMAIL="${2:-}"; shift 2 ;;
    --owner-email=*) OPT_OWNER_EMAIL="${1#--owner-email=}"; shift ;;
    --owner-name) OPT_OWNER_NAME="${2:-}"; shift 2 ;;
    --owner-name=*) OPT_OWNER_NAME="${1#--owner-name=}"; shift ;;
    --no-caddy) OPT_NO_CADDY=1; shift ;;
    --node) OPT_NODE=1; shift ;;
    --no-node) OPT_NODE=0; shift ;;
    --node-name) OPT_NODE_NAME="${2:-}"; OPT_NODE=1; shift 2 ;;
    --node-name=*) OPT_NODE_NAME="${1#--node-name=}"; OPT_NODE=1; shift ;;
    --terminal) OPT_TERMINAL=1; shift ;;
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

[ -f "$COMPOSE_FILE" ] || die "This is not a Geeboard checkout." \
  "$COMPOSE_FILE is not here, and it is what starts the panel." \
  "Run this from the directory git clone made:

  cd Geeboard && sudo bash deploy/linux/install-panel.sh"

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

# ── 3 ────────────────────────────────────────────────────────────────
stage "Configuring HTTPS"

# https is not a preference here. Session cookies are Secure in production,
# so a panel on plain http cannot sign anybody in at all.
SITE=""; TLS_LINE=""; PANEL_URL=""; HTTPS_MODE=""

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

  # Worth saying now rather than at the certificate failure in four minutes.
  RESOLVED=""
  if have getent; then RESOLVED="$(getent ahostsv4 "$OPT_DOMAIN" 2>/dev/null | awk '{print $1}' | head -n 1 || true)"; fi
  if [ -z "$RESOLVED" ]; then
    warn "$OPT_DOMAIN does not resolve from this machine yet."
    note "Point an A record at ${PUBLIC_IP:-the address of this machine} first, or the certificate cannot be issued."
  elif [ -n "$PUBLIC_IP" ] && [ "$RESOLVED" != "$PUBLIC_IP" ] && ! is_local_address "$RESOLVED"; then
    warn "$OPT_DOMAIN resolves to $RESOLVED, and this machine is $PUBLIC_IP."
    note "Let's Encrypt asks this machine for the name it is issuing, so the record has to point here."
  else
    ok "$OPT_DOMAIN resolves to this machine"
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

  SITE="$OPT_IP"
  TLS_LINE="tls internal"
  PANEL_URL="https://$OPT_IP"
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

# The image: this release's published one, the one already chosen, or a
# build from this checkout when there is no pulling to be done.
VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$REPO/web/package.json" | head -1)"
CURRENT_IMAGE="$(env_get "$ENV_FILE" GEEBOARD_PANEL_IMAGE || true)"
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
elif docker pull "$PUBLISHED:${VERSION:-latest}" >/dev/null 2>&1; then
  IMAGE="$PUBLISHED:${VERSION:-latest}"
  ok "Panel image: $IMAGE"
else
  IMAGE="$LOCAL_IMAGE"
  info "$PUBLISHED:${VERSION:-latest} could not be pulled; building it from this checkout"
fi
env_set "$ENV_FILE" GEEBOARD_PANEL_IMAGE "$IMAGE"

if [ "$IMAGE" = "$LOCAL_IMAGE" ]; then
  compose build panel >/dev/null 2>&1 || compose build panel || die \
    "The panel image did not build." \
    "Nothing was started, and nothing already installed was changed." \
    "The build output above says what failed. A machine with no way out to the internet cannot build it either: it pulls a base image."
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

compose up -d db >/dev/null 2>&1 || compose up -d db

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

# Applying the migrations before the panel starts, rather than letting the
# first request find a schema that is a release behind.
if compose run --rm -T panel migrate >/dev/null 2>&1; then
  ok "Database schema up to date"
else
  compose run --rm -T panel migrate || die \
    "The migrations did not apply." \
    "The panel was not started, and no data was changed." \
    "The output above says what failed."
fi

compose up -d >/dev/null 2>&1 || compose up -d
ok "Panel and poller started"

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

# ── 6 ────────────────────────────────────────────────────────────────
stage "Configuring Caddy"

CA_READY=0
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
    die "Caddy could not be installed automatically." \
      "The panel is up on $PANEL_LOCAL and waiting for something to put https in front of it. Nothing is lost." \
      "Install Caddy, then run this installer again:

  sudo apt install -y caddy          # Debian, Ubuntu
  sudo dnf install -y caddy          # Fedora, RHEL

caddyserver.com/docs/install has the rest. Or use a proxy of your own and run
this again with --no-caddy."
  fi

  HOLDER="$(port_holder 443 || true)"
  if [ -n "$HOLDER" ] && [ "$HOLDER" != "caddy" ]; then
    warn "$HOLDER is already listening on 443."
    note "Caddy cannot take the port while it is held, and two proxies on one port is not a thing."
    confirm "Carry on and write the Caddyfile anyway?" no || die \
      "Stopped, with the panel running and no proxy configured." \
      "Nothing was changed outside deploy/panel/." \
      "Stop $HOLDER and run this again, or run it with --no-caddy and configure $HOLDER yourself."
  fi

  if ! caddy_replaceable; then
    warn "$CADDYFILE is a reverse proxy somebody configured, so it was left alone."
    note "Add this site block to it yourself, and reload Caddy:"
    caddy_render "$CADDY_TEMPLATE" "$SITE" "$TLS_LINE" "$BIND" | grep -v '^#' | grep -v '^$' | sed 's/^/    /'
  else
    RENDERED="$(mktemp)"
    caddy_render "$CADDY_TEMPLATE" "$SITE" "$TLS_LINE" "$BIND" > "$RENDERED"
    if caddy_apply "$RENDERED"; then
      rm -f "$RENDERED"
      ok "HTTPS active: $CADDYFILE"
    else
      rm -f "$RENDERED"
      die "Caddy refused the configuration." \
        "The panel is running and the Caddyfile was not replaced." \
        "The lines above name what it did not like."
    fi
  fi

  if [ "$HTTPS_MODE" = "ip" ]; then
    # Caddy writes its authority the first time it serves with `tls
    # internal`, so this is waiting for a file that does not exist yet.
    if caddy_wait_ca 45 && caddy_export_ca; then
      CA_READY=1
      ok "Certificate authority ready for nodes: $PANEL_CA_COPY"
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
if [ -z "$OPT_OWNER_EMAIL" ] && gb_interactive; then
  say "Whoever installs the panel is its administrator. This makes that one account."
  OPT_OWNER_EMAIL="$(ask "Your email, which you will sign in with" "")"
  [ -z "$OPT_OWNER_EMAIL" ] || OPT_OWNER_NAME="$(ask "Your name, as the audit log will show it" "$OPT_OWNER_NAME")"
fi

if [ -n "$OPT_OWNER_EMAIL" ] && [ -n "$OPT_OWNER_NAME" ]; then
  SETUP_OUT="$(mktemp)"
  if compose run --rm -T panel setup --email "$OPT_OWNER_EMAIL" --name "$OPT_OWNER_NAME" > "$SETUP_OUT" 2>&1; then
    OWNER_DONE=1
    ok "Owner created: $OPT_OWNER_NAME <$OPT_OWNER_EMAIL>"
    say ""
    # The temporary password is in here, shown this once and stored nowhere
    # it can be read back. It is the one thing that has to reach the screen.
    sed -n '/the first owner/,$p' "$SETUP_OUT"
  elif grep -q "already has an\|already has [0-9]" "$SETUP_OUT"; then
    OWNER_DONE=1
    ok "This installation already has an owner"
    note "Setup makes the first one only. Lost the password? See the end of this output."
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
case "$PANEL_URL" in
  https://*) FINAL_CHECK="HTTPS answering on $PANEL_URL" ;;
  *) FINAL_CHECK="Answering on $PANEL_URL" ;;
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
  NODE_ARGS=()
  [ "$OPT_TERMINAL" != "1" ] || NODE_ARGS+=(--terminal)
  if bash "$REPO/deploy/linux/install.sh" "${NODE_ARGS[@]}"; then
    NODE_DONE=1
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
  TOKEN_OUT="$(mktemp)"
  NODE_TOKEN=""
  if compose run --rm -T panel node-token "$NODE_NAME" --label "this machine, by the installer" > "$TOKEN_OUT" 2>/dev/null; then
    NODE_TOKEN="$(tail -n 1 "$TOKEN_OUT" | tr -d '\r')"
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
  NODE_OUT="$(mktemp)"
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

if [ "$REACHED" = "1" ]; then
  printf '\n%sGeeboard is ready.%s\n\n' "$GB_B" "$GB_0"
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
say "Next:"
if [ "$HTTPS_MODE" = "ip" ]; then
  say "  1. Open the panel. The browser warns once about the certificate's authority,"
  say "     which is Caddy's own on this machine — accept it."
else
  say "  1. Open the panel and sign in with the temporary password above."
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
if [ "$CA_READY" = "1" ]; then
  say ""
  say "  This panel's certificate authority is at $PANEL_CA_COPY."
  say "  The Add a node command carries --panel-ca auto for you, because this panel is"
  say "  reached at an address: on this machine that is the whole of it. For a node"
  say "  elsewhere, copy the authority over first:"
  say "    sudo cat $PANEL_CA_COPY        # on this machine"
  say "    sudo bash deploy/linux/install.sh $PANEL_URL 'gbn_…' --panel-ca /root/panel-ca.crt"
fi
say ""
say "  docs/production.md is the whole of it, troubleshooting included."
say ""
