"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import clsx from "clsx";
import { Archive, Play, RotateCw, Square, Terminal } from "lucide-react";
import {
  createBackup,
  restartServer,
  startServer,
  stopServer,
  type ActionResult,
} from "@/app/actions/servers";
import type { ServerAllowance } from "@/domain/access/permissions";
import { useToast } from "./toast";
import { Button } from "./ui";

type Kind = "start" | "stop" | "restart" | "backup";

const RUN: Record<Kind, (slug: string) => Promise<ActionResult>> = {
  start: startServer,
  stop: stopServer,
  restart: restartServer,
  backup: createBackup,
};

/* A transition finishes on the server well before the simulated daemon
   settles the state, so refresh once more when it should have landed. */
const SETTLE_MS: Partial<Record<Kind, number>> = { start: 6500, restart: 6500, stop: 4000 };

function useRunAction(slug: string) {
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  const run = (kind: Kind) => {
    startTransition(async () => {
      const result = await RUN[kind](slug);
      if (result.ok) {
        push({ tone: result.tone, title: result.title, body: result.body });
        const delay = SETTLE_MS[kind];
        if (delay) setTimeout(() => router.refresh(), delay);
      } else {
        push({ tone: "danger", title: result.title, body: result.body });
      }
      router.refresh();
    });
  };

  return { run, pending };
}

/* Full-size controls for the server detail and console headers. */
export function ServerControls({
  slug,
  running,
  allow,
  size = "md",
}: {
  slug: string;
  running: boolean;
  /** What this viewer may do here — a control they may not use is not drawn. */
  allow: ServerAllowance;
  size?: "sm" | "md";
}) {
  const { run, pending } = useRunAction(slug);

  return (
    <>
      {running
        ? allow.restart && (
            <Button
              intent="secondary"
              size={size}
              icon={RotateCw}
              disabled={pending}
              onClick={() => run("restart")}
            >
              Restart
            </Button>
          )
        : allow.start && (
            <Button intent="secondary" size={size} icon={Play} disabled={pending} onClick={() => run("start")}>
              Start
            </Button>
          )}
      {allow.stop && (
        <Button
          intent="destructive"
          size={size}
          icon={Square}
          disabled={pending || !running}
          onClick={() => run("stop")}
        >
          Stop
        </Button>
      )}
      {allow.backup && (
        <Button size={size} icon={Archive} disabled={pending} onClick={() => run("backup")}>
          Back up now
        </Button>
      )}
    </>
  );
}

/* The icon row in a server card's footer. */
export function ServerCardActions({
  slug,
  name,
  running,
  allow,
}: {
  slug: string;
  name: string;
  running: boolean;
  allow: ServerAllowance;
}) {
  const { run, pending } = useRunAction(slug);
  const router = useRouter();

  const items: Array<[Kind | "console", typeof Play, string]> = [];
  if (running && allow.restart) items.push(["restart", RotateCw, `Restart ${name}`]);
  if (!running && allow.start) items.push(["start", Play, `Start ${name}`]);
  if (allow.stop) items.push(["stop", Square, `Stop ${name}`]);
  items.push(["console", Terminal, `Open the console for ${name}`]);

  return (
    <span className="flex gap-1">
      {items.map(([kind, Icon, label]) => {
        const disabled = pending || (kind === "stop" && !running);
        return (
          <button
            key={kind}
            type="button"
            aria-label={label}
            title={label}
            disabled={disabled}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (kind === "console") router.push(`/console?server=${slug}`);
              else run(kind);
            }}
            className={clsx(
              "grid h-6 w-6 place-items-center rounded-md text-ink-4 transition-colors duration-150",
              disabled ? "opacity-40" : "hover:bg-card-2 hover:text-ink",
            )}
          >
            <Icon size={13} strokeWidth={1.7} />
          </button>
        );
      })}
    </span>
  );
}
