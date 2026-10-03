"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { ArrowRight, Bird, Check, Cloud, Copy, ExternalLink, Globe, KeyRound, RefreshCw, Trash2, Webhook } from "lucide-react";
import { checkDns, configureDns, makeWebhookSecret, removeDns, retryServerDns } from "@/app/actions/dns";
import { Field, inputClass } from "@/components/form";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, Label } from "@/components/ui";
import { PITCH, guideDone, guideFor } from "@/domain/dns/guide";
import { DNS_KINDS, DNS_PROVIDERS, type DnsKind } from "@/domain/dns/rules";
import type { OpResult } from "@/lib/server-ops";

/** What the page may know about the provider: which, for which zone, whether it works — never the token. */
export interface ProviderView {
  kind: DnsKind | null;
  zone: string | null;
  checkHost: string | null;
  /** A webhook's host, never its path. */
  receiver: string | null;
  unreadable: boolean;
  configuredBy: string | null;
  configuredAt: string | null;
  checkedAt: string | null;
  checkError: string | null;
}

function useOp() {
  const [pending, start] = useTransition();
  const { push } = useToast();
  const router = useRouter();
  const run = (fn: () => Promise<OpResult>, then?: () => void) =>
    start(async () => {
      const r = await fn();
      push(r.ok ? { tone: r.tone, title: r.title, body: r.body } : { tone: "danger", title: r.title, body: r.body });
      if (r.ok) then?.();
      router.refresh();
    });
  return { run, pending };
}

const when = (iso: string) => new Date(iso).toLocaleString("en-GB");
const ICON: Record<DnsKind, typeof Globe> = { duckdns: Bird, cloudflare: Cloud, webhook: Webhook };

/* The steps for the provider chosen, ticked from what the panel holds.
   Numbered down a rail, the step to do next lit, the ones behind it
   ticked: the same picture as the dialog that follows a node in. */
function Guide({ kind, saved, written }: { kind: DnsKind; saved: boolean; written: number }) {
  const steps = guideFor(kind);
  const done = guideDone(kind, { saved, written });
  const current = done.findIndex((d) => !d);
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-baseline gap-2">
        <Label>Setup</Label>
        <span className="text-[13px] font-semibold tracking-[-0.01em]">{PITCH[kind].label}, step by step</span>
      </div>
      <ol className="flex flex-col">
        {steps.map((step, i) => (
          <li key={step.title} className="relative flex gap-3 pb-5 last:pb-0">
            {i < steps.length - 1 && <span aria-hidden className="absolute top-[26px] bottom-[2px] left-[10.5px] w-px bg-line" />}
            <span
              className={clsx(
                "relative grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border font-mono text-[10.5px]",
                done[i]
                  ? "border-success-line bg-success-soft text-success"
                  : i === current
                    ? "border-accent-line bg-accent-soft text-accent"
                    : "border-line bg-card text-ink-4",
              )}
            >
              {done[i] ? <Check size={12} strokeWidth={2.4} /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className={clsx("text-[13px] font-medium", done[i] && "text-ink-3")}>{step.title}</div>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-3">{step.body}</p>
              {step.link && (
                <a
                  href={step.link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-[5px] text-[12px] text-accent hover:underline"
                >
                  {step.link.label}
                  <ExternalLink size={11} strokeWidth={1.8} />
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/* The provider, for owners and admins.

   Without one it is a choice, the form, and the steps for the choice; with
   one it is a line saying which and whether it still works, and — until a
   server has a record — the next thing to do. A token is typed once into a
   field that is emptied when it has been saved, and never shown again. */
export function DnsProviderCard({ view, written }: { view: ProviderView; written: number }) {
  const { run, pending } = useOp();
  const { push } = useToast();
  const configured = view.kind !== null;
  const [editing, setEditing] = useState(!configured);
  const [armed, setArmed] = useState(false);
  const [kind, setKind] = useState<DnsKind>(view.kind ?? "duckdns");
  const [token, setToken] = useState("");
  const [zone, setZone] = useState(view.kind && DNS_PROVIDERS[view.kind].zoneFixed === null ? (view.zone ?? "") : "");
  const [checkHost, setCheckHost] = useState(view.checkHost ?? "");
  // A webhook's address is a secret and is never sent back, so a replacement is typed again.
  const [endpoint, setEndpoint] = useState("");
  const [made, setMade] = useState(false);
  const facts = DNS_PROVIDERS[kind];
  // What to call the other end in a sentence: a webhook's is the receiver somebody runs.
  const other = kind === "webhook" ? "the receiver" : PITCH[kind].label;

  // Cancelling goes back to what was there: the status line if there was a provider, the setup if there was none.
  const cancel = () => {
    setToken("");
    setEndpoint("");
    setMade(false);
    setEditing(!configured);
  };
  // A save that the provider accepted always ends on the status line.
  const saved = () => {
    setToken("");
    setEndpoint("");
    setMade(false);
    setEditing(false);
  };
  const makeSecret = async () => {
    const r = await makeWebhookSecret();
    if (r.ok) {
      setToken(r.secret);
      setMade(true);
    } else {
      push({ tone: "danger", title: r.title, body: r.body });
    }
  };

  if (!editing && view.kind) {
    const Icon = ICON[view.kind];
    return (
      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-3 p-5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <span className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl border border-accent-line bg-accent-soft text-accent">
              <Icon size={20} strokeWidth={1.7} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-[10px]">
                <span className="text-[15px] font-semibold tracking-[-0.01em]">{PITCH[view.kind].label}</span>
                <span className="font-mono text-[12px] text-ink-3">{view.zone}</span>
                {view.receiver && <span className="font-mono text-[12px] text-ink-4">→ {view.receiver}</span>}
                {view.checkError ? (
                  <Badge tone="danger">refused</Badge>
                ) : view.checkedAt ? (
                  <Badge tone="success">{view.kind === "webhook" ? "answered" : "accepted"} {when(view.checkedAt)}</Badge>
                ) : null}
              </div>
              <div className="mt-[5px] text-[11.5px] text-ink-4">
                Set{view.configuredBy ? ` by ${view.configuredBy}` : ""}
                {view.configuredAt ? `, ${when(view.configuredAt)}` : ""} · {view.kind === "webhook" ? "secret and address not shown" : "token not shown"}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1">
              <Button size="sm" intent="secondary" icon={RefreshCw} disabled={pending} onClick={() => run(() => checkDns())}>
                Check
              </Button>
              <Button size="sm" intent="ghost" disabled={pending} onClick={() => setEditing(true)}>
                Replace
              </Button>
              {armed ? (
                <span className="flex items-center gap-1">
                  <button type="button" onClick={() => setArmed(false)} className="rounded-md px-2 py-1 text-[10.5px] text-ink-4 hover:text-ink">
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => removeDns(), () => setArmed(false))}
                    className="rounded-md border border-danger-line bg-danger-soft px-2 py-1 text-[10.5px] font-medium text-danger hover:brightness-110"
                  >
                    Forget the provider
                  </button>
                </span>
              ) : (
                <Button size="sm" intent="ghost" icon={Trash2} disabled={pending} onClick={() => setArmed(true)}>
                  Remove
                </Button>
              )}
            </div>
          </div>
          {view.checkError && <p className="text-[11.5px] leading-snug text-danger">{view.checkError}</p>}
          {view.unreadable && (
            <p className="text-[11.5px] leading-snug text-danger">
              {view.kind === "webhook" ? "A secret and an address are" : "A token is"} saved here, and this panel cannot decrypt {view.kind === "webhook" ? "them" : "it"} — its SECRETS_KEY has changed since. Set {view.kind === "webhook" ? "them" : "it"} again.
            </p>
          )}
        </Card>

        {written === 0 && !view.unreadable && (
          <Card className="flex flex-col gap-3 border-accent-line p-5 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <Label className="text-accent">Next</Label>
              <div className="mt-1 text-[13.5px] font-semibold tracking-[-0.01em]">{guideFor(view.kind).at(-1)!.title}</div>
              <p className="mt-1 max-w-[74ch] text-[12px] leading-relaxed text-ink-3">{guideFor(view.kind).at(-1)!.body}</p>
            </div>
            <Link
              href="/servers/new"
              className="inline-flex shrink-0 items-center justify-center gap-[7px] rounded-[9px] bg-accent px-4 py-[9px] text-[13px] font-semibold text-accent-ink hover:brightness-110"
            >
              Create a server
              <ArrowRight size={14} strokeWidth={1.9} />
            </Link>
          </Card>
        )}
      </div>
    );
  }

  const Chosen = ICON[kind];
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <Card className="flex flex-col gap-5 p-5">
        <div>
          <Label>{configured ? "Replace the provider" : "Where do the records live?"}</Label>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 sm:[&>button:last-child:nth-child(odd)]:col-span-2">
            {DNS_KINDS.map((k) => {
              const Icon = ICON[k.id];
              const on = kind === k.id;
              return (
                <button
                  key={k.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setKind(k.id)}
                  className={clsx(
                    "flex flex-col gap-2 rounded-[12px] border p-4 text-left transition-colors duration-150",
                    on ? "border-accent-line bg-accent-soft" : "border-line bg-bg-2 hover:border-line-2",
                  )}
                >
                  <span className="flex items-center gap-2 text-[13.5px] font-semibold">
                    <Icon size={15} strokeWidth={1.8} className={on ? "text-accent" : "text-ink-3"} />
                    {PITCH[k.id].label}
                  </span>
                  <span className="text-[11.5px] leading-relaxed text-ink-3">{PITCH[k.id].pitch}</span>
                </button>
              );
            })}
          </div>
        </div>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => configureDns({ kind, token, zone, checkHost, endpoint }), saved);
          }}
        >
          {kind === "webhook" ? (
            <>
              <Field
                label="Signing secret"
                htmlFor="dns-token"
                hint="Make one, and put it in the receiver first: it checks every request against it, and the test that saves this is signed with it."
              >
                <div className="flex items-center gap-2">
                  <input
                    id="dns-token"
                    required
                    autoComplete="off"
                    spellCheck={false}
                    value={token}
                    onChange={(e) => {
                      setToken(e.target.value.trim());
                      setMade(false);
                    }}
                    className={inputClass(false, true)}
                  />
                  <Button type="button" size="sm" intent="secondary" icon={KeyRound} disabled={pending} onClick={makeSecret}>
                    Make one
                  </Button>
                  {token && <CopyName text={token} label="Copy" />}
                </div>
                {made && (
                  <p className="mt-[6px] text-[11.5px] leading-snug text-warning">
                    This is the only time it is shown. Copy it into the receiver now: once saved it is stored encrypted and cannot be read back.
                  </p>
                )}
              </Field>
              <Field label="Receiver's address" htmlFor="dns-endpoint" hint="https, or plain http on your own network where the operator has allowed that. It is stored encrypted and not shown again.">
                <input
                  id="dns-endpoint"
                  required
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="https://dns-hook.example.com/geeboard"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value.trim())}
                  className={inputClass(false, true)}
                />
              </Field>
            </>
          ) : (
            <Field
              label={`${PITCH[kind].label} token`}
              htmlFor="dns-token"
              hint={
                kind === "cloudflare"
                  ? "An API token with Zone → Zone → Read and Zone → DNS → Edit on the one zone. Not the global key."
                  : "The account token shown at the top of duckdns.org once signed in."
              }
            >
              <input
                id="dns-token"
                type="password"
                required
                autoComplete="new-password"
                spellCheck={false}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className={inputClass(false, true)}
              />
            </Field>
          )}
          {facts.zoneFixed === null ? (
            <Field
              label="Zone"
              htmlFor="dns-zone"
              hint={kind === "webhook" ? "The domain the receiver writes in. The panel sends nothing for a name that is not under it." : "The domain itself. A server gets a record when its address is under it."}
            >
              <input
                id="dns-zone"
                required
                spellCheck={false}
                placeholder="example.com"
                value={zone}
                onChange={(e) => setZone(e.target.value.trim().toLowerCase())}
                className={inputClass(false, true)}
              />
            </Field>
          ) : (
            <Field
              label="One of your subdomains"
              htmlFor="dns-check"
              hint="Made on duckdns.org first. It only checks the token: written back as it is, or cleared if it has no address yet."
            >
              <div className="flex items-center gap-1">
                <input
                  id="dns-check"
                  required
                  spellCheck={false}
                  placeholder="myserver"
                  value={checkHost}
                  onChange={(e) => setCheckHost(e.target.value.trim().toLowerCase())}
                  className={inputClass(false, true)}
                />
                <span className="shrink-0 font-mono text-[11px] text-ink-4">.duckdns.org</span>
              </div>
            </Field>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending} icon={Chosen}>
              {pending ? `Asking ${other}…` : "Test and save"}
            </Button>
            {configured && (
              <button type="button" onClick={cancel} className="text-[12px] text-ink-4 hover:text-ink">
                Cancel
              </button>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-ink-4">
            {kind === "webhook"
              ? "Saved only if the receiver answers a signed test with 2xx, which proves the address and the secret together. Both are stored encrypted and never shown again — not to you, not in the audit log, not to the API. Neither is ever sent to a node."
              : `Saved only if ${other} accepts it, stored encrypted, and never shown again — not to you, not in the audit log, not to the API. It is never sent to a node.`}
          </p>
        </form>
      </Card>

      <div className="lg:sticky lg:top-6">
        <Guide kind={kind} saved={configured && view.kind === kind} written={written} />
      </div>
    </div>
  );
}

export function RetryDns({ slug, small = false }: { slug: string; small?: boolean }) {
  const { run, pending } = useOp();
  return (
    <Button size="sm" intent={small ? "ghost" : "secondary"} icon={RefreshCw} disabled={pending} onClick={() => run(() => retryServerDns(slug))}>
      {pending ? "Trying…" : "Retry now"}
    </Button>
  );
}

/* A name to paste into duckdns.org's box, one press from the clipboard. */
export function CopyName({ text, label = "Copy name" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      intent="ghost"
      icon={copied ? Check : Copy}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* no clipboard here, over plain http or in a locked-down browser; the name is on screen */
        }
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}
