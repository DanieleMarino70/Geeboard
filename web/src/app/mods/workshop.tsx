"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Download,
  Eye,
  EyeOff,
  Layers,
  Link2,
  Loader2,
  Package,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import {
  addCollection,
  addMod,
  applyMods,
  refreshInstalled,
  removeCollection,
  removeMod,
  reorderMods,
  searchMods,
  setModEnabled,
} from "@/app/actions/mods";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, Label, Pill } from "@/components/ui";
import type { CollectionPreview, ModsView } from "@/lib/mod-ops";
import type { WorkshopItem } from "@/lib/workshop";
import { SteamKey, type KeyView } from "./steam-key";

/* Choosing mods, as a shelf rather than a text field.

   The panel could have asked for a list of numbers — that is, after all,
   exactly what it writes into the game's settings. It asks for a shelf
   instead because nobody knows a mod by its id: the Workshop is
   pictures, names and how many people run the thing, and a person
   picking mods is browsing, not typing identifiers.

   Two halves, and the split is the honest one: on the left what Steam
   has, on the right what this server has. Between them one button, which
   is the only thing here that touches the node. Everything else is a
   list that can be changed and changed back for free. */

function size(bytes: number): string {
  if (!bytes) return "—";
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.max(1, Math.round(mb))} MB`;
}

function when(epochSeconds: number): string {
  if (!epochSeconds) return "";
  const days = Math.round((Date.now() / 1000 - epochSeconds) / 86_400);
  if (days <= 0) return "updated today";
  if (days === 1) return "updated yesterday";
  if (days < 30) return `updated ${days} days ago`;
  if (days < 365) return `updated ${Math.round(days / 30)} months ago`;
  return `updated ${Math.round(days / 365)} years ago`;
}

function people(count: number): string {
  if (!count) return "";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M subscribers`;
  if (count >= 1_000) return `${Math.round(count / 1000)}k subscribers`;
  return `${count} subscribers`;
}

export function ModWorkshop({
  slug,
  node,
  view,
  canWrite,
  steamKey,
}: {
  slug: string;
  node: string;
  view: ModsView;
  canWrite: boolean;
  /** Where the Steam key comes from, for owners and admins; null for everyone else. */
  steamKey: KeyView | null;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WorkshopItem[] | null>(null);
  /** Of the results, those tagged only for another build than this server's. */
  const [offBuild, setOffBuild] = useState<Record<string, string>>({});
  const [collection, setCollection] = useState<CollectionPreview | null>(null);
  /** The collection whose mods are about to be removed, asked once before it happens. */
  const [dropping, setDropping] = useState<string | null>(null);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [working, startWork] = useTransition();
  const { push } = useToast();
  const router = useRouter();
  const firstLoad = useRef(false);
  const latestLook = useRef(0);

  const chosen = new Set(view.mods.map((mod) => mod.workshopId));

  const run = (
    what: () => Promise<{ ok: boolean; title: string; body: string; tone?: "success" | "warning" }>,
    then?: () => void,
  ) =>
    startWork(async () => {
      const result = await what();
      push(
        result.ok
          ? { tone: result.tone ?? "success", title: result.title, body: result.body }
          : { tone: "danger", title: result.title, body: result.body },
      );
      if (result.ok) then?.();
      router.refresh();
    });

  const look = (text: string, page = 1) => {
    const asked = ++latestLook.current;
    startSearch(async () => {
      const result = await searchMods(slug, text, page);
      /* Only the last question's answer is shown. The shelf fills itself
         as the tab opens, and that answer used to land after a link
         pasted in the meantime and wipe its preview. */
      if (asked !== latestLook.current) return;
      setCollection(null);
      if (!result.ok) {
        setResults([]);
        setSearchNote(`${result.title}. ${result.body}`);
        return;
      }
      if (result.collection) {
        setResults([]);
        setCollection(result.collection);
        setSearchNote(null);
        return;
      }
      setResults(result.items ?? []);
      setOffBuild(result.offBuild ?? {});
      setSearchNote(result.items && result.items.length === 0 ? "Nothing matched that." : null);
    });
  };

  /* Counted here rather than taken from the preview, so an item added
     by hand while the preview is open stops being counted as new. */
  const fresh = collection ? collection.items.filter((item) => !chosen.has(item.id)).length : 0;
  /* Of its items already here, the ones no collection claims: added on
     their own, or before a mod's collection was remembered. Adding the
     collection counts them as its own, so they can leave with it. */
  const unclaimed = new Set(view.mods.filter((mod) => !mod.collection).map((mod) => mod.workshopId));
  const adoptable = collection ? collection.items.filter((item) => unclaimed.has(item.id)).length : 0;

  /* The shelf is not empty when the page opens: an operator who has not
     typed anything still wants to see what people run. Only where this
     installation can search at all — otherwise the field is for links. */
  useEffect(() => {
    if (firstLoad.current || !view.searchAvailable) return;
    firstLoad.current = true;
    look("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.searchAvailable]);

  return (
    <div className="flex flex-col gap-4">
      {/* What is true right now, and the one button that changes the server. */}
      <Card className="flex flex-col gap-3 p-[18px] lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <span className="flex items-center gap-2 text-[13px] font-medium">
            <Package size={15} strokeWidth={1.8} className="text-ink-3" />
            {view.mods.length === 0
              ? "No mods chosen"
              : `${view.mods.length} mod${view.mods.length === 1 ? "" : "s"} chosen`}
          </span>
          {view.pending && <Pill tone="warning">Not applied</Pill>}
          {!view.pending && view.mods.length > 0 && <Pill tone="success">Applied</Pill>}
          {view.awaitingDownload > 0 && (
            <span className="font-mono text-[11px] text-ink-4">
              {view.awaitingDownload} not downloaded by {node} yet
            </span>
          )}
          {view.refused > 0 && view.build && (
            <span className="font-mono text-[11px] text-warning">
              {view.refused} will not load on {view.build.label}
            </span>
          )}
        </div>

        {canWrite && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              intent="secondary"
              size="sm"
              icon={working ? Loader2 : RefreshCw}
              disabled={working || !view.attached}
              onClick={() => run(() => refreshInstalled(slug))}
            >
              Ask the node
            </Button>
            <Button
              intent={view.pending ? "primary" : "secondary"}
              size="sm"
              icon={Upload}
              disabled={working || !view.attached}
              onClick={() => run(() => applyMods(slug))}
            >
              Apply to server
            </Button>
          </div>
        )}
      </Card>

      {view.pending && (
        <div className="rounded-[10px] border border-warning-line bg-warning-soft px-3 py-[11px] text-xs leading-snug text-warning">
          The list below is not what the server is running. <strong>Apply to server</strong> writes it
          into the game&apos;s settings — a backup is taken first — and the game reads it on its next
          start, downloading anything new as it goes.
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,1fr)]">
        {/* ── The Workshop ─────────────────────────────────────── */}
        <Card className="flex flex-col gap-4 p-[18px]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Label>The Steam Workshop</Label>
              <p className="mt-[6px] text-[12px] leading-snug text-ink-3">
                {view.searchAvailable
                  ? "Search it, or paste a link to an item or a whole collection. The game downloads what you add, on the node."
                  : steamKey
                    ? "Paste a link or id, of an item or a whole collection. Browsing needs a Steam Web API key, which you can set here."
                    : "Paste a link or id, of an item or a whole collection. Browsing needs a Steam Web API key on the panel."}
              </p>
            </div>
            <a
              href="https://steamcommunity.com/app/108600/workshop/"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-[6px] font-mono text-[11px] text-ink-4 hover:text-accent"
            >
              <Link2 size={12} strokeWidth={1.8} />
              open on Steam
            </a>
          </div>

          {steamKey && <SteamKey view={steamKey} />}

          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              look(query);
            }}
          >
            <div className="relative flex-1">
              <Search
                size={14}
                strokeWidth={1.8}
                className="pointer-events-none absolute top-1/2 left-[11px] -translate-y-1/2 text-ink-4"
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={
                  view.searchAvailable ? "Search mods, or paste a link to a mod or collection" : "Paste a Workshop link or id, of a mod or a collection"
                }
                className="w-full rounded-[10px] border border-line bg-bg-2 py-[9px] pr-3 pl-[32px] text-[12.5px] outline-none placeholder:text-ink-4 focus:border-accent-line"
              />
            </div>
            <Button size="sm" icon={searching ? Loader2 : Search} disabled={searching} type="submit">
              {view.searchAvailable ? "Search" : "Find it"}
            </Button>
          </form>

          {searchNote && <div className="text-[12px] leading-snug text-ink-4">{searchNote}</div>}

          {/* A pasted collection: what is in it, before any of it is added.
              Asked first because a collection can be hundreds of mods. They
              can be taken off again together, from the list on the right. */}
          {collection && (
            <div className="flex flex-col gap-3 rounded-[12px] border border-line bg-bg-2 p-[13px]">
              <div className="flex items-start gap-3">
                <div className="grid h-[42px] w-[42px] shrink-0 place-items-center overflow-hidden rounded-[9px] border border-line bg-card-2 text-ink-4">
                  {collection.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={collection.previewUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                  ) : (
                    <Layers size={17} strokeWidth={1.7} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold" title={collection.title}>
                    {collection.title}
                  </div>
                  <a
                    href={`https://steamcommunity.com/sharedfiles/filedetails/?id=${collection.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[10.5px] text-ink-4 hover:text-accent"
                  >
                    collection · {collection.id}
                  </a>
                </div>
              </div>

              <p className="text-[12px] leading-snug text-ink-2">
                {collection.items.length} mod{collection.items.length === 1 ? "" : "s"}:{" "}
                <strong>{fresh} new</strong>
                {collection.items.length - fresh > 0 && `, ${collection.items.length - fresh} already on this server`}.
                {collection.fromLinked > 0 &&
                  ` ${collection.fromLinked} of them only through the ${collection.linked.length === 1 ? "collection" : `${collection.linked.length} collections`} it links.`}
              </p>

              {/* What the tags say, before the download says it for certain. */}
              {collection.builds && (
                <p
                  className={`text-[12px] leading-snug ${Object.keys(collection.offBuild).length > 0 ? "text-warning" : "text-ink-3"}`}
                >
                  Tagged {collection.builds}.
                  {Object.keys(collection.offBuild).length > 0 &&
                    view.build &&
                    ` Tags are the author's, so those are added too; once downloaded, the node says whether ${view.build.label} loads them, and the ones it does not stay out of the load list.`}
                </p>
              )}

              {(collection.linked.length > 0 ||
                collection.gone > 0 ||
                collection.otherGame > 0 ||
                collection.missingLinks > 0 ||
                collection.truncated) && (
                <ul className="flex flex-col gap-[3px] font-mono text-[10.5px] leading-snug text-ink-4">
                  {collection.linked.map((link) => (
                    <li key={link.id}>
                      follows{" "}
                      <a
                        href={`https://steamcommunity.com/sharedfiles/filedetails/?id=${link.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-accent"
                      >
                        {link.title}
                      </a>
                    </li>
                  ))}
                  {collection.missingLinks > 0 && (
                    <li>{collection.missingLinks} linked collection{collection.missingLinks === 1 ? " is" : "s are"} gone from Steam</li>
                  )}
                  {collection.gone > 0 && <li>{collection.gone} no longer on Steam, left out</li>}
                  {collection.otherGame > 0 && <li>{collection.otherGame} for another game, left out</li>}
                  {collection.truncated && <li className="text-warning">larger than the panel adds at once: only the first {collection.items.length}</li>}
                </ul>
              )}

              <ol className="flex max-h-[340px] flex-col gap-[5px] overflow-y-auto pr-1">
                {collection.items.map((item, index) => {
                  const here = chosen.has(item.id);
                  return (
                    <li key={item.id} className="flex items-center gap-[10px] rounded-[9px] border border-line bg-card px-[9px] py-[6px]">
                      <span className="w-[26px] shrink-0 text-right font-mono text-[10px] text-ink-4">{index + 1}</span>
                      <div className="h-[26px] w-[26px] shrink-0 overflow-hidden rounded-[6px] bg-card-2">
                        {item.previewUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.previewUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                        )}
                      </div>
                      <span className={`min-w-0 flex-1 truncate text-[12px] ${here ? "text-ink-4" : ""}`} title={item.title}>
                        {item.title}
                      </span>
                      {collection.offBuild[item.id] && <Badge tone="warning">{collection.offBuild[item.id]}</Badge>}
                      {here ? (
                        <span className="flex shrink-0 items-center gap-[4px] text-[11px] text-success">
                          <Check size={12} strokeWidth={2} /> here
                        </span>
                      ) : (
                        <span className="shrink-0 font-mono text-[10.5px] text-ink-4">{size(item.sizeBytes)}</span>
                      )}
                    </li>
                  );
                })}
              </ol>

              <div className="flex flex-wrap items-center gap-2">
                {canWrite && (
                  <Button
                    size="sm"
                    icon={working ? Loader2 : fresh === 0 ? Layers : Download}
                    disabled={working || (fresh === 0 && adoptable === 0)}
                    onClick={() => run(() => addCollection(slug, collection.id), () => setCollection(null))}
                  >
                    {fresh > 0
                      ? `Add ${fresh} to this server`
                      : adoptable > 0
                        ? `Count the ${adoptable} here as this collection's`
                        : "Nothing new to add"}
                  </Button>
                )}
                <button type="button" onClick={() => setCollection(null)} className="text-[11.5px] text-ink-4 hover:text-ink">
                  Close
                </button>
              </div>
              <p className="text-[11px] leading-snug text-ink-4">
                New ones go after what this server has now, in the collection&apos;s order; nothing already here
                moves or is switched back on. They are chosen, not installed, until the list is applied. The
                ones it adds are remembered as this collection&apos;s, and can be removed with it in one go.
              </p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {(results ?? []).map((item) => {
              const already = chosen.has(item.id);
              return (
                <div
                  key={item.id}
                  className="flex flex-col overflow-hidden rounded-[12px] border border-line bg-bg-2 transition-[border-color,transform] duration-200 hover:-translate-y-[2px] hover:border-line-2"
                >
                  {/* Steam's own preview, fetched by the browser. The panel
                      never holds it: it has no business storing somebody
                      else's artwork, and the page reads fine without it. */}
                  <div className="aspect-[16/9] w-full bg-card-2">
                    {item.previewUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.previewUrl}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>

                  <div className="flex flex-1 flex-col gap-[10px] p-[13px]">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold" title={item.title}>
                        {item.title}
                      </div>
                      <p className="mt-[5px] line-clamp-2 text-[11.5px] leading-snug text-ink-3">{item.summary}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px] text-ink-4">
                      <span>{size(item.sizeBytes)}</span>
                      {item.subscriptions > 0 && <span>{people(item.subscriptions)}</span>}
                      {item.updatedAt > 0 && <span>{when(item.updatedAt)}</span>}
                    </div>

                    {(item.tags.length > 0 || offBuild[item.id]) && (
                      <div className="flex flex-wrap gap-[5px]">
                        {offBuild[item.id] && view.build && (
                          <Badge tone="warning">
                            {offBuild[item.id]} · this is {view.build.label}
                          </Badge>
                        )}
                        {item.tags.slice(0, 3).map((tag) => (
                          <Badge key={tag} tone="muted">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}

                    <div className="mt-auto flex items-center justify-between pt-1">
                      <a
                        href={`https://steamcommunity.com/sharedfiles/filedetails/?id=${item.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-[10.5px] text-ink-4 hover:text-accent"
                      >
                        {item.id}
                      </a>
                      {already ? (
                        <span className="flex items-center gap-[5px] text-[11.5px] text-success">
                          <Check size={13} strokeWidth={2} /> on this server
                        </span>
                      ) : (
                        canWrite && (
                          <Button
                            size="sm"
                            intent="secondary"
                            icon={Download}
                            disabled={working}
                            onClick={() => run(() => addMod(slug, item.id))}
                          >
                            Add
                          </Button>
                        )
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {results === null && !searching && (
            <div className="rounded-[12px] border border-dashed border-line-2 px-4 py-9 text-center text-[12px] text-ink-4">
              {view.searchAvailable ? "Searching the Workshop…" : "Nothing searched yet."}
            </div>
          )}
        </Card>

        {/* ── This server's list ───────────────────────────────── */}
        <Card className="flex flex-col gap-3 p-[18px]">
          <div>
            <Label>On this server</Label>
            <p className="mt-[6px] text-[12px] leading-snug text-ink-3">
              In load order: the last one wins a conflict. A mod switched off stays downloaded.
            </p>
          </div>

          {/* A collection arrives in one click with hundreds of mods; it
              leaves the same way, taking only what it brought. */}
          {view.collections.length > 0 && (
            <div className="flex flex-col gap-[7px] rounded-[12px] border border-line bg-bg-2 p-[11px]">
              {view.collections.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-2 text-[12px]">
                  <Layers size={13} strokeWidth={1.9} className="shrink-0 text-ink-4" />
                  <span className="min-w-0 flex-1 truncate" title={c.title}>
                    {c.title}
                  </span>
                  <span className="font-mono text-[10.5px] text-ink-4">
                    {c.count} mod{c.count === 1 ? "" : "s"} it added
                  </span>
                  {canWrite &&
                    (dropping === c.id ? (
                      <>
                        <Button
                          size="sm"
                          intent="destructive"
                          disabled={working}
                          onClick={() => run(() => removeCollection(slug, c.id), () => setDropping(null))}
                        >
                          Remove {c.count === 1 ? "it" : `all ${c.count}`}
                        </Button>
                        <button
                          type="button"
                          onClick={() => setDropping(null)}
                          className="text-[11.5px] text-ink-3 hover:text-ink-2"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <Button size="sm" intent="ghost" icon={Trash2} disabled={working} onClick={() => setDropping(c.id)}>
                        Remove its mods
                      </Button>
                    ))}
                </div>
              ))}
            </div>
          )}

          {view.mods.length === 0 ? (
            <div className="rounded-[12px] border border-dashed border-line-2 px-4 py-9 text-center text-[12px] text-ink-4">
              Nothing yet. Add one from the Workshop.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {view.mods.map((mod, index) => (
                <li
                  key={mod.workshopId}
                  className="flex items-start gap-[11px] rounded-[12px] border border-line bg-bg-2 p-[11px]"
                >
                  <div className="h-[42px] w-[42px] shrink-0 overflow-hidden rounded-[9px] border border-line bg-card-2">
                    {mod.previewUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={mod.previewUrl}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`truncate text-[12.5px] font-medium ${mod.enabled ? "" : "text-ink-4 line-through"}`}>
                        {mod.title}
                      </span>
                      {!mod.downloaded && <Pill tone="info">waiting</Pill>}
                      {mod.loads.length === 0 && mod.refused.length > 0 && view.build && (
                        <Pill tone="warning">will not load</Pill>
                      )}
                    </div>
                    <div className="mt-[3px] truncate font-mono text-[10.5px] text-ink-4">
                      {mod.loads.length > 0
                        ? mod.loads.join(", ")
                        : mod.downloaded
                          ? mod.modIds.join(", ") || mod.workshopId
                          : `${mod.workshopId} · ${size(mod.sizeBytes)}`}
                    </div>
                    {mod.collection && (
                      <div className="mt-[2px] truncate text-[10.5px] text-ink-4">from {mod.collection.title}</div>
                    )}
                    {/* What the author says it needs, before the game finds out it is missing. */}
                    {mod.missing && mod.missing.length > 0 && (
                      <div className="mt-[3px] flex flex-wrap items-center gap-x-2 gap-y-[2px] text-[11px] leading-snug text-warning">
                        <span>Its Workshop page lists as required, not on this list:</span>
                        {mod.missing.map((need) => (
                          <span key={need.id} className="inline-flex items-center gap-[6px]">
                            <a
                              href={`https://steamcommunity.com/sharedfiles/filedetails/?id=${need.id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="underline-offset-2 hover:underline"
                            >
                              {need.title}
                            </a>
                            {canWrite && (
                              <button
                                type="button"
                                disabled={working}
                                onClick={() => run(() => addMod(slug, need.id))}
                                className="text-accent hover:underline disabled:opacity-50"
                              >
                                add it
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                    {/* What this build will not load, and why — the game would only say "not found" in its log. */}
                    {mod.refused.map((refusal) => (
                      <p key={refusal.id} className="mt-[3px] text-[11px] leading-snug text-warning">
                        {mod.loads.length > 0 && <span className="font-mono">{refusal.id}: </span>}
                        {refusal.reason}
                      </p>
                    ))}
                    {!mod.enabled && mod.pulledInBy.length > 0 && (
                      <p className="mt-[3px] text-[11px] leading-snug text-warning">
                        Switched off, and loaded anyway: {mod.pulledInBy.join(", ")} {mod.pulledInBy.length === 1 ? "requires" : "require"} it,
                        and the game loads what is required whether it is listed or not.
                      </p>
                    )}
                  </div>

                  {canWrite && (
                    <div className="flex shrink-0 items-center gap-[2px]">
                      <Button
                        intent="ghost"
                        size="sm"
                        icon={ArrowUp}
                        aria-label="Move up"
                        disabled={working || index === 0}
                        onClick={() => {
                          const order = view.mods.map((m) => m.workshopId);
                          [order[index - 1], order[index]] = [order[index]!, order[index - 1]!];
                          run(() => reorderMods(slug, order));
                        }}
                      />
                      <Button
                        intent="ghost"
                        size="sm"
                        icon={ArrowDown}
                        aria-label="Move down"
                        disabled={working || index === view.mods.length - 1}
                        onClick={() => {
                          const order = view.mods.map((m) => m.workshopId);
                          [order[index], order[index + 1]] = [order[index + 1]!, order[index]!];
                          run(() => reorderMods(slug, order));
                        }}
                      />
                      <Button
                        intent="ghost"
                        size="sm"
                        icon={mod.enabled ? Eye : EyeOff}
                        aria-label={mod.enabled ? "Stop loading it" : "Load it"}
                        disabled={working}
                        onClick={() => run(() => setModEnabled(slug, mod.workshopId, !mod.enabled))}
                      />
                      <Button
                        intent="ghost"
                        size="sm"
                        icon={Trash2}
                        aria-label="Remove"
                        disabled={working}
                        onClick={() => run(() => removeMod(slug, mod.workshopId))}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {view.mods.length > 0 && (
            <p className="text-[11.5px] leading-snug text-ink-4">
              A mod the node has not downloaded yet shows its Workshop id; once the game has fetched
              it, this shows the ids it is loaded by — read from the files on {node}, not guessed.
              {view.build &&
                ` A mod ${view.build.label} will not load stays out of the load list, and says why.`}
              {view.searchAvailable
                ? " What each one's Workshop page lists as required is asked of Steam when it is added and when the node is asked."
                : " Without a Steam key, what a mod's Workshop page lists as required is not known here; the node still finds a missing one once the game has the files."}
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
