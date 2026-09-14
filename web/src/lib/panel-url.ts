import "server-only";
import { headers } from "next/headers";

/* Where a node agent should reach this panel.

   PANEL_URL wins when it is set, because the address somebody's browser
   used is not always one a node can use: a panel behind a proxy, or one
   an operator reaches over a tunnel. Without it, the request that
   rendered the page is the best evidence there is — and the Add a node
   dialog leaves the field editable, since it is still only evidence. */
export async function panelUrl(): Promise<string> {
  const configured = process.env.PANEL_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const h = await headers();
  const host = h.get("x-forwarded-host")?.split(",")[0]?.trim() || h.get("host") || "localhost:3000";
  /* Next does not terminate TLS, so a request with no proxy in front of
     it arrived over http; a proxy that terminates TLS says so. */
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
  return `${proto}://${host}`;
}
