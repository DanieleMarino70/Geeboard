/* Whether the panel should tell browsers to use https for it, for a year (Strict-Transport-Security).

   Right for a panel reached at a name over https, and wrong for the rest: a browser does not apply HSTS to an IP address at
   all, and on a panel reached over plain http (a LAN, a first install) it would be a promise the panel cannot keep. So it
   follows the address the owner said the panel is at. Not includeSubDomains and not preload: those are the owner's
   decisions about their domain, not ours. */
export function hstsApplies(panelUrl: string | undefined): boolean {
  if (!panelUrl) return false;
  try {
    const url = new URL(panelUrl);
    if (url.protocol !== "https:") return false;
    const host = url.hostname;
    // An IPv4 literal, or an IPv6 one (the parser keeps its brackets), or this machine.
    return !(/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[") || host === "localhost");
  } catch {
    return false;
  }
}
