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
} > "$target"

echo "Wrote $target. The secrets were not printed."
[ -n "${1:-}" ] || echo "PANEL_URL is empty: set it to the panel's https address before adding nodes."
echo "Next:"
echo "  # the published image for this release, named in the file above —"
echo "  #   GEEBOARD_PANEL_IMAGE=ghcr.io/danielemarino70/geeboard-panel:<version>"
echo "  # then:"
echo "  docker compose -f $here/docker-compose.yml pull panel poller"
echo "  # or build it from this checkout instead:"
echo "  #   docker compose -f $here/docker-compose.yml build"
echo "  docker compose -f $here/docker-compose.yml run --rm panel setup --email you@example.com --name \"Your Name\""
echo "  docker compose -f $here/docker-compose.yml up -d"
