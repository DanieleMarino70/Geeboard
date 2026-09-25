"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import clsx from "clsx";
import { Check, LoaderCircle, X, Zap } from "lucide-react";
import { createServer, previewPorts } from "@/app/actions/create";
import type { InstallProgressView } from "@/lib/install-progress";
import { recommendNode, type PlacementPreview } from "@/app/actions/nodes";
import { BrandMark } from "@/components/brand-mark";
import {
  InstallProgressDetail,
  InstallSteps,
  newProgressKey,
  useInstallProgress,
} from "@/components/install-progress";
import { ToastProvider, useToast } from "@/components/toast";
import { Button } from "@/components/ui";
import { applyTemplate } from "@/domain/games/config";
import { GAMES, defaultVersion, gameById, gameForVersion, slugify } from "@/lib/catalog";
import { stepBlocker } from "@/lib/create-wizard";
import {
  GameStep,
  Heading,
  ResourcesStep,
  ReviewStep,
  TemplateStep,
  VersionStep,
  type Draft,
  type NodeOption,
} from "./steps";

/* The create wizard.

   Five steps, and the draft behind them is the only state: each step
   reads it and patches it, and nothing is committed anywhere until the
   last button. The draft is kept in localStorage as well, because the
   header in the design says "draft saved" and a header that says that
   had better mean it. */

const STEPS = ["Game", "Version", "Template", "Resources", "Review"] as const;
const DRAFT_KEY = "geeboard.create-draft.v1";

const HEADINGS: Record<number, { title: string; blurb: string }> = {
  1: {
    title: "What are you hosting?",
    blurb:
      "Pick the game and Geeboard brings its versions, its port layout, its settings and the sensible defaults that come with them. A server stays the game it was made as.",
  },
  2: {
    title: "Which build should it run?",
    blurb:
      "The version decides the build the node runs. A newer version of the same kind is an update later, with a backup taken first; another kind — Paper to Fabric, Build 41 to 42 — is a new server.",
  },
  3: {
    title: "How should it start, and what is it called?",
    blurb:
      "A template is the first set of settings the server boots with, not a category it is stuck in. Every one of them is editable from the moment it exists, except the few marked as set now, for good — a world's rules — which this is the one place to choose.",
  },
  4: {
    title: "How much of the node does it get?",
    blurb:
      "These are hard ceilings, not reservations — the server can burst up to them and no further. Memory and CPU can be changed later in its settings, and an owner or admin can move it to another node; storage cannot be changed yet.",
  },
  5: {
    title: "One last look before it exists.",
    blurb:
      "The name, address, memory, CPU and game settings can be changed afterwards, and the node by moving the server; the game and storage cannot. If the node has not run this build before, it downloads it first, and this page shows how far it has got. Some games fetch more of themselves on their first start, which the server's console shows.",
  },
};

function initialDraft(nodes: NodeOption[], domain: string, startGameId?: string): Draft {
  // A game chosen from the catalog opens the wizard on that game.
  const game = (startGameId && gameById(startGameId)) || GAMES[0]!;
  const open =
    nodes.find(
      (n) => n.state !== "DRAINING" && n.state !== "UNREACHABLE" && n.state !== "MAINTENANCE",
    ) ?? nodes[0];
  const versionId = defaultVersion(game).id;
  const templateId = game.templates[0]!.id;
  return {
    gameId: game.id,
    versionId,
    templateId,
    config: applyTemplate(gameForVersion(game, versionId), templateId),
    name: "",
    host: `server.${domain}`,
    hostEdited: false,
    nodeName: open?.name ?? "",
    memoryGb: game.defaults.memoryGb,
    cpuLimit: game.defaults.cpuLimit,
    diskGb: game.defaults.diskGb,
  };
}

/* The draft the browser is holding, if it is still coherent. A draft
   can outlive the catalogue entry or the node it names, and restoring
   one of those would put the wizard in a state its own steps cannot
   describe — so a stale draft is dropped rather than repaired. */
function storedDraft(
  nodes: NodeOption[],
  domain: string,
  startGameId?: string,
): { draft: Draft; restored: boolean } {
  const fresh = initialDraft(nodes, domain, startGameId);
  /* Arriving from the catalog is an explicit choice of game, so it wins
     over whatever half-finished draft the browser was holding. */
  if (startGameId && gameById(startGameId)) return { draft: fresh, restored: false };
  try {
    const stored = localStorage.getItem(DRAFT_KEY);
    if (!stored) return { draft: fresh, restored: false };

    const parsed = JSON.parse(stored) as Partial<Draft>;
    if (!parsed.gameId || !gameById(parsed.gameId)) return { draft: fresh, restored: false };
    if (!nodes.some((n) => n.name === parsed.nodeName)) return { draft: fresh, restored: false };

    /* Never restored: an overcommit is a decision about one placement,
       taken in front of the numbers. A draft left open yesterday must
       not carry it silently into a different node's creation. */
    return { draft: { ...fresh, ...parsed, overcommit: false }, restored: true };
  } catch {
    // An unreadable draft is not worth failing over.
    return { draft: fresh, restored: false };
  }
}

/* False on the server and during the first client render, true after.

   The stored draft cannot be read while rendering on the server, and
   reading it during hydration would disagree with the HTML that was
   already sent — so the wizard is remounted once, with a key, and only
   then reads it. */
const noSubscription = () => () => {};

function useHydrated() {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

/* The installer's steps while the create call is out. Downloading is the
   long one — a node that has not run this build pulls it now, gigabytes
   for some games — and the node says how far it has got: layers at once,
   bytes as each layer begins, a bar once the whole size is known. */
function InstallProgressLine({ progress, opening }: { progress: InstallProgressView | null; opening: string | null }) {
  return (
    <div className="mx-auto mb-3 flex w-full max-w-[1000px] flex-col gap-1" role="status" aria-live="polite">
      {/* Once the call has answered there is nothing left to watch. It
          used to go back to "Checking the node…" while the server's page
          opened, which is the first thing a create does, not the last. */}
      {opening ? (
        <p className="text-[11px] leading-snug text-ink-3">{opening}. Opening its page…</p>
      ) : (
        <>
          <InstallSteps progress={progress} />
          <InstallProgressDetail progress={progress} waiting="Checking the node, its capacity and a free port…" />
        </>
      )}
    </div>
  );
}

function Stepper({ step, onJump }: { step: number; onJump: (n: number) => void }) {
  return (
    <div className="flex shrink-0 items-center gap-[10px]">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const current = n === step;
        return (
          <div key={label} className={clsx("flex min-w-0 items-center gap-[10px]", n < 5 && "flex-1")}>
            <button
              type="button"
              onClick={() => done && onJump(n)}
              disabled={!done}
              aria-current={current ? "step" : undefined}
              className={clsx(
                "grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full border font-mono text-[11px] font-medium",
                done && "border-accent-line bg-accent text-accent-ink hover:brightness-110",
                current && "border-accent-line bg-accent-soft text-accent",
                !done && !current && "border-line bg-card-2 text-ink-4",
              )}
            >
              {done ? <Check size={12} strokeWidth={3.2} /> : n}
            </button>
            <span
              className={clsx(
                "hidden whitespace-nowrap text-[12.5px] sm:block",
                current ? "font-medium text-ink" : done ? "text-ink-3" : "text-ink-4",
              )}
            >
              {label}
            </span>
            {n < 5 && (
              <span
                className={clsx("mx-1 h-px min-w-4 flex-1", done ? "bg-accent-line" : "bg-line")}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function CreateWizard({
  nodes,
  domain,
  startGameId,
}: {
  nodes: NodeOption[];
  domain: string;
  startGameId?: string;
}) {
  const hydrated = useHydrated();
  /* The wizard carries its own toasts: it is the one screen outside the
     app shell, which is where the provider normally lives. */
  return (
    <ToastProvider>
      {/* The key remounts the wizard once, so its state can start from
          the stored draft rather than be patched into place after. */}
      <Wizard
        key={hydrated ? "stored" : "fresh"}
        nodes={nodes}
        domain={domain}
        hydrated={hydrated}
        startGameId={startGameId}
      />
    </ToastProvider>
  );
}

function Wizard({
  nodes,
  domain,
  hydrated,
  startGameId,
}: {
  nodes: NodeOption[];
  domain: string;
  hydrated: boolean;
  startGameId?: string;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [creating, startCreating] = useTransition();

  /* What the install is doing, asked once a second while the create call
     is out. Installation used to be a spinner for as long as it took —
     minutes, when the node has to pull a build — with the steps going to
     the activity log where nobody waiting could see them. */
  const [progressKey, setProgressKey] = useState<string | null>(null);
  const progress = useInstallProgress(progressKey);
  const [opening, setOpening] = useState<string | null>(null);

  const [step, setStep] = useState(1);
  const [start] = useState(() =>
    hydrated
      ? storedDraft(nodes, domain, startGameId)
      : { draft: initialDraft(nodes, domain, startGameId), restored: false },
  );
  const [draft, setDraft] = useState<Draft>(start.draft);
  const [saved, setSaved] = useState(start.restored);

  /* The allocator's answer for the game and node currently chosen,
     tagged with what it was asked. Anything tagged with a different
     question is a stale answer, which is also how "still asking" is
     told apart from "asked, and there is nothing free". */
  const question = `${draft.gameId}|${draft.nodeName}`;
  const [answer, setAnswer] = useState<{ question: string; base: number | null } | null>(null);
  const portsPending = answer?.question !== question;
  const portBase = answer?.question === question ? answer.base : null;

  const patch = useCallback((values: Partial<Draft>) => {
    setDraft((current) => {
      const next = { ...current, ...values };
      // The address follows the name until somebody types over it.
      if (!next.hostEdited && (values.name !== undefined || values.gameId !== undefined)) {
        next.host = `${slugify(next.name) || "server"}.${domain}`;
      }
      /* A different game, version or template brings its own settings;
         what was adjusted for the old one would be keys the new one
         has no meaning for. Only a change that names settings keeps them. */
      if (
        values.config === undefined &&
        (values.gameId !== undefined || values.versionId !== undefined || values.templateId !== undefined)
      ) {
        next.config = applyTemplate(gameForVersion(gameById(next.gameId)!, next.versionId), next.templateId);
      }
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
      } catch {
        /* Private browsing, a full quota — the wizard still works. */
      }
      return next;
    });
    setSaved(true);
  }, [domain]);

  /* A preview, not a reservation — which is why the create allocates
     again rather than trusting what was on screen. */
  useEffect(() => {
    let live = true;
    const [gameId, nodeName] = question.split("|") as [string, string];

    previewPorts(gameId, nodeName)
      .then((result) => {
        if (live) setAnswer({ question, base: result.base });
      })
      .catch(() => {
        if (live) setAnswer({ question, base: null });
      });

    return () => {
      live = false;
    };
  }, [question]);

  /* Which node the platform would pick, and why.

     Asked whenever the game or the resources change, because those are
     what the answer depends on — not on which node is currently
     selected, or it would re-fetch every time somebody clicked one. */
  const [advice, setAdvice] = useState<PlacementPreview | null>(null);
  const placementQuestion = `${draft.gameId}|${draft.memoryGb}|${draft.cpuLimit}|${draft.diskGb}`;

  useEffect(() => {
    let live = true;
    const [gameId, memoryGb, cpuLimit, diskGb] = placementQuestion.split("|");

    recommendNode({
      gameId: gameId!,
      memoryGb: Number(memoryGb),
      cpuLimit: Number(cpuLimit),
      diskGb: Number(diskGb),
    })
      .then((result) => {
        if (live) setAdvice(result);
      })
      .catch(() => {
        // A recommendation is a convenience; the wizard works without it.
        if (live) setAdvice(null);
      });

    return () => {
      live = false;
    };
  }, [placementQuestion]);

  const node = nodes.find((n) => n.name === draft.nodeName);
  const trimmed = draft.name.trim();

  const nameError = useMemo(() => {
    if (!trimmed) return null;
    if (trimmed.length < 2) return "A little longer, please.";
    if (!slugify(trimmed)) return "That needs at least one letter or digit.";
    return null;
  }, [trimmed]);

  // Same rule the create operation applies; shown beside the field rather than only in the footer.
  const hostError = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)+$/i.test(draft.host)
    ? null
    : "Not a valid hostname — letters, digits and hyphens, with at least one dot.";

  /* What stops each step, in the words the footer will use — the rules
     themselves are in lib/create-wizard.ts, where they can be read and
     tested against the step that answers them. Memory and CPU stop the
     create on the review step and not the step before it, because the
     checkbox that clears them lives on the review step: blocking earlier
     made the only door to it one that was locked. */
  const blocked = useMemo(
    (): string | null =>
      stepBlocker({
        step,
        name: trimmed,
        nameError,
        hostError,
        node: node ?? null,
        memoryGb: draft.memoryGb,
        cpuLimit: draft.cpuLimit,
        diskGb: draft.diskGb,
        overcommit: draft.overcommit === true,
        portBase,
        portsPending,
        cannotRunGame: Boolean(
          node && advice?.scores.find((s) => s.node === node.name)?.cannotRun.length,
        ),
      }),
    [step, trimmed, nameError, hostError, draft, node, portBase, portsPending, advice],
  );

  function submit() {
    /* A key for asking how the install is going while the call below is
       still out. Made here, because the server's address is not known
       until the call comes back. */
    const key = newProgressKey();
    setProgressKey(key);
    startCreating(async () => {
      const result = await createServer({
        progressKey: key,
        name: trimmed,
        host: draft.host,
        gameId: draft.gameId,
        versionId: draft.versionId,
        templateId: draft.templateId,
        config: draft.config,
        nodeName: draft.nodeName,
        memoryGb: draft.memoryGb,
        cpuLimit: draft.cpuLimit,
        diskGb: draft.diskGb,
        overcommit: draft.overcommit,
      });

      setProgressKey(null);
      if (!result.ok) {
        push({ tone: "danger", title: result.title, body: result.body });
        return;
      }

      push({ tone: result.tone, title: result.title, body: result.body });
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* nothing to clear */
      }
      setOpening(result.title);
      router.push(`/servers/${result.slug}`);
    });
  }

  const NEXT_LABEL: Record<number, string> = {
    1: "Choose a version",
    2: "Choose a template",
    3: "Set resources",
    4: "Review",
  };

  return (
    // Clipped: the glow behind the header is wider than a phone screen.
    <div className="relative flex min-h-dvh flex-col overflow-x-clip bg-bg">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-[220px] left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-[50%]"
        style={{ background: "radial-gradient(closest-side, var(--accent-soft), transparent)" }}
      />

      <header className="relative flex h-[60px] shrink-0 items-center gap-3 border-b border-line px-5 sm:px-10">
        <BrandMark size={26} className="shrink-0 text-accent" />
        <span className="text-[13.5px] font-semibold tracking-[-0.01em]">Geeboard</span>
        <span className="mx-1 h-[18px] w-px bg-line" />
        <span className="text-[13px] text-ink-3">Create a server</span>
        <span className="ml-auto font-mono text-[10.5px] text-ink-4">
          {saved ? "draft saved" : "new draft"}
        </span>
        <Link
          href="/servers"
          aria-label="Cancel"
          className="ml-3 grid h-8 w-8 shrink-0 place-items-center rounded-[9px] border border-line text-ink-4 transition-colors duration-150 hover:border-line-2 hover:text-ink"
        >
          <X size={15} strokeWidth={1.7} />
        </Link>
      </header>

      <div className="relative flex flex-1 flex-col items-center px-5 pt-7 pb-8 sm:px-10">
        <div className="flex w-full max-w-[1000px] flex-1 flex-col gap-[26px]">
          <Stepper step={step} onJump={setStep} />
          <Heading {...HEADINGS[step]!} />

          <div className="flex-1">
            {step === 1 && <GameStep draft={draft} patch={patch} />}
            {step === 2 && <VersionStep draft={draft} patch={patch} />}
            {step === 3 && (
              <TemplateStep draft={draft} patch={patch} nameError={nameError} hostError={hostError} />
            )}
            {step === 4 && (
              <ResourcesStep
                draft={draft}
                patch={patch}
                nodes={nodes}
                portBase={portBase}
                portsPending={portsPending}
                advice={advice}
              />
            )}
            {step === 5 && node && (
              <ReviewStep draft={draft} patch={patch} nodes={nodes} portBase={portBase} goTo={setStep} />
            )}
          </div>
        </div>
      </div>

      <footer className="sticky bottom-0 z-10 shrink-0 border-t border-line bg-bg-2 px-5 py-4 sm:px-10">
        {creating && <InstallProgressLine progress={progress} opening={opening} />}
        <div className="mx-auto flex w-full max-w-[1000px] items-center gap-3">
          {/* On a phone the step count gives way to the reason, which is
              the only thing that explains a disabled button. */}
          <span className={clsx("text-xs text-ink-4", blocked && "hidden sm:inline")}>Step {step} of 5</span>
          {blocked && (
            <span className="min-w-0 text-[11.5px] leading-snug text-warning">
              <span className="hidden sm:inline">· </span>
              {blocked}
            </span>
          )}

          <span className="ml-auto flex gap-2">
            {step === 1 ? (
              <Link
                href="/servers"
                className="rounded-[9px] px-4 py-[9px] text-[13px] text-ink-3 transition-colors duration-150 hover:bg-card-2 hover:text-ink"
              >
                Cancel
              </Link>
            ) : (
              <Button intent="secondary" onClick={() => setStep(step - 1)} disabled={creating}>
                Back
              </Button>
            )}

            {step < 5 ? (
              <Button onClick={() => setStep(step + 1)} disabled={blocked !== null}>
                {NEXT_LABEL[step]}
              </Button>
            ) : (
              <Button
                icon={creating ? undefined : Zap}
                onClick={submit}
                disabled={creating || blocked !== null}
              >
                {creating ? (
                  <>
                    <LoaderCircle size={14} strokeWidth={2} className="animate-spin" />
                    Creating {trimmed}…
                  </>
                ) : (
                  `Create ${trimmed}`
                )}
              </Button>
            )}
          </span>
        </div>
      </footer>
    </div>
  );
}
