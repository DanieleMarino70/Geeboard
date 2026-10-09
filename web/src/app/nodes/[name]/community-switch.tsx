"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { setCommunityGames } from "@/app/actions/nodes";
import { Dialog } from "@/components/dialog";
import { useToast } from "@/components/toast";
import { useAction } from "@/components/use-action";
import { Button } from "@/components/ui";

/* Letting community games run on this node, from the panel: an owner's, with a fresh code from the authenticator each
   time, and said in full before it is done. See lib/community-grant-ops.ts. */
export function CommunitySwitch({
  name,
  granted,
  declared,
  grantedBy,
  grantedAt,
  isOwner,
}: {
  name: string;
  /** Granted from the panel. */
  granted: boolean;
  /** Declared by the machine itself, which only the machine can take back. */
  declared: boolean;
  grantedBy: string | null;
  grantedAt: string | null;
  isOwner: boolean;
}) {
  const [asking, setAsking] = useState<null | boolean>(null);
  const [code, setCode] = useState("");
  const [pending, start] = useAction();
  const { push } = useToast();
  const router = useRouter();

  const submit = () =>
    start(async () => {
      const result = await setCommunityGames(name, asking === true, code);
      push(result.ok ? { tone: result.tone, title: result.title, body: result.body } : { tone: "danger", title: result.title, body: result.body });
      if (result.ok) {
        setAsking(null);
        setCode("");
        router.refresh();
      }
    });

  const on = granted || declared;

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-[10px] border border-line bg-bg-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[12.5px] font-medium">Community games</div>
          <p className="mt-[2px] text-[11.5px] leading-snug text-ink-3">
            {declared
              ? "Allowed by the machine itself (--community-games). Only the machine can take that away."
              : granted
                ? `Allowed from the panel${grantedBy ? ` by ${grantedBy}` : ""}${grantedAt ? `, ${new Date(grantedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}.`
                : "Not allowed: games an owner approved from a manifest are not placed here."}
          </p>
        </div>
        {isOwner && !declared && (
          <Button size="sm" intent={on ? "secondary" : "primary"} onClick={() => setAsking(!on)}>
            {on ? "Take back" : "Allow community games"}
          </Button>
        )}
      </div>
      {!isOwner && !declared && <p className="text-[11px] text-ink-4">Only an owner can change this.</p>}

      <Dialog
        open={asking !== null}
        onClose={() => {
          setAsking(null);
          setCode("");
        }}
        title={asking ? `Let community games run on ${name}?` : `Take community games back from ${name}?`}
        width={520}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {asking ? (
            <div className="flex gap-3 rounded-[10px] border border-warning-line bg-warning-soft p-3 text-[12px] leading-snug text-warning-fg">
              <ShieldAlert size={16} className="mt-[1px] shrink-0" />
              <div>
                Games somebody else wrote, once an owner approves them, can be placed on this node. <strong>Their images run as root in their containers</strong>{" "}
                and reach what this machine&apos;s network reaches: its SSH, the agent&apos;s port, and on a cloud machine its metadata service. Before the first one,
                run <span className="font-mono">deploy/linux/container-firewall.sh add</span> on the machine (docs: Community games, &quot;Keeping containers off the
                node itself&quot;).
              </div>
            </div>
          ) : (
            <p className="text-[12px] leading-snug text-ink-3">
              No new community game server is placed on {name}. The ones already there keep running, and can be moved or deleted as usual.
            </p>
          )}
          <label className="flex flex-col gap-[6px] text-[12px]">
            <span className="text-ink-2">A fresh code from your authenticator</span>
            <input
              data-autofocus
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              className="w-[140px] rounded-[9px] border border-control bg-bg-2 px-3 py-[9px] font-mono text-[14px] tracking-[0.2em] focus:border-accent-line"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              intent="ghost"
              size="sm"
              onClick={() => {
                setAsking(null);
                setCode("");
              }}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" intent={asking ? "destructive" : "secondary"} disabled={pending || code.length !== 6}>
              {asking ? "Allow on this node" : "Take back"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
