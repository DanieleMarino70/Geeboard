#!/bin/sh
# Writes deploy/panel/.env with generated secrets, once.
#
#   deploy/panel/init.sh [https://panel.example.com]
#
# Three secrets, made on this machine and written to one file that only
# this account can read: the database's password, the key that signs
# sessions, and the key that encrypts every node token. None is printed.
#
# It never overwrites. SECRETS_KEY is what the stored node tokens are
# encrypted under, and POSTGRES_PASSWORD is only read by Postgres the first
# time its volume is made — regenerating either on a running installation
# locks the panel out of its own data.
set -eu

here="$(cd "$(dirname "$0")" && pwd)"
target="$here/.env"

if [ -e "$target" ]; then
  echo "$target already exists, and was not changed." >&2
  exit 1
fi

secret() {
  # URL-safe, because one of these goes into a connection string.
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-48
  else
    head -c 64 /dev/urandom | base64 | tr -d '\n=+/' | cut -c1-48
  fi
}

umask 077
{
  echo "# Written by deploy/panel/init.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ). Keep it; do not commit it."
  echo "POSTGRES_PASSWORD=$(secret)"
  echo "SESSION_SECRET=$(secret)"
  echo "SECRETS_KEY=$(secret)"
  echo "# Where browsers and node agents reach the panel: the https address of your reverse proxy."
  echo "PANEL_URL=${1:-}"
  echo "# Where the panel listens on this host. Loopback, for a reverse proxy on the same machine."
  echo "PANEL_BIND=127.0.0.1:3000"
  echo "# Optional: a Steam Web API key, which is what searching the Workshop"
  echo "# needs. Without one the Mods tab still adds a mod by its link."
  echo "STEAM_API_KEY="
} > "$target"

echo "Wrote $target. The secrets were not printed."
[ -n "${1:-}" ] || echo "PANEL_URL is empty: set it to the panel's https address before adding nodes."
# https either way: a panel on plain http cannot sign anybody in, because
# its session cookies are Secure. With a domain name Caddy gets a public
# certificate; with an address it signs one itself and the nodes have to
# be given the authority — deploy/panel/Caddyfile, docs/production.md.
case "${1:-}" in
  https://*) ;;
  "") ;;
  *) echo "PANEL_URL is not https. Sessions are Secure cookies: nobody can sign in over http." ;;
esac
echo "Next:"
echo "  # the published image for this release, named in the file above —"
echo "  #   GEEBOARD_PANEL_IMAGE=ghcr.io/danielemarino70/geeboard-panel:<version>"
echo "  # then:"
echo "  sudo docker compose -f $here/docker-compose.yml pull panel poller"
echo "  # or build it from this checkout instead:"
echo "  #   sudo docker compose -f $here/docker-compose.yml build"
echo "  sudo docker compose -f $here/docker-compose.yml run --rm panel setup --email you@example.com --name \"Your Name\""
echo "  sudo docker compose -f $here/docker-compose.yml up -d"
echo "  # then https in front of it, which is not optional:"
echo "  #   $here/Caddyfile — a domain, or an address with Caddy's own authority"
