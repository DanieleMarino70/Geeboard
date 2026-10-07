# Caddy, as the panel's installer deals with it. Sourced after common.sh.
#
# One place that knows where Caddy's files are, what the panel's site block
# looks like, and how its private certificate authority reaches a node.
# The site block itself is a template — deploy/panel/caddy/panel.caddyfile.tmpl
# — so the file somebody reads and the file the installer writes are the
# same file with three values filled in.

CADDYFILE="/etc/caddy/Caddyfile"
CADDY_CA_ROOT="/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt"
# Where the installer leaves a copy of that authority for node agents. Not
# a secret: it checks certificates and can sign nothing.
PANEL_CA_COPY="/etc/geeboard/panel-ca.crt"
CADDY_MARKER="# geeboard-managed"

caddy_present() { have caddy; }

caddy_has_unit() {
  have systemctl && systemctl list-unit-files caddy.service >/dev/null 2>&1 &&
    systemctl list-unit-files caddy.service 2>/dev/null | grep -q '^caddy.service'
}

# What is holding 443, when it is not Caddy. nginx and apache are the two
# that have actually been in the way.
port_holder() {
  if have ss; then
    ss -ltnp 2>/dev/null | awk -v p=":$1\$" '$4 ~ p { print $0 }' | sed -n 's/.*users:((\"\([^"]*\)\".*/\1/p' | head -n 1
  fi
}

# Installs Caddy from the distribution's own packages. Not from a script
# piped into a shell: this runs as root on somebody's server.
caddy_install() {
  if os_is_debian_like && have apt-get; then
    info "Installing Caddy from the distribution's packages"
    DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null 2>&1 || true
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq caddy >/dev/null 2>&1 && return 0
  elif os_is_rhel_like && have dnf; then
    info "Installing Caddy from the distribution's packages"
    dnf install -y -q caddy >/dev/null 2>&1 && return 0
  fi
  return 1
}

# caddy_render <template> <site> <tls line> <upstream> — to stdout.
caddy_render() {
  _template="$1"; _site="$2"; _tls="$3"; _upstream="$4"
  [ -r "$_template" ] || return 1
  awk -v site="$_site" -v tls="$_tls" -v upstream="$_upstream" '
    { gsub(/__SITE__/, site); gsub(/__TLS__/, tls); gsub(/__UPSTREAM__/, upstream); print }
  ' "$_template"
}

# True when /etc/caddy/Caddyfile is one this installer may write over.
#
# Three cases, and the third is the one that matters: the Debian and Fedora
# packages install a Caddyfile of their own, which serves a placeholder page
# on :80 and proxies nothing. A fresh machine therefore always has a file
# here, and an installer that refused to touch one would refuse on every
# first installation it was written for. A file that proxies something is
# somebody's reverse proxy, and that one is left alone.
caddy_replaceable() {
  [ -f "$CADDYFILE" ] || return 0
  head -n 1 "$CADDYFILE" 2>/dev/null | grep -q "$CADDY_MARKER" && return 0
  grep -q '^[[:space:]]*reverse_proxy' "$CADDYFILE" 2>/dev/null && return 1
  return 0
}

# existing_site <panel url> <recorded mode> <recorded email> <caddyfile> — how a panel that is already
# installed is served, read off the machine instead of asked: prints "<mode> <host> [<email>]" and returns 0,
# or returns 1 when there is nothing to read (a first installation).
#
# The installer asks "do you have a domain name?", and the answer it takes when nobody answers — `--yes`, a
# script, a person who presses Enter — is no. So a bare re-run of a panel on a domain read "no", wrote
# `tls internal` where a Let's Encrypt block had been, and the final check, which only asks whether the
# address answers, passed. Every remote node then failed to verify the certificate. Nothing about the re-run said
# the way the panel was served was being changed.
#
# What is read, most specific first: what the installer recorded in deploy/panel/.env itself (the mode and the
# email, written since 0.9.0); the Caddyfile it manages, by its marker and the `tls` line in it, which is how a
# panel installed before then is recognised; a Caddyfile that proxies something and is not ours, which means the
# https is somebody else's; and last the address, an IP being an IP and a name a name. A name read that way has
# no email to keep, and the caller has to ask for one.
existing_site() {
  _url="$1"; _mode="$2"; _email="$3"; _file="$4"
  [ -n "$_url" ] || return 1
  _host="$(host_of "$_url")"
  [ -n "$_host" ] || return 1

  case "$_mode" in
    domain) printf 'domain %s %s\n' "$_host" "$_email"; return 0 ;;
    ip) printf 'ip %s\n' "$_host"; return 0 ;;
    given) printf 'given %s\n' "$_host"; return 0 ;;
  esac

  if [ -f "$_file" ] && head -n 1 "$_file" 2>/dev/null | grep -q "$CADDY_MARKER"; then
    _tls="$(sed -n 's/^[[:space:]]*tls[[:space:]][[:space:]]*//p' "$_file" | head -n 1 | sed 's/[[:space:]]*$//')"
    case "$_tls" in
      internal) printf 'ip %s\n' "$_host"; return 0 ;;
      *@*) printf 'domain %s %s\n' "$_host" "$_tls"; return 0 ;;
    esac
  elif [ -f "$_file" ] && grep -q '^[[:space:]]*reverse_proxy' "$_file" 2>/dev/null; then
    printf 'given %s\n' "$_host"; return 0
  fi

  if is_ipv4 "$_host" || is_ipv6 "$_host"; then
    printf 'ip %s\n' "$_host"
  else
    printf 'domain %s\n' "$_host"
  fi
  return 0
}

# caddy_apply <rendered file> — validates, keeps a copy of what was there,
# writes, and reloads. Returns 1 when the configuration does not validate,
# having changed nothing.
caddy_apply() {
  _new="$1"
  if have caddy && ! caddy validate --config "$_new" --adapter caddyfile >/dev/null 2>&1; then
    warn "Caddy refused the configuration this would have written:"
    caddy validate --config "$_new" --adapter caddyfile 2>&1 | sed 's/^/    /' >&2
    return 1
  fi

  if [ -f "$CADDYFILE" ] && ! cmp -s "$_new" "$CADDYFILE"; then
    _backup="$CADDYFILE.before-geeboard.$(date -u +%Y%m%d%H%M%S)"
    cp -p "$CADDYFILE" "$_backup"
    info "The Caddyfile that was there is kept at $_backup"
  fi

  install -d -m 0755 "$(dirname "$CADDYFILE")"
  install -m 0644 "$_new" "$CADDYFILE"

  if caddy_has_unit; then
    systemctl enable caddy >/dev/null 2>&1 || true
    if systemctl is-active --quiet caddy; then
      systemctl reload caddy >/dev/null 2>&1 || systemctl restart caddy
    else
      systemctl start caddy
    fi
  else
    warn "Caddy is installed but has no systemd unit, so it was not reloaded."
    note "Reload it however you run it. The configuration is at $CADDYFILE."
  fi
  return 0
}

# Caddy writes its authority the first time it serves with `tls internal`,
# so this waits for a file that does not exist yet rather than reading one
# that should.
caddy_wait_ca() {
  wait_for "${1:-30}" "Caddy's certificate authority" test -s "$CADDY_CA_ROOT"
}

# Leaves the authority where a node installer can read it without being
# root in Caddy's own directory, which is root-only on some installations.
caddy_export_ca() {
  [ -s "$CADDY_CA_ROOT" ] || return 1
  grep -q 'BEGIN CERTIFICATE' "$CADDY_CA_ROOT" || return 1
  # 0700 on the directory, the same as the node installer gives it: it also
  # holds the agent's settings, and those are not for everybody.
  install -d -m 0700 "$(dirname "$PANEL_CA_COPY")"
  install -m 0644 "$CADDY_CA_ROOT" "$PANEL_CA_COPY"
}
