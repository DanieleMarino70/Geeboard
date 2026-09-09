"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import clsx from "clsx";
import {
  ChevronRight,
  FileText,
  FolderClosed,
  FolderPlus,
  Image as ImageIcon,
  RotateCw,
  Save,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  createDirectory,
  deleteEntry,
  listFiles,
  readFile,
  saveFile,
} from "@/app/actions/files";
import { useToast } from "@/components/toast";
import { Card, Label } from "@/components/ui";
import type { FileEntry } from "@/lib/daemon-client";

const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i;
const COLS = "minmax(0,1fr) 96px 132px 104px 34px";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function crumbsFor(at: string) {
  const parts = at.split("/").filter(Boolean);
  return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join("/") }));
}

export function FileBrowser({ slug, serverName }: { slug: string; serverName: string }) {
  const [path, setPath] = useState("/");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [openFile, setOpenFile] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [truncated, setTruncated] = useState(false);

  const [pending, startTransition] = useTransition();
  const [navigating, startNavigation] = useTransition();
  const { push } = useToast();

  const dirty = openFile !== null && content !== original;

  /* Reading a directory runs as a transition: the pending flag comes
     from React rather than a state write, which keeps the initial load
     out of an effect that sets state synchronously. */
  const load = useCallback(
    (at: string) => {
      startNavigation(async () => {
        const result = await listFiles(slug, at);
        setEntries(result.entries);
        setListError(result.ok ? null : (result.error ?? "could not read that directory"));
        setPath(result.path);
        setLoading(false);
      });
    },
    [slug],
  );

  useEffect(() => load("/"), [load]);

  const open = (entry: FileEntry) => {
    if (entry.kind === "directory") {
      setOpenFile(null);
      load(entry.path);
      return;
    }
    if (entry.kind !== "file") return;

    void readFile(slug, entry.path).then((result) => {
      if (!result.ok) {
        push({ tone: "danger", title: "Cannot open", body: result.error ?? "unreadable" });
        return;
      }
      setOpenFile(entry.path);
      setContent(result.content);
      setOriginal(result.content);
      setTruncated(result.truncated);
    });
  };

  const run = (fn: () => Promise<Awaited<ReturnType<typeof saveFile>>>, after?: () => void) =>
    startTransition(async () => {
      const r = await fn();
      push(
        r.ok
          ? { tone: r.tone, title: r.title, body: r.body }
          : { tone: "danger", title: r.title, body: r.body },
      );
      if (r.ok) after?.();
    });

  const parent = path === "/" || path === "" ? null : path.split("/").slice(0, -1).join("/") || "/";

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-[10px] border-b border-line px-[18px] py-[13px]">
          <nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center gap-[6px]">
            <button
              type="button"
              onClick={() => load("/")}
              className={clsx(
                "text-[11.5px]",
                path === "/" ? "font-medium text-ink" : "text-ink-3 hover:text-accent",
              )}
            >
              {serverName}
            </button>
            {crumbsFor(path).map((c, i, all) => (
              <span key={c.path} className="flex items-center gap-[6px]">
                <ChevronRight size={12} strokeWidth={2} className="text-ink-4" />
                <button
                  type="button"
                  onClick={() => load(c.path)}
                  className={clsx(
                    "truncate font-mono text-[11.5px]",
                    i === all.length - 1 ? "font-medium text-ink" : "text-ink-3 hover:text-accent",
                  )}
                >
                  {c.name}
                </button>
              </span>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => load(path)}
              aria-label="Refresh"
              title="Refresh"
              className="grid h-[26px] w-[26px] place-items-center rounded-[7px] text-ink-4 hover:bg-card-2 hover:text-ink"
            >
              <RotateCw size={14} strokeWidth={1.7} />
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                const name = window.prompt("New folder name");
                if (!name) return;
                const at = path === "/" ? name : `${path}/${name}`;
                run(() => createDirectory(slug, at), () => load(path));
              }}
              aria-label="New folder"
              title="New folder"
              className="grid h-[26px] w-[26px] place-items-center rounded-[7px] text-ink-4 hover:bg-card-2 hover:text-ink"
            >
              <FolderPlus size={14} strokeWidth={1.7} />
            </button>
          </div>
        </div>

        <div
          className="hidden gap-[14px] border-b border-line bg-bg-2 px-[18px] py-[10px] lg:grid"
          style={{ gridTemplateColumns: COLS }}
        >
          {["Name", "Size", "Modified", "Mode", ""].map((h, i) => (
            <Label key={h || i}>{h}</Label>
          ))}
        </div>

        {listError ? (
          <div className="flex items-start gap-[10px] px-[18px] py-6">
            <TriangleAlert size={15} strokeWidth={1.9} className="mt-px shrink-0 text-danger" />
            <div>
              <div className="text-[12.5px] font-semibold text-danger">Cannot read this directory</div>
              <p className="mt-1 text-[11.5px] leading-snug text-ink-3">{listError}</p>
            </div>
          </div>
        ) : loading || navigating ? (
          <div className="px-[18px] py-8 text-center text-[11.5px] text-ink-4">Reading…</div>
        ) : (
          <>
            {parent !== null && (
              <button
                type="button"
                onClick={() => load(parent)}
                className="flex w-full items-center gap-[10px] border-b border-line px-[18px] py-[10px] text-left hover:bg-card-2"
              >
                <FolderClosed size={15} strokeWidth={1.7} className="text-ink-4" />
                <span className="font-mono text-[12px] text-ink-3">..</span>
              </button>
            )}

            {entries.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <div className="text-[13px] font-semibold">This folder is empty</div>
                <p className="mx-auto mt-2 max-w-[34ch] text-[11.5px] leading-relaxed text-ink-4">
                  Nothing here yet.
                </p>
              </div>
            ) : (
              entries.map((entry, i) => {
                const Icon =
                  entry.kind === "directory"
                    ? FolderClosed
                    : IMAGE.test(entry.name)
                      ? ImageIcon
                      : FileText;
                const isOpen = openFile === entry.path;
                return (
                  <div
                    key={entry.path}
                    className={clsx(
                      "px-[18px] py-[11px] transition-colors duration-150",
                      isOpen ? "bg-accent-soft" : "hover:bg-card-2",
                      i < entries.length - 1 && "border-b border-line",
                    )}
                  >
                    <div
                      className="grid items-center gap-x-[14px] gap-y-1"
                      style={{ gridTemplateColumns: COLS }}
                    >
                      <button
                        type="button"
                        onClick={() => open(entry)}
                        className="flex min-w-0 items-center gap-[10px] text-left"
                      >
                        <Icon
                          size={15}
                          strokeWidth={1.7}
                          className={entry.kind === "directory" ? "text-accent" : "text-ink-4"}
                        />
                        <span className="truncate font-mono text-[12px]">{entry.name}</span>
                      </button>
                      <span className="font-mono text-[10.5px] text-ink-4 tnum">
                        {entry.kind === "directory" ? "—" : formatSize(entry.sizeBytes)}
                      </span>
                      <span className="text-[10.5px] text-ink-4">
                        {new Date(entry.modifiedAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span className="font-mono text-[10.5px] text-ink-4">{entry.mode}</span>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          if (!window.confirm(`Delete ${entry.name}? This cannot be undone.`)) return;
                          run(() => deleteEntry(slug, entry.path), () => {
                            if (openFile === entry.path) setOpenFile(null);
                            load(path);
                          });
                        }}
                        aria-label={`Delete ${entry.name}`}
                        title="Delete"
                        className="grid h-[26px] w-[26px] place-items-center justify-self-end rounded-[7px] text-ink-4 hover:bg-danger-soft hover:text-danger"
                      >
                        <Trash2 size={14} strokeWidth={1.7} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}
      </Card>

      <Card className="flex min-h-0 flex-col overflow-hidden">
        {openFile === null ? (
          <div className="grid flex-1 place-items-center px-6 py-16 text-center">
            <p className="max-w-[32ch] text-[11.5px] leading-relaxed text-ink-4">
              Select a file to read or edit it. Anything over 2 MB opens read-only.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-[10px] border-b border-line bg-bg-2 px-4 py-[10px]">
              <FileText size={14} strokeWidth={1.7} className="text-ink-4" />
              <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{openFile}</span>
              {dirty && <span className="font-mono text-[9.5px] text-warning">unsaved</span>}
              <button
                type="button"
                onClick={() => setOpenFile(null)}
                className="text-[11px] text-ink-4 hover:text-ink"
              >
                Close
              </button>
            </div>

            {truncated ? (
              <div className="grid flex-1 place-items-center px-6 py-16 text-center">
                <div>
                  <div className="text-[13px] font-semibold">Too large to edit here</div>
                  <p className="mx-auto mt-2 max-w-[34ch] text-[11.5px] leading-relaxed text-ink-4">
                    This file is over 2 MB. Editing it in a browser textarea would not end well.
                  </p>
                </div>
              </div>
            ) : (
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
                aria-label={`Contents of ${openFile}`}
                className="min-h-[420px] flex-1 resize-none bg-con-bg p-4 font-mono text-[11.5px] leading-[1.8] text-con-ink outline-none"
              />
            )}

            <div className="flex items-center gap-2 border-t border-line bg-bg-2 px-4 py-[10px]">
              <span className="font-mono text-[9.5px] text-ink-4">
                {dirty ? "modified" : "no changes"}
              </span>
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  disabled={!dirty || pending}
                  onClick={() => setContent(original)}
                  className="rounded-lg px-3 py-[6px] text-xs text-ink-3 hover:bg-card-2 hover:text-ink disabled:pointer-events-none disabled:opacity-45"
                >
                  Revert
                </button>
                <button
                  type="button"
                  disabled={!dirty || pending || truncated}
                  onClick={() =>
                    run(
                      () => saveFile(slug, openFile, content),
                      () => {
                        setOriginal(content);
                        load(path);
                      },
                    )
                  }
                  className="inline-flex items-center gap-[7px] rounded-lg bg-accent px-3 py-[6px] text-xs font-semibold text-accent-ink hover:brightness-110 disabled:pointer-events-none disabled:opacity-45"
                >
                  <Save size={13} strokeWidth={1.9} />
                  Save
                </button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
