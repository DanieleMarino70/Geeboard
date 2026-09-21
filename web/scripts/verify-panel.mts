import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import process from "node:process";

/* Starting and stopping a panel for a check, in one place.

   Three scripts need a running panel — verify-setup, verify-versions and
   verify-console — and all three had copied the same two mistakes.

   The first was stopping it. `npm run dev` is a wrapper: the server is
   its child, and SIGTERM to the wrapper leaves the server running. On
   Windows the scripts used `taskkill /T`, which takes the whole tree, so
   nobody noticed — until CI, where the leftover server from one check
   was still holding the build directory when the next check tried to
   start its own, and the second one never came up. Here the process gets
   a group of its own and the group is what is signalled.

   The second was saying nothing. A panel that does not start produced
   "timed out waiting for panel" and then a fetch that failed on a
   refused connection, which is a stack trace about the symptom. Its
   output is kept and printed with the failure instead.

   Every caller gives its own port and its own GEEBOARD_DIST_DIR: two
   dev servers cannot share a build directory. */

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

export interface Panel {
  process: ChildProcess;
  /** The last few thousand characters the server wrote, for a failure. */
  output: () => string;
}

export function startPanel(port: number, env: NodeJS.ProcessEnv): Panel {
  const args = ["run", "--silent", "dev", "--", "-p", String(port)];

  /* npm is a .cmd on Windows and needs a shell there, which wants one
     command line; everything in it is written in this file. Elsewhere,
     `detached` makes the child a process group leader so that stopping
     it stops the server it starts. */
  const child =
    process.platform === "win32"
      ? spawn([npm, ...args].join(" "), { env, shell: true, stdio: ["ignore", "pipe", "pipe"] })
      : spawn(npm, args, { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });

  let tail = "";
  const keep = (chunk: Buffer) => {
    tail = (tail + chunk.toString("utf8")).slice(-4000);
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);

  return { process: child, output: () => tail };
}

/** Waits for the sign-in page, or throws saying what the server said. */
export async function waitForPanel(panel: Panel, url: string, seconds = 120): Promise<void> {
  for (let i = 0; i < seconds; i++) {
    const up = await fetch(`${url}/sign-in`, { redirect: "manual" }).then(
      (res) => res.status === 200,
      () => false,
    );
    if (up) {
      /* A development server answers the first page it has compiled
         while the rest is still building, and an authenticated request
         arriving in that window is redirected to sign-in as if the
         session were bad. One request through the middleware and the
         app router, so the next caller meets a compiled path. */
      await fetch(url, { redirect: "manual" }).catch(() => undefined);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const said = panel.output().trim();
  throw new Error(
    `the panel did not answer on ${url} within ${seconds}s.\n` +
      (said ? `What it wrote:\n${said}` : "It wrote nothing at all."),
  );
}

/* Asks for a page until it answers 200, for as long as a development
   server may still be compiling it.

   Not a way to make a refusal pass: a page that is genuinely refused
   answers the same thing every time and this still gives up, with that
   answer and the server's own output. It only absorbs the first-request
   compile, which was making a check pass or fail depending on how busy
   the machine was. */
export async function fetchWhenReady(
  panel: Panel,
  url: string,
  init: RequestInit,
  seconds = 60,
): Promise<{ response: Response; attempts: number; detail: string }> {
  let last: Response | undefined;
  for (let i = 1; i <= seconds; i++) {
    const res = await fetch(url, { ...init, redirect: "manual" }).catch(() => undefined);
    if (res) {
      last = res;
      if (res.status === 200) return { response: res, attempts: i, detail: "" };
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return {
    response: last ?? new Response("", { status: 0 }),
    attempts: seconds,
    detail: `${last?.status ?? "no answer"} ${last?.headers.get("location") ?? ""} after ${seconds}s\n${panel
      .output()
      .slice(-1500)}`,
  };
}

export function stopPanel(panel: Panel | undefined): void {
  const pid = panel?.process.pid;
  if (!pid) return;

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)]);
    return;
  }
  // The negative pid is the group: the wrapper and the server it started.
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      panel!.process.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
}
