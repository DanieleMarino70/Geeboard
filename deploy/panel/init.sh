#!/bin/sh
# Writes deploy/panel/.env with generated secrets, once.
#
#   deploy/panel/init.sh [https://panel.example.com]
#
# This is the manual path. `sudo bash deploy/linux/install-panel.sh` does
# this and the rest of the installation — Caddy, https, the containers, the
# first owner — and is what docs/production.md tells a beginner to run. Use
# this one when you are putting the pieces together yourself.
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
repo="$(cd "$here/../.." && pwd)"
target="$here/.env"

# The generating and the writing live in deploy/lib/, because the panel
# installer writes the same file and two copies of that rule would be one
# copy too many.
# shellcheck source=../lib/common.sh
. "$repo/deploy/lib/common.sh"
# shellcheck source=../lib/panel-env.sh
. "$repo/deploy/lib/panel-env.sh"

if panel_env_exists "$target"; then
  echo "$target already exists, and was not changed." >&2
  missing="$(panel_env_missing_secrets "$target")"
  if [ -n "$missing" ]; then
    echo "It is missing:" >&2
    echo "$missing" | sed 's/^/  /' >&2
    echo "Add each one by hand, or let the installer fill them in: sudo bash deploy/linux/install-panel.sh" >&2
  fi
  exit 1
fi

panel_env_create "$target" "${1:-}"

echo "Wrote $target. The secrets were not printed."
[ -n "${1:-}" ] || echo "PANEL_URL is empty: set it to the panel's https address before adding nodes."
# https either way: a panel on plain http cannot sign anybody in, because
# its session cookies are Secure. With a domain name Caddy gets a public
# certificate; with an address it signs one itself and the nodes have to
# be given the authority — deploy/panel/Caddyfile, docs/advanced-install.md.
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
