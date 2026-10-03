"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Bell, Check, Copy, Link2, MessageSquare, Power, RefreshCw, Send, Trash2 } from "lucide-react";
import { addChannel, changeChannel, removeChannel, rotateChannelKey, testChannel } from "@/app/actions/notifications";
import { Field, Notice, inputClass } from "@/components/form";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, Label } from "@/components/ui";
import type { ChannelResult, ChannelView, NotificationsView } from "@/lib/notify/channel-ops";

/* The channels, one card each, and the form that adds another. Everything
   typed here is an address or a name: the address is typed once, into a field
   that is emptied when it has been saved, and never comes back — the page
   shows where a channel goes and which events it hears, and that is all. */

const when = (iso: string) => new Date(iso).toLocaleString("en-GB");

function useOp() {
  const [pending, start] = useTransition();
  const { push } = useToast();
  const router = useRouter();
  const run = (fn: () => Promise<ChannelResult>, then?: (r: ChannelResult) => void) =>
    start(async () => {
      const r = await fn();
      push(r.ok ? { tone: r.tone, title: r.title, body: r.body } : { tone: "danger", title: r.title, body: r.body });
      if (r.ok) then?.(r);
      router.refresh();
    });
  return { run, pending };
}

/* A signing key is shown once, here, with a way to copy it, and leaves the page when it is dismissed. */
function ShownOnce({ secret, onDone }: { secret: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Card className="flex flex-col gap-3 border-warning-line p-5">
      <Label className="text-warning">Signing key — shown once</Label>
      <p className="max-w-[74ch] text-[12px] leading-relaxed text-ink-3">
        Every message to this webhook carries a signature made with this key
        (<span className="font-mono">X-Geeboard-Signature</span>). Whatever receives them can check it; copy it now, the
        panel will not show it again. If it is lost, make a new one.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-[9px] border border-line bg-bg-2 px-3 py-[9px] font-mono text-[12px]">{secret}</code>
        <Button
          size="sm"
          intent="secondary"
          icon={copied ? Check : Copy}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(secret);
              setCopied(true);
            } catch {
              /* no clipboard here, over plain http; the key is on screen */
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button size="sm" intent="ghost" onClick={onDone}>
          I have it
        </Button>
      </div>
    </Card>
  );
}

function Choices({
  all,
  chosen,
  onChange,
  disabled,
}: {
  all: NotificationsView["choices"];
  chosen: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-[7px]">
      {all.map((c) => (
        <label key={c.id} className="flex items-start gap-2 text-[12px] text-ink-2">
          <input
            type="checkbox"
            className="mt-[2px]"
            checked={chosen.includes(c.id)}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked ? [...chosen, c.id] : chosen.filter((x) => x !== c.id))}
          />
          <span>
            {c.label}
            <span className="block text-[11px] leading-snug text-ink-4">{c.note}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function ChannelCard({ channel, choices, onSecret }: { channel: ChannelView; choices: NotificationsView["choices"]; onSecret: (s: string) => void }) {
  const { run, pending } = useOp();
  const [armed, setArmed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [chosen, setChosen] = useState(channel.choices);
  const Icon = channel.kind === "DISCORD" ? MessageSquare : Link2;

  return (
    <Card className={clsx("flex flex-col gap-3 p-5", !channel.enabled && "opacity-80")}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <span className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl border border-accent-line bg-accent-soft text-accent">
          <Icon size={20} strokeWidth={1.7} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-[10px]">
            <span className="text-[15px] font-semibold tracking-[-0.01em]">{channel.name}</span>
            <Badge tone="muted">{channel.kind === "DISCORD" ? "Discord" : "Webhook"}</Badge>
            {!channel.enabled && <Badge tone="warning">off</Badge>}
            {channel.lastError ? <Badge tone="danger">last send failed</Badge> : channel.lastOkAt ? <Badge tone="success">last sent {when(channel.lastOkAt)}</Badge> : null}
          </div>
          <div className="mt-[5px] font-mono text-[11.5px] text-ink-4">{channel.goes} · address not shown</div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          <Button size="sm" intent="secondary" icon={Send} disabled={pending || channel.unreadable} onClick={() => run(() => testChannel(channel.id))}>
            Send a test
          </Button>
          <Button size="sm" intent="ghost" icon={Power} disabled={pending} onClick={() => run(() => changeChannel(channel.id, { enabled: !channel.enabled }))}>
            {channel.enabled ? "Turn off" : "Turn on"}
          </Button>
          <Button size="sm" intent="ghost" disabled={pending} onClick={() => setEditing((e) => !e)}>
            {editing ? "Done" : "Events"}
          </Button>
          {channel.signed && (
            <Button size="sm" intent="ghost" icon={RefreshCw} disabled={pending} onClick={() => run(() => rotateChannelKey(channel.id), (r) => r.secret && onSecret(r.secret))}>
              New key
            </Button>
          )}
          {armed ? (
            <span className="flex items-center gap-1">
              <button type="button" onClick={() => setArmed(false)} className="rounded-md px-2 py-1 text-[10.5px] text-ink-4 hover:text-ink">
                Cancel
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => removeChannel(channel.id), () => setArmed(false))}
                className="rounded-md border border-danger-line bg-danger-soft px-2 py-1 text-[10.5px] font-medium text-danger hover:brightness-110"
              >
                Remove {channel.name}
              </button>
            </span>
          ) : (
            <Button size="sm" intent="ghost" icon={Trash2} disabled={pending} onClick={() => setArmed(true)}>
              Remove
            </Button>
          )}
        </div>
      </div>

      {channel.lastError && (
        <p className="text-[11.5px] leading-snug text-danger">
          {channel.lastError}
          {channel.lastErrorAt ? ` (${when(channel.lastErrorAt)})` : ""}
        </p>
      )}
      {channel.unreadable && (
        <p className="text-[11.5px] leading-snug text-danger">
          The address is saved here, and this panel cannot decrypt it — its SECRETS_KEY changed since, without{" "}
          <span className="font-mono">rekey</span>. Remove the channel and add it again.
        </p>
      )}
      {(channel.pending > 0 || channel.failed > 0) && (
        <p className="text-[11px] text-ink-4">
          {channel.pending > 0 ? `${channel.pending} waiting to be sent` : ""}
          {channel.pending > 0 && channel.failed > 0 ? " · " : ""}
          {channel.failed > 0 ? `${channel.failed} given up on` : ""}
        </p>
      )}

      {editing ? (
        <div className="flex flex-col gap-3 border-t border-line pt-3">
          <Choices all={choices} chosen={chosen} onChange={setChosen} disabled={pending} />
          <div>
            <Button size="sm" disabled={pending || chosen.length === 0} onClick={() => run(() => changeChannel(channel.id, { choices: chosen }), () => setEditing(false))}>
              Save events
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-[6px]">
          {choices
            .filter((c) => channel.choices.includes(c.id))
            .map((c) => (
              <span key={c.id} className="rounded-full border border-line bg-card-2 px-[9px] py-[3px] text-[11px] text-ink-3">
                {c.label}
              </span>
            ))}
          {channel.choices.length === 0 && <span className="text-[11.5px] text-ink-4">No events chosen: this channel hears nothing.</span>}
        </div>
      )}
    </Card>
  );
}

function AddChannel({ view, onSecret }: { view: NotificationsView; onSecret: (s: string) => void }) {
  const { run, pending } = useOp();
  const [kind, setKind] = useState<"DISCORD" | "WEBHOOK">("DISCORD");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [chosen, setChosen] = useState(view.choices.map((c) => c.id));

  return (
    <Card className="flex flex-col gap-5 p-5">
      <div>
        <Label>{view.channels.length === 0 ? "Where should it tell you?" : "Add a channel"}</Label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {(
            [
              { id: "DISCORD", icon: MessageSquare, label: "Discord", pitch: "A channel on your server. Make a webhook there (Channel settings → Integrations) and paste its address." },
              { id: "WEBHOOK", icon: Link2, label: "A webhook", pitch: "Anything that takes a JSON POST: ntfy, Gotify, Home Assistant, your own code. Messages are signed so you can check they are ours." },
            ] as const
          ).map((k) => {
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
                  <k.icon size={15} strokeWidth={1.8} className={on ? "text-accent" : "text-ink-3"} />
                  {k.label}
                </span>
                <span className="text-[11.5px] leading-relaxed text-ink-3">{k.pitch}</span>
              </button>
            );
          })}
        </div>
      </div>

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () => addChannel({ name, kind, url, choices: chosen }),
            (r) => {
              setUrl("");
              setName("");
              if (r.secret) onSecret(r.secret);
            },
          );
        }}
      >
        <Field label="Name" htmlFor="channel-name" hint="What it is called here. Two words, not a secret.">
          <input id="channel-name" required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "DISCORD" ? "Crew channel" : "Ops webhook"} className={inputClass(false)} />
        </Field>
        <Field
          label={kind === "DISCORD" ? "Webhook address" : "Address"}
          htmlFor="channel-url"
          hint={
            kind === "DISCORD"
              ? "https://discord.com/api/webhooks/… — only what Discord itself gives you is accepted."
              : view.privateAllowed
                ? "https:// to a public address; http:// and private network addresses are allowed on this panel."
                : "https:// to a public address. Private network addresses are not allowed here."
          }
        >
          <input
            id="channel-url"
            type="password"
            required
            autoComplete="new-password"
            spellCheck={false}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={kind === "DISCORD" ? "https://discord.com/api/webhooks/…" : "https://hooks.example.com/…"}
            className={inputClass(false, true)}
          />
        </Field>
        <div className="flex flex-col gap-2">
          <Label>Tell it about</Label>
          <Choices all={view.choices} chosen={chosen} onChange={setChosen} disabled={pending} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending || view.full || chosen.length === 0} icon={Bell}>
            {pending ? "Sending a test…" : "Send a test and save"}
          </Button>
          {view.full && <span className="text-[11.5px] text-ink-4">Ten channels is the most; remove one first.</span>}
        </div>
        <p className="text-[11px] leading-relaxed text-ink-4">
          Saved only if the test message goes through, stored encrypted, and never shown again — not to you, not in the
          audit log, not to the API.
        </p>
      </form>
    </Card>
  );
}

const STATE_TONE = { SENT: "success", PENDING: "warning", FAILED: "danger" } as const;

export function NotificationsPanel({ view }: { view: NotificationsView }) {
  const [secret, setSecret] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {secret && <ShownOnce secret={secret} onDone={() => setSecret(null)} />}

      {view.channels.map((c) => (
        <ChannelCard key={c.id} channel={c} choices={view.choices} onSecret={setSecret} />
      ))}

      <AddChannel view={view} onSecret={setSecret} />

      <Notice tone={view.privateAllowed ? "warning" : "info"}>
        {view.privateAllowed ? (
          <>
            This panel is allowed to call addresses on private networks from a webhook, because{" "}
            <span className="font-mono">{view.variable}=1</span> is set on the machine. Whoever can type an address here
            can make the panel call anything on its network. The machine itself and cloud metadata addresses stay
            refused.
          </>
        ) : (
          <>
            A webhook may only call public addresses, and Discord only its own. To send to something on your own
            network — ntfy or Home Assistant on the LAN — the person who runs the panel sets{" "}
            <span className="font-mono">{view.variable}=1</span> in the panel&apos;s environment and restarts it. It is
            not a setting on this page, on purpose.
          </>
        )}
        {!view.linksOn && (
          <>
            {" "}
            <span className="font-mono">PANEL_URL</span> is not set, so messages carry no link back to the panel.
          </>
        )}
      </Notice>

      {view.deliveries.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-line px-5 py-3">
            <Label>Latest messages</Label>
          </div>
          <ul className="divide-y divide-line">
            {view.deliveries.map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-[10px] text-[12px]">
                <Badge tone={STATE_TONE[d.state]}>{d.state === "SENT" ? "sent" : d.state === "PENDING" ? "waiting" : "given up"}</Badge>
                <span className="font-medium text-ink-2">{d.title}</span>
                <span className="text-ink-4">to {d.channel}</span>
                <span className="ml-auto font-mono text-[10.5px] text-ink-4">{when(d.at)}</span>
                {d.error && <span className="w-full text-[11px] leading-snug text-danger">{d.error}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
