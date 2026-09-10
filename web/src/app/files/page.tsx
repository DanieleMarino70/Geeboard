import Link from "next/link";
import { FolderClosed } from "lucide-react";
import { AppShell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { runtimeFor } from "@/domain/runtime/docker";
import { getServerBySlug, getServers } from "@/lib/queries";
import { FileBrowser } from "./file-browser";

export const dynamic = "force-dynamic";

export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<{ server?: string }>;
}) {
  const user = await requireUser();
  const { server: requested } = await searchParams;

  const all = await getServers();
  const slug = requested && all.some((s) => s.slug === requested) ? requested : all[0]?.slug;
  const server = slug ? await getServerBySlug(slug) : null;
  if (!server) return null;

  const hasAgent = runtimeFor(server.node) !== null;
  const privileged = user.role === "OWNER" || user.role === "ADMIN";
  const allowed = privileged || server.ownerId === user.id;

  return (
    <AppShell crumbs={["Ashfold", server.name, "Files"]} user={user}>
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="flex flex-col items-start gap-4 lg:flex-row lg:items-end">
          <div className="min-w-0">
            <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Files</h1>
            <p className="mt-[7px] max-w-[70ch] text-[12.5px] leading-snug text-ink-3">
              The server&apos;s own directory on {server.node.name}. Every path is resolved inside it
              — nothing here can reach the rest of the node.
            </p>
          </div>
        </div>

        {all.length > 1 && (
          <div className="inline-flex w-fit flex-wrap gap-px rounded-[9px] bg-(--border) p-px">
            {all.map((s) => (
              <Link
                key={s.id}
                href={`/files?server=${s.slug}`}
                className={`rounded-lg px-3 py-[6px] text-[11.5px] transition-colors duration-150 ${
                  s.slug === server.slug ? "bg-card-2 text-ink" : "text-ink-3 hover:text-ink-2"
                }`}
              >
                {s.name}
              </Link>
            ))}
          </div>
        )}

        {!allowed ? (
          <div className="rounded-[14px] border border-line bg-card px-6 py-[52px] text-center">
            <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-[13px] border border-dashed border-line-2 text-ink-4">
              <FolderClosed size={20} strokeWidth={1.6} />
            </div>
            <div className="text-[13.5px] font-semibold">No file access</div>
            <p className="mx-auto mt-2 max-w-[40ch] text-xs leading-relaxed text-ink-4">
              Files reach config, worlds and anything dropped on disk, so access is limited to owners
              and admins — console access alone does not include it.
            </p>
          </div>
        ) : !hasAgent ? (
          <div className="rounded-[14px] border border-warning-line bg-card px-6 py-[52px] text-center">
            <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-[13px] bg-warning-soft text-warning">
              <FolderClosed size={20} strokeWidth={1.6} />
            </div>
            <div className="text-[13.5px] font-semibold">No agent on {server.node.name}</div>
            <p className="mx-auto mt-2 max-w-[42ch] text-xs leading-relaxed text-ink-4">
              Files are read from the node itself, so there is nothing to show until an agent is
              attached. This is the one screen with no simulated fallback — inventing a filesystem
              would be worse than an empty one.
            </p>
          </div>
        ) : (
          <FileBrowser slug={server.slug} serverName={server.name} />
        )}
      </div>
    </AppShell>
  );
}
