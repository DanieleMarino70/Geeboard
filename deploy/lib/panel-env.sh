# The panel's production environment file: deploy/panel/.env.
#
# One implementation, used by deploy/panel/init.sh (which writes it once,
# by hand) and by deploy/linux/install-panel.sh (which writes it as part of
# an installation and may be run again on the same machine tomorrow).
#
# The rule both of them keep, and the reason this is one file rather than
# two: **a secret already in the file is never changed.** SECRETS_KEY is
# what every stored node token is encrypted under, and POSTGRES_PASSWORD is
# read by Postgres only when its volume is first made. Regenerating either
# on a running installation locks the panel out of its own data — so an
# installer that "helpfully" refreshed them would be the worst bug this
# project could ship.
#
# Sourced after common.sh, which has gb_secret, env_get, env_set and
# env_default.

PANEL_ENV_SECRETS="POSTGRES_PASSWORD SESSION_SECRET SECRETS_KEY"

# panel_env_exists <file>
panel_env_exists() { [ -e "$1" ]; }

# panel_env_create <file> [panel url] — the whole file, with its comments
# and three generated secrets. Refuses to touch a file that is there.
panel_env_create() {
  _file="$1"; _url="${2:-}"
  [ -e "$_file" ] && return 1
  umask 077
  {
    echo "# Geeboard's panel, in production. Written on $(date -u +%Y-%m-%dT%H:%M:%SZ)."
    echo "# Keep it, back it up with the database, and do not commit it: the panel"
    echo "# cannot read its own data without SECRETS_KEY."
    echo "POSTGRES_PASSWORD=$(gb_secret)"
    echo "SESSION_SECRET=$(gb_secret)"
    echo "SECRETS_KEY=$(gb_secret)"
    echo "# Where browsers and node agents reach the panel: the https address of your reverse proxy."
    echo "PANEL_URL=$_url"
    echo "# Where the panel listens on this host. Loopback, for a reverse proxy on the same machine."
    echo "PANEL_BIND=127.0.0.1:3000"
    echo "# The published image for this release. Unset builds it from this checkout."
    echo "GEEBOARD_PANEL_IMAGE="
    echo "# Optional: a Steam Web API key, which is what searching the Workshop"
    echo "# needs. Without one the Mods tab still adds a mod by its link."
    echo "STEAM_API_KEY="
  } > "$_file"
  chmod 0600 "$_file" 2>/dev/null || true
  return 0
}

# panel_env_ensure <file> — makes the file if there is none, and otherwise
# fills in only what is missing. Sets GB_ENV_CREATED to 1 or 0.
#
# Filling in what is missing matters more than it sounds: a .env written by
# an older release has no GEEBOARD_PANEL_IMAGE line, and compose without one
# looks for an image tagged `local` that nobody built.
panel_env_ensure() {
  _file="$1"
  if panel_env_create "$_file"; then
    GB_ENV_CREATED=1
    return 0
  fi
  GB_ENV_CREATED=0
  for _key in $PANEL_ENV_SECRETS; do
    env_has "$_file" "$_key" || env_set "$_file" "$_key" "$(gb_secret)"
  done
  env_default "$_file" "PANEL_URL" ""
  env_default "$_file" "PANEL_BIND" "127.0.0.1:3000"
  env_default "$_file" "GEEBOARD_PANEL_IMAGE" ""
  env_default "$_file" "STEAM_API_KEY" ""
  chmod 0600 "$_file" 2>/dev/null || true
  return 0
}

# panel_env_missing_secrets <file> — names the secrets that are not there,
# for a report. Empty output is a file with all three.
panel_env_missing_secrets() {
  for _key in $PANEL_ENV_SECRETS; do
    env_has "$1" "$_key" || printf '%s\n' "$_key"
  done
}

# The host side of PANEL_BIND, as something to make an HTTP request to.
# 0.0.0.0 is not an address to connect to, and an entry with no host at all
# is a port.
panel_bind_url() {
  _bind="${1:-127.0.0.1:3000}"
  case "$_bind" in
    *:*) _host="${_bind%:*}"; _port="${_bind##*:}" ;;
    *) _host="127.0.0.1"; _port="$_bind" ;;
  esac
  case "$_host" in ""|0.0.0.0|"::"|"[::]") _host="127.0.0.1" ;; esac
  printf 'http://%s:%s' "$_host" "$_port"
}

# port_free <port> — true when nothing is listening on it here.
port_free() {
  if have ss; then
    ! ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1\$"
  elif have netstat; then
    ! netstat -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1\$"
  else
    return 0
  fi
}
