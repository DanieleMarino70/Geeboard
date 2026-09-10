"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Copy, Plus, ShieldCheck, X } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import type { OpResult } from "@/lib/server-ops";
import { useToast } from "@/components/toast";
import {
  approveNode,
  createRegistrationToken,
  rejectNode,
  revokeRegistrationToken,
} from "@/app/actions/nodes";

/* Bringing a machine into the fleet.

   Two halves, and both belong on this page because they are one job:
   mint a token, run the agent with it, and then say yes to the thing
   that turns up. The approval step is the security of the whole flow —
   a token that leaks lets somebody register a machine, and approval is
   what stops that machine becoming useful. */

export interface PendingNode {
  name: string;
  city: string;
  os: string | null;
  arch: string | null;
  capabilities: string[];
  cpuCores: number;
  ramTotal: number;
  diskTotal: number;
  daemon: string;
  registeredAt: string | null;
}

export interface TokenRow {
  id: string;
  prefix: string;
  label: string;
  expiresAt: string;
  usedAt: string | null;
  usedByNode: string | null;
  revokedAt: string | null;
}

function statusOf(token: TokenRow): { label: string; tone: "success" | "muted" | "warning" | "danger" } {
  if (token.revokedAt) return { label: "revoked", tone: "danger" };
  if (token.usedAt) return { label: `used by ${token.usedByNode ?? "a node"}`, tone: "muted" };
  if (new Date(token.expiresAt) < new Date()) return { label: "expired", tone: "warning" };
  return { label: "ready", tone: "success" };
}

export function NodeRegistration({
  pending,
  tokens,
  canManage,
}: {
  pending: PendingNode[];
  tokens: TokenRow[];
  canManage: boolean;
}) {
  const { push } = useToast();
  const router = useRouter();
  const [busy, start] = useTransition();
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!canManage) return null;

  const report = (r: { ok: boolean; title: string; body: string; tone?: "success" | "warning" }) =>
    push(
      r.ok
        ? { tone: r.tone ?? "success", title: r.title, body: r.body }
        : { tone: "danger", title: r.title, body: r.body },
    );

  const mint = () => {
    start(async () => {
      const result = await createRegistrationToken(label, 24);
      report(result);
      if (result.ok && result.secret) {
        setSecret(result.secret);
        setLabel("");
      }
      router.refresh();
    });
  };

  const act = (run: () => Promise<OpResult>) => {
    start(async () => {
      report(await run());
      router.refresh();
    });
  };

  const copy = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked; the secret is on screen to select by hand.
    }
  };

  const live = tokens.filter((t) => !t.revokedAt && !t.usedAt);

  return (
    <div className="flex flex-col gap-4">
      {/* Pending nodes come first: a machine waiting for approval is the
          one thing on this page that somebody has to act on. */}
      {pending.length > 0 && (
        <Card className="border-accent-line bg-linear-to-b from-accent-soft to-transparent p-5">
          <div className="mb-[14px] flex items-center gap-[9px]">
            <ShieldCheck size={16} strokeWidth={1.8} className="text-accent" />
            <h2 className="text-[13.5px] font-semibold">
              {pending.length} node{pending.length === 1 ? "" : "s"} waiting for approval
            </h2>
          </div>

          {pending.map((node) => (
            <div
              key={node.name}
              className="flex flex-col gap-3 border-b border-line py-3 last:border-b-0 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-[7px]">
                  <span className="font-mono text-[12.5px] font-medium">{node.name}</span>
                  <Badge tone="muted">{node.daemon}</Badge>
                </div>
                <div className="mt-1 font-mono text-[10.5px] text-ink-4">
                  {node.os ?? "unknown"} · {node.arch ?? "unknown"} · {node.cpuCores} vCPU ·{" "}
                  {node.ramTotal} GB · {node.diskTotal} GB
                </div>
                {node.capabilities.length > 0 && (
                  <div className="mt-[5px] font-mono text-[10px] text-ink-4">
                    {node.capabilities.join(" · ")}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" icon={Check} disabled={busy} onClick={() => act(() => approveNode(node.name))}>
                  Approve
                </Button>
                <Button
                  size="sm"
                  intent="destructive"
                  icon={X}
                  disabled={busy}
                  onClick={() => act(() => rejectNode(node.name))}
                >
                  Reject
                </Button>
              </div>
            </div>
          ))}

          <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
            Approving puts a node into service and makes it available for placement. Nothing is
            placed on a node until you do — a machine that registered with a token it should not
            have must not become useful by waiting.
          </p>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="mb-[10px] text-[13.5px] font-semibold">Add a node</h2>
        <p className="mb-[14px] max-w-[70ch] text-[11.5px] leading-relaxed text-ink-3">
          Mint a token, then start the agent on the machine with it. The node registers itself and
          appears above for approval. Tokens work once and expire in 24 hours.
        </p>

        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="What is this for? e.g. Milan rack 3"
            className="w-full rounded-[9px] border border-line bg-bg-2 px-3 py-[10px] text-[13px] outline-none transition-colors duration-150 placeholder:text-ink-4 hover:border-line-2 focus:border-accent-line"
          />
          <Button icon={Plus} onClick={mint} disabled={busy || label.trim().length < 2}>
            Mint token
          </Button>
        </div>

        {secret && (
          <div className="mt-4 rounded-[9px] border border-warning-line bg-warning-soft p-[14px]">
            <div className="mb-[7px] flex items-center justify-between gap-3">
              <span className="font-mono text-[10px] tracking-[0.05em] text-warning uppercase">
                Shown once
              </span>
              <button
                type="button"
                onClick={copy}
                className="inline-flex items-center gap-[5px] text-[11.5px] text-accent hover:underline"
              >
                {copied ? <Check size={12} strokeWidth={2.2} /> : <Copy size={12} strokeWidth={2} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <code className="block break-all font-mono text-[11.5px]">{secret}</code>
            <pre className="mt-3 overflow-x-auto rounded-[7px] bg-bg-2 p-3 font-mono text-[10.5px] leading-relaxed text-ink-3">
{`GEEBOARD_DAEMON_TOKEN=<32+ chars you choose> \\
GEEBOARD_NODE_NAME=mil-node-01 \\
GEEBOARD_PANEL_URL=https://panel.example.com \\
GEEBOARD_ADVERTISE_URL=http://10.0.0.5:8080 \\
GEEBOARD_REGISTRATION_TOKEN=${secret} \\
GEEBOARD_CAPABILITIES=steamcmd,java,ssd \\
npm start`}
            </pre>
          </div>
        )}

        {live.length > 0 && (
          <div className="mt-4 border-t border-line pt-3">
            {tokens.map((token) => {
              const status = statusOf(token);
              const spent = Boolean(token.usedAt || token.revokedAt);
              return (
                <div
                  key={token.id}
                  className="flex items-center gap-[10px] border-b border-line py-2 last:border-b-0"
                >
                  <span className="min-w-0 flex-1 truncate text-[11.5px]">{token.label}</span>
                  <span className="hidden font-mono text-[10px] text-ink-4 sm:block">
                    {token.prefix}
                  </span>
                  <Badge tone={status.tone}>{status.label}</Badge>
                  {!spent && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act(() => revokeRegistrationToken(token.id))}
                      className="text-[11px] text-danger hover:underline disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
