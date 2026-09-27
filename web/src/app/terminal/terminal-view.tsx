"use client";

import { useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { KeyRound, SquareTerminal } from "lucide-react";
import { Field, Notice, inputClass } from "@/components/form";
import { Button, Pill } from "@/components/ui";
import type { Tone } from "@/lib/ui-types";

/* The terminal page's client half: the door, then the emulator.

   The door asks for a fresh code from the authenticator and opens the
   session; only then is the emulator — and its library — loaded, so a
   page that ends at a refusal has cost nothing. */

const Emulator = dynamic(() => import("./emulator").then((m) => m.Emulator), {
  ssr: false,
  loading: () => (
    <div className="flex h-[calc(100vh-240px)] min-h-[420px] items-center justify-center rounded-[14px] border border-line bg-con-bg font-mono text-[11.5px] text-con-dim">
      loading the terminal…
    </div>
  ),
});

export interface ShellFacts {
  user: string;
  program: string;
  os: string;
  scope: "machine" | "container";
}

export type TerminalState = "closed" | "opening" | "connecting" | "live" | "reconnecting" | "ended" | "disconnected";

const PILL: Record<TerminalState, { tone: Tone; label: string; pulse: boolean }> = {
  closed: { tone: "muted", label: "Not open", pulse: false },
  opening: { tone: "muted", label: "Opening", pulse: true },
  connecting: { tone: "muted", label: "Connecting", pulse: true },
  live: { tone: "success", label: "Attached", pulse: true },
  reconnecting: { tone: "warning", label: "Reconnecting", pulse: true },
  ended: { tone: "danger", label: "Closed", pulse: false },
  disconnected: { tone: "danger", label: "Disconnected", pulse: false },
};

export function describeShell(shell: ShellFacts): string {
  const where = shell.scope === "container" ? "inside the agent's container" : `on the machine (${shell.os})`;
  return `${shell.user} · ${shell.program} · ${where}`;
}

export function TerminalView({ node, shell, navigation }: { node: string; shell: ShellFacts; navigation?: ReactNode }) {
  const [session, setSession] = useState<{ id: string; shell: ShellFacts } | null>(null);
  const [state, setState] = useState<TerminalState>("closed");
  const [ended, setEnded] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = async () => {
    setBusy(true);
    setError(null);
    setEnded(null);
    setState("opening");
    try {
      const res = await fetch(`/api/nodes/${encodeURIComponent(node)}/terminal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.trim(), cols: 100, rows: 30 }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: string; shell?: ShellFacts; title?: string; body?: string };
      if (!res.ok || !body.ok || !body.id) {
        setError([body.title, body.body].filter(Boolean).join(": ") || `The panel answered ${res.status}.`);
        setState("closed");
        return;
      }
      setCode("");
      setSession({ id: body.id, shell: body.shell ?? shell });
      setState("connecting");
    } catch {
      setError("The panel did not answer.");
      setState("closed");
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    if (!session) return;
    await fetch(`/api/terminal/${encodeURIComponent(session.id)}/close`, { method: "POST" }).catch(() => {});
  };

  const meta = PILL[state];
  const current = session?.shell ?? shell;

  return (
    <div className="flex flex-col gap-[14px] px-5 pt-[22px] pb-[26px] sm:px-8">
      <div className="flex flex-col items-start gap-4 lg:flex-row lg:items-center">
        <div className="min-w-0">
          <h1 className="text-[clamp(21px,2.6vw,24px)] font-semibold tracking-[-0.025em]">Terminal</h1>
          <div className="mt-[6px] flex flex-wrap items-center gap-[10px]">
            <span className="font-mono text-[11px] text-ink-4">
              {node} · {describeShell(current)}
            </span>
            <Pill tone={meta.tone} pulse={meta.pulse}>
              {meta.label}
            </Pill>
          </div>
        </div>
        {session && state !== "ended" && (
          <div className="flex shrink-0 flex-wrap gap-2 lg:ml-auto">
            <Button intent="secondary" size="sm" onClick={close}>
              Close terminal
            </Button>
          </div>
        )}
      </div>

      {navigation}

      {!session ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          <form
            className="flex flex-col gap-4 rounded-[14px] border border-line bg-card p-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) void open();
            }}
          >
            <div className="flex items-center gap-[10px]">
              <span className="grid h-9 w-9 place-items-center rounded-[10px] border border-accent-line bg-accent-soft text-accent">
                <KeyRound size={16} strokeWidth={1.8} />
              </span>
              <div>
                <div className="text-[13.5px] font-semibold">Open a shell on {node}</div>
                <div className="text-[11.5px] text-ink-4">A fresh code from your authenticator, every time.</div>
              </div>
            </div>
            <Field
              label="Authenticator code"
              htmlFor="terminal-code"
              hint="The current six digits — not the code you signed in with; that one is spent."
              error={error}
            >
              <input
                id="terminal-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^\d\s]/g, "").slice(0, 7))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123 456"
                className={inputClass(Boolean(error), true)}
                autoFocus
              />
            </Field>
            {ended && <Notice tone="info">{ended}</Notice>}
            <Button type="submit" icon={SquareTerminal} disabled={busy || code.replace(/\s/g, "").length !== 6}>
              {busy ? "Opening…" : "Open terminal"}
            </Button>
          </form>
          <div className="rounded-[14px] border border-line bg-card p-5 text-[12px] leading-relaxed text-ink-3">
            <div className="mb-2 text-[13px] font-semibold text-ink">What opens</div>
            <p>
              <span className="font-mono text-ink-2">{current.program}</span> as{" "}
              <span className="font-mono text-ink-2">{current.user}</span>,{" "}
              {current.scope === "container"
                ? "inside the agent's container on that machine: it sees the agent's files and the servers' data, and the host's network — not the host's own files."
                : `on the machine itself (${current.os}), with that account's rights and nothing more.`}
            </p>
            <p className="mt-2">
              The session is yours, from this sign-in: it closes when you sign out, when your role changes, when the node&apos;s
              token is rotated, after fifteen idle minutes, or after four hours. What you type and what it prints are not
              recorded anywhere; that the session opened and closed is, in the audit log.
            </p>
          </div>
        </div>
      ) : (
        <Emulator
          id={session.id}
          node={node}
          onState={setState}
          onEnded={(reason) => {
            setEnded(reason);
            setSession(null);
            setState("ended");
          }}
        />
      )}
    </div>
  );
}
