import { X509Certificate } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import https from "node:https";
import path from "node:path";
import process from "node:process";
import { describeFetchFailure } from "./panel.ts";

/* How a node comes to trust a panel that is reached at an address.

   No public authority issues a certificate for an address, so a panel the installer put behind Caddy's `tls internal`
   has a certificate signed by an authority only that machine knows, and a node agent (a Node.js program, with the public
   authorities for a trust store) refuses it. Until this, the answer was a file: copy the authority from the panel's machine
   to the node by hand and name it. For a node on another machine that is the one step nobody can be told in a command.

   The panel now offers its authority at /api/v1/panel-ca, and the command it writes carries the authority's SHA-256
   fingerprint: `--panel-ca sha256:<hex>` on Linux, `-PanelCa 'sha256:<hex>'` on Windows. The node fetches the file without
   trusting the connection it came over, and keeps it only if its fingerprint is the one in the command. The command came from
   the panel's own signed-in page, so the fingerprint is the part nobody on the way can change, and a file that does not match
   it is thrown away whoever sent it. This is how an SSH host key is pinned, and it is not turning the check off.

   The file is then used as one more authority beside the public ones (NODE_EXTRA_CA_CERTS), never instead of them. */

export const PANEL_CA_ROUTE = "/api/v1/panel-ca";

/** A reason in words, for whoever ran the command. Never carries anything secret: no token goes near this. */
export class PanelCaError extends Error {}

export type PanelCaSpec = { kind: "file"; path: string } | { kind: "sha256"; hex: string };

/** What `--panel-ca` / `-PanelCa` is given: a file, or `sha256:<64 hex digits>` (colons and capitals are fine, as openssl prints them). */
export function parsePanelCa(raw: string): PanelCaSpec {
  const value = raw.trim();
  const named = /^sha-?256[:=](.*)$/i.exec(value);
  if (named) {
    const hex = named[1]!.replace(/[:\s]/g, "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hex)) {
      throw new PanelCaError(
        "That fingerprint is not 64 hexadecimal digits. It is the SHA-256 of the authority's certificate, " +
          "as the panel's command wrote it: sha256:0a1b…",
      );
    }
    return { kind: "sha256", hex };
  }
  if (value === "") throw new PanelCaError("The panel's authority needs a file, or sha256:<fingerprint>.");
  return { kind: "file", path: value };
}

/** The same digits as openssl prints, without colons, in lower case. */
export function fingerprintOf(certificate: X509Certificate): string {
  return certificate.fingerprint256.replace(/:/g, "").toLowerCase();
}

/** The certificates in a PEM text, each as its own PEM. Anything that is not a certificate block is ignored. */
export function certificatesIn(text: string): { pem: string; certificate: X509Certificate }[] {
  const found: { pem: string; certificate: X509Certificate }[] = [];
  for (const block of text.match(/-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\s]+?-----END CERTIFICATE-----/g) ?? []) {
    try {
      const certificate = new X509Certificate(block);
      found.push({ pem: `${block.trim().replace(/\r\n/g, "\n")}\n`, certificate });
    } catch {
      /* a block that does not parse is not one */
    }
  }
  return found;
}

const MAX_BODY = 64 * 1024;

interface Fetched {
  status: number;
  body: string;
}

/* One GET of the panel's authority. `ca` set: the connection is checked against it and nothing else. Unset: it is not checked at
   all, which is the point of the fingerprint. */
function getAuthority(panelUrl: string, ca: string | null, timeoutMs: number): Promise<Fetched> {
  return new Promise((resolve, reject) => {
    const url = new URL(PANEL_CA_ROUTE, panelUrl);
    const request = https.request(
      {
        protocol: "https:",
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || 443,
        path: url.pathname,
        method: "GET",
        headers: { accept: "application/x-pem-file, text/plain" },
        ...(ca === null ? { rejectUnauthorized: false } : { ca, rejectUnauthorized: true }),
        timeout: timeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY) {
            request.destroy(new PanelCaError("The panel answered with far more than a certificate."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
        response.on("error", reject);
      },
    );
    request.on("timeout", () => request.destroy(Object.assign(new Error("timeout"), { name: "TimeoutError" })));
    request.on("error", reject);
    request.end();
  });
}

export interface PinnedAuthority {
  /** The authority's certificate, as PEM: only the one whose fingerprint was asked for. */
  pem: string;
  fingerprint: string;
  subject: string;
  notAfter: string;
}

/* Fetches the panel's authority and keeps it only if it is the one the command named.

   Then proves the other half: that the panel's own certificate really is signed by it, by asking again over a connection
   that trusts nothing else. An authority that matches the fingerprint but does not sign what the panel presents is a panel
   whose installer has not been run again since its address or its authority changed, and joining would fail further on with
   an error about a certificate; this says it here, in a sentence. */
export async function fetchAuthority(
  panelUrl: string,
  fingerprint: string,
  options: { timeoutMs?: number } = {},
): Promise<PinnedAuthority> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  let origin: URL;
  try {
    origin = new URL(panelUrl);
  } catch {
    throw new PanelCaError(`${panelUrl} is not an address.`);
  }
  if (origin.protocol !== "https:") {
    throw new PanelCaError(
      `${origin.origin} is plain http, so there is no certificate to trust. Leave the authority out of this command: ` +
        "it is for a panel that is reached over https at an address.",
    );
  }

  let first: Fetched;
  try {
    first = await getAuthority(origin.origin, null, timeoutMs);
  } catch (error) {
    if (error instanceof PanelCaError) throw error;
    throw new PanelCaError(`This machine could not ask the panel for its authority: ${describeFetchFailure(error, origin.origin)}`);
  }
  if (first.status === 404) {
    throw new PanelCaError(
      `${origin.origin} has no authority to offer. Its installer has to be run again on the panel's machine ` +
        "(sudo bash deploy/linux/install-panel.sh) so that it knows its own; until then copy the authority from that machine, " +
        "/etc/geeboard/panel-ca.crt, and name the file instead of the fingerprint.",
    );
  }
  if (first.status !== 200) {
    throw new PanelCaError(`${origin.origin} answered ${first.status} when asked for its authority.`);
  }

  const wanted = fingerprint.toLowerCase();
  const offered = certificatesIn(first.body);
  const match = offered.find((entry) => fingerprintOf(entry.certificate) === wanted);
  if (!match) {
    const seen = offered.length > 0 ? offered.map((entry) => fingerprintOf(entry.certificate)).join(", ") : "no certificate at all";
    throw new PanelCaError(
      `The authority ${origin.origin} offers is not the one this command names.\n` +
        `  the command: sha256:${wanted}\n  the panel:   sha256:${seen}\n` +
        "Either this is not the panel the command was written for, or the command is old: the panel's authority " +
        "changed after it was written. Make a new command in the panel (Nodes → Add a node) and run that. " +
        "If you did not expect this, do not go on: somebody between this machine and the panel is answering instead of it.",
    );
  }
  if (!match.certificate.ca) {
    throw new PanelCaError("The certificate with that fingerprint is not a certificate authority, so it is not what a panel signs with.");
  }

  let second: Fetched;
  try {
    second = await getAuthority(origin.origin, match.pem, timeoutMs);
  } catch (error) {
    if (error instanceof PanelCaError) throw error;
    const reason = (error as { code?: string }).code ?? describeFetchFailure(error, origin.origin);
    throw new PanelCaError(
      `The authority matches the command, but the certificate ${origin.origin} presents is not signed by it (${reason}). ` +
        "The panel's installer was probably not run again after its address changed.",
    );
  }
  if (second.status !== 200) {
    throw new PanelCaError(`${origin.origin} answered ${second.status} on the checked connection.`);
  }

  return {
    pem: match.pem,
    fingerprint: wanted,
    subject: match.certificate.subject.replace(/\n/g, ", "),
    notAfter: new Date(match.certificate.validTo).toISOString().slice(0, 10),
  };
}

/** Written whole or not at all, readable by anybody: a certificate is not a secret. */
function writeWhole(file: string, text: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, text, { mode: 0o644 });
    renameSync(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

/* Puts the panel's authority at `out`, from a file or by fingerprint, and says what it kept. */
export async function pinAuthority(panelUrl: string, spec: PanelCaSpec, out: string): Promise<PinnedAuthority> {
  if (spec.kind === "sha256") {
    const authority = await fetchAuthority(panelUrl, spec.hex);
    writeWhole(out, authority.pem);
    return authority;
  }

  let text: string;
  try {
    text = readFileSync(spec.path, "utf8");
  } catch (error) {
    throw new PanelCaError(`Cannot read ${spec.path}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}.`);
  }
  const found = certificatesIn(text);
  if (found.length === 0) {
    throw new PanelCaError(`${spec.path} has no certificate in it: it is the panel's authority as a PEM file, with a BEGIN CERTIFICATE line.`);
  }
  if (path.resolve(spec.path) !== path.resolve(out)) {
    mkdirSync(path.dirname(out), { recursive: true });
    copyFileSync(spec.path, out);
  }
  const first = found[0]!.certificate;
  return {
    pem: found.map((entry) => entry.pem).join(""),
    fingerprint: fingerprintOf(first),
    subject: first.subject.replace(/\n/g, ", "),
    notAfter: new Date(first.validTo).toISOString().slice(0, 10),
  };
}

/* npm run pin-ca -- <panel address> <sha256:fingerprint | file> <where to keep it>

   What the installers run before they join, so that the join and every start after it trust the panel. Prints what it kept. */
export async function main(argv: readonly string[]) {
  const [panel, spec, out] = argv.map((value) => unquote(value));
  if (!panel || !spec || !out || argv.length !== 3) {
    console.error("\nUsage: npm run pin-ca -- <panel address> <sha256:fingerprint | file> <where to keep it>\n");
    process.exit(2);
  }
  try {
    const parsed = parsePanelCa(spec);
    const origin = new URL(panel).origin;
    const kept = await pinAuthority(origin, parsed, out);
    console.log(`The panel's authority is kept at ${out}`);
    console.log(`  ${kept.subject}`);
    console.log(`  sha256:${kept.fingerprint}, valid until ${kept.notAfter}`);
    console.log(
      parsed.kind === "sha256"
        ? "  It is the one the command named, and the certificate the panel presents is signed by it."
        : "  Taken from the file you named.",
    );
  } catch (error) {
    // exitCode and not process.exit: see JoinFailure in join.ts, a connection still closing under an exit is a libuv assertion on Windows.
    console.error(
      error instanceof PanelCaError
        ? `\n${error.message}\n`
        : `\nThe panel's authority could not be set up: ${(error as Error).message}\n`,
    );
    process.exitCode = 1;
  }
}

/** One pair of quotes off a value, ASCII or typographic: what a paste into the wrong shell leaves around it. */
export function unquote(value: string): string {
  const pairs: Array<[string, string]> = [
    ["'", "'"],
    ['"', '"'],
    ["‘", "’"],
    ["“", "”"],
    ["‚", "‛"],
  ];
  const trimmed = value.trim();
  for (const [open, close] of pairs) {
    if (trimmed.length >= 2 && trimmed.startsWith(open) && trimmed.endsWith(close)) return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  await main(process.argv.slice(2));
}
