"use client";

import { BookOpen, ChevronDown } from "lucide-react";
import { useLocalFlag } from "@/components/use-local-flag";
import { Card } from "@/components/ui";
import type { ModsView } from "@/lib/mod-ops";

/* How mods work on this panel, in the order a person does it.

   The tab has two lists, a button, and a word ("Applied") that only make sense once somebody has said what happens
   between choosing a mod and the game loading it. Open until it has been closed once in this browser; the choice is
   kept there. */
export function ModGuide({ view, node }: { view: ModsView; node: string }) {
  const [closed, flip] = useLocalFlag("geeboard.mods.guide.closed", false);
  const files = view.loadOrder?.writes.map((write) => write.file) ?? [];
  const steps: Array<[string, React.ReactNode]> = [
    [
      "Find a mod",
      view.searchAvailable
        ? "Browse the Workshop on the left: popular this month first, or order and filter it. Click a mod to read its Workshop page here."
        : "Paste a Workshop link or id on the left, of a mod or a whole collection. Browsing needs a Steam Web API key, which an owner or admin sets on this tab.",
    ],
    [
      "Add it",
      "It goes on this server's list, on the right. Nothing is downloaded and nothing on the server changes yet: adding, removing, reordering and switching off are free, and can be undone.",
    ],
    view.whole
      ? [
          "Order is optional",
          "The game is given the list top to bottom. Addons rarely depend on order here; when two replace the same file, try them one at a time.",
        ]
      : [
          "Put them in order",
          "The game loads the list top to bottom, and when two mods change the same thing the one lower down wins. Libraries and frameworks go first, the mods that build on them after.",
        ],
    [
      "Apply to server",
      <>
        Writes the list into{" "}
        {files.length > 0
          ? files.map((file, i) => (
              <span key={file}>
                {i > 0 && (i === files.length - 1 ? " and " : ", ")}
                <span className="font-mono">{file}</span>
              </span>
            ))
          : "the game's settings file"}{" "}
        (a backup of the server is taken first). The preview under the list shows what will be written, exactly.
      </>,
    ],
    [
      "Restart",
      view.whole
        ? `The game downloads anything new from the Workshop on its next start, on ${node}, and mounts it. Players' games fetch the same items when they join.`
        : `The game downloads anything new from the Workshop on its next start, on ${node}. A big list can take minutes the first time.`,
    ],
    [
      "Ask the node",
      view.whole
        ? `Says which items the node has downloaded. Until then a new one shows "waiting".`
        : `Reads what the downloads actually contain: the mod ids the game loads them by${view.build ? `, and whether ${view.build.label} can load each one` : ""}. Until then a new mod shows "waiting".`,
    ],
  ];

  return (
    <Card className="p-0">
      <button
        type="button"
        onClick={flip}
        aria-expanded={!closed}
        className="flex w-full items-center gap-[10px] px-[18px] py-[13px] text-left"
      >
        <BookOpen size={15} strokeWidth={1.8} className="text-ink-3" />
        <span className="flex-1 text-[13px] font-medium">How mods work here</span>
        <ChevronDown size={15} className={`text-ink-4 transition-transform ${closed ? "" : "rotate-180"}`} />
      </button>
      {!closed && (
        <div className="border-t border-line px-[18px] pt-[12px] pb-[16px]">
          <ol className="grid gap-x-6 gap-y-[12px] md:grid-cols-2 xl:grid-cols-3">
            {steps.map(([title, body], i) => (
              <li key={title} className="flex gap-[10px]">
                <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border border-line-2 font-mono text-[10.5px] text-ink-3">
                  {i + 1}
                </span>
                <div>
                  <div className="text-[12.5px] font-medium">{title}</div>
                  <p className="mt-[3px] text-[11.5px] leading-snug text-ink-3">{body}</p>
                </div>
              </li>
            ))}
          </ol>
          {view.whole ? (
            <p className="mt-[14px] text-[11px] leading-snug text-ink-4">
              One list, of Workshop items: the server downloads and mounts each whole, and every player&apos;s game is told to fetch the
              same ones on joining. A gamemode or a map from the Workshop is chosen in the server&apos;s settings, by its name, once it
              is on this list. An addon switched off is left out of both lists; the node keeps its download, so switching it back on
              costs nothing.
            </p>
          ) : (
            <p className="mt-[14px] text-[11px] leading-snug text-ink-4">
              Two lists are written, and they are not the same thing: the Workshop items to download (numbers), and the mod ids to load
              (names, read from each download&apos;s <span className="font-mono">mod.info</span>). One item can hold several mods, and a mod
              switched off stays downloaded, so switching it back on costs nothing.
              {view.build && ` A mod tagged only for another build is added anyway (tags are the author's word); once downloaded, the node says whether ${view.build.label} loads it.`}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

/* What Apply writes, file by file, and the load order spelt out. What differs from what the game was last told is
   marked, so "Not applied" says what, not only that. */
export function LoadOrder({ view }: { view: ModsView }) {
  const order = view.loadOrder;
  if (!order || view.mods.length === 0) return null;
  const changed = order.writes.some((write) => write.text !== write.applied);
  // One file is one line of a settings file, or a short file of its own; several are named each.
  const several = new Set(order.writes.map((write) => write.file)).size > 1;

  return (
    <div className="flex flex-col gap-[10px] rounded-[12px] border border-line bg-bg-2 p-[12px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold">Load order preview</span>
        {!several && order.writes[0] && <span className="font-mono text-[10.5px] text-ink-4">{order.writes[0].file}</span>}
      </div>

      {order.order.length > 0 ? (
        <ol className="flex flex-col gap-[3px]" aria-label="The order the game loads in">
          {order.order.map(({ id, title }, i) => (
            <li key={`${id}-${i}`} className="flex items-baseline gap-2 text-[11.5px]">
              <span className="w-[22px] shrink-0 text-right font-mono text-[10px] text-ink-4">{i + 1}</span>
              <span className="font-mono">{id}</span>
              {title !== id && <span className="min-w-0 truncate text-ink-4">{title}</span>}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[11.5px] leading-snug text-ink-4">
          {view.whole
            ? "Nothing to load: every addon on the list is switched off."
            : "Nothing to load yet: the mod ids are known once the node has the downloads. Apply, restart, then Ask the node."}
        </p>
      )}

      <div className="flex flex-col gap-[4px]">
        {order.writes.map((write) => (
          <div key={write.file} className="flex flex-col gap-[3px]">
            {several && <span className="font-mono text-[10.5px] text-ink-4">{write.file}</span>}
            <pre
              className={`max-h-[180px] overflow-auto rounded-[7px] border px-[9px] py-[6px] font-mono text-[10.5px] whitespace-pre ${write.text !== write.applied ? "border-warning-line text-warning-fg" : "border-line text-ink-3"}`}
            >
              {write.text.replace(/\n$/, "")}
            </pre>
          </div>
        ))}
        {changed && (
          <p className="text-[10.5px] text-warning-fg">The marked files are not what the game was last told. Apply to server writes them.</p>
        )}
      </div>
    </div>
  );
}
