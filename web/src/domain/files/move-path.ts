/* A path in a server's folder, read the way the node's agent reads it.

   The agent turns a backslash into a slash and collapses `.` and `..` (daemon/src/beneath.ts, `partsOf`); the panel used to cut the string at its
   slashes and compare what was left, so `plugins\b.jar` was a name that never exists and `server.properties/.` a name inside a file, and a rename
   the panel judged safe replaced a file (the audit of 0.9.5). A path with a dot-segment is refused here instead of being read two ways; a backslash is
   a slash, as it is to the agent. */

/** `escapes`: the path, collapsed the way the agent would, leaves the server's folder; the API answers that as a refusal (403), not as a mistake in the request. */
export type MovePath = { ok: true; path: string } | { ok: false; why: string; escapes: boolean };

export function movePath(raw: string): MovePath {
  if (/[\u0000-\u001f\u007f]/.test(raw)) return { ok: false, why: "A name cannot hold a control character.", escapes: false };
  const segments = raw.replace(/\\/g, "/").split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    let depth = 0;
    let escapes = false;
    for (const segment of segments) {
      if (segment === "..") depth -= 1;
      else if (segment !== ".") depth += 1;
      if (depth < 0) escapes = true;
    }
    return {
      ok: false,
      why: escapes ? "That path leaves the server's folder." : "Name the folder in full: a path with . or .. in it is not followed.",
      escapes,
    };
  }
  return { ok: true, path: segments.join("/") };
}

/** The key a name is compared by. A Windows node's file system does not tell `Server.Properties` from `server.properties`, nor `a.txt.` from `a.txt`. */
export function nameKey(name: string, caseInsensitive: boolean): string {
  return caseInsensitive ? name.toLowerCase().replace(/[. ]+$/, "") : name;
}
