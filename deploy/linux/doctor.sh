#!/usr/bin/env bash
# Looks at this Linux machine as a Geeboard panel and as a node, and changes nothing. What doctor.ps1 is on Windows.
#
#   sudo bash deploy/linux/doctor.sh
#
# For the machine that "shows Not reached", or does not start, or whose dump did not run: it reads what the installers made and
# what they depend on, and says in words what is wrong and the command that puts it right. It writes nothing, starts nothing, stops
# nothing and prints no token or key. It looks for the panel (deploy/panel/.env) and for the agent (/etc/geeboard/agent.json) and
# says so when it finds neither.
#
# It exits 1 when it found something to put right, and 0 when it did not.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# shellcheck source=../lib/common.sh
. "$REPO/deploy/lib/common.sh"
# shellcheck source=../lib/panel-env.sh
. "$REPO/deploy/lib/panel-env.sh"

PROBLEMS=0
section() { printf '\n%s%s%s\n' "$GB_B" "$1" "$GB_0"; }
bad() { PROBLEMS=$((PROBLEMS + 1)); warn "$1"; [ -z "${2:-}" ] || note "$2"; }

ENV_FILE="$REPO/deploy/panel/.env"
COMPOSE_FILE="$REPO/deploy/panel/docker-compose.yml"
AGENT_FILE="/etc/geeboard/agent.json"
CHECKOUT_VERSION="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$REPO/web/package.json" | head -n 1)"

printf '%sGeeboard - looking at this machine (nothing is changed)%s\n' "$GB_B" "$GB_0"
note "$REPO, release ${CHECKOUT_VERSION:-unknown}"

# ── This machine ─────────────────────────────────────────────────────
section "This machine"
[ "$(id -u)" -eq 0 ] || bad "Not root: some of this (the dump directory, the agent's settings) cannot be read." "Run it again with sudo."
detect_os 2>/dev/null || true
ok "${GB_OS_NAME:-$(uname -sr)}, $(uname -m)"
if [ -d /run/systemd/system ]; then ok "systemd"; else bad "No systemd: the agent's unit and the nightly dump's timer need it." "Run the agent and deploy/linux/dump-panel.sh under whatever starts services here."; fi
MEM_MB="$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)"
if [ "$MEM_MB" -lt 1800 ]; then bad "${MEM_MB} MB of memory. The panel wants about 2 GB and a server wants its own." "docs/production.md says what each asks."; else ok "${MEM_MB} MB of memory"; fi
for dir in / /var/lib/docker /var/lib/geeboard /var/backups/geeboard; do
  [ -d "$dir" ] || continue
  free_kb="$(df -Pk "$dir" 2>/dev/null | awk 'NR==2 {print $4}')"
  [ -n "$free_kb" ] || continue
  if [ "$free_kb" -lt 2097152 ]; then bad "$dir has $((free_kb / 1024)) MB free." "Less than 2 GB: a dump, an image pull or a backup will fail first."; else ok "$dir: $((free_kb / 1048576)) GB free"; fi
done
if have timedatectl; then
  case "$(timedatectl show -p NTPSynchronized --value 2>/dev/null)" in
    yes) ok "The clock is synchronised" ;;
    no) bad "The clock is not synchronised." "Two-factor codes, signed requests and every schedule read it. sudo timedatectl set-ntp true" ;;
  esac
fi

# ── Docker ───────────────────────────────────────────────────────────
section "Docker"
if ! have docker; then
  bad "Docker is not installed." "curl -fsSL https://get.docker.com | sudo sh"
elif ! docker info >/dev/null 2>&1; then
  bad "Docker is installed and not answering." "sudo systemctl start docker; and this account has to be root or in the docker group."
else
  ok "Docker $(docker version -f '{{.Server.Version}}' 2>/dev/null), $(docker info -f '{{.Driver}}' 2>/dev/null) storage"
  if docker compose version >/dev/null 2>&1; then ok "Compose $(docker compose version --short 2>/dev/null)"; else bad "No Compose plugin." "sudo apt-get install docker-compose-plugin, or docker's own repository."; fi
  case "$(readlink -f "$(command -v docker)" 2>/dev/null)" in */snap/*) bad "This Docker is a snap, which cannot bind a game's folder by its host path." "Install Docker from its own repository." ;; esac
fi

# ── The panel ────────────────────────────────────────────────────────
section "The panel"
if [ ! -f "$ENV_FILE" ]; then
  note "No $ENV_FILE: the panel is not installed here. (deploy/linux/install-panel.sh installs it.)"
elif ! docker info >/dev/null 2>&1; then
  note "Not looked at: Docker does not answer."
else
  GB_COMPOSE="docker compose"
  compose() { $GB_COMPOSE --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
  for service in db panel poller; do
    state="$(compose ps --format '{{.State}}' "$service" 2>/dev/null | head -n 1)"
    case "$state" in
      running) ok "$service is running" ;;
      "") bad "$service is not here." "docker compose -f deploy/panel/docker-compose.yml up -d" ;;
      *) bad "$service is $state." "docker compose -f deploy/panel/docker-compose.yml logs --tail 40 $service" ;;
    esac
  done
  url="$(panel_bind_url "$(env_get "$ENV_FILE" PANEL_BIND || true)")"
  health="$(http_code "$url/api/health")"
  if [ "$health" = "200" ]; then
    body="$(_http_body "$url/api/health" 5 || true)"
    ok "$url/api/health answers: $body"
    running_version="$(printf '%s' "$body" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"
    [ -z "$running_version" ] || [ "$running_version" = "$CHECKOUT_VERSION" ] || bad "The panel runs $running_version and this checkout is $CHECKOUT_VERSION." "Run deploy/linux/install-panel.sh again: that is the upgrade."
    last_migration=""
    for dir in "$REPO"/web/prisma/migrations/[0-9]*/; do last_migration="$(basename "$dir")"; done   # the glob sorts, and the names are timestamps
    applied="$(printf '%s' "$body" | sed -n 's/.*"schema":"\([^"]*\)".*/\1/p')"
    if [ -n "$applied" ] && [ "$applied" != "$last_migration" ]; then
      if [[ "$applied" > "$last_migration" ]]; then
        bad "The database is ahead of this checkout: its last migration is $applied, and the checkout's is $last_migration." "A newer release migrated it. Update the checkout (git pull) before the next upgrade; an older panel on this database is not something to run."
      else
        bad "The database is behind this checkout: its last migration is $applied, and the checkout's is $last_migration." "docker compose -f deploy/panel/docker-compose.yml run --rm panel migrate"
      fi
    fi
  elif [ "$health" = "404" ] && [ "$(http_code "$url/sign-in")" != "000" ]; then
    # Up, and with no such route: a panel of a release before /api/health (0.8.1 and earlier), under a checkout that has the route.
    bad "The panel answers, and has no /api/health: it is an older release than this checkout ($CHECKOUT_VERSION)." "Run deploy/linux/install-panel.sh again from this checkout (--build if it is ahead of any release, so that the image is this one's), or check out the release tag the running image is."
  else
    bad "$url/api/health answers $health." "docker compose -f deploy/panel/docker-compose.yml logs --tail 40 panel"
  fi
  public="$(env_get "$ENV_FILE" PANEL_URL || true)"
  if [ -n "$public" ] && [ "$health" = "200" ]; then
    code="$(http_code "$public/sign-in")"
    trust=""
    if [ "$code" = "000" ]; then
      # Nothing, or something this machine does not trust: an address with Caddy's own authority is the second, and is fine.
      code="$(http_code_insecure "$public/sign-in")"
      [ "$code" = "000" ] || trust=", with a certificate this machine does not verify (Caddy's own authority on an address; a browser warns once)"
    fi
    if [ "$code" = "000" ]; then
      # An address this machine does not hold (NAT): a request for it from this side does not come back. Ask Caddy here instead.
      if nat_address "$public"; then
        code="$(http_code_local "$(host_of "$public")" /sign-in)"
        [ "$code" = "000" ] || trust=", asked of Caddy on this machine, because a request for that address from here does not come back (NAT); whether the rest of the world reaches it depends on the router forwarding 80 and 443"
      fi
    fi
    case "$code" in
      200|307|308) ok "$public answers ($code)$trust" ;;
      000) bad "$public does not answer from this machine." "What is in front of the panel (Caddy, a proxy, the firewall) is not passing it on. docs/production.md#the-panels-address-does-not-answer" ;;
      *) bad "$public answers $code, from this machine." "What is in front of the panel is not passing it on as the panel answers it. docs/production.md#the-panels-address-does-not-answer" ;;
    esac
  fi
  # The nightly dump: the timer is there, it ran, and what it made is recent.
  if have systemctl && [ -d /run/systemd/system ]; then
    if systemctl is-enabled geeboard-dump.timer >/dev/null 2>&1; then
      ok "The nightly dump's timer is enabled"
      if systemctl is-failed geeboard-dump.service >/dev/null 2>&1; then bad "The last nightly dump failed." "journalctl -u geeboard-dump -n 30"; fi
      newest="$(ls -1t /var/backups/geeboard/geeboard-scheduled-*.dump 2>/dev/null | head -n 1)"
      if [ -z "$newest" ]; then note "No nightly dump yet."; else
        age_h=$(( ($(date +%s) - $(stat -c %Y "$newest")) / 3600 ))
        if [ "$age_h" -gt 36 ]; then bad "The newest nightly dump is $age_h hours old." "sudo bash deploy/linux/dump-panel.sh, and journalctl -u geeboard-dump says why the timer did not."; else ok "The newest dump is $age_h hours old"; fi
      fi
    else
      bad "There is no nightly dump of the panel's database." "It is installed by deploy/linux/install-panel.sh (unless --no-nightly-dump). Dump by hand: sudo bash deploy/linux/dump-panel.sh"
    fi
  fi
fi

# ── The node ─────────────────────────────────────────────────────────
section "The node"
if [ ! -r "$AGENT_FILE" ] && ! systemctl cat geeboard-agent >/dev/null 2>&1; then
  note "No $AGENT_FILE and no geeboard-agent unit: this machine is not a node. (deploy/linux/install.sh makes it one.)"
else
  [ -r "$AGENT_FILE" ] && ok "$AGENT_FILE is there" || bad "No readable $AGENT_FILE: this machine has not joined a panel." "deploy/linux/install.sh <panel> <token>, with the command Nodes → Add a node writes."
  port="$(sed -n 's/.*"port"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$AGENT_FILE" 2>/dev/null | head -n 1)"
  port="${port:-8080}"
  node_panel="$(sed -n 's/.*"panelUrl"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$AGENT_FILE" 2>/dev/null | head -n 1)"
  if have systemctl; then
    case "$(systemctl is-active geeboard-agent 2>/dev/null)" in
      active) ok "geeboard-agent is active" ;;
      *) bad "geeboard-agent is $(systemctl is-active geeboard-agent 2>/dev/null)." "journalctl -u geeboard-agent -n 40, and sudo systemctl restart geeboard-agent" ;;
    esac
    for unit in geeboard-agent-port geeboard-container-firewall; do
      systemctl cat "$unit" >/dev/null 2>&1 || continue
      case "$(systemctl is-active "$unit" 2>/dev/null)" in
        active|activating) ok "$unit is active" ;;
        *) bad "$unit is $(systemctl is-active "$unit" 2>/dev/null)." "It is what keeps everything but the panel off the agent's port. journalctl -u $unit -n 20" ;;
      esac
    done
  fi
  if have ss && ss -ltn 2>/dev/null | awk '{print $4}' | grep -q ":$port\$"; then ok "Something listens on port $port"; else bad "Nobody is listening on port $port, so the agent is not running." "journalctl -u geeboard-agent -n 40 says why it stopped."; fi
  # The agent answers /version to the panel's token; this reads it from the settings file and sends it to this machine only.
  token="$(sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$AGENT_FILE" 2>/dev/null | head -n 1)"
  if [ -n "$token" ] && have curl; then
    reply="$(curl -s --max-time 8 -H "Authorization: Bearer $token" "http://127.0.0.1:$port/version" 2>/dev/null || true)"
    agent_version="$(printf '%s' "$reply" | sed -n 's/.*"agent":"\([^"]*\)".*/\1/p')"
    agent_contract="$(printf '%s' "$reply" | sed -n 's/.*"contract":\([0-9]*\).*/\1/p')"
    if [ -n "$agent_version" ]; then
      ok "The agent answers: release $agent_version, contract ${agent_contract:-none}"
      [ "$agent_version" = "$CHECKOUT_VERSION" ] || bad "The agent runs $agent_version and this checkout is $CHECKOUT_VERSION." "Run deploy/linux/install.sh again with no arguments: that is the agent's upgrade."
    else
      bad "The agent does not answer /version on port $port." "journalctl -u geeboard-agent -n 40"
    fi
  fi
  if [ -n "$node_panel" ] && have curl; then
    code="$(http_code "$node_panel/api/health")"
    if [ "$code" = "200" ]; then
      ok "The panel at $node_panel answers from here"
    elif [ "$code" = "000" ] && [ "$(http_code_insecure "$node_panel/api/health")" = "200" ]; then
      ok "The panel at $node_panel answers from here, with a certificate this machine does not verify by itself"
      note "A node joined with the panel's authority (--panel-ca) verifies it with that; this check does not read it."
    else
      bad "The panel at $node_panel answers $code from this machine." "The agent registers and sends its heartbeats there. docs/nodes.md"
    fi
  fi
  if [ -d /var/lib/geeboard ]; then ok "/var/lib/geeboard exists"; else bad "/var/lib/geeboard does not exist." "It is the agent's data root, mounted at the same path in the agent and on the host."; fi
fi

printf '\n'
if [ "$PROBLEMS" -eq 0 ]; then printf '%sNothing to put right.%s\n' "$GB_G" "$GB_0"; exit 0; fi
printf '%s%s thing(s) to put right, above.%s\n' "$GB_Y" "$PROBLEMS" "$GB_0"
exit 1
