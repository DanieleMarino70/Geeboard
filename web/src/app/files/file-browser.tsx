"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { CSSProperties, DragEvent } from "react";
import clsx from "clsx";
import {
  ChevronRight,
  Download,
  FileText,
  FolderClosed,
  FolderPlus,
  Image as ImageIcon,
  RotateCw,
  Save,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import {
  createDirectory,
  deleteEntry,
  listFiles,
  readFile,
  saveFile,
} from "@/app/actions/files";
import { Dialog } from "@/components/dialog";
import { Field, inputClass } from "@/components/form";
import { useToast } from "@/components/toast";
import { Button, Card, Label } from "@/components/ui";
import type { FileEntry } from "@/lib/daemon-client";

/** Why a folder name will not do, or null. The agent refuses the same things. */
function folderNameError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Name the folder.";
  if (trimmed.length > 128) return "Keep it to 128 characters.";
  if (/[\\/]/.test(trimmed)) return "A name, not a path — no slashes.";
  if (trimmed === "." || trimmed === "..") return "That name is reserved.";
  if (/[\0\r\n]/.test(trimmed)) return "No control characters.";
  return null;
}

const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i;
const COLS = "minmax(0,1fr) 96px 132px 104px 62px";

/* What the node accepts, from daemon/src/files.ts. Checked here as well so
   that a 400 MB world is refused in the browser rather than after it has
   been pushed across the network twice. */
const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;

/* Uploading and downloading go to the HTTP API rather than through a server
   action, and not for want of an action: a Server Action's body stops at
   1 MB, which is nothing for a modpack. The API takes the file as the
   request body, streams it to the node, and authenticates the session
   cookie this page already holds — see lib/api.ts. XHR rather than fetch,
   because fetch reports no progress while a request body is going out. */
function rawUrl(slug: string, at: string) {
  return `/api/v1/servers/${encodeURIComponent(slug)}/files/raw?path=${encodeURIComponent(at)}`;
}

function joinPath(at: string, name: string) {
  return at === "/" || at === "" ? name : `${at}/${name}`;
}

/** What the API said went wrong, or what the status code says instead. */
function messageOf(xhr: XMLHttpRequest): string {
  try {
    const body = JSON.parse(xhr.responseText) as { message?: string };
    if (body.message) return body.message;
  } catch {
    // Not JSON: a proxy or a timeout answered, not the panel.
  }
  if (xhr.status === 0) return "The connection dropped before the file was through.";
  return `The panel answered ${xhr.status}.`;
}

function putFile(slug: string, at: string, file: File, onProgress: (percent: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", rawUrl(slug, at));
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    xhr.addEventListener("load", () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(messageOf(xhr))),
    );
    xhr.addEventListener("error", () => reject(new Error(messageOf(xhr))));
    xhr.addEventListener("abort", () => reject(new Error("The upload was stopped.")));
    xhr.send(file);
  });
}

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

export function FileBrowser({
  slug,
  serverName,
  canWrite,
}: {
  slug: string;
  serverName: string;
  /** Reading and writing are separate permissions. */
  canWrite: boolean;
}) {
  /* Dialogs rather than window.prompt and window.confirm, which looked
     like the browser's and not the panel's, could not say why a name
     was refused, and asked nothing before an unsaved edit was thrown away. */
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderTried, setFolderTried] = useState(false);
  const [doomed, setDoomed] = useState<FileEntry | null>(null);
  const [discarding, setDiscarding] = useState<(() => void) | null>(null);
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

  /* Uploading: the queue that is going out, the files a drop would
     replace and is waiting to be told about, and whether a drag is over
     the listing. */
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [sending, setSending] = useState<{ name: string; done: number; total: number; percent: number } | null>(null);
  const [replacing, setReplacing] = useState<File[] | null>(null);
  const [dragging, setDragging] = useState(false);

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

  /* Anything that would close the editor asks first while it holds
     changes. */
  const guard = (then: () => void) => {
    if (dirty) setDiscarding(() => then);
    else then();
  };

  const open = (entry: FileEntry) => guard(() => openNow(entry));

  const openNow = (entry: FileEntry) => {
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

  /* One file at a time, on purpose: the node writes each upload beside
     its target and renames it into place, and three of those at once on a
     small VPS is how a disk fills while somebody watches a progress bar. */
  const sendAll = async (files: File[]) => {
    const refused: string[] = [];
    let done = 0;

    for (const file of files) {
      setSending({ name: file.name, done, total: files.length, percent: 0 });
      try {
        await putFile(slug, joinPath(path, file.name), file, (percent) =>
          setSending({ name: file.name, done, total: files.length, percent }),
        );
      } catch (error) {
        refused.push(`${file.name} — ${(error as Error).message}`);
      }
      done += 1;
    }

    setSending(null);
    load(path);

    const landed = files.length - refused.length;
    const where = path === "/" ? serverName : path;
    if (refused.length === 0) {
      push({
        tone: "success",
        title: landed === 1 ? `${files[0].name} is on the node` : `${landed} files are on the node`,
        body: `In ${where}. The game reads ${landed === 1 ? "it" : "them"} when it next starts.`,
      });
    } else {
      push({
        tone: landed > 0 ? "warning" : "danger",
        title: landed > 0 ? `${landed} of ${files.length} uploaded` : "Nothing was uploaded",
        body: refused.join(" · "),
      });
    }
  };

  /* What a picked or dropped set of files turns into: the ones that are
     too big are named rather than silently dropped, and a name already in
     this folder asks before it is written over. */
  const offer = (chosen: File[]) => {
    if (chosen.length === 0) return;

    const tooBig = chosen.filter((file) => file.size > MAX_UPLOAD_BYTES);
    const sendable = chosen.filter((file) => file.size <= MAX_UPLOAD_BYTES);
    if (tooBig.length > 0) {
      push({
        tone: "warning",
        title: tooBig.length === 1 ? `${tooBig[0].name} is too big` : `${tooBig.length} files are too big`,
        body: `The node takes ${formatSize(MAX_UPLOAD_BYTES)} at a time. A whole world goes in a backup, not here.`,
      });
    }
    if (sendable.length === 0) return;

    const clashes = sendable.filter((file) =>
      entries.some((entry) => entry.kind === "file" && entry.name === file.name),
    );
    if (clashes.length > 0) setReplacing(sendable);
    else void sendAll(sendable);
  };

  /* A dropped folder arrives as an item with no bytes, which would land
     as an empty file of the same name. The browser will say which items
     are directories; say so back rather than writing nonsense. */
  const offerDrop = (transfer: DataTransfer) => {
    const items = Array.from(transfer.items ?? []);
    const folders = items.filter(
      (item) => item.kind === "file" && item.webkitGetAsEntry?.()?.isDirectory,
    ).length;
    const files = Array.from(transfer.files).filter((file) => file.size > 0 || folders === 0);

    if (folders > 0) {
      push({
        tone: "warning",
        title: folders === 1 ? "A folder cannot be dropped" : "Folders cannot be dropped",
        body: "Make the folder here, open it, and drop the files into it.",
      });
    }
    offer(files);
  };

  const parent = path === "/" || path === "" ? null : path.split("/").slice(0, -1).join("/") || "/";

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      {/* The drop target is this wrapper rather than the Card: Card takes a
          class name and children and nothing else, and a file listing is not
          a reason to teach the design system about drag events. */}
      <div
        className="relative"
        style={{ "--files-cols": COLS } as CSSProperties}
        onDragOver={
          canWrite
            ? (event: DragEvent<HTMLDivElement>) => {
                event.preventDefault();
                setDragging(true);
              }
            : undefined
        }
        onDragLeave={
          canWrite
            ? (event: DragEvent<HTMLDivElement>) => {
                // Only when the pointer leaves the listing, not a row inside it.
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
              }
            : undefined
        }
        onDrop={
          canWrite
            ? (event: DragEvent<HTMLDivElement>) => {
                event.preventDefault();
                setDragging(false);
                offerDrop(event.dataTransfer);
              }
            : undefined
        }
      >
      <Card className={clsx("overflow-hidden", dragging && "ring-1 ring-accent-line")}>
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
            {canWrite && (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setFolderName("");
                  setFolderTried(false);
                  setFolderOpen(true);
                }}
                aria-label="New folder"
                title="New folder"
                className="grid h-[26px] w-[26px] place-items-center rounded-[7px] text-ink-4 hover:bg-card-2 hover:text-ink"
              >
                <FolderPlus size={14} strokeWidth={1.7} />
              </button>
            )}
            {canWrite && (
              <>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    offer(Array.from(event.target.files ?? []));
                    // So the same file can be picked twice in a row.
                    event.target.value = "";
                  }}
                />
                <button
                  type="button"
                  disabled={sending !== null}
                  onClick={() => fileInput.current?.click()}
                  aria-label="Upload files"
                  title={`Upload into ${path === "/" ? serverName : path} — up to ${formatSize(MAX_UPLOAD_BYTES)} each`}
                  className="grid h-[26px] w-[26px] place-items-center rounded-[7px] text-ink-4 hover:bg-card-2 hover:text-ink disabled:opacity-50"
                >
                  <Upload size={14} strokeWidth={1.7} />
                </button>
              </>
            )}
          </div>
        </div>

        {sending && (
          <div className="border-b border-line bg-bg-2 px-[18px] py-[10px]">
            <div className="flex items-center gap-2 text-[11.5px]">
              <Upload size={13} strokeWidth={1.8} className="shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate font-mono">{sending.name}</span>
              <span className="font-mono text-[10.5px] text-ink-4 tnum">
                {sending.total > 1 ? `${sending.done + 1}/${sending.total} · ` : ""}
                {sending.percent}%
              </span>
            </div>
            <div className="mt-[7px] h-[3px] overflow-hidden rounded-full bg-card-2">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-150"
                style={{ width: `${sending.percent}%` }}
              />
            </div>
          </div>
        )}

        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-bg/80 backdrop-blur-[2px]">
            <div className="flex items-center gap-[10px] rounded-[10px] border border-accent-line bg-card px-4 py-3">
              <Upload size={16} strokeWidth={1.8} className="text-accent" />
              <span className="text-[12.5px] font-medium">
                Drop to upload into {path === "/" ? serverName : path}
              </span>
            </div>
          </div>
        )}

        <div className="hidden gap-[14px] border-b border-line bg-bg-2 px-[18px] py-[10px] lg:grid lg:grid-cols-[var(--files-cols)]">
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
                  {canWrite ? "Drop files here to upload them." : "Nothing here yet."}
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
                    {/* Four columns of metadata do not fit a phone, and the
                        name is the column that was losing: `minmax(0,1fr)`
                        squeezed it to nothing while the mode string kept its
                        104px. Below lg the row is the name and its buttons,
                        with size, date and mode on a line of their own —
                        `lg:contents` dissolves that line again at the width
                        where the columns fit. */}
                    <div className="grid items-center gap-x-[14px] gap-y-1 grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[var(--files-cols)]">
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
                      <span className="order-last col-span-2 flex items-center gap-[14px] lg:contents">
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
                      </span>
                      <span className="flex items-center justify-end gap-[2px]">
                        {entry.kind === "file" && (
                          /* A link, not a fetch: the browser saves the file
                             itself, sends the session cookie, and never holds
                             256 MB in a tab to hand it back. */
                          <a
                            href={rawUrl(slug, entry.path)}
                            download={entry.name}
                            aria-label={`Download ${entry.name}`}
                            title="Download"
                            className="grid h-[26px] w-[26px] place-items-center rounded-[7px] text-ink-4 hover:bg-card-2 hover:text-ink"
                          >
                            <Download size={14} strokeWidth={1.7} />
                          </a>
                        )}
                        {canWrite && (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => setDoomed(entry)}
                            aria-label={`Delete ${entry.name}`}
                            title="Delete"
                            className="grid h-[26px] w-[26px] place-items-center rounded-[7px] text-ink-4 hover:bg-danger-soft hover:text-danger"
                          >
                            <Trash2 size={14} strokeWidth={1.7} />
                          </button>
                        )}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}
      </Card>
      </div>

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
                onClick={() => guard(() => setOpenFile(null))}
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
                readOnly={!canWrite}
                spellCheck={false}
                aria-label={`Contents of ${openFile}`}
                className="min-h-[420px] flex-1 resize-none bg-con-bg p-4 font-mono text-[11.5px] leading-[1.8] text-con-ink outline-none"
              />
            )}

            <div className="flex items-center gap-2 border-t border-line bg-bg-2 px-4 py-[10px]">
              <span className="font-mono text-[9.5px] text-ink-4">
                {!canWrite ? "read-only for you" : dirty ? "modified" : "no changes"}
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
                  disabled={!dirty || pending || truncated || !canWrite}
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

      <Dialog open={folderOpen} onClose={() => setFolderOpen(false)} title="New folder" width={440}>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setFolderTried(true);
            if (folderNameError(folderName)) return;
            const name = folderName.trim();
            const at = path === "/" ? name : `${path}/${name}`;
            run(() => createDirectory(slug, at), () => {
              setFolderOpen(false);
              load(path);
            });
          }}
          className="flex flex-col gap-5"
        >
          <Field
            label="Name"
            htmlFor="folder-name"
            hint={`Created in ${path === "/" ? serverName : path}.`}
            error={folderTried ? folderNameError(folderName) : null}
          >
            <input
              id="folder-name"
              autoFocus
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              className={inputClass(folderTried && Boolean(folderNameError(folderName)), true)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button intent="ghost" onClick={() => setFolderOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create folder"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={doomed !== null} onClose={() => setDoomed(null)} title={`Delete ${doomed?.name ?? ""}?`} width={440}>
        <p className="text-[12.5px] leading-relaxed text-ink-3">
          {doomed?.kind === "directory"
            ? "The folder and everything in it are removed from the node."
            : "The file is removed from the node."}{" "}
          This cannot be undone — a backup is the only way back.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button intent="ghost" onClick={() => setDoomed(null)} disabled={pending}>
            Cancel
          </Button>
          <Button
            intent="destructive"
            icon={Trash2}
            disabled={pending}
            onClick={() => {
              const entry = doomed;
              if (!entry) return;
              run(() => deleteEntry(slug, entry.path), () => {
                if (openFile === entry.path) setOpenFile(null);
                setDoomed(null);
                load(path);
              });
            }}
          >
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={replacing !== null}
        onClose={() => setReplacing(null)}
        title={replacing && replacing.length === 1 ? `Replace ${replacing[0].name}?` : "Replace these files?"}
        width={440}
      >
        <p className="text-[12.5px] leading-relaxed text-ink-3">
          {(replacing ?? [])
            .filter((file) => entries.some((entry) => entry.kind === "file" && entry.name === file.name))
            .map((file) => file.name)
            .join(", ")}{" "}
          {replacing && replacing.length === 1 ? "is" : "are"} already in{" "}
          <span className="font-mono">{path === "/" ? serverName : path}</span>. The file on the node
          is written over, and a running server keeps reading the old one until it restarts.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button intent="ghost" onClick={() => setReplacing(null)}>
            Cancel
          </Button>
          <Button
            icon={Upload}
            onClick={() => {
              const files = replacing ?? [];
              setReplacing(null);
              void sendAll(files);
            }}
          >
            Upload and replace
          </Button>
        </div>
      </Dialog>

      <Dialog open={discarding !== null} onClose={() => setDiscarding(null)} title="Discard your changes?" width={440}>
        <p className="text-[12.5px] leading-relaxed text-ink-3">
          <span className="font-mono">{openFile}</span> has changes that are not saved.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button intent="ghost" onClick={() => setDiscarding(null)}>
            Keep editing
          </Button>
          <Button
            intent="destructive"
            onClick={() => {
              const next = discarding;
              setDiscarding(null);
              setContent(original);
              next?.();
            }}
          >
            Discard
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
