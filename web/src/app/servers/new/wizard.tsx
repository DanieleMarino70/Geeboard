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
import { ToastProvider, useToast } from "@/components/toast";
import { Button } from "@/components/ui";
import { GAMES, gameById, slugify } from "@/lib/catalog";
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
      "Pick the game and Geeboard sets the container image, the port layout and the sensible defaults that come with it. You can change all of them later.",
  },
  2: {
    title: "Which build should it run?",
    blurb:
      "The version decides the image the node pulls. Everything here boots the same way, so switching later is a restart rather than a migration.",
  },
  3: {
    title: "How should it start, and what is it called?",
    blurb:
      "A template is the first set of settings the server boots with, not a category it is stuck in. Every one of them is editable from the moment it exists.",
  },
  4: {
    title: "How much of the node does it get?",
    blurb:
      "These are hard ceilings, not reservations — the container can burst up to them and no further. Everything here can be changed after the server exists.",
  },
  5: {
    title: "One last look before it exists.",
    blurb:
      "Everything below is editable after creation except the node. Creating takes about a minute and you can watch it happen in the console.",
  },
};

function initialDraft(nodes: NodeOption[], domain: string): Draft {
  const game = GAMES[0]!;
  const open = nodes.find((n) => n.state !== "DRAINING" && n.state !== "UNREACHABLE") ?? nodes[0];
  return {
    gameId: game.id,
    versionId: (game.versions.find((v) => v.recommended) ?? game.versions[0]!).id,
    templateId: game.templates[0]!.id,
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
function storedDraft(nodes: NodeOption[], domain: string): { draft: Draft; restored: boolean } {
  const fresh = initialDraft(nodes, domain);
  try {
    const stored = localStorage.getItem(DRAFT_KEY);
    if (!stored) return { draft: fresh, restored: false };

    const parsed = JSON.parse(stored) as Partial<Draft>;
    if (!parsed.gameId || !gameById(parsed.gameId)) return { draft: fresh, restored: false };
    if (!nodes.some((n) => n.name === parsed.nodeName)) return { draft: fresh, restored: false };

    return { draft: { ...fresh, ...parsed }, restored: true };
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

export function CreateWizard({ nodes, domain }: { nodes: NodeOption[]; domain: string }) {
  const hydrated = useHydrated();
  /* The wizard carries its own toasts: it is the one screen outside the
     app shell, which is where the provider normally lives. */
  return (
    <ToastProvider>
      {/* The key remounts the wizard once, so its state can start from
          the stored draft rather than be patched into place after. */}
      <Wizard key={hydrated ? "stored" : "fresh"} nodes={nodes} domain={domain} hydrated={hydrated} />
    </ToastProvider>
  );
}

function Wizard({
  nodes,
  domain,
  hydrated,
}: {
  nodes: NodeOption[];
  domain: string;
  hydrated: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [creating, startCreating] = useTransition();

  const [step, setStep] = useState(1);
  const [start] = useState(() =>
    hydrated ? storedDraft(nodes, domain) : { draft: initialDraft(nodes, domain), restored: false },
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

  const node = nodes.find((n) => n.name === draft.nodeName);
  const trimmed = draft.name.trim();

  const nameError = useMemo(() => {
    if (!trimmed) return null;
    if (trimmed.length < 2) return "A little longer, please.";
    if (!slugify(trimmed)) return "That needs at least one letter or digit.";
    return null;
  }, [trimmed]);

  /* What stops each step, in the words the footer will use. */
  const blocked = useMemo((): string | null => {
    if (step === 3) {
      if (trimmed.length < 2) return "Give the server a name";
      if (nameError) return nameError;
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)+$/i.test(draft.host)) {
        return "That address is not a valid hostname";
      }
    }
    if (step >= 4) {
      if (!node) return "Pick a node";
      if (node.ramCommitted + draft.memoryGb > node.ramTotal) return `${node.name} is out of memory`;
      if (node.cpuCommitted + draft.cpuLimit > node.cpuTotal) return `${node.name} is out of CPU`;
      if (node.diskCommitted + draft.diskGb > node.diskTotal) return `${node.name} is out of storage`;
      if (!portsPending && portBase === null) return `${node.name} has no free port block`;
    }
    return null;
  }, [step, trimmed, nameError, draft, node, portBase, portsPending]);

  function submit() {
    startCreating(async () => {
      const result = await createServer({
        name: trimmed,
        host: draft.host,
        gameId: draft.gameId,
        versionId: draft.versionId,
        templateId: draft.templateId,
        nodeName: draft.nodeName,
        memoryGb: draft.memoryGb,
        cpuLimit: draft.cpuLimit,
        diskGb: draft.diskGb,
      });

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
    <div className="relative flex min-h-dvh flex-col bg-bg">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-[220px] left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-[50%]"
        style={{ background: "radial-gradient(closest-side, var(--accent-soft), transparent)" }}
      />

      <header className="relative flex h-[60px] shrink-0 items-center gap-3 border-b border-line px-5 sm:px-10">
        <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg bg-accent text-accent-ink">
          <Zap size={15} strokeWidth={2.4} />
        </span>
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
              <TemplateStep draft={draft} patch={patch} domain={domain} nameError={nameError} />
            )}
            {step === 4 && (
              <ResourcesStep
                draft={draft}
                patch={patch}
                nodes={nodes}
                portBase={portBase}
                portsPending={portsPending}
              />
            )}
            {step === 5 && node && (
              <ReviewStep draft={draft} nodes={nodes} portBase={portBase} goTo={setStep} />
            )}
          </div>
        </div>
      </div>

      <footer className="sticky bottom-0 z-10 shrink-0 border-t border-line bg-bg-2 px-5 py-4 sm:px-10">
        <div className="mx-auto flex w-full max-w-[1000px] items-center gap-3">
          <span className="text-xs text-ink-4">Step {step} of 5</span>
          {blocked && (
            <span className="hidden text-[11.5px] text-warning sm:block">· {blocked}</span>
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
