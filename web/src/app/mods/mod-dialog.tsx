"use client";

import { useEffect, useState } from "react";
import { Check, Download, ExternalLink, Loader2, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import { modPage } from "@/app/actions/mods";
import { Dialog } from "@/components/dialog";
import { Badge, Button } from "@/components/ui";
import type { Block, Span } from "@/domain/games/bbcode";
import type { ModPageResult } from "@/lib/mod-ops";

/* A mod's Workshop page, inside the panel.

   What the Workshop says about an item, read by the server (lib/workshop.ts) and handed over as text: the description is
   blocks, never markup (domain/games/bbcode.ts), images are Steam's own previews, and a link in it opens Steam in a new
   tab. Adding or removing it from here is the same operation as the button on its card. */

function size(bytes: number): string {
  if (!bytes) return "—";
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.max(1, Math.round(mb))} MB`;
}

function count(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 100) / 10}k`;
  return String(n);
}

function day(epochSeconds: number): string {
  if (!epochSeconds) return "—";
  return new Date(epochSeconds * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function Spans({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((span, i) => {
        const className = [
          span.bold && "font-semibold text-ink",
          span.italic && "italic",
          span.underline && "underline",
          span.strike && "line-through",
        ]
          .filter(Boolean)
          .join(" ");
        return span.href ? (
          <a key={i} href={span.href} target="_blank" rel="noreferrer noopener" className={`text-accent-fg underline underline-offset-2 ${className}`}>
            {span.text}
          </a>
        ) : (
          <span key={i} className={className || undefined}>
            {span.text}
          </span>
        );
      })}
    </>
  );
}

export function Description({ blocks }: { blocks: Block[] }) {
  if (blocks.length === 0) return <p className="text-[12px] text-ink-4">Its author wrote no description.</p>;
  return (
    <div className="flex flex-col gap-[10px] text-[12.5px] leading-relaxed whitespace-pre-line text-ink-2">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "heading":
            return (
              <h4 key={i} className={`mt-1 font-semibold text-ink ${block.level === 1 ? "text-[14.5px]" : "text-[13px]"}`}>
                <Spans spans={block.spans} />
              </h4>
            );
          case "paragraph":
            return (
              <p key={i}>
                <Spans spans={block.spans} />
              </p>
            );
          case "quote":
            return (
              <blockquote key={i} className="border-l-2 border-line-2 pl-3 text-ink-3">
                <Spans spans={block.spans} />
              </blockquote>
            );
          case "list": {
            const List = block.ordered ? "ol" : "ul";
            return (
              <List key={i} className={`flex flex-col gap-[3px] pl-5 ${block.ordered ? "list-decimal" : "list-disc"}`}>
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Spans spans={item} />
                  </li>
                ))}
              </List>
            );
          }
          case "code":
            return (
              <pre key={i} className="overflow-x-auto rounded-[8px] border border-line bg-bg-2 p-3 font-mono text-[11px] whitespace-pre text-ink-3">
                {block.text}
              </pre>
            );
          case "rule":
            return <hr key={i} className="border-line" />;
        }
      })}
    </div>
  );
}

export function ModDialog({
  slug,
  workshopId,
  onClose,
  canWrite,
  working,
  onAdd,
  onRemove,
  buildLabel,
  isChosen,
}: {
  /** Whether an id is on this server's list now: read from the page, so an add from here shows at once. */
  isChosen: (id: string) => boolean;
  slug: string;
  /** The item to show; null keeps the dialog closed. */
  workshopId: string | null;
  onClose: () => void;
  canWrite: boolean;
  working: boolean;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  buildLabel: string | null;
}) {
  const [result, setResult] = useState<{ id: string; value: ModPageResult } | null>(null);
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    if (!workshopId) return;
    let live = true;
    modPage(slug, workshopId).then((value) => {
      if (live) setResult({ id: workshopId, value });
    });
    return () => {
      live = false;
    };
  }, [slug, workshopId]);

  const loaded = result && result.id === workshopId ? result.value : null;
  const page = loaded?.ok ? loaded : null;
  const title = page ? page.page.title : loaded && !loaded.ok ? loaded.title : "Workshop item";
  const images = page ? [page.page.previewUrl, ...page.page.screenshots].filter((u): u is string => Boolean(u)) : [];
  const big = shown && images.includes(shown) ? shown : (images[0] ?? null);

  return (
    <Dialog open={workshopId !== null} onClose={onClose} title={title} width={760} description={workshopId ? `Workshop item ${workshopId}` : undefined}>
      {!loaded ? (
        <div className="flex items-center gap-2 py-10 text-[12px] text-ink-4">
          <Loader2 size={14} className="animate-spin" /> Asking Steam…
        </div>
      ) : !loaded.ok ? (
        <p className="text-[12.5px] text-ink-3">{loaded.body}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {big && (
            <div className="flex flex-col gap-2">
              <div className="aspect-[16/9] w-full overflow-hidden rounded-[10px] border border-line bg-card-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={big} alt="" referrerPolicy="no-referrer" className="h-full w-full object-contain" />
              </div>
              {images.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1" role="list" aria-label="Screenshots">
                  {images.map((url) => (
                    <button
                      key={url}
                      type="button"
                      role="listitem"
                      aria-label="Show this screenshot"
                      onClick={() => setShown(url)}
                      className={`h-[54px] w-[96px] shrink-0 overflow-hidden rounded-[7px] border ${url === big ? "border-accent-line" : "border-line"}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-[10px] sm:grid-cols-4">
            {[
              ["Subscribers", count(page!.page.subscriptions)],
              ["Favourites", count(page!.page.favorited)],
              ["Views", count(page!.page.views)],
              ["Size", size(page!.page.sizeBytes)],
              ["Published", day(page!.page.createdAt)],
              ["Updated", day(page!.page.updatedAt)],
              ...(page!.page.votes
                ? [["Votes", `${count(page!.page.votes.up)} up · ${count(page!.page.votes.down)} down`] as [string, string]]
                : []),
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="font-mono text-[10px] tracking-[0.04em] text-ink-4 uppercase">{label}</dt>
                <dd className="mt-[2px] flex items-center gap-1 text-[12.5px] font-medium">
                  {label === "Votes" && <ThumbsUp size={12} className="text-ink-4" />}
                  {value}
                  {label === "Votes" && <ThumbsDown size={12} className="text-ink-4" />}
                </dd>
              </div>
            ))}
          </dl>

          {(page!.page.tags.length > 0 || page!.offBuild || page!.otherGame) && (
            <div className="flex flex-wrap gap-[5px]">
              {page!.otherGame && <Badge tone="danger">for another game</Badge>}
              {page!.offBuild && buildLabel && (
                <Badge tone="warning">
                  {page!.offBuild} · this is {buildLabel}
                </Badge>
              )}
              {page!.page.tags.map((tag) => (
                <Badge key={tag} tone="muted">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          {page!.requires && page!.requires.length > 0 && (
            <div className="rounded-[10px] border border-line bg-bg-2 p-3">
              <div className="text-[12px] font-semibold">Its page lists as required</div>
              <ul className="mt-2 flex flex-col gap-[5px]">
                {page!.requires.map((need) => (
                  <li key={need.id} className="flex items-center gap-2 text-[12px]">
                    <span className="min-w-0 flex-1 truncate">{need.title}</span>
                    {isChosen(need.id) ? (
                      <span className="flex items-center gap-1 text-[11px] text-success-fg">
                        <Check size={12} /> on this server
                      </span>
                    ) : (
                      canWrite && (
                        <button type="button" disabled={working} onClick={() => onAdd(need.id)} className="text-[11.5px] text-accent-fg hover:underline disabled:opacity-50">
                          add it
                        </button>
                      )
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="max-h-[42vh] overflow-y-auto rounded-[10px] border border-line p-4" tabIndex={0} aria-label="Description">
            <Description blocks={page!.blocks} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
            <a
              href={`https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`}
              target="_blank"
              rel="noreferrer noopener"
              className="flex items-center gap-[6px] text-[12px] text-ink-3 hover:text-accent-fg"
            >
              <ExternalLink size={13} /> Open on Steam
            </a>
            {canWrite &&
              (isChosen(workshopId!) ? (
                <Button intent="secondary" size="sm" icon={Trash2} disabled={working} onClick={() => onRemove(workshopId!)}>
                  Remove from this server
                </Button>
              ) : (
                <Button size="sm" icon={working ? Loader2 : Download} disabled={working || page!.otherGame} onClick={() => onAdd(workshopId!)}>
                  Add to this server
                </Button>
              ))}
          </div>
        </div>
      )}
    </Dialog>
  );
}
