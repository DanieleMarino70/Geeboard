import "server-only";
import type { Prisma } from "@prisma/client";
import { classifyAgent, classifyPanel, parseRelease, type AgentVerdict, type PanelVerdict, type Release, STATE_WORD } from "@/domain/updates/release";
import { classifyAddress } from "@/domain/net/address";
import { userAgent } from "@/domain/net/user-agent";
import { db } from "./db";
import { PANEL_VERSION } from "./version";

/* The panel finds out that a newer release of itself exists, and says so without asking anybody on a page view.

   Once the poller has gone through an hour it calls checkForUpdates, which does nothing unless twelve hours have passed since the last
   attempt (an hour after one that failed), and then makes ONE request, for one small static file, release.json, that every release carries
   as an asset. Not the GitHub API: no rate limit to share with everyone behind the same address, no notes to parse, and what is classified
   (update, recommended, security) is what a person wrote at the cut, in release-policy.json, and not a guess made from prose.

   What leaves the machine: the request for that file, to github.com, with the name every request of this panel carries (Geeboard/<version> (+ the
   project's address), domain/net/user-agent.ts) and nothing else — no cookie, no credential, no address, no identifier of this installation —
   so what the file answers is the same for everybody, and a request is not a report. GEEBOARD_UPDATE_CHECK=off makes none, and
   GEEBOARD_UPDATE_URL names another place (a mirror, an air-gapped copy). The answer is stored (update_checks), read by the pages from there,
   and announced once through the audit log, which is where the notification channels read.

   A failure is a sentence in the row and never an exception: a panel behind a firewall that cannot reach GitHub says so on its Updates page
   and goes on. */

export const DEFAULT_UPDATE_URL = "https://github.com/DanieleMarino70/Geeboard/releases/latest/download/release.json";
export const CHECK_EVERY_MS = 12 * 3600_000;
export const RETRY_AFTER_FAILURE_MS = 3600_000;
export const FORCE_MIN_MS = 30_000;
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 64 * 1024;
const ROW = "panel";

type Env = Record<string, string | undefined>;

export function updateCheckEnabled(env: Env = process.env): boolean {
  const v = (env.GEEBOARD_UPDATE_CHECK ?? "on").trim().toLowerCase();
  return !["off", "0", "false", "no", "never"].includes(v);
}

/** Where the file is read from: https, or http on this machine (a test, a mirror on the same host); anything else is not used. */
export function updateSource(env: Env = process.env): { ok: true; url: string } | { ok: false; why: string } {
  const raw = env.GEEBOARD_UPDATE_URL?.trim();
  if (!raw) return { ok: true, url: DEFAULT_UPDATE_URL };
  try {
    const url = new URL(raw);
    /* A user name or password in the address is refused, and the sentence does not repeat the address: fetch refuses such a URL with a
       message that quotes the whole of it, and that message went to the Updates page, the database and the poller's log. */
    if (url.username || url.password) {
      return { ok: false, why: "GEEBOARD_UPDATE_URL has a user name or password in it, which is not used. Put the credentials where the mirror reads them (a header it adds itself), not in the address." };
    }
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if (url.protocol === "https:" || (url.protocol === "http:" && local)) return { ok: true, url: url.toString() };
  } catch {
    // falls through to the same sentence
  }
  return { ok: false, why: "GEEBOARD_UPDATE_URL is not an https address (http is accepted only for this machine), so no check was made." };
}

/** Where, for a person: the host and no more, since a path can carry a token somebody put in a mirror's address. */
export function whereFrom(env: Env = process.env): string {
  const s = updateSource(env);
  if (!s.ok) return "an address that is not used";
  try {
    return new URL(s.url).host;
  } catch {
    return "?";
  }
}

export interface CheckReport {
  ran: boolean;
  /** Why nothing was asked: off, recent. */
  skipped?: "off" | "recent";
  ok?: boolean;
  /** The newest release now known, if any. */
  latest?: string;
  /** A release that was not the one known before. */
  changed?: boolean;
  error?: string;
}

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return await response.text();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error(`the file is larger than ${MAX_BYTES / 1024} KB, which no release file is`);
    }
    parts.push(value);
  }
  return Buffer.concat(parts).toString("utf8");
}

/** What an error says, for a page: on one line, short, and with every address in it cut to its host (a path or a query can carry a token). */
export function sentence(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && error.name === "AbortError") return `the request took longer than ${TIMEOUT_MS / 1000} seconds`;
  // A network failure says only "fetch failed" and keeps its reason in `cause`.
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  const said = (cause ? `${text}: ${cause}` : text).replace(/\s+/g, " ");
  return said.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)]+/gi, (address) => {
    try {
      return new URL(address).host || "an address";
    } catch {
      return "an address";
    }
  }).slice(0, 200);
}

/* The redirects of the update check are followed here and not by fetch, so that each hop can be judged: the file is on GitHub, which
   answers with a redirect to wherever its release assets are served from, and a mirror may do the same, but a hop to plain http, to an
   address of this machine's own network, or to a fourth address is not a release file (the audit of 0.9.5: whoever could change what the
   address answers could send the poller to http://169.254.169.254/ or to a service on a private address, and read from the Updates
   page whether it answered). The first address is the operator's; only the hops after it are held to this. */
const MAX_HOPS = 3;

async function fetchFollowing(start: string, init: RequestInit, fetchImpl: typeof fetch): Promise<Response> {
  let url = start;
  for (let hop = 0; ; hop++) {
    const response = await fetchImpl(url, { ...init, redirect: "manual" });
    if (response.status < 300 || response.status >= 400 || response.status === 304) return response;
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => {});
    if (!location) return response;
    if (hop >= MAX_HOPS) throw new Error(`it redirected more than ${MAX_HOPS} times`);
    let next: URL;
    try {
      next = new URL(location, url);
    } catch {
      throw new Error("it redirected to an address that is not one");
    }
    // The operator's own address (a mirror on this machine, which is http) may send a request to itself; nothing else may leave https.
    if (next.origin === new URL(start).origin) {
      url = next.toString();
      continue;
    }
    if (next.protocol !== "https:") throw new Error("it redirected to an address that is not https");
    if (next.username || next.password) throw new Error("it redirected to an address with credentials in it");
    const kind = classifyAddress(next.hostname);
    if (kind !== null && kind !== "public") throw new Error("it redirected to an address that is not on the internet");
    url = next.toString();
  }
}

export interface CheckOptions {
  /** Ask whatever the clock says (the button). */
  force?: boolean;
  now?: Date;
  env?: Env;
  fetchImpl?: typeof fetch;
}

export async function checkForUpdates(options: CheckOptions = {}): Promise<CheckReport> {
  const env = options.env ?? process.env;
  if (!updateCheckEnabled(env)) return { ran: false, skipped: "off" };
  const now = options.now ?? new Date();

  const row = await db.updateCheck.findUnique({ where: { id: ROW } });
  if (row?.checkedAt) {
    // The button asks whatever the clock says, but not twice in half a minute: a click held down is not a reason to ask GitHub a hundred times.
    const wait = options.force ? FORCE_MIN_MS : row.error ? RETRY_AFTER_FAILURE_MS : CHECK_EVERY_MS;
    if (now.getTime() - row.checkedAt.getTime() < wait) return { ran: false, skipped: "recent" };
  }

  const record = (data: Prisma.UpdateCheckUncheckedUpdateInput) =>
    db.updateCheck.upsert({ where: { id: ROW }, create: { id: ROW, ...(data as Prisma.UpdateCheckUncheckedCreateInput) }, update: data });

  const source = updateSource(env);
  if (!source.ok) {
    await record({ checkedAt: now, error: source.why });
    return { ran: true, ok: false, error: source.why };
  }

  const known = row?.release ? parseRelease(row.release) : null;
  const headers: Record<string, string> = { accept: "application/json", "user-agent": userAgent() };
  if (row?.etag && known?.ok) headers["if-none-match"] = row.etag;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchFollowing(source.url, { headers, signal: controller.signal }, options.fetchImpl ?? fetch);
    if (response.status === 304 && known?.ok) {
      await record({ checkedAt: now, succeededAt: now, error: null });
      return { ran: true, ok: true, latest: known.release.version, changed: false };
    }
    if (response.status === 404) {
      const why = "No release has been published at that address yet (HTTP 404).";
      await record({ checkedAt: now, error: why });
      return { ran: true, ok: false, error: why };
    }
    if (!response.ok) {
      const why = `${new URL(source.url).host} answered HTTP ${response.status}.`;
      await record({ checkedAt: now, error: why });
      return { ran: true, ok: false, error: why };
    }
    const body = await readCapped(response);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      const why = "The answer is not JSON, so it is not a release file.";
      await record({ checkedAt: now, error: why });
      return { ran: true, ok: false, error: why };
    }
    const read = parseRelease(parsed);
    if (!read.ok) {
      const why = `The release file was refused: ${read.why}.`;
      await record({ checkedAt: now, error: why });
      return { ran: true, ok: false, error: why };
    }
    const changed = !known?.ok || known.release.version !== read.release.version;
    await record({
      checkedAt: now,
      succeededAt: now,
      etag: response.headers.get("etag"),
      error: null,
      release: read.release as unknown as Prisma.InputJsonValue,
    });
    return { ran: true, ok: true, latest: read.release.version, changed };
  } catch (error) {
    const why = `${new URL(source.url).host} could not be reached: ${sentence(error)}.`;
    await record({ checkedAt: now, error: why }).catch(() => {});
    return { ran: true, ok: false, error: why };
  } finally {
    clearTimeout(timer);
  }
}

export interface UpdateStatus {
  enabled: boolean;
  installed: string;
  /** Where the file is read from, for a person: the host. */
  source: string;
  checkedAt: Date | null;
  succeededAt: Date | null;
  error: string | null;
  release: Release | null;
  panel: PanelVerdict | null;
  agents: Array<{ node: string; version: string; verdict: AgentVerdict }>;
  /** The table is not there (a database that has not been migrated to this release yet). */
  unavailable: boolean;
}

/** What a page shows. Reads one row and the nodes: never the network. */
export async function readUpdateStatus(): Promise<UpdateStatus> {
  const base: UpdateStatus = {
    enabled: updateCheckEnabled(),
    installed: PANEL_VERSION,
    source: whereFrom(),
    checkedAt: null,
    succeededAt: null,
    error: null,
    release: null,
    panel: null,
    agents: [],
    unavailable: false,
  };
  let row: Awaited<ReturnType<typeof db.updateCheck.findUnique>> = null;
  try {
    row = await db.updateCheck.findUnique({ where: { id: ROW } });
  } catch {
    return { ...base, unavailable: true };
  }
  if (!row) return base;
  const parsed = row.release ? parseRelease(row.release) : null;
  const release = parsed?.ok ? parsed.release : null;
  const nodes = release ? await db.node.findMany({ select: { name: true, daemon: true }, orderBy: { name: "asc" } }) : [];
  return {
    ...base,
    checkedAt: row.checkedAt,
    succeededAt: row.succeededAt,
    error: row.error,
    release,
    panel: release ? classifyPanel(PANEL_VERSION, release) : null,
    agents: release ? nodes.map((n) => ({ node: n.name, version: n.daemon, verdict: classifyAgent(n.daemon, release) })) : [],
  };
}

/** The agents a release calls a problem: below a floor, in the order the nodes are listed. */
export function agentsToUpgrade(status: Pick<UpdateStatus, "agents">) {
  return status.agents.filter((a) => a.verdict.state === "security" || a.verdict.state === "unsupported");
}

/** Whether anything in the status wants a person: the panel is behind, or an agent is below a floor. */
export function wantsAttention(status: UpdateStatus): "danger" | "warning" | "info" | null {
  if (!status.panel) return null;
  const agents = agentsToUpgrade(status);
  if (status.panel.state === "security" || agents.some((a) => a.verdict.state === "security")) return "danger";
  if (status.panel.state === "recommended" || agents.length > 0) return "warning";
  if (status.panel.state === "update") return "info";
  return null;
}

/* The audit line the notification channels read. Written once for a release and what it makes of this panel and its agents; when the panel
   catches up and no agent is below a floor, the key is cleared, so the next release is news. Returns whether a line was written. */
export async function recordPanelUpdateNews(): Promise<boolean> {
  const status = await readUpdateStatus();
  if (status.unavailable || !status.release || !status.panel) return false;
  const low = agentsToUpgrade(status);
  const worst = wantsAttention(status);
  const row = await db.updateCheck.findUnique({ where: { id: ROW }, select: { notifiedKey: true } });

  if (!worst) {
    if (row?.notifiedKey) await db.updateCheck.update({ where: { id: ROW }, data: { notifiedKey: null } });
    return false;
  }
  const key = `${status.release.version}:${status.panel.state}:${low.map((a) => `${a.node}=${a.verdict.state}`).join(",")}`;
  if (key === row?.notifiedKey) return false;

  const lines = low.map((a) => `${a.node} (${a.version}: ${STATE_WORD[a.verdict.state].toLowerCase()})`).join(", ");
  await db.$transaction([
    db.updateCheck.update({ where: { id: ROW }, data: { notifiedKey: key } }),
    db.activityEvent.create({
      data: {
        actor: "Updates",
        action: "panel.update.available",
        target: `Geeboard ${status.release.version}`,
        tone: worst === "danger" ? "DANGER" : worst === "warning" ? "WARNING" : "INFO",
        changes: {
          Release: { from: PANEL_VERSION, to: status.release.version },
          State: { from: "—", to: STATE_WORD[status.panel.state] },
          ...(lines ? { Agents: { from: "—", to: lines } } : {}),
          ...(status.release.url ? { Link: { from: "—", to: status.release.url } } : {}),
        },
      },
    }),
  ]);
  return true;
}
