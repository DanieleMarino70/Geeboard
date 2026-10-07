import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import WebSocket from "ws";

/* A browser to look at the panel with, driven over the DevTools protocol: no dependency beyond `ws`, which the panel already has, and the Chrome
   (or Edge, or Chromium) that is on the machine. Used by the checks that need to see a page as a person does: accessibility, and what a
   phone is shown. A machine with none says so and the check is skipped, which is not a pass. */

export function findBrowser(): string | null {
  const candidates = [
    process.env.GEEBOARD_CHROME,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  return candidates.find((c): c is string => Boolean(c) && existsSync(c as string)) ?? null;
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

/** The parts of the protocol's console and exception events that are read. */
interface Heard {
  type?: string;
  args?: Array<{ value?: unknown; description?: string }>;
  exceptionDetails?: { text?: string; exception?: { description?: string } };
}

export interface Tab {
  call(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  goto(url: string, settleMs?: number): Promise<void>;
  eval<T = unknown>(expression: string): Promise<T>;
  setCookie(name: string, value: string, host: string): Promise<void>;
  viewport(width: number, height: number, mobile?: boolean): Promise<void>;
  shot(file: string): Promise<void>;
  /** A key as a keyboard sends it, so that what the page does for a keyboard (focus-visible, a skip link) is what is seen. */
  press(key: "Tab" | "Shift+Tab" | "Enter"): Promise<void>;
  /** What the page has said in its console as an error or a warning, and every exception it threw, since the last call. */
  problems(): string[];
}

export interface Browser {
  open(): Promise<Tab>;
  close(): Promise<void>;
}

export async function launchBrowser(executable: string, port = 9400 + Math.floor(Math.random() * 400)): Promise<Browser> {
  const profile = mkdtempSync(path.join(tmpdir(), "geeboard-browser-"));
  const child: ChildProcess = spawn(
    executable,
    [`--remote-debugging-port=${port}`, "--headless=new", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "--disable-gpu", `--user-data-dir=${profile}`, "about:blank"],
    { stdio: "ignore" },
  );

  let version: { webSocketDebuggerUrl: string } | null = null;
  for (let i = 0; i < 150 && !version; i++) {
    try {
      version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as { webSocketDebuggerUrl: string };
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  if (!version) {
    child.kill();
    throw new Error(`the browser at ${executable} did not start`);
  }

  const ws = new WebSocket(version.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  let id = 0;
  const waiting = new Map<number, Pending>();
  const heard: Array<{ sessionId?: string; text: string }> = [];
  ws.on("message", (raw) => {
    const message = JSON.parse(String(raw)) as { id?: number; result?: unknown; error?: unknown; method?: string; sessionId?: string; params?: Heard };
    if (message.id === undefined) {
      const p = message.params ?? {};
      if (message.method === "Runtime.exceptionThrown") heard.push({ sessionId: message.sessionId, text: `exception: ${p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text}` });
      else if (message.method === "Runtime.consoleAPICalled" && (p.type === "error" || p.type === "warning"))
        heard.push({ sessionId: message.sessionId, text: `${p.type}: ${(p.args ?? []).map((a) => String(a.value ?? a.description ?? "")).join(" ")}` });
      return;
    }
    const pending = waiting.get(message.id);
    if (!pending) return;
    waiting.delete(message.id);
    if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
    else pending.resolve(message.result);
  });
  const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const mine = ++id;
      waiting.set(mine, { resolve: resolve as (v: unknown) => void, reject });
      ws.send(JSON.stringify({ id: mine, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  return {
    async open() {
      const { targetId } = (await send("Target.createTarget", { url: "about:blank" })) as { targetId: string };
      const { sessionId } = (await send("Target.attachToTarget", { targetId, flatten: true })) as { sessionId: string };
      const call = (method: string, params: Record<string, unknown> = {}) => send(method, params, sessionId);
      await call("Page.enable");
      await call("Runtime.enable");
      await call("Network.enable");
      await call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
      const tab: Tab = {
        call,
        async goto(url, settleMs = 800) {
          await call("Page.navigate", { url });
          // `load` of this document, and then a moment for what a page does after it.
          for (let i = 0; i < 300; i++) {
            const state = (await tab.eval<string>("document.readyState").catch(() => "loading")) as string;
            if (state === "complete") break;
            await new Promise((r) => setTimeout(r, 100));
          }
          await new Promise((r) => setTimeout(r, settleMs));
        },
        async eval<T>(expression: string) {
          const out = (await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })) as { result: { value: T }; exceptionDetails?: { text: string; exception?: { description?: string } } };
          if (out.exceptionDetails) throw new Error(`${out.exceptionDetails.text} ${out.exceptionDetails.exception?.description ?? ""}`);
          return out.result.value;
        },
        async setCookie(name, value, host) {
          await call("Network.setCookie", { name, value, domain: host, path: "/", httpOnly: true });
        },
        async viewport(width, height, mobile = false) {
          await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
        },
        async press(key) {
          const shift = key === "Shift+Tab";
          const name = shift ? "Tab" : key;
          const code = { Tab: 9, Enter: 13 }[name as "Tab" | "Enter"];
          const common = { key: name, code: name, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 };
          await call("Input.dispatchKeyEvent", { type: "rawKeyDown", ...common, ...(name === "Enter" ? { text: "\r" } : {}) });
          await call("Input.dispatchKeyEvent", { type: "keyUp", ...common });
          await new Promise((r) => setTimeout(r, 120));
        },
        problems() {
          return heard.splice(0).filter((h) => h.sessionId === sessionId).map((h) => h.text);
        },
        async shot(file) {
          const { data } = (await call("Page.captureScreenshot", { format: "png" })) as { data: string };
          (await import("node:fs")).writeFileSync(file, Buffer.from(data, "base64"));
        },
      };
      return tab;
    },
    async close() {
      ws.close();
      child.kill();
      await new Promise((r) => setTimeout(r, 300));
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        /* Chrome may still hold a file for a moment; the temp directory is the system's to clear */
      }
    },
  };
}
