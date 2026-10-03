import { Check, X } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { CAN_DO, CANNOT_DO, type Preview } from "@/domain/games/preview";

/* What the panel would do with a manifest, drawn from previewOf(). Server-rendered: it reads, and decides nothing. */

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line px-5 py-3">
        <h2 className="text-[13.5px] font-semibold">{title}</h2>
        {hint && <p className="mt-[3px] max-w-[80ch] text-[11.5px] leading-snug text-ink-4">{hint}</p>}
      </div>
      <div className="px-5 py-4">{children}</div>
    </Card>
  );
}

const mono = "font-mono text-[11.5px] break-all";

function Rows({ rows }: { rows: Array<[React.ReactNode, React.ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-[7px] text-[12px]">
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-ink-4">{k}</dt>
          <dd className="min-w-0 text-ink-2">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SayWhatItCanDo() {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card className="p-5">
        <h2 className="flex items-center gap-2 text-[13.5px] font-semibold">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-warning-soft text-warning">
            <Check size={12} strokeWidth={2.4} />
          </span>
          What an image can do on the node
        </h2>
        <p className="mt-[4px] text-[11.5px] leading-snug text-ink-4">The part to read before approving. It is true of every container Docker runs, not only this one.</p>
        <ul className="mt-3 flex flex-col gap-[9px] text-[12px] leading-relaxed text-ink-2">
          {CAN_DO.map((s) => (
            <li key={s} className="flex gap-2">
              <span className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full bg-warning" />
              <span>{s}.</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="p-5">
        <h2 className="flex items-center gap-2 text-[13.5px] font-semibold">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-success-soft text-success">
            <X size={12} strokeWidth={2.4} />
          </span>
          What the agent will not give it
        </h2>
        <p className="mt-[4px] text-[11.5px] leading-snug text-ink-4">Held by the agent&apos;s own fixed container options, checked by a test on every release.</p>
        <ul className="mt-3 flex flex-col gap-[9px] text-[12px] leading-relaxed text-ink-2">
          {CANNOT_DO.map((s) => (
            <li key={s} className="flex gap-2">
              <span className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full bg-success" />
              <span>{s}.</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export function PreviewView({ preview }: { preview: Preview }) {
  return (
    <div className="flex flex-col gap-3">
      <Section title="Images" hint="Each version is one image, named by the digest of its content. A tag is shown for reading; the node pulls by the digest, so a tag that moves later changes nothing.">
        <div className="flex flex-col gap-4">
          {preview.versions.map((v) => (
            <div key={v.id} className="rounded-[9px] border border-line bg-card-2 px-4 py-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold">{v.label}</span>
                <span className="font-mono text-[10.5px] text-ink-4">{v.id}</span>
                <Badge tone="muted">{v.channel}</Badge>
                {!v.supported && <Badge tone="warning">never run</Badge>}
              </div>
              {v.image ? (
                <Rows
                  rows={[
                    ["Registry", <span key="r" className={mono}>{v.image.registry}</span>],
                    ["Repository", <span key="p" className={mono}>{v.image.repository}</span>],
                    ["Tag", <span key="t" className={mono}>{v.image.tag ?? "none"}</span>],
                    ["Digest", <span key="d" className={mono}>{v.image.digest}</span>],
                    [
                      "Starts with",
                      v.args.length > 0 ? (
                        <span key="a" className={mono}>{v.args.join(" ")}</span>
                      ) : (
                        <span key="a" className="text-ink-4">the image&apos;s own command</span>
                      ),
                    ],
                    [
                      "Environment",
                      v.env.length > 0 ? (
                        <span key="e" className="flex flex-col gap-[2px]">
                          {v.env.map((e) => (
                            <span key={e.name} className={mono}>
                              {e.name}={e.value}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span key="e" className="text-ink-4">none of its own</span>
                      ),
                    ],
                  ]}
                />
              ) : (
                <div className="text-[12px] text-danger">This image does not parse. It cannot be approved.</div>
              )}
              {v.note && <p className="mt-2 text-[11.5px] text-ink-4">{v.note}</p>}
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11.5px] leading-snug text-ink-4">
          The panel adds to the environment itself, whatever the manifest says: <span className="font-mono">{preview.panelEnv.join(", ")}</span>.
        </p>
      </Section>

      <div className="grid gap-3 lg:grid-cols-2">
        <Section title="Ports" hint="Opened on the node, from the block the panel gives the server.">
          <ul className="flex flex-col gap-[7px] text-[12px]">
            {preview.ports.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-medium">{p.label}</span>
                <span className="font-mono text-[11.5px] text-ink-3">
                  {p.protocol} · base + {p.offset}
                  {p.container !== null ? ` · ${p.container} inside` : ""}
                </span>
                <span className={p.exposure.startsWith("everyone") ? "text-warning" : "text-ink-4"}>{p.exposure}</span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Folders and limits">
          <div className="flex flex-col gap-3">
            <ul className="flex flex-col gap-[7px] text-[12px]">
              {preview.mounts.map((m) => (
                <li key={m.path}>
                  <span className={mono}>{m.path}</span> <span className="text-ink-4">— {m.what}</span>
                </li>
              ))}
            </ul>
            <Rows rows={preview.limits.map((l) => [l.what, l.value])} />
          </div>
        </Section>
      </div>

      <Section title="What the panel types and writes" hint="The words it will send to the game's console, and the files in the server's folder it will write.">
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <div className="mb-2 font-mono text-[10px] tracking-[0.05em] text-ink-4 uppercase">At the console</div>
            {preview.console.length === 0 ? (
              <p className="text-[12px] text-ink-4">Nothing: the panel stops it with a signal.</p>
            ) : (
              <ul className="flex flex-col gap-[6px] text-[12px]">
                {preview.console.map((c, i) => (
                  <li key={i}>
                    <span className={mono}>{c.text}</span> <span className="text-ink-4">— {c.when}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 mb-2 font-mono text-[10px] tracking-[0.05em] text-ink-4 uppercase">Health checks</div>
            <ul className="flex flex-col gap-[5px] text-[12px] text-ink-2">
              {preview.probes.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
              {preview.probes.length === 0 && <li className="text-ink-4">None.</li>}
            </ul>
          </div>
          <div>
            <div className="mb-2 font-mono text-[10px] tracking-[0.05em] text-ink-4 uppercase">Files written</div>
            {preview.files.length === 0 ? (
              <p className="text-[12px] text-ink-4">None: its settings go in through its environment and command line.</p>
            ) : (
              <ul className="flex flex-col gap-[6px] text-[12px]">
                {preview.files.map((f) => (
                  <li key={f.file}>
                    <span className={mono}>{f.file}</span> <span className="text-ink-4">— {f.how}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Section>

      <Section title={`Settings (${preview.settings.length})`} hint="What a person sees when creating a server, and where each answer lands.">
        {preview.settings.length === 0 ? (
          <p className="text-[12px] text-ink-4">None.</p>
        ) : (
          <ul className="grid gap-x-6 gap-y-[6px] text-[12px] md:grid-cols-2">
            {preview.settings.map((s) => (
              <li key={s.key} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{s.label}</span>
                <span className="font-mono text-[10.5px] text-ink-4">{s.type}</span>
                {s.secret && <Badge tone="warning">secret</Badge>}
                <span className="basis-full font-mono text-[11px] text-ink-4">{s.where}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title={`Expressions it will run (${preview.expressions.length})`}
        hint="Run on every line the game prints, each cut to 2000 characters and stopped after 25 ms. One that was too slow in a test, or could take unbounded time, was refused before this page."
      >
        <ul className="flex flex-col gap-[6px] text-[12px]">
          {preview.expressions.map((e, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-3">
              <span className="w-[16rem] max-w-full shrink-0 text-ink-4">{e.where}</span>
              <span className={mono}>{e.pattern}</span>
            </li>
          ))}
          {preview.expressions.length === 0 && <li className="text-ink-4">None.</li>}
        </ul>
      </Section>

      {preview.templates.length > 0 && (
        <Section title="Templates it brings">
          <ul className="flex flex-col gap-[6px] text-[12px]">
            {preview.templates.map((t) => (
              <li key={t.name}>
                <span className="font-medium">{t.name}</span> <span className="text-ink-4">— {t.summary}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Needs from a node">
        <div className="flex flex-wrap gap-[6px]">
          {preview.requires.map((r) => (
            <Badge key={r} tone={r === "community-games" ? "warning" : "muted"}>
              {r}
            </Badge>
          ))}
        </div>
        <p className="mt-2 text-[11.5px] leading-snug text-ink-4">
          <span className="font-mono">community-games</span> is declared on the machine, at install — the panel has no switch for it. A node that has not will be refused for this game, and says why.
        </p>
      </Section>
    </div>
  );
}
