"use client";

import { CopyButton } from "./copy-button";

/* How a player connects, with one press to copy it.

   The page printed `host:port` in its header and nowhere else, the panel's own address for the machine was on the node's page and never here,
   and no address anywhere had a Copy button: an operator with no domain ended up with a server whose displayed name could not work and a panel
   that did not say what could. The name is what players are given; the node's address is what works before the name does. */
export function ConnectLine({ name, address }: { name: string; address: string | null }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2 text-[11.5px] text-ink-3">
      <span>Players connect with</span>
      <code className="rounded-[6px] border border-line bg-bg-2 px-[7px] py-[2px] font-mono text-[11.5px] text-ink-2 select-all">{name}</code>
      <CopyButton text={name} className="px-2 py-[3px] text-[11px]" />
      {address ? (
        <>
          <span>or, before that name points here,</span>
          <code className="rounded-[6px] border border-line bg-bg-2 px-[7px] py-[2px] font-mono text-[11.5px] text-ink-2 select-all">{address}</code>
          <CopyButton text={address} className="px-2 py-[3px] text-[11px]" />
        </>
      ) : null}
    </div>
  );
}
