import Link from "next/link";
import { SquareTerminal } from "lucide-react";
import { AppShell } from "@/components/shell";
import { shellUser } from "@/lib/ui-types";
import { can } from "@/domain/access/permissions";
import { terminalDecision } from "@/domain/access/terminal";
import { requireUser } from "@/lib/auth";
import { terminalOf } from "@/lib/node-ops";
import { getNodesWithLoad } from "@/lib/queries";
import { NodeSwitcher, type SwitcherNode } from "./node-switcher";
import { TerminalView } from "./terminal-view";

export const dynamic = "force-dynamic";

/* The node terminal: a shell of a node's machine, opened from here.

   Not the console. A console is a game's stdin and stdout; this is the
   machine the agent runs on, as the account it runs as — see
   docs/nodes.md, "Node terminal". The page is drawn for everybody who
   can reach it and says plainly why nothing opens: only an owner may,
   and only on a node whose machine said yes. */

function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[14px] border border-line bg-card px-6 py-[52px] text-center">
      <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-[13px] border border-dashed border-line-2 text-ink-4">
        <SquareTerminal size={20} strokeWidth={1.6} />
      </div>
      <div className="text-[13.5px] font-semibold">{title}</div>
      <p className="mx-auto mt-2 max-w-[52ch] text-xs leading-relaxed text-ink-4">{children}</p>
    </div>
  );
}

export const metadata = { title: "Terminal" };

export default async function TerminalPage({ searchParams }: { searchParams: Promise<{ node?: string }> }) {
  const user = await requireUser();
  const { node: requested } = await searchParams;

  /* Said first, to anybody who is not an owner: what they are told must not depend on what nodes the page can list. A member
     who followed a link here saw "No nodes yet" and "Nodes → Add a node is where one starts", which is false twice (there
     are nodes, and a member cannot add one) and is not the answer to the question they came with. */
  if (!can(user, "node.terminal")) {
    return (
      <AppShell crumbs={["Terminal"]} user={shellUser(user)}>
        <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
          <div className="min-w-0">
            <h1 className="text-[clamp(21px,2.6vw,24px)] font-semibold tracking-[-0.025em]">Terminal</h1>
          </div>
          <Empty title="Owners only">
            A shell on a node&apos;s machine is something only an owner can open, and only with two-factor on. If you need
            to do something on a node, ask an owner. A game&apos;s console, which you may have, is under Servers.
          </Empty>
        </div>
      </AppShell>
    );
  }

  const all = (await getNodesWithLoad()).map((n) => ({
    ...n,
    facts: { name: n.name, approvedAt: n.approvedAt, daemonUrl: n.daemonUrl, daemonToken: n.daemonToken, daemon: n.daemon, terminal: terminalOf(n) },
  }));
  const switcher: SwitcherNode[] = all.map((n) => ({
    name: n.name,
    state: n.state,
    approved: n.approvedAt !== null,
    hasAgent: n.hasAgent,
    daemonUrl: n.daemonUrl,
    terminal: n.facts.terminal,
  }));

  /* With none asked for, the first node a shell can open on; failing
     that, the first node, whose page says why not. */
  const chosen =
    all.find((n) => n.name === requested) ??
    all.find((n) => terminalDecision(user, n.facts).ok) ??
    all[0] ??
    null;

  const header = (
    <div className="min-w-0">
      <h1 className="text-[clamp(21px,2.6vw,24px)] font-semibold tracking-[-0.025em]">Terminal</h1>
      <p className="mt-[6px] max-w-[70ch] text-[12px] leading-relaxed text-ink-4">
        A shell on a node&apos;s machine, as the account its agent runs as. Not a game&apos;s console: that is under
        Servers. Off until somebody at the machine allows it.
      </p>
    </div>
  );

  if (!chosen) {
    return (
      <AppShell crumbs={["Terminal"]} user={shellUser(user)}>
        <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
          {header}
          <Empty title="No nodes yet">
            A terminal opens on a node. <Link href="/nodes" className="text-accent-fg underline underline-offset-2">Nodes → Add a node</Link> is
            where one starts.
          </Empty>
        </div>
      </AppShell>
    );
  }

  const decision = terminalDecision(user, chosen.facts);
  const crumbs = [{ label: "Nodes", href: "/nodes" }, { label: chosen.name, href: `/nodes/${chosen.name}` }, "Terminal"];

  if (!decision.ok) {
    const owner = can(user, "node.terminal");
    return (
      <AppShell crumbs={crumbs} user={shellUser(user)}>
        <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
          {header}
          {owner && <NodeSwitcher nodes={switcher} current={chosen.name} />}
          <Empty title={owner ? `No terminal on ${chosen.name}` : "Owners only"}>
            {decision.message}
            {owner && decision.code === "terminal-off" && (
              <>
                {" "}
                <Link href="/nodes" className="text-accent-fg underline underline-offset-2">
                  The node&apos;s page
                </Link>{" "}
                says how.
              </>
            )}
          </Empty>
        </div>
      </AppShell>
    );
  }

  const shell = chosen.facts.terminal!;
  return (
    <AppShell crumbs={crumbs} user={shellUser(user)}>
      {/* Keyed on the node: switching within the page must not carry a session across. */}
      <TerminalView
        key={chosen.name}
        node={chosen.name}
        shell={{ user: shell.user, program: shell.shell, os: shell.os, scope: shell.scope }}
        navigation={<NodeSwitcher nodes={switcher} current={chosen.name} />}
      />
    </AppShell>
  );
}
