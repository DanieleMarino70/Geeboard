"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Check, ShieldCheck, X } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import type { OpResult } from "@/lib/server-ops";
import { useToast } from "@/components/toast";
import { approveNode, rejectNode, revokeRegistrationToken } from "@/app/actions/nodes";

/* What is left of bringing a machine into the fleet once the command
   has been handed out: saying yes to what turned up, and taking back
   tokens nobody used. Minting lives in the Add a node dialog.

   The approval step is the security of the whole flow — a token that
   leaks lets somebody register a machine, and approval is what stops
   that machine becoming useful. */

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
  nodeName: string | null;
  expiresAt: string;
  usedAt: string | null;
  usedByNode: string | null;
  revokedAt: string | null;
}

function statusOf(token: TokenRow): { label: string; tone: "success" | "muted" | "warning" | "danger" } {
  if (token.revokedAt) return { label: "revoked", tone: "danger" };
  if (token.usedAt) return { label: `used by ${token.usedByNode ?? "a node"}`, tone: "muted" };
  if (new Date(token.expiresAt) < new Date()) return { label: "expired", tone: "warning" };
  return { label: "waiting", tone: "success" };
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

  if (!canManage) return null;

  const act = (run: () => Promise<OpResult>) => {
    start(async () => {
      const r = await run();
      push(
        r.ok
          ? { tone: r.tone ?? "success", title: r.title, body: r.body }
          : { tone: "danger", title: r.title, body: r.body },
      );
      router.refresh();
    });
  };

  /* Only tokens that could still register something are worth a row: a
     used or revoked one is history, and the activity log keeps it. */
  const open = tokens.filter(
    (t) => !t.revokedAt && !t.usedAt && new Date(t.expiresAt) >= new Date(),
  );

  if (pending.length === 0 && open.length === 0) return null;

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

      {open.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-[4px] text-[13.5px] font-semibold">Registration tokens</h2>
          <p className="mb-[10px] text-[11.5px] leading-relaxed text-ink-3">
            Handed out and not used yet. Each registers one named node, once, within 24 hours.
          </p>
          {open.map((token) => {
            const status = statusOf(token);
            return (
              <div
                key={token.id}
                className="flex items-center gap-[10px] border-b border-line py-2 last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">
                  {token.nodeName ?? token.label}
                </span>
                <span className="hidden font-mono text-[10px] text-ink-4 sm:block">
                  {token.prefix}
                </span>
                <Badge tone={status.tone}>{status.label}</Badge>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act(() => revokeRegistrationToken(token.id))}
                  className="text-[11px] text-danger hover:underline disabled:opacity-50"
                >
                  Revoke
                </button>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
