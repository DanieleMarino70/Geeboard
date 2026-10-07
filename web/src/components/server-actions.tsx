"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAction } from "@/components/use-action";
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
import { OPTIMISTIC_STATE } from "@/lib/state-meta";
import { setPendingState } from "./state-pill";
import { useToast } from "./toast";
import { Button } from "./ui";

type Kind = "start" | "stop" | "restart" | "backup";

/* What the button that was pressed says while its request is out, so that a Stop that takes forty seconds does not look hung. */
const DOING: Record<Kind, string> = { start: "Starting…", stop: "Stopping…", restart: "Restarting…", backup: "Backing up…" };

const RUN: Record<Kind, (slug: string) => Promise<ActionResult>> = {
  start: startServer,
  stop: stopServer,
  restart: restartServer,
  backup: createBackup,
};

/* A press says what the server is about to be, at once. Stop and Restart hold the request open for the game's own save and exit, up to a
   minute, and nothing on the page changed until it came back: the button greyed, the pill still "Running", and a second press that looked
   like it did nothing. The pill (state-pill.tsx) takes the state from here and gives it back when the request returns. What changes after
   that is the page's own: the action revalidates the pages it touched when it succeeds, and LiveRefresh draws them again while the server
   is on its way (components/live-refresh.tsx). The refreshes at 4 and 6.5 seconds that were here were tuned to the simulator. */
function useRunAction(slug: string) {
  const [pending, startTransition] = useAction();
  const [doing, setDoing] = useState<Kind | null>(null);
  const { push } = useToast();
  const router = useRouter();

  const run = (kind: Kind) => {
    const state = kind === "backup" ? null : OPTIMISTIC_STATE[kind];
    if (state) setPendingState(slug, state);
    setDoing(kind);
    startTransition(async () => {
      try {
        const result = await RUN[kind](slug);
        if (result.ok) {
          push({ tone: result.tone, title: result.title, body: result.body });
        } else {
          push({ tone: "danger", title: result.title, body: result.body });
          // A refusal revalidated nothing, and the state it was refused for may have moved.
          router.refresh();
        }
      } finally {
        if (state) setPendingState(slug, null);
        setDoing(null);
      }
    });
  };

  return { run, pending, doing };
}

/* Full-size controls for the server detail and console headers. */
export function ServerControls({
  slug,
  running,
  allow,
  size = "md",
  unavailable = null,
}: {
  slug: string;
  running: boolean;
  /** What this viewer may do here — a control they may not use is not drawn. */
  allow: ServerAllowance;
  size?: "sm" | "md";
  /** Why nothing can be done to this server now (its node is away): the controls are drawn and disabled, and say it on hover. */
  unavailable?: string | null;
}) {
  const { run, pending, doing } = useRunAction(slug);
  const off = pending || unavailable !== null;
  const label = (kind: Kind, idle: string) => (doing === kind ? DOING[kind] : idle);
  const why = unavailable ?? undefined;

  return (
    <>
      {running
        ? allow.restart && (
            <Button
              intent="secondary"
              size={size}
              icon={RotateCw}
              disabled={off}
              title={why}
              onClick={() => run("restart")}
            >
              {label("restart", "Restart")}
            </Button>
          )
        : allow.start && (
            <Button intent="secondary" size={size} icon={Play} disabled={off} title={why} onClick={() => run("start")}>
              {label("start", "Start")}
            </Button>
          )}
      {allow.stop && (
        <Button
          intent="destructive"
          size={size}
          icon={Square}
          disabled={off || !running}
          title={why}
          onClick={() => run("stop")}
        >
          {label("stop", "Stop")}
        </Button>
      )}
      {allow.backup && (
        <Button size={size} icon={Archive} disabled={off} title={why} onClick={() => run("backup")}>
          {label("backup", "Back up now")}
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
  unavailable = null,
}: {
  slug: string;
  name: string;
  running: boolean;
  allow: ServerAllowance;
  /** Why nothing can be done to this server now (its node is away). The console link still works: it says what the node says. */
  unavailable?: string | null;
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
        const disabled = kind !== "console" && (pending || unavailable !== null || (kind === "stop" && !running));
        const text = kind !== "console" && unavailable !== null ? `${label}: ${unavailable}` : label;
        return (
          <button
            key={kind}
            type="button"
            aria-label={text}
            title={text}
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
