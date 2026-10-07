import { X509Certificate } from "node:crypto";

/* The certificate authority of a panel that is reached at an address.

   No public authority issues a certificate for an address, so the installer puts such a panel behind Caddy's `tls internal`,
   which signs with an authority of its own, and a node agent refuses what that authority signed until it is handed the
   authority. The installer tells the panel what it is (PANEL_CA_B64: the root certificate as one line of base64), and the panel
   does two things with it: it offers the certificate at /api/v1/panel-ca, and the Add a node dialog writes its SHA-256
   fingerprint into the command. The node fetches the certificate without trusting the connection and keeps it only if its
   fingerprint is the one in the command (daemon/src/panel-ca.ts), so the part nobody on the way can change is the part that came
   from this page.

   A root certificate is public by nature: anybody who is shown this panel's https is shown the authority's name, and the
   certificate itself is what a browser would be asked to trust. Nothing here is secret, and nothing here can be used to sign. */

export interface PanelAuthority {
  /** The certificate, as PEM, one block, LF line endings. */
  pem: string;
  /** SHA-256 of the DER, 64 lower-case hex digits: what openssl prints without the colons. */
  sha256: string;
}

/** The authority an installer wrote into the environment, or null when there is none or it is not a certificate authority. */
export function authorityFrom(encoded: string | undefined | null): PanelAuthority | null {
  const value = encoded?.trim();
  if (!value) return null;

  let text: string;
  try {
    text = Buffer.from(value, "base64").toString("utf8");
  } catch {
    return null;
  }

  const block = /-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\s]+?-----END CERTIFICATE-----/.exec(text)?.[0];
  if (!block) return null;

  try {
    const certificate = new X509Certificate(block);
    // Offering a leaf certificate as "the authority" would be a mistake that fails far from where it was made.
    if (!certificate.ca) return null;
    return {
      pem: `${block.trim().replace(/\r\n/g, "\n")}\n`,
      sha256: certificate.fingerprint256.replace(/:/g, "").toLowerCase(),
    };
  } catch {
    return null;
  }
}

/** This panel's authority, from the environment it was started with. */
export function panelAuthority(env: Record<string, string | undefined> = process.env): PanelAuthority | null {
  return authorityFrom(env.PANEL_CA_B64);
}
