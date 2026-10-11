"use client";

import { useMemo, useState, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { useAction } from "@/components/use-action";
import { saveSettings } from "@/app/actions/settings";
import { Field, inputClass } from "@/components/form";
import { useToast } from "@/components/toast";
import { Card } from "@/components/ui";
import { settingsHostHint } from "@/domain/dns/address";
import type { DnsKind } from "@/domain/dns/rules";
import { plainTest, validateConfig } from "@/domain/games/config";
import type { ConfigField, ConfigValue, GameDefinition } from "@/domain/games/types";
import type { ConfigDrift } from "@/lib/config-ops";
import {
  PLATFORM_FLOOR,
  SETTINGS_LABELS,
  limitsForSaved,
  settingsWarnings,
  validateSettings,
  type SettingsErrors,
  type SettingsInput,
  type SettingsLimits,
} from "@/lib/settings-rules";
import { changedGameKeys, changedServerKeys, pendingChanges, shownServerValue, summarize } from "@/lib/settings-summary";
import { AssignOwner } from "./assign-owner";
import { CopyServer } from "./copy-server";
import { DangerZone } from "./danger-zone";
import { GameSettings } from "./game-settings";
import { MoveServer } from "./move-server";
import { LeaveGuard } from "./leave-guard";
import { SaveBar } from "./save-bar";
import { SectionMap, type Section } from "./section-map";

export interface ServerSettings extends SettingsInput {
  slug: string;
  port: number;
  version: string;
  node: string;
  worldSize: string;
  /** A real workload exists, so new resource limits need a rebuild to apply. */
  rebuildable: boolean;
  /** The reader may rebuild it (server.update): only then does a change of limits offer to rebuild as it saves. */
  canRebuild: boolean;
  /** The reader may change these settings; otherwise the form is shown and not offered. */
  editable: boolean;
  /** The DNS provider and its zone, or null with none: decides what the address hint promises. */
  dns: { kind: DnsKind; zone: string } | null;
}

export interface GameSection {
  name: string;
  fields: ConfigField[];
  /** What the server has: its files where they could be read, the stored settings otherwise. */
  initial: Record<string, ConfigValue>;
  drift: ConfigDrift[];
  hidden: string[];
  /* A game Geeboard ships, whose patterns are code that was read and can be run in the browser as a value is typed. A community game's are
     a stranger's, and are only run by the panel under a time limit (domain/games/regex-guard.ts): its values are checked when saved. */
  trusted: boolean;
}

const SERVER_FIELD_ID: Record<keyof SettingsInput, string> = {
  name: "s-name",
  host: "s-host",
  memoryLimit: "s-memory",
  cpuLimit: "s-cpu",
  restartPolicy: "s-policy",
  maxRestarts: "s-attempts",
};

/* The server's Settings page: the game's settings, the server's own, what is done to the server rather than set on it, and deleting it,
   in that order, with one save for everything that is saved.

   It was two forms with a save each, one at the top for the name, address, limits and restart policy, and one at the bottom for the
   game, with the owner, the move, the copy and the Danger zone between them. Somebody who changed the MOTD and the CPU limit had to save
   twice and was not told. Now there is one dirty state for the page, every changed field is marked, and a bar at the foot of the window
   says what the save will change and what it costs before it is pressed (lib/settings-summary.ts); the save checks both parts before it
   writes either (lib/settings-save.ts).

   Controlled, and saved by calling the action rather than submitting to it: a form action resets the form when it finishes, so a save the
   server refused threw away what had been typed. Errors are shown beside the field they belong to, as the value is typed, using the same
   rules the save applies, and a refusal from the save is put on its field too. */
export function SettingsForm({
  server,
  limits,
  game,
  ownership,
  danger,
}: {
  server: ServerSettings;
  limits: SettingsLimits;
  game: GameSection | null;
  /* The owner, the move and the copy: actions with their own buttons, not settings. Each null for a reader who is not given it, and the
     whole section null when none is. Given as what they show rather than drawn by the page: elements made on the server and handed to this
     component arrived as a list React asked keys of. */
  ownership: {
    owner: ComponentProps<typeof AssignOwner> | null;
    move: ComponentProps<typeof MoveServer> | null;
    copy: ComponentProps<typeof CopyServer> | null;
  } | null;
  /** Null for a reader who may not delete the server. */
  danger: ComponentProps<typeof DangerZone> | null;
}) {
  const initial: SettingsInput = {
    name: server.name,
    host: server.host,
    memoryLimit: server.memoryLimit,
    cpuLimit: server.cpuLimit,
    restartPolicy: server.restartPolicy,
    maxRestarts: server.maxRestarts,
  };
  const [values, setValues] = useState<SettingsInput>(initial);
  const [gameValues, setGameValues] = useState<Record<string, ConfigValue>>(game?.initial ?? {});
  const [refusedServer, setRefusedServer] = useState<SettingsErrors>({});
  const [refusedGame, setRefusedGame] = useState<Record<string, string>>({});
  /* What the last save was refused with, said in the bar rather than in a toast: the toast sat over the bar's own buttons, and the bar is where
     somebody looks after pressing Save. Gone with the next change. */
  const [refusal, setRefusal] = useState<{ title: string; body: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, start] = useAction();
  const { push } = useToast();
  const router = useRouter();

  const serverChanged = changedServerKeys(initial, values);
  const gameChanged = game ? changedGameKeys(game.fields, game.initial, gameValues) : [];
  const dirty = serverChanged.length > 0 || gameChanged.length > 0;

  // The rules the save applies, the saved memory limit included.
  const rules = limitsForSaved(limits, initial.memoryLimit);
  const serverProblems = validateSettings(values, rules);
  const gameProblems = useMemo(() => {
    if (!game) return {};
    const test = game.trusted ? plainTest : () => true;
    // validateConfig reads a definition's name and settings, and nothing else of it.
    const problems = validateConfig({ name: game.name, config: game.fields } as GameDefinition, gameValues, test);
    return Object.fromEntries(problems.map((p) => [p.key, `${p.message.charAt(0).toUpperCase()}${p.message.slice(1)}.`]));
  }, [game, gameValues]);

  /* Errors show once something differs from what was saved, not on a pristine page; once anything has changed, every error shows, because
     each one holds the save. What the save refused shows until the field it is about changes. */
  const serverErrors: SettingsErrors = { ...(dirty ? serverProblems : {}), ...refusedServer };
  const gameErrors: Record<string, string> = { ...(dirty ? gameProblems : {}), ...refusedGame };
  const invalid = [
    ...(game ? game.fields.filter((f) => gameErrors[f.key]).map((f) => ({ id: `cfg-${f.key}`, label: f.label })) : []),
    ...(Object.keys(serverErrors) as Array<keyof SettingsInput>).map((k) => ({ id: SERVER_FIELD_ID[k], label: SETTINGS_LABELS[k] })),
  ];

  const changes = pendingChanges({
    game: game ? { fields: game.fields, initial: game.initial, values: gameValues } : undefined,
    server: { initial, values, limitsNeedRebuild: server.rebuildable },
  });
  const summary = summarize(changes);
  const offerRebuild = summary.gameNeedsRebuild || (summary.rebuild > 0 && server.canRebuild);
  const limitsChanged = serverChanged.includes("memoryLimit") || serverChanged.includes("cpuLimit");
  /* Under what the game asks for is allowed, and said. The same words
     the create wizard puts under its sliders. */
  const advice = settingsWarnings(values, limits);

  const set = <K extends keyof SettingsInput>(key: K, value: SettingsInput[K]) => {
    setRefusal(null);
    setRefusedServer((r) => without(r, key));
    setValues((v) => ({ ...v, [key]: value }));
  };
  const setGame = (key: string, value: ConfigValue) => {
    setRefusal(null);
    setRefusedGame((r) => without(r, key));
    setGameValues((v) => ({ ...v, [key]: value }));
  };
  const discard = () => {
    setValues(initial);
    setGameValues(game?.initial ?? {});
    setRefusedServer({});
    setRefusedGame({});
    setRefusal(null);
  };

  const send = (rebuild: boolean) =>
    start(async () => {
      const result = await saveSettings(server.slug, {
        server: serverChanged.length > 0 ? values : undefined,
        game: gameChanged.length > 0 ? gameValues : undefined,
        rebuild,
      });
      setConfirming(false);
      if (!result.ok) {
        setRefusedServer(result.errors?.server ?? {});
        setRefusedGame(result.errors?.game ?? {});
        // The page thought no rebuild was needed and the save says one is: asked, as if the bar had known.
        if (result.needsRebuild) setConfirming(true);
        else setRefusal({ title: result.title, body: result.body });
        return;
      }
      push({ tone: result.tone, title: result.title, body: result.body });
      // The page is drawn again with the saved values, and keyed on them (page.tsx): the form starts over from them, clean.
      router.refresh();
    });

  const save = () => (offerRebuild ? setConfirming(true) : send(false));
  const canSave = server.editable && dirty && invalid.length === 0 && !saving;
  const showProblem = () => {
    const first = invalid[0] && document.getElementById(invalid[0].id);
    if (first) {
      first.scrollIntoView({ block: "center" });
      first.focus({ preventScroll: true });
    }
  };

  const number = (raw: string) => (raw.trim() === "" ? Number.NaN : Number(raw));
  const was = (k: keyof SettingsInput) => (serverChanged.includes(k) ? shownServerValue(k, initial[k]) : undefined);
  const pendingIn = (section: "game" | "server") => changes.filter((c) => c.section === section).length;

  const sections: Section[] = [
    ...(game ? [{ id: "game", label: "Game", pending: pendingIn("game") }] : []),
    { id: "server", label: "Server", pending: pendingIn("server") },
    ...(ownership ? [{ id: "ownership", label: "Ownership and reuse" }] : []),
    ...(danger ? [{ id: "danger", label: "Danger" }] : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-start gap-2 lg:flex-row lg:items-end">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Settings</h1>
          <p className="mt-[7px] text-[12.5px] leading-snug text-ink-3">
            {server.name} · every change is recorded in the audit log.
          </p>
        </div>
        {/* Shown, not offered, to whoever may not change it: every account
            may open this page, and a Save that is refused only once it is
            sent is a form that said the opposite of what was true. */}
        {!server.editable && (
          <p className="max-w-[46ch] text-[11.5px] leading-relaxed text-ink-4 lg:ml-auto lg:text-right">
            Only the server&apos;s owner and admins can change this server&apos;s settings.
          </p>
        )}
      </div>

      <SectionMap sections={sections} />

      {/* Enter in a field saves, as it did when each half was a form of its own, unless the save would rebuild: that is asked first. */}
      <div
        className="flex flex-col gap-6"
        onKeyDown={(e) => {
          if (e.key !== "Enter" || !(e.target instanceof HTMLInputElement) || e.target.type === "checkbox") return;
          e.preventDefault();
          if (canSave) save();
        }}
      >
        {game && (
          <section id="game" aria-labelledby="section-game" className="flex scroll-mt-[124px] flex-col gap-3">
            <SectionHeading id="section-game" title="Game">
              What {game.name} itself reads. Saved with the bar at the foot of the page; each group says what saving it does.
            </SectionHeading>
            <GameSettings
              gameName={game.name}
              fields={game.fields}
              initial={game.initial}
              values={gameValues}
              onChange={setGame}
              errors={gameErrors}
              drift={game.drift}
              hidden={game.hidden}
              readOnly={!server.editable}
            />
          </section>
        )}

        <section id="server" aria-labelledby="section-server" className="flex scroll-mt-[124px] flex-col gap-3">
          <SectionHeading id="section-server" title="Server">
            How the panel runs it: its name and address, its limits, and what happens when it stops. Saved with the same bar.
          </SectionHeading>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
            <fieldset disabled={!server.editable} className="flex min-w-0 flex-col gap-4">
              <Card className="p-[22px]">
                <h3 className="mb-1 text-sm font-semibold tracking-[-0.015em]">Identity</h3>
                <p className="mb-5 text-[11.5px] leading-snug text-ink-4">
                  How the server appears in this panel and the address you give players; saved at once. What the game itself shows in its
                  server list is in the game&apos;s settings above.
                </p>
                <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2">
                  <Field quiet label="Server name" htmlFor="s-name" error={serverErrors.name} hint="Shown in the panel." was={was("name")}>
                    <input
                      id="s-name"
                      value={values.name}
                      maxLength={60}
                      onChange={(e) => set("name", e.target.value)}
                      className={inputClass(Boolean(serverErrors.name))}
                    />
                  </Field>
                  <Field
                    quiet
                    label="Address"
                    htmlFor="s-host"
                    aside={`port ${server.port}`}
                    error={serverErrors.host}
                    hint={settingsHostHint(server.dns)}
                    was={was("host")}
                  >
                    <input
                      id="s-host"
                      value={values.host}
                      spellCheck={false}
                      onChange={(e) => set("host", e.target.value)}
                      className={inputClass(Boolean(serverErrors.host), true)}
                    />
                  </Field>
                </div>
              </Card>

              <Card className="p-[22px]">
                <h3 className="mb-1 text-sm font-semibold tracking-[-0.015em]">Resources</h3>
                <p className="mb-5 text-[11.5px] leading-snug text-ink-4">
                  Hard ceilings, not reservations — the server can use up to them and no further. They are fixed when the server&apos;s
                  workload is made{server.rebuildable ? ", so a change reaches the server when it is rebuilt" : ""}.
                </p>
                <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2">
                  <Field
                    quiet
                    label="Memory limit"
                    htmlFor="s-memory"
                    aside="GB"
                    error={serverErrors.memoryLimit}
                    was={was("memoryLimit")}
                    hint={`${PLATFORM_FLOOR.memoryGb}–${limits.memoryGb[1]} GB${
                      limits.recommended ? `, ${limits.recommended.memoryGb} asked for by this game` : ""
                    }${
                      limits.memoryAvailableGb !== null ? `; ${Math.max(limits.memoryAvailableGb, initial.memoryLimit)} GB available on ${server.node}` : ""
                    }.`}
                  >
                    <input
                      id="s-memory"
                      type="number"
                      inputMode="numeric"
                      min={PLATFORM_FLOOR.memoryGb}
                      max={limits.memoryGb[1]}
                      step={1}
                      value={Number.isNaN(values.memoryLimit) ? "" : values.memoryLimit}
                      onChange={(e) => set("memoryLimit", number(e.target.value))}
                      className={inputClass(Boolean(serverErrors.memoryLimit), true)}
                    />
                    {!serverErrors.memoryLimit && advice.memoryLimit && <Caution text={advice.memoryLimit} />}
                  </Field>
                  <Field
                    quiet
                    label="CPU limit"
                    htmlFor="s-cpu"
                    aside="% of a core"
                    error={serverErrors.cpuLimit}
                    was={was("cpuLimit")}
                    hint={`${PLATFORM_FLOOR.cpuLimit}–${limits.cpuLimit[1]}%${
                      limits.recommended ? `, ${limits.recommended.cpuLimit} asked for by this game` : ""
                    }. 200% is two cores.`}
                  >
                    <input
                      id="s-cpu"
                      type="number"
                      inputMode="numeric"
                      min={PLATFORM_FLOOR.cpuLimit}
                      max={limits.cpuLimit[1]}
                      step={25}
                      value={Number.isNaN(values.cpuLimit) ? "" : values.cpuLimit}
                      onChange={(e) => set("cpuLimit", number(e.target.value))}
                      className={inputClass(Boolean(serverErrors.cpuLimit), true)}
                    />
                    {!serverErrors.cpuLimit && advice.cpuLimit && <Caution text={advice.cpuLimit} />}
                  </Field>
                </div>
                {limitsChanged && server.rebuildable && (
                  <p className="mt-4 rounded-[9px] border border-warning-line bg-warning-soft px-3 py-[10px] text-[11.5px] leading-relaxed text-warning-fg">
                    {server.canRebuild
                      ? "New limits reach the server when it is rebuilt: Save and rebuild does it now, or saves them for a rebuild later. A restart keeps the old ones."
                      : "New limits reach the server when it is rebuilt, which an owner or an admin does from its page. A restart keeps the old ones."}
                  </p>
                )}
              </Card>

              <Card className="p-[22px]">
                <h3 className="mb-1 text-sm font-semibold tracking-[-0.015em]">When it stops unexpectedly</h3>
                <p className="mb-4 text-[11.5px] leading-snug text-ink-4">Saved at once, and used the next time it stops.</p>
                {/* A policy rather than a switch, because "restart it" and "how
                    many times before giving up" are different questions and only
                    the second one stops a crash loop. */}
                <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2">
                  <Field quiet label="Policy" htmlFor="s-policy" error={serverErrors.restartPolicy} was={was("restartPolicy")}>
                    <select
                      id="s-policy"
                      value={values.restartPolicy}
                      onChange={(e) => set("restartPolicy", e.target.value as SettingsInput["restartPolicy"])}
                      className={inputClass(Boolean(serverErrors.restartPolicy))}
                    >
                      <option value="NEVER">Leave it down</option>
                      <option value="ON_FAILURE">Restart after a crash</option>
                      <option value="ALWAYS">Restart whenever it stops</option>
                    </select>
                  </Field>
                  <Field
                    quiet
                    label="Attempts before giving up"
                    htmlFor="s-attempts"
                    error={serverErrors.maxRestarts}
                    was={was("maxRestarts")}
                    hint="Waits longer between each. The count starts over once a run has lasted."
                  >
                    <input
                      id="s-attempts"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={10}
                      step={1}
                      disabled={values.restartPolicy === "NEVER"}
                      value={Number.isNaN(values.maxRestarts) ? "" : values.maxRestarts}
                      onChange={(e) => set("maxRestarts", number(e.target.value))}
                      className={inputClass(Boolean(serverErrors.maxRestarts), true)}
                    />
                  </Field>
                </div>
              </Card>
            </fieldset>

            <div>
              <Card className="px-5 py-[18px] xl:sticky xl:top-[124px]">
                <h3 className="mb-3 text-[13px] font-semibold">This server</h3>
                {(
                  [
                    ["Version", server.version],
                    ["Node", server.node],
                    ["World size", server.worldSize],
                    ["Address", `${server.host}:${server.port}`],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="flex items-baseline gap-[10px] border-b border-line py-2 last:border-b-0">
                    <span className="w-[74px] shrink-0 text-[11.5px] text-ink-4">{k}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{v}</span>
                  </div>
                ))}
              </Card>
            </div>
          </div>
        </section>
      </div>

      {ownership && (
        <section id="ownership" aria-labelledby="section-ownership" className="mt-2 flex scroll-mt-[124px] flex-col gap-3">
          <SectionHeading id="section-ownership" title="Ownership and reuse">
            Things done to the server rather than set on it. Each acts on its own button, at once, and none of them is part of the save bar.
          </SectionHeading>
          {ownership.owner && <AssignOwner {...ownership.owner} />}
          {ownership.move && <MoveServer {...ownership.move} />}
          {ownership.copy && <CopyServer {...ownership.copy} />}
        </section>
      )}

      {danger && (
        <section id="danger" aria-labelledby="section-danger" className="mt-2 flex scroll-mt-[124px] flex-col gap-3">
          <SectionHeading id="section-danger" title="Danger">
            What cannot be undone.
          </SectionHeading>
          <DangerZone {...danger} />
        </section>
      )}

      {server.editable && dirty && (
        <SaveBar
          changes={changes}
          summary={summary}
          invalid={invalid.map((i) => i.label)}
          refusal={refusal}
          offerRebuild={offerRebuild}
          saving={saving}
          confirming={confirming}
          serverName={server.name}
          onDiscard={discard}
          onSave={save}
          onConfirm={(answer) => {
            if (answer === null) setConfirming(false);
            else send(answer === "rebuild");
          }}
          onShowProblem={showProblem}
        />
      )}
      <LeaveGuard dirty={server.editable && dirty && !saving} count={summary.count} />
    </div>
  );
}

function SectionHeading({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-[3px] border-b border-line pb-2">
      <h2 id={id} className="text-[15px] font-semibold tracking-[-0.015em]">
        {title}
      </h2>
      <p className="text-[11.5px] leading-snug text-ink-3">{children}</p>
    </div>
  );
}

/* A value the form will save and thinks you should know about — under
   what the game asks for. Deliberately not an error: the field saves,
   the server is created, and whoever is paying for the machine decides
   how much of it one game gets. */
function Caution({ text }: { text: string }) {
  return (
    <p className="mt-[6px] flex items-start gap-[7px] text-[11px] leading-relaxed text-warning-fg">
      <TriangleAlert size={12} strokeWidth={1.9} className="mt-[2px] shrink-0" />
      <span>{text}</span>
    </p>
  );
}

/** What the save refused, less the field that has just been changed. */
function without<T extends Record<string, unknown>>(errors: T, key: keyof T): T {
  const rest = { ...errors };
  delete rest[key];
  return rest;
}
