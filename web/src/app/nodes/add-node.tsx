"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import clsx from "clsx";
import { Check, Copy, Loader2, Plus, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { useToast } from "@/components/toast";
import { approveNode, createRegistrationToken, registrationProgress } from "@/app/actions/nodes";
import { NODE_NAME, checkAddress, joinCommand, panelOrigin, startsAgain, type Shell } from "@/lib/agent-command";

/* Adding a node, start to finish, in one place.

   It used to be a form already on the page that the header button
   scrolled to, a Mint button that stayed disabled with no word of why,
   and a command full of placeholders that could not have worked as
   shown. What this has to produce is a command somebody can paste and
   run, and then the machine that turns up — so it waits for it, and
   offers the approval right here. */

export interface DeclarableCapability {
  id: string;
  label: string;
  /** Games that cannot be placed on a node without it. */
  games: string[];
}

type Progress = Awaited<ReturnType<typeof registrationProgress>>;

interface Minted {
  nodeName: string;
  secret: string;
  tokenId: string;
  panelUrl: string;
  advertiseUrl: string;
  capabilities: string[];
  replaces: boolean;
}

const POLL_MS = 3_000;
const OPEN_EVENT = "geeboard:add-node";

/* Opens the page's one Add a node dialog from anywhere on it.

   There is one dialog, in the header, on purpose. The empty state's
   button used to own a second one — and the moment the first node
   registered, the page refreshed, the empty state went away, and took
   the open dialog with it, mid-flow. */
export function OpenAddNode({ label }: { label: string }) {
  return (
    <Button icon={Plus} onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}>
      {label}
    </Button>
  );
}

export function AddNodeButton(props: {
  panelUrl: string;
  existingNames: string[];
  declarable: DeclarableCapability[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  // A fresh form each time it opens: a half-used token from last time is
  // in the token list, not resurrected here.
  const [session, setSession] = useState(0);

  const show = () => {
    if (dialog.current?.open) return;
    setSession((n) => n + 1);
    setOpen(true);
    dialog.current?.showModal();
  };
  const close = () => dialog.current?.close();

  useEffect(() => {
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  });

  return (
    <>
      <Button icon={Plus} onClick={show}>
        Add a node
      </Button>
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        aria-label="Add a node"
        className="m-auto max-h-[calc(100dvh-40px)] w-[640px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-line-2 bg-surface p-0 text-ink shadow-e3 backdrop:bg-[hsl(230_30%_3%/0.62)] backdrop:backdrop-blur-[4px] open:animate-(--animate-rise)"
      >
        {open && <AddNodeFlow key={session} {...props} onClose={close} />}
      </dialog>
    </>
  );
}

function AddNodeFlow({
  panelUrl: initialPanelUrl,
  existingNames,
  declarable,
  onClose,
}: {
  panelUrl: string;
  existingNames: string[];
  declarable: DeclarableCapability[];
  onClose: () => void;
}) {
  const { push } = useToast();
  const router = useRouter();
  const [busy, start] = useTransition();

  const [nodeName, setNodeName] = useState("");
  const [panelUrl, setPanelUrl] = useState(initialPanelUrl);
  // Empty by default: the agent works out its own address when it joins.
  const [advertiseUrl, setAdvertiseUrl] = useState("");
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [minted, setMinted] = useState<Minted | null>(null);

  const name = nodeName.trim().toLowerCase();
  /* Every problem is said beside the field it belongs to. Errors appear
     once somebody has tried to continue, not while they are still typing
     the first letter. */
  const errors = {
    nodeName: !name
      ? "Name the node — it is how the panel and the agent agree which machine this is."
      : NODE_NAME.test(name)
        ? null
        : "2–39 lowercase letters, digits and dashes, starting with a letter or digit.",
    panelUrl: checkAddress(panelUrl),
    advertiseUrl: advertiseUrl.trim() ? checkAddress(advertiseUrl) : null,
  };
  const valid = !errors.nodeName && !errors.panelUrl && !errors.advertiseUrl;
  const replaces = NODE_NAME.test(name) && existingNames.includes(name);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setFailure(null);
    if (!valid) return;

    start(async () => {
      /* A throw from the action would otherwise end the transition with
         nothing on screen — the same silent button this replaced. */
      const result = await createRegistrationToken(name).catch(() => null);
      if (!result) {
        setFailure("The panel could not create a token. Its log has the reason.");
        return;
      }
      if (!result.ok || !result.secret || !result.tokenId) {
        setFailure(`${result.title}. ${result.body}`);
        return;
      }
      setMinted({
        nodeName: name,
        secret: result.secret,
        tokenId: result.tokenId,
        panelUrl,
        advertiseUrl,
        capabilities,
        replaces: Boolean(result.replaces),
      });
      router.refresh();
    });
  };

  return (
    <div>
      <div className="flex items-start gap-3 border-b border-line px-6 py-5">
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold tracking-[-0.01em]">Add a node</h2>
          <p className="mt-[5px] text-[12px] leading-snug text-ink-3">
            {minted
              ? "Run this on the machine. It registers itself, and you approve it here."
              : "A machine you already have, running Docker. Geeboard installs nothing on it but the agent."}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-[5px] border border-line px-[6px] py-[2px] font-mono text-[9.5px] text-ink-4 hover:text-ink"
        >
          ESC
        </button>
      </div>

      {minted ? (
        <RunStep minted={minted} onClose={onClose} push={push} />
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-5 px-6 py-5">
          <Field
            label="Node name"
            hint="Lowercase, like fra-node-03. The token only registers this name."
            error={submitted ? errors.nodeName : null}
          >
            <input
              autoFocus
              value={nodeName}
              onChange={(e) => setNodeName(e.target.value)}
              placeholder="win-node-01"
              spellCheck={false}
              autoComplete="off"
              className={inputClass(submitted && Boolean(errors.nodeName), true)}
            />
          </Field>

          {replaces && (
            <Notice tone="warning">
              <strong className="font-semibold">{name} already exists.</strong> Registering with
              this token replaces its agent address and token, and keeps its approval — the way to
              rebuild a machine or rotate its token.
            </Notice>
          )}

          {/* Addresses are the part most people never need to touch, so
              they are folded away — and opened by themselves when one of
              them is what stops the form. */}
          <details
            open={submitted && Boolean(errors.panelUrl || errors.advertiseUrl)}
            className="group rounded-[9px] border border-line px-3 py-[9px]"
          >
            <summary className="cursor-pointer text-[12px] font-medium text-ink-2 select-none">
              Addresses{" "}
              <span className="font-normal text-ink-4">
                — panel {panelOrigin(panelUrl) || "not set"}, agent{" "}
                {advertiseUrl.trim() ? panelOrigin(advertiseUrl) : "found automatically"}
              </span>
            </summary>
            <div className="mt-4 flex flex-col gap-5">
              <Field
                label="Panel address"
                hint="Where the machine reaches this panel. Change it if the machine sees the panel under another name, like its LAN address."
                error={submitted ? errors.panelUrl : null}
              >
                <input
                  value={panelUrl}
                  onChange={(e) => setPanelUrl(e.target.value)}
                  spellCheck={false}
                  className={inputClass(submitted && Boolean(errors.panelUrl), true)}
                />
              </Field>

              <Field
                label="Agent address (optional)"
                hint="Left empty, the agent uses the address it reaches this panel from, on port 8080. Set it when the panel reaches the machine some other way — a forwarded port, a proxy."
                error={submitted ? errors.advertiseUrl : null}
              >
                <input
                  value={advertiseUrl}
                  onChange={(e) => setAdvertiseUrl(e.target.value)}
                  placeholder="found automatically"
                  spellCheck={false}
                  className={inputClass(submitted && Boolean(errors.advertiseUrl), true)}
                />
              </Field>
            </div>
          </details>

          <fieldset>
            <legend className="mb-[6px] text-[12px] font-medium text-ink-2">
              What this node will run
            </legend>
            <p className="mb-[10px] text-[11px] leading-snug text-ink-4">
              Docker, IPv6 and memory are measured by the agent. These cannot be, so they are your
              call — a game that needs one is not placed on a node without it.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {declarable.map((capability) => {
                const on = capabilities.includes(capability.id);
                return (
                  <label
                    key={capability.id}
                    className={clsx(
                      "flex cursor-pointer items-start gap-[10px] rounded-[9px] border px-3 py-[9px] transition-colors duration-150",
                      on ? "border-accent-line bg-accent-soft" : "border-line hover:border-line-2",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setCapabilities((list) =>
                          on ? list.filter((c) => c !== capability.id) : [...list, capability.id],
                        )
                      }
                      className="mt-[3px] accent-accent"
                    />
                    <span className="min-w-0">
                      <span className="block text-[12.5px]">{capability.label}</span>
                      <span className="block text-[10.5px] leading-snug text-ink-4">
                        {capability.games.length > 0
                          ? `Needed by ${capability.games.join(", ")}`
                          : "No game needs it yet"}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {failure && <Notice tone="danger">{failure}</Notice>}

          <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
            <Button intent="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy} icon={busy ? Loader2 : undefined}>
              {busy ? "Creating…" : "Create the command"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/* ── The command, and the wait ────────────────────────────────────── */

function RunStep({
  minted,
  onClose,
  push,
}: {
  minted: Minted;
  onClose: () => void;
  push: ReturnType<typeof useToast>["push"];
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  // The machine being added is most often the kind the browser is on.
  const [shell, setShell] = useState<Shell>(() =>
    typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent) ? "powershell" : "bash",
  );
  const [copied, setCopied] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [approved, setApproved] = useState(false);
  const pre = useRef<HTMLPreElement>(null);

  const command = joinCommand(
    {
      panelUrl: minted.panelUrl,
      advertiseUrl: minted.advertiseUrl,
      registrationToken: minted.secret,
      capabilities: minted.capabilities,
    },
    shell,
  );

  /* Waiting for the machine. Stops once there is an answer that will not
     change by itself — registered, expired, revoked. */
  const settled = progress !== null && progress.state !== "waiting";
  useEffect(() => {
    if (settled) return;
    let cancelled = false;
    const check = async () => {
      try {
        const next = await registrationProgress(minted.tokenId);
        if (!cancelled) {
          setProgress(next);
          if (next.state === "registered") router.refresh();
        }
      } catch {
        /* a failed poll is not news; the next one will say */
      }
    };
    void check();
    const timer = setInterval(() => void check(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [minted.tokenId, settled, router]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      /* The clipboard API needs a secure context, and a panel reached
         over plain http on a LAN address is not one. Selecting the text
         leaves one keystroke between the operator and the command. */
      const range = document.createRange();
      if (pre.current) range.selectNodeContents(pre.current);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      if (!document.execCommand?.("copy")) return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const approve = (name: string) =>
    start(async () => {
      const result = await approveNode(name);
      push(
        result.ok
          ? { tone: "success", title: result.title, body: result.body }
          : { tone: "danger", title: result.title, body: result.body },
      );
      if (result.ok) setApproved(true);
      router.refresh();
    });

  const registered = progress?.state === "registered" ? progress.node : null;

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <p className="text-[12px] leading-snug text-ink-3">
        On the machine, with Docker running, open a terminal in a checkout of Geeboard and paste
        this. It joins the panel and installs the agent as something that starts at boot:
      </p>

      <div className="overflow-hidden rounded-[11px] border border-line bg-bg-2">
        <div className="flex items-center gap-1 border-b border-line px-2 py-[6px]">
          {(["powershell", "bash"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setShell(option)}
              aria-pressed={shell === option}
              className={clsx(
                "rounded-[6px] px-[10px] py-[4px] font-mono text-[10.5px] transition-colors duration-150",
                shell === option ? "bg-card-2 text-ink" : "text-ink-4 hover:text-ink-2",
              )}
            >
              {option === "powershell" ? "PowerShell" : "bash"}
            </button>
          ))}
          <button
            type="button"
            onClick={copy}
            className="ml-auto inline-flex items-center gap-[5px] rounded-[6px] px-[10px] py-[4px] text-[11.5px] text-accent hover:bg-card-2"
          >
            {copied ? <Check size={12} strokeWidth={2.2} /> : <Copy size={12} strokeWidth={2} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre
          ref={pre}
          className="overflow-x-auto p-[14px] font-mono text-[10.5px] leading-[1.7] whitespace-pre text-ink-2"
        >
          {command}
        </pre>
      </div>

      {/* Nothing to keep: the token in the command is spent by its first
          run, and the agent's own secret is made on the machine and never
          shown to anybody. */}
      <p className="text-[11.5px] leading-relaxed text-ink-4">
        The token in it registers <span className="font-mono text-ink-3">{minted.nodeName}</span> once
        and is then spent. The agent saves its own settings on the machine and is started by{" "}
        <code className="font-mono text-ink-3">{startsAgain(shell)}</code>
        {shell === "powershell" ? "" : " — a systemd unit, enabled at boot"}. Upgrading and removing
        are in the installation guide.
      </p>

      {minted.replaces && (
        <Notice tone="warning">
          This replaces the agent currently registered as {minted.nodeName}.
        </Notice>
      )}

      <div className="rounded-[11px] border border-line p-4" aria-live="polite">
        {registered ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-[7px]">
                <ShieldCheck size={15} strokeWidth={1.8} className="text-accent" />
                <span className="font-mono text-[12.5px] font-medium">{registered.name}</span>
                <Badge tone={registered.approved || approved ? "success" : "info"}>
                  {registered.approved || approved ? "in service" : "waiting for approval"}
                </Badge>
              </div>
              <div className="mt-1 font-mono text-[10.5px] text-ink-4">
                {registered.os ?? "unknown"} · {registered.arch ?? "unknown"} · {registered.cpuCores}{" "}
                vCPU · {registered.ramTotal} GB · {registered.diskTotal} GB
              </div>
              {registered.capabilities.length > 0 && (
                <div className="mt-[3px] font-mono text-[10px] text-ink-4">
                  {registered.capabilities.join(" · ")}
                </div>
              )}
            </div>
            {registered.approved || approved ? (
              <Button intent="secondary" onClick={onClose}>
                Done
              </Button>
            ) : (
              <Button icon={Check} disabled={busy} onClick={() => approve(registered.name)}>
                Approve
              </Button>
            )}
          </div>
        ) : progress?.state === "expired" || progress?.state === "revoked" || progress?.state === "gone" ? (
          <div className="flex items-center gap-[9px] text-[12px] text-danger">
            <X size={14} strokeWidth={2} />
            {progress.state === "expired"
              ? "This token expired before a machine used it. Close this and create another."
              : progress.state === "revoked"
                ? "This token was revoked. Close this and create another."
                : "This token, or the node it registered, no longer exists."}
          </div>
        ) : (
          <div className="flex items-center gap-[9px] text-[12px] text-ink-3">
            <Loader2 size={14} strokeWidth={2} className="animate-spin text-accent" />
            Waiting for {minted.nodeName} to register…
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────── */

function inputClass(invalid: boolean, mono = false) {
  return clsx(
    "w-full rounded-[9px] border bg-bg-2 px-3 py-[9px] text-[13px] outline-none transition-colors duration-150 placeholder:text-ink-4",
    mono && "font-mono text-[12.5px]",
    invalid ? "border-danger-line" : "border-line hover:border-line-2 focus:border-accent-line",
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint: string;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-[6px]">
      <span className="text-[12px] font-medium text-ink-2">{label}</span>
      {children}
      <span className={clsx("text-[11px] leading-snug", error ? "text-danger" : "text-ink-4")}>
        {error ?? hint}
      </span>
    </label>
  );
}

function Notice({ tone, children }: { tone: "warning" | "danger"; children: React.ReactNode }) {
  return (
    <div
      className={clsx(
        "flex gap-[9px] rounded-[9px] border px-3 py-[10px] text-[11.5px] leading-relaxed",
        tone === "warning"
          ? "border-warning-line bg-warning-soft text-warning"
          : "border-danger-line bg-danger-soft text-danger",
      )}
    >
      <TriangleAlert size={14} strokeWidth={1.9} className="mt-[2px] shrink-0" />
      <div>{children}</div>
    </div>
  );
}
