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
