"use client";

import { Check, Info, Shield, TriangleAlert } from "lucide-react";
import clsx from "clsx";
import { Badge, Cover, Meter } from "@/components/ui";
import type { PlacementPreview } from "@/app/actions/nodes";
import {
  GAMES,
  formatReleased,
  gameById,
  portsFor,
  protocolLabel,
  templateById,
  versionById,
} from "@/lib/catalog";

/* The five step bodies. The wizard owns the draft and the chrome; each
   of these renders one decision and reports it back. */

/* How a server's files get onto the node, said the way an operator
   thinks about it. The wizard used to show the container image here,
   which is a true thing about the implementation and the wrong thing to
   put in front of somebody choosing a game to host. */
const INSTALL_LABEL: Record<string, string> = {
  image: "a maintained server build",
  steamcmd: "Steam",
  download: "the game's own download",
};

export interface NodeOption {
  name: string;
  city: string;
  region: string;
  state: string;
  pingMs: number;
  hasAgent: boolean;
  cpuCommitted: number;
  cpuTotal: number;
  ramCommitted: number;
  ramTotal: number;
  diskCommitted: number;
  diskTotal: number;
  servers: number;
}

export interface Draft {
  gameId: string;
  versionId: string;
  templateId: string;
  name: string;
  host: string;
  /* Once the address is typed by hand it stops following the name —
     otherwise renaming would silently move a server people connect to. */
  hostEdited: boolean;
  nodeName: string;
  memoryGb: number;
  cpuLimit: number;
  diskGb: number;
}

export type Patch = (values: Partial<Draft>) => void;

/* ── Shared pieces ────────────────────────────────────────────────── */

function Radio({ on }: { on: boolean }) {
  return (
    <span
      className={clsx(
        "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border",
        on ? "border-accent bg-accent text-accent-ink" : "border-line-2",
      )}
    >
      {on && <Check size={11} strokeWidth={3.4} />}
    </span>
  );
}

function Selectable({
  selected,
  onSelect,
  children,
  className,
}: {
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={clsx(
        "rounded-lg border bg-card p-[18px] text-left transition-[border-color,transform] duration-200 ease-(--ease-out-soft) hover:-translate-y-[3px]",
        selected
          ? "border-accent shadow-[0_0_0_3px_var(--accent-soft),var(--shadow-2)]"
          : "border-line shadow-e1 hover:border-line-2",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Heading({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="shrink-0">
      <h1 className="text-[28px] leading-[1.1] font-semibold tracking-[-0.03em]">{title}</h1>
      <p className="mt-[10px] max-w-[64ch] text-[13.5px] leading-relaxed text-ink-2">{blurb}</p>
    </div>
  );
}

const FIELD =
  "w-full rounded-[9px] border border-line bg-bg-2 px-3 py-[10px] text-[13px] outline-none transition-colors duration-150 placeholder:text-ink-4 hover:border-line-2 focus:border-accent-line";

/* ── 1 · Game ─────────────────────────────────────────────────────── */

export function GameStep({ draft, patch }: { draft: Draft; patch: Patch }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {GAMES.map((game) => {
        const selected = draft.gameId === game.id;
        return (
          <Selectable
            key={game.id}
            selected={selected}
            onSelect={() => {
              const version = game.versions.find((v) => v.recommended) ?? game.versions[0]!;
              /* Changing the game changes what every later step means,
                 so the defaults that come with it are taken too. */
              patch({
                gameId: game.id,
                versionId: version.id,
                templateId: game.templates[0]!.id,
                memoryGb: game.defaults.memoryGb,
                cpuLimit: game.defaults.cpuLimit,
                diskGb: game.defaults.diskGb,
              });
            }}
            className="flex flex-col gap-[14px]"
          >
            <div className="flex items-start gap-[14px]">
              <Cover tag={game.art} size={56} radius={13} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-[7px]">
                  <span className="min-w-0 truncate text-sm font-semibold tracking-[-0.015em]">
                    {game.name}
                  </span>
                  {game.official && (
                    <span title="Official image" className="shrink-0 text-accent">
                      <Shield size={14} strokeWidth={2} />
                    </span>
                  )}
                </div>
                <div className="mt-[5px] font-mono text-[10px] text-ink-4">{game.popularity}</div>
              </div>
              <Radio on={selected} />
            </div>
            <p className="text-[11.5px] leading-relaxed text-ink-3">{game.blurb}</p>
          </Selectable>
        );
      })}
    </div>
  );
}

/* ── 2 · Version ──────────────────────────────────────────────────── */

export function VersionStep({ draft, patch }: { draft: Draft; patch: Patch }) {
  const game = gameById(draft.gameId)!;

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-card shadow-e1">
      {game.versions.map((version, i) => {
        const selected = draft.versionId === version.id;
        return (
          <button
            key={version.id}
            type="button"
            aria-pressed={selected}
            onClick={() => patch({ versionId: version.id })}
            className={clsx(
              "flex w-full items-center gap-[14px] px-[22px] py-[15px] text-left transition-colors duration-150",
              i < game.versions.length - 1 && "border-b border-line",
              selected ? "bg-accent-soft" : "hover:bg-card-2",
            )}
          >
            <Radio on={selected} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-[9px]">
                <span className="text-[13px] font-medium">{version.label}</span>
                {version.recommended && <Badge>recommended</Badge>}
              </div>
              <div className="mt-1 truncate font-mono text-[10.5px] text-ink-4">{version.note}</div>
            </div>
            <div className="hidden shrink-0 text-right sm:block">
              <div className="font-mono text-[10.5px] text-ink-3">{formatReleased(version.released)}</div>
              <div className="mt-1 font-mono text-[9.5px] text-ink-4">{version.channel}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ── 3 · Template and identity ────────────────────────────────────── */

export function TemplateStep({
  draft,
  patch,
  domain,
  nameError,
}: {
  draft: Draft;
  patch: Patch;
  domain: string;
  nameError: string | null;
}) {
  const game = gameById(draft.gameId)!;

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_324px]">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {game.templates.map((template) => {
          const selected = draft.templateId === template.id;
          return (
            <Selectable
              key={template.id}
              selected={selected}
              onSelect={() => patch({ templateId: template.id })}
              className="flex flex-col gap-[10px]"
            >
              <div className="flex items-center gap-[10px]">
                <span className="text-[13.5px] font-semibold tracking-[-0.015em]">
                  {template.name}
                </span>
                <span className="ml-auto">
                  <Radio on={selected} />
                </span>
              </div>
              <p className="text-[11.5px] leading-relaxed text-ink-3">{template.blurb}</p>
              <div className="mt-auto border-t border-line pt-[10px] font-mono text-[10px] text-ink-4">
                {template.summary}
              </div>
            </Selectable>
          );
        })}
      </div>

      <div className="rounded-lg border border-line bg-card p-5 shadow-e1">
        <h2 className="mb-[14px] text-[13px] font-semibold">Name and address</h2>

        <label className="mb-[7px] block text-xs font-medium" htmlFor="server-name">
          Server name
        </label>
        <input
          id="server-name"
          className={FIELD}
          value={draft.name}
          maxLength={60}
          placeholder="Nightwatch"
          onChange={(e) => patch({ name: e.target.value })}
        />
        {nameError && <p className="mt-[7px] text-[11px] text-warning">{nameError}</p>}

        <label className="mt-4 mb-[7px] block text-xs font-medium" htmlFor="server-host">
          Address
        </label>
        <input
          id="server-host"
          className={clsx(FIELD, "font-mono text-[12px]")}
          value={draft.host}
          onChange={(e) => patch({ host: e.target.value, hostEdited: true })}
        />
        <p className="mt-[7px] text-[11px] leading-snug text-ink-4">
          {draft.hostEdited
            ? `Typed by hand, so it no longer follows the name. Anything under ${domain} works.`
            : `Follows the name until you change it. The port is allocated on the next step.`}
        </p>
      </div>
    </div>
  );
}

/* ── 4 · Resources ────────────────────────────────────────────────── */

function Slider({
  label,
  aside,
  value,
  min,
  max,
  step = 1,
  format,
  footnote,
  onChange,
}: {
  label: string;
  aside: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format: (n: number) => string;
  footnote: string;
  onChange: (n: number) => void;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="mb-3 flex items-baseline gap-[10px]">
        <label className="text-[13px] font-medium" htmlFor={`slider-${label}`}>
          {label}
        </label>
        <span className="text-[11.5px] text-ink-4">{aside}</span>
        <span className="tnum ml-auto font-mono text-[15px] font-medium">{format(value)}</span>
      </div>
      <input
        id={`slider-${label}`}
        type="range"
        className="gb-range"
        style={{ "--gb-fill": `${fill}%` } as React.CSSProperties}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="mt-2 flex justify-between font-mono text-[9.5px] text-ink-4">
        <span>{format(min)}</span>
        <span className="text-ink-3">{footnote}</span>
        <span>{format(max)}</span>
      </div>
    </div>
  );
}

export function ResourcesStep({
  draft,
  patch,
  nodes,
  portBase,
  portsPending,
  advice,
}: {
  draft: Draft;
  patch: Patch;
  nodes: NodeOption[];
  portBase: number | null;
  portsPending: boolean;
  advice: PlacementPreview | null;
}) {
  const game = gameById(draft.gameId)!;
  const node = nodes.find((n) => n.name === draft.nodeName);
  const ports = portBase === null ? [] : portsFor(game, portBase);

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_324px]">
      <div className="flex flex-col gap-6 rounded-lg border border-line bg-card p-6 shadow-e1">
        <Slider
          label="CPU limit"
          aside="percent of one core"
          value={draft.cpuLimit}
          min={game.limits.cpuLimit[0]}
          max={game.limits.cpuLimit[1]}
          step={50}
          format={(n) => `${n}%`}
          footnote={`${(draft.cpuLimit / 100).toFixed(draft.cpuLimit % 100 ? 1 : 0)} cores`}
          onChange={(cpuLimit) => patch({ cpuLimit })}
        />
        <Slider
          label="Memory"
          aside="hard ceiling"
          value={draft.memoryGb}
          min={game.limits.memoryGb[0]}
          max={game.limits.memoryGb[1]}
          format={(n) => `${n} GB`}
          footnote={`about ${Math.round(draft.memoryGb * 5)} players' worth`}
          onChange={(memoryGb) => patch({ memoryGb })}
        />
        <Slider
          label="Storage"
          aside="SSD quota, snapshots excluded"
          value={draft.diskGb}
          min={game.limits.diskGb[0]}
          max={game.limits.diskGb[1]}
          step={5}
          format={(n) => `${n} GB`}
          footnote="a world grows about 1 GB a week"
          onChange={(diskGb) => patch({ diskGb })}
        />

        <div className="border-t border-line pt-[22px]">
          <div className="mb-[14px] flex items-baseline gap-[10px]">
            <span className="text-[13px] font-medium">Ports</span>
            <span className="text-[11.5px] text-ink-4">
              {portsPending
                ? "asking the panel what is free…"
                : `allocated on ${draft.nodeName}`}
            </span>
          </div>

          {ports.length === 0 ? (
            <p className="rounded-[10px] border border-warning-line bg-warning-soft px-[13px] py-[11px] text-[11.5px] text-warning">
              {portsPending
                ? "Looking for a free block."
                : `${draft.nodeName} has no free ${game.name} port block left. Another node will have one.`}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {ports.map((port) => (
                <div
                  key={port.label}
                  className="flex items-center gap-3 rounded-[10px] border border-line bg-bg-2 px-[13px] py-[11px]"
                >
                  <span className="w-[56px] shrink-0 text-xs text-ink-2">{port.label}</span>
                  <span className="shrink-0 font-mono text-[12.5px]">{port.host}</span>
                  <span className="font-mono text-[10.5px] text-ink-4">
                    {protocolLabel(port.protocol)}
                    {port.note ? ` · ${port.note}` : ""}
                  </span>
                  {port.primary && (
                    <span className="ml-auto">
                      <Badge>primary</Badge>
                    </span>
                  )}
                </div>
              ))}
              <p className="mt-1 text-[11px] leading-snug text-ink-4">
                Reserved as a block, so the layout stays the same wherever this server lands. The
                allocation is confirmed when it is created.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <PlacementCard draft={draft} patch={patch} nodes={nodes} advice={advice} />
        {node && <LeavesCard draft={draft} node={node} />}
      </div>
    </div>
  );
}

export function PlacementCard({
  draft,
  patch,
  nodes,
  advice,
}: {
  draft: Draft;
  patch: Patch;
  nodes: NodeOption[];
  advice: PlacementPreview | null;
}) {
  return (
    <div className="rounded-lg border border-line bg-card p-5 shadow-e1">
      <h2 className="mb-[14px] text-[13px] font-semibold">Placement</h2>

      {/* The recommendation, with its arithmetic. A score nobody can
          reproduce is a score nobody trusts, so the reasons are shown
          rather than a number — and it stays a suggestion: the operator
          picks, and creation validates whatever they picked. */}
      {advice?.recommended && (
        <div className="mb-3 rounded-[10px] border border-accent-line bg-accent-soft px-3 py-[11px]">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11.5px]">
              Recommended: <span className="font-mono font-medium">{advice.recommended}</span>
            </span>
            {draft.nodeName !== advice.recommended && (
              <button
                type="button"
                onClick={() => patch({ nodeName: advice.recommended! })}
                className="shrink-0 text-[11px] font-medium text-accent hover:underline"
              >
                Use it
              </button>
            )}
          </div>
          <ul className="mt-[7px] flex flex-col gap-[3px]">
            {advice.reasons.map((reason) => (
              <li key={reason} className="flex gap-[7px] font-mono text-[10px] text-ink-3">
                <span className="text-accent">✓</span>
                {reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {advice?.refusal && (
        <div className="mb-3 rounded-[10px] border border-warning-line bg-warning-soft px-3 py-[11px]">
          <span className="text-[11.5px] text-warning">No node can take this server</span>
          <ul className="mt-[6px] flex flex-col gap-[3px]">
            {advice.refusal.map((reason) => (
              <li key={reason} className="font-mono text-[10px] text-ink-3">
                {reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {nodes.map((node) => {
          const selected = draft.nodeName === node.name;
          const closed =
            node.state === "DRAINING" ||
            node.state === "UNREACHABLE" ||
            node.state === "MAINTENANCE";
          const usedPct = Math.round((node.ramCommitted / node.ramTotal) * 100);
          const full = node.ramCommitted + draft.memoryGb > node.ramTotal;

          return (
            <button
              key={node.name}
              type="button"
              aria-pressed={selected}
              disabled={closed}
              onClick={() => patch({ nodeName: node.name })}
              className={clsx(
                "flex items-center gap-[11px] rounded-[10px] border px-3 py-[11px] text-left transition-colors duration-150",
                selected ? "border-accent-line bg-accent-soft" : "border-line bg-bg-2",
                closed ? "cursor-not-allowed opacity-50" : "hover:border-line-2",
              )}
            >
              <span
                className={clsx(
                  "h-[6px] w-[6px] shrink-0 rounded-full",
                  closed || full ? "bg-warning" : "bg-success",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-[11.5px]">{node.name}</span>
                <span className="mt-[2px] block text-[10.5px] text-ink-4">
                  {node.city} ·{" "}
                  {closed
                    ? node.state.toLowerCase()
                    : full
                      ? "no room for this one"
                      : `${usedPct}% committed`}
                  {!node.hasAgent && " · no agent"}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[10.5px] text-ink-3">{node.pingMs} ms</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Leave({
  label,
  committed,
  adding,
  total,
  unit,
}: {
  label: string;
  committed: number;
  adding: number;
  total: number;
  unit: string;
}) {
  const after = Math.min(100, Math.round(((committed + adding) / total) * 100));
  const over = committed + adding > total;
  return (
    <div className="border-b border-line py-[10px] last:border-b-0">
      <div className="mb-[7px] flex justify-between">
        <span className="text-[11.5px] text-ink-3">{label}</span>
        <span className={clsx("font-mono text-[10.5px]", over ? "text-danger" : "text-ink-2")}>
          {after}%
        </span>
      </div>
      <Meter value={after} colour={over ? "var(--danger)" : after > 85 ? "var(--warning)" : "var(--accent)"} />
      <div className="mt-[6px] font-mono text-[9.5px] text-ink-4">
        this one takes {adding} {unit} of {total} {unit}
      </div>
    </div>
  );
}

export function LeavesCard({ draft, node }: { draft: Draft; node: NodeOption }) {
  return (
    <div className="rounded-lg border border-line bg-card p-5 shadow-e1">
      <h2 className="mb-3 text-[13px] font-semibold">What this leaves</h2>
      <Leave
        label="CPU on node"
        committed={node.cpuCommitted / 100}
        adding={draft.cpuLimit / 100}
        total={node.cpuTotal / 100}
        unit="cores"
      />
      <Leave
        label="Memory on node"
        committed={node.ramCommitted}
        adding={draft.memoryGb}
        total={node.ramTotal}
        unit="GB"
      />
      <Leave
        label="Storage pool"
        committed={node.diskCommitted}
        adding={draft.diskGb}
        total={node.diskTotal}
        unit="GB"
      />
      <p className="mt-3 text-[11px] leading-snug text-ink-4">
        Committed, not used. {node.servers} server{node.servers === 1 ? "" : "s"} already hold their
        share of {node.name} whether or not anyone is playing.
      </p>
    </div>
  );
}

/* ── 5 · Review ───────────────────────────────────────────────────── */

function Row({
  label,
  value,
  note,
  onChange,
}: {
  label: string;
  value: string;
  note: string;
  onChange?: () => void;
}) {
  return (
    <div className="flex items-baseline gap-5 border-b border-line px-[22px] py-[15px] last:border-b-0">
      <span className="w-[104px] shrink-0 text-xs text-ink-4">{label}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{value}</div>
        <div className="mt-1 font-mono text-[10.5px] text-ink-4">{note}</div>
      </div>
      {onChange && (
        <button
          type="button"
          onClick={onChange}
          className="shrink-0 text-[11.5px] text-accent hover:underline"
        >
          Change
        </button>
      )}
    </div>
  );
}

function Milestone({ text, timing, last }: { text: string; timing: string; last?: boolean }) {
  return (
    <div className={clsx("flex gap-[13px]", !last && "pb-[14px]")}>
      <div className="relative flex w-[9px] shrink-0 justify-center pt-[5px]">
        <span className="z-1 h-[7px] w-[7px] shrink-0 rounded-full bg-accent shadow-[0_0_0_3px_var(--card)]" />
        {!last && <span className="absolute top-3 -bottom-3 w-px bg-line" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs leading-snug text-ink-2">{text}</div>
        <div className="mt-[3px] font-mono text-[9.5px] text-ink-4">{timing}</div>
      </div>
    </div>
  );
}

export function ReviewStep({
  draft,
  nodes,
  portBase,
  goTo,
}: {
  draft: Draft;
  nodes: NodeOption[];
  portBase: number | null;
  goTo: (step: number) => void;
}) {
  const game = gameById(draft.gameId)!;
  const version = versionById(game, draft.versionId)!;
  const template = templateById(game, draft.templateId)!;
  const node = nodes.find((n) => n.name === draft.nodeName)!;

  const roomy =
    node.ramCommitted + draft.memoryGb <= node.ramTotal &&
    node.cpuCommitted + draft.cpuLimit <= node.cpuTotal &&
    node.diskCommitted + draft.diskGb <= node.diskTotal;

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_324px]">
      <div className="overflow-hidden rounded-lg border border-line bg-card shadow-e1">
        <div className="flex items-center gap-3 border-b border-line bg-bg-2 px-[22px] py-4">
          <Cover tag={game.art} size={38} radius={10} />
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-[-0.015em]">
              {draft.name.trim() || "Untitled server"}
            </div>
            <div className="mt-[3px] font-mono text-[10px] text-ink-4">
              new server · not yet created
            </div>
          </div>
          <span className="ml-auto">
            <span className="inline-flex items-center gap-[7px] rounded-full border border-accent-line bg-accent-soft px-[10px] py-1 font-mono text-[10.5px] tracking-[0.03em] text-accent">
              <span className="h-[5px] w-[5px] rounded-full bg-current" />
              Ready to build
            </span>
          </span>
        </div>

        <Row
          label="Game"
          value={game.name}
          note={`${game.official ? "Officially supported" : "Community supported"} · installs from ${INSTALL_LABEL[game.install.kind]}`}
          onChange={() => goTo(1)}
        />
        <Row
          label="Version"
          value={version.label}
          note={`${version.note} · released ${formatReleased(version.released)}`}
          onChange={() => goTo(2)}
        />
        <Row label="Template" value={template.name} note={template.summary} onChange={() => goTo(3)} />
        <Row
          label="Resources"
          value={`${draft.memoryGb} GB memory · ${draft.cpuLimit}% CPU`}
          note={`${draft.diskGb} GB SSD quota`}
          onChange={() => goTo(4)}
        />
        <Row
          label="Node"
          value={node.name}
          note={`${node.city} · ${node.region} · ${node.pingMs} ms${node.hasAgent ? "" : " · no agent attached"}`}
          onChange={() => goTo(4)}
        />
        <Row
          label="Address"
          value={portBase === null ? draft.host : `${draft.host}:${portBase}`}
          note={
            portBase === null
              ? "no free port block on this node"
              : `${portsFor(game, portBase).length} ports reserved as a block`
          }
          onChange={() => goTo(3)}
        />
        <Row label="Backups" value="Daily at 03:00 UTC" note="Created with the server, and editable in the scheduler" />
      </div>

      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-line bg-card p-5 shadow-e1">
          <h2 className="mb-3 text-[13px] font-semibold">What happens next</h2>
          <Milestone text={`Claim the port block on ${node.name}`} timing="immediate" />
          <Milestone
            text={`Fetch ${game.name} ${version.label}`}
            timing="cached, or a minute the first time"
          />
          <Milestone text="Create the server and its data directory" timing="a few seconds" />
          <Milestone text="Start it and stream the first boot to the console" timing="about 40 seconds" last />
        </div>

        {node.hasAgent ? (
          <div
            className={clsx(
              "rounded-lg border p-5 shadow-e1",
              roomy
                ? "border-accent-line bg-linear-to-b from-accent-soft to-transparent"
                : "border-warning-line bg-warning-soft",
            )}
          >
            <div className="mb-[9px] flex items-center gap-[10px]">
              <span
                className={clsx(
                  "grid h-6 w-6 shrink-0 place-items-center rounded-[7px]",
                  roomy ? "bg-accent-soft text-accent" : "bg-warning-soft text-warning",
                )}
              >
                {roomy ? <Info size={13} strokeWidth={1.8} /> : <TriangleAlert size={13} strokeWidth={1.8} />}
              </span>
              <span className="text-[12.5px] font-semibold">
                {roomy ? `${node.name} has the headroom` : `${node.name} is too full`}
              </span>
            </div>
            <p className="text-[11.5px] leading-relaxed text-ink-3">
              {roomy
                ? `This takes ${draft.memoryGb} GB of the ${node.ramTotal - node.ramCommitted} GB still uncommitted. Deleting the server releases all of it.`
                : `Its committed totals do not leave room for ${draft.memoryGb} GB and ${draft.cpuLimit}% CPU. Pick another node or ask for less.`}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-warning-line bg-warning-soft p-5 shadow-e1">
            <div className="mb-[9px] flex items-center gap-[10px]">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[7px] bg-warning-soft text-warning">
                <TriangleAlert size={13} strokeWidth={1.8} />
              </span>
              <span className="text-[12.5px] font-semibold">This one will be simulated</span>
            </div>
            <p className="text-[11.5px] leading-relaxed text-ink-3">
              {node.name} has no agent attached, so nothing is provisioned. The server is real in the
              panel and nowhere else, and it is labelled that way wherever it appears.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
