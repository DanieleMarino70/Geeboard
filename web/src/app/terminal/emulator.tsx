"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useLocalFlag } from "@/components/use-local-flag";
import type { TerminalState } from "./terminal-view";

/* The emulator: xterm in the panel's own colours and font, wired to the
   session's stream and input routes.

   Output arrives as Server-Sent Events, as a console's does. Typing goes
   back in numbered requests, one at a time: whatever is typed while one
   is on its way waits and goes in the next, so order is a matter of
   construction and a request repeated after a hiccup is not typed twice.
   Nothing is kept in the browser beyond what is on the screen. */

const RESIZE_DEBOUNCE_MS = 150;

/* xterm takes colours as rgb() and hex, not as var() or hsl(… / alpha),
   so each token is read as the browser computed it, from a probe. */
function themeFromTokens(): Record<string, string> {
  const probe = document.createElement("span");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  document.body.appendChild(probe);
  const colour = (token: string) => {
    probe.style.color = `var(${token})`;
    return getComputedStyle(probe).color;
  };
  try {
    const bg = colour("--con-bg");
    const ink = colour("--con-ink");
    const dim = colour("--con-dim");
    const accent = colour("--accent");
    const success = colour("--success");
    const warning = colour("--warning");
    const danger = colour("--danger");
    const info = colour("--info");
    // The sixteen ANSI colours mapped onto the semantic palette, as the console's levels are.
    return {
      background: bg,
      foreground: ink,
      cursor: ink,
      cursorAccent: bg,
      selectionBackground: accent,
      selectionForeground: colour("--accent-ink"),
      black: bg,
      red: danger,
      green: success,
      yellow: warning,
      blue: info,
      magenta: accent,
      cyan: success,
      white: ink,
      brightBlack: dim,
      brightRed: danger,
      brightGreen: success,
      brightYellow: warning,
      brightBlue: info,
      brightMagenta: accent,
      brightCyan: success,
      brightWhite: ink,
    };
  } finally {
    probe.remove();
  }
}

function monoFamily(): string {
  const probe = document.createElement("span");
  probe.className = "font-mono";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  document.body.appendChild(probe);
  try {
    // The family list as computed, without the proportional fallback next/font adds.
    return getComputedStyle(probe).fontFamily.replace(/,\s*"?[^",]*Fallback"?/gi, "");
  } finally {
    probe.remove();
  }
}

export function Emulator({
  id,
  node,
  onState,
  onEnded,
}: {
  id: string;
  node: string;
  onState: (state: TerminalState) => void;
  onEnded: (reason: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  /* Screen-reader mode: xterm draws to a canvas, which a screen reader cannot read, and builds a readable copy of the output (and an
     assertive live region for what is typed) only when asked. Off by default because it costs a DOM row per line, and kept in this browser. */
  const [screenReader, toggleScreenReader] = useLocalFlag("gb-terminal-screen-reader");
  const screenReaderRef = useRef(screenReader);
  useEffect(() => {
    screenReaderRef.current = screenReader;
    if (termRef.current) termRef.current.options.screenReaderMode = screenReader;
  }, [screenReader]);
  const [size, setSize] = useState<{ cols: number; rows: number } | null>(null);
  /* The callbacks are read through refs: the parent makes a new closure on
     every render, and an effect that depended on them tore the stream
     down and opened it again at each state change — a loop of streams. */
  const stateRef = useRef(onState);
  const endedRef = useRef(onEnded);
  useEffect(() => {
    stateRef.current = onState;
    endedRef.current = onEnded;
  });

  useEffect(() => {
    const onState = (state: TerminalState) => stateRef.current(state);
    const onEnded = (reason: string) => endedRef.current(reason);
    const element = host.current;
    if (!element) return;
    let disposed = false;

    const term = new Terminal({
      // A cursor that blinks for somebody who asked the system for less motion is a motion they did not want.
      cursorBlink: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      screenReaderMode: screenReaderRef.current,
      fontFamily: monoFamily(),
      fontSize: 12.5,
      lineHeight: 1.2,
      scrollback: 5000,
      theme: themeFromTokens(),
      allowProposedApi: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(element);
    termRef.current = term;

    // Colours follow the panel's theme, which lives on <html data-theme>.
    const themed = new MutationObserver(() => {
      term.options.theme = themeFromTokens();
    });
    themed.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    /* ── Typing ─────────────────────────────────────────────────── */
    let seq = 0;
    let pending = "";
    let inFlight = false;
    let over = false;
    const flush = async () => {
      if (inFlight || over || !pending) return;
      inFlight = true;
      const d = pending;
      pending = "";
      const mine = seq++;
      for (let attempt = 0; attempt < 3 && !over; attempt++) {
        try {
          const res = await fetch(`/api/terminal/${encodeURIComponent(id)}/input`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ seq: mine, d }),
          });
          if (res.status === 404 || res.status === 401 || res.status === 403) {
            over = true;
            break;
          }
          if (res.ok) break;
        } catch {
          /* a hiccup: the same number goes again, and is typed once */
        }
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
      inFlight = false;
      void flush();
    };
    const typed = term.onData((data) => {
      pending += data;
      void flush();
    });

    // Ctrl+Shift+C copies the selection; paste is the browser's own.
    term.attachCustomKeyEventHandler((event) => {
      /* Shift+Tab is the way out, as the page says. xterm turns it into the shell's backtab and cancels the event, so the focus stayed in the
         terminal for a keyboard (WCAG 2.1.2, no keyboard trap); not handled here, the browser moves focus to the control before it. */
      if (event.key === "Tab" && event.shiftKey) return false;
      if (event.type === "keydown" && event.ctrlKey && event.shiftKey && event.code === "KeyC" && term.hasSelection()) {
        void navigator.clipboard?.writeText(term.getSelection());
        return false;
      }
      return true;
    });

    /* ── Size ───────────────────────────────────────────────────── */
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const sendSize = () => {
      if (over) return;
      setSize({ cols: term.cols, rows: term.rows });
      void fetch(`/api/terminal/${encodeURIComponent(id)}/resize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cols: term.cols, rows: term.rows }),
      }).catch(() => {});
    };
    const refit = () => {
      try {
        fit.fit();
      } catch {
        return;
      }
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(sendSize, RESIZE_DEBOUNCE_MS);
    };
    const watcher = new ResizeObserver(refit);
    watcher.observe(element);

    /* ── Output ─────────────────────────────────────────────────── */
    onState("connecting");
    const source = new EventSource(`/api/terminal/${encodeURIComponent(id)}/stream`);
    let everOpen = false;
    source.addEventListener("out", (event) => {
      const frame = JSON.parse((event as MessageEvent).data) as { d: string; dropped?: boolean };
      if (frame.dropped) term.writeln("\r\n\x1b[2m[some output while the page was away was not kept]\x1b[0m");
      term.write(frame.d);
    });
    source.addEventListener("exit", (event) => {
      const frame = JSON.parse((event as MessageEvent).data) as { code: number | null };
      term.writeln(`\r\n\x1b[2m[the shell exited${frame.code === null ? "" : ` with code ${frame.code}`}]\x1b[0m`);
    });
    source.addEventListener("ended", (event) => {
      const frame = JSON.parse((event as MessageEvent).data) as { reason: string };
      over = true;
      source.close();
      term.writeln(`\r\n\x1b[2m[closed: ${frame.reason}]\x1b[0m`);
      onEnded(frame.reason);
    });
    /* The panel's `open` event names the session, and comes both when the
       shell starts and when a dropped stream picks the session back up. */
    const live = () => {
      const first = !everOpen;
      everOpen = true;
      onState("live");
      // Told once the stream is up, so the shell starts at the size it will be drawn at.
      refit();
      sendSize();
      /* Focus goes to the terminal when it first opens, and not again: a stream that picked its session back up after a blip took focus
         from whatever the reader had moved to (the Close button) every time it did. */
      if (first) term.focus();
    };
    source.addEventListener("open", live);
    source.onerror = () => {
      if (over) return;
      if (source.readyState === EventSource.CLOSED) onState("disconnected");
      else onState(everOpen ? "reconnecting" : "connecting");
    };

    refit();

    return () => {
      disposed = true;
      void disposed;
      over = true;
      source.close();
      typed.dispose();
      watcher.disconnect();
      themed.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
      termRef.current = null;
      term.dispose();
    };
  }, [id, node]);

  return (
    <div className="flex h-[calc(100vh-240px)] min-h-[420px] flex-col overflow-hidden rounded-[14px] border border-line gb-dark-surface bg-con-bg">
      <div className="flex shrink-0 items-center gap-[10px] border-b border-line bg-bg-2 px-4 py-[9px]">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-4">shell · {node}</span>
        <span className="ml-auto hidden font-mono text-[9.5px] text-ink-4 sm:inline">Shift+Tab leaves the terminal</span>
        <button
          type="button"
          onClick={toggleScreenReader}
          aria-pressed={screenReader}
          title="Build a readable copy of the output for a screen reader. Costs a little speed on a busy shell."
          className={`rounded-[7px] border px-2 py-[3px] font-mono text-[9.5px] transition-colors duration-150 hover:text-ink ${
            screenReader ? "border-accent-line text-accent-fg" : "border-line text-ink-4"
          }`}
        >
          Screen-reader mode
        </button>
        <span className="font-mono text-[9.5px] text-ink-4 tnum">{size ? `${size.cols}×${size.rows}` : ""}</span>
      </div>
      {/* A group with a name and what the keys do: Tab is the shell's (xterm keeps it), Shift+Tab is the way out, Escape is the shell's. */}
      <p id={`terminal-keys-${id}`} className="sr-only">
        Tab is sent to the shell. Shift+Tab leaves the terminal. Escape goes to the shell. Control Shift C copies the selection.
      </p>
      <div
        ref={host}
        role="group"
        aria-label={`Terminal on ${node}`}
        aria-describedby={`terminal-keys-${id}`}
        className="min-h-0 flex-1 p-2 [&_.xterm]:h-full"
      />
    </div>
  );
}
