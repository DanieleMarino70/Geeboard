import { queryPlan } from "../servers/query";
import { followProblems } from "./followed";
import type { ConfigField, GameDefinition } from "./types";

/* What makes a definition consistent, in one place for every game.

   This was the body of a loop in registry.ts, run once at module load over the
   games Geeboard ships. It is a function over one definition now because a game
   can come from a manifest too, and the same rules have to hold for it: a
   definition with two versions sharing an id, or a port layout with two
   primaries, is a mistake whichever way it arrived. What this does NOT check is
   whether a definition is safe — that is domain/games/manifest.ts, which asks
   more of a game somebody else wrote.

   Returns every problem, each starting with the game's id; empty when the
   definition is consistent. */

/** What a definition may not name yet, and why, in the words an author is told. */
export const UNSUPPORTED = {
  json: "targets a JSON file, which the panel cannot write yet: a setting can go in an environment variable, a properties or ini file, a Lua table, a Source .cfg or a command-line flag",
  download: "installs from a download, which the panel does not run yet: use an image",
} as const;

export function auditDefinition(game: GameDefinition): string[] {
  const problems: string[] = [];

  const versions = new Set<string>();
  for (const version of game.versions) {
    if (versions.has(version.id)) problems.push(`${game.id}: duplicate version ${version.id}`);
    versions.add(version.id);
  }
  /* A former id that is also a live id, or that two versions both
     claim, would make a lookup by it answer with whichever came first. */
  const former = new Set<string>();
  for (const version of game.versions) {
    for (const id of version.formerIds ?? []) {
      if (versions.has(id)) problems.push(`${game.id}: former id ${id} is still a version id`);
      if (former.has(id)) problems.push(`${game.id}: two versions claim former id ${id}`);
      former.add(id);
    }
  }
  if (game.versions.length === 0) problems.push(`${game.id}: no versions`);
  if (game.followTags) problems.push(...followProblems(game, game.followTags));

  const primaries = game.ports.filter((p) => p.primary).length;
  if (primaries !== 1) problems.push(`${game.id}: ${primaries} primary ports, expected exactly 1`);

  const offsets = new Set(game.ports.map((p) => p.offset));
  if (offsets.size !== game.ports.length) problems.push(`${game.id}: two ports share an offset`);

  const keys = new Set(game.config.map((f) => f.key));
  /* One key may be several fields, one per version line, and only
     then: two fields for the same key on the same line — or one of
     them on every line — would leave the form showing both. */
  const lines = new Set(game.versions.map((v) => v.line ?? ""));
  for (const key of keys) {
    const same = game.config.filter((f) => f.key === key);
    if (same.length < 2) continue;
    for (const line of lines) {
      const onLine = same.filter((f) => !f.lines || f.lines.includes(line)).length;
      if (onLine > 1) problems.push(`${game.id}: two config fields share the key ${key} on line ${line || "(default)"}`);
    }
  }
  for (const field of game.config) {
    for (const line of field.lines ?? []) {
      if (!lines.has(line)) problems.push(`${game.id}: ${field.key} names a version line "${line}" the game does not have`);
    }
    // A Lua base with no way to spell it, or a companion with no key.
    if (field.target.kind === "lua-base" && field.type !== "enum") {
      problems.push(`${game.id}: ${field.key} is a Lua base and has to be an enum`);
    }
    if (field.target.kind === "lua") {
      for (const extra of field.target.also ?? []) {
        if (!extra.key || (extra.value === undefined && !extra.byValue)) {
          problems.push(`${game.id}: ${field.key} has a companion assignment with nothing to write`);
        }
      }
    }
    /* A password that forgot to say so would be shown to every account
       and written into the audit log. The next game's is caught here. */
    if (/pass(word)?\b|pwd/i.test(`${field.key} ${field.label}`) && field.secret !== true) {
      problems.push(`${game.id}: ${field.key} looks like a password and is not marked secret`);
    }
  }

  for (const template of game.templates) {
    for (const key of Object.keys(template.config)) {
      if (!keys.has(key)) problems.push(`${game.id}/${template.id}: unknown config key ${key}`);
    }
  }

  /* What the panel cannot do yet, refused where an author finds out. The manifest's parser refuses these with reasons; a built-in definition
     passed this audit and failed at the first create, after the row and the port existed: a JSON file is not written, a download install is
     not run. (An rcon probe is skipped rather than refused, and a manifest may carry one: that is a documented boundary, not a refusal.)
     One list, so the two cannot drift (test/extension-guards.test.ts holds them to each other). */
  for (const field of game.config) {
    if ((field.target.kind as string) === "json") problems.push(`${game.id}: ${field.key} ${UNSUPPORTED.json}`);
  }
  if ((game.install.kind as string) === "download") problems.push(`${game.id}: ${UNSUPPORTED.download}`);

  /* A notice that never matches is a notice nobody sees, and its link is a page the panel sends people to. */
  for (const field of game.config) {
    if (!field.notice) continue;
    try {
      new RegExp(field.notice.when);
    } catch {
      problems.push(`${game.id}: ${field.key}'s notice does not compile`);
    }
    if (field.notice.link && !/^https:\/\/[^\s"<>]+$/.test(field.notice.link.href)) {
      problems.push(`${game.id}: ${field.key}'s notice links to something that is not an https address`);
    }
  }

  /* A variable two settings write is one variable: either every setting on it says it is a part of it, or the last one rendered
     quietly wins and the others are lost — Valheim's preset and its modifiers, all in SERVER_ARGS. */
  const byVariable = new Map<string, ConfigField[]>();
  for (const field of game.config) {
    if (field.target.kind === "env") byVariable.set(field.target.name, [...(byVariable.get(field.target.name) ?? []), field]);
  }
  for (const [name, fields] of byVariable) {
    const keys = new Set(fields.map((f) => f.key));
    if (keys.size > 1 && fields.some((f) => f.target.kind === "env" && !f.target.joined)) {
      problems.push(`${game.id}: ${[...keys].join(", ")} all write ${name}, and not all of them as a part of it (joined)`);
    }
  }

  /* An empty choice that says what it means has to read a setting the game has, under values that setting can take, and say it as
     one of its own options; and a list of names to choose from must not offer one the setting would then refuse. */
  for (const field of game.config) {
    if (field.presetValues) {
      // The setting it reads on each line this one is on: a field on every line reads every line's.
      const deciders = game.config.filter((f) => f.key === field.presetValues!.key && (!f.lines || !field.lines || f.lines.some((l) => field.lines!.includes(l))));
      if (deciders.length === 0) problems.push(`${game.id}: ${field.key}'s presetValues read ${field.presetValues.key}, which it does not have`);
      for (const value of Object.keys(field.presetValues.values)) {
        if (deciders.length > 0 && !deciders.some((d) => !d.options || d.options.some((o) => o.value === value))) {
          problems.push(`${game.id}: ${field.key}'s presetValues name ${value}, which ${field.presetValues.key} does not offer`);
        }
      }
      if (!field.options?.some((o) => o.value === "")) problems.push(`${game.id}: ${field.key} has presetValues and no empty choice to show them on`);
    }
    for (const choice of field.choices?.values ?? []) {
      if (field.pattern && !new RegExp(field.pattern.regex).test(choice.value)) {
        problems.push(`${game.id}: ${field.key} offers ${choice.value}, which its own pattern refuses`);
      }
    }
    if (field.choices && field.type !== "string") problems.push(`${game.id}: ${field.key} offers choices and is not a string`);
  }

  const { memoryGb, cpuLimit, diskGb } = game.limits;
  if (game.defaults.memoryGb < memoryGb[0] || game.defaults.memoryGb > memoryGb[1]) {
    problems.push(`${game.id}: default memory is outside its own limits`);
  }
  if (game.defaults.cpuLimit < cpuLimit[0] || game.defaults.cpuLimit > cpuLimit[1]) {
    problems.push(`${game.id}: default CPU is outside its own limits`);
  }
  if (game.defaults.diskGb < diskGb[0] || game.defaults.diskGb > diskGb[1]) {
    problems.push(`${game.id}: default disk is outside its own limits`);
  }
  if (game.requirements.memoryGbMin > memoryGb[1]) {
    problems.push(`${game.id}: requires more memory than its own ceiling allows`);
  }

  /* A player pattern that does not compile, or has no name to read,
     would fail silently in the poller on every pass. */
  for (const [which, pattern] of Object.entries(game.console.players ?? {})) {
    try {
      const hasName = pattern.includes("(?<name>");
      const hasId = pattern.includes("(?<id>");
      if (which === "join" && !hasName) problems.push(`${game.id}: player join pattern has no name group`);
      // A leave by id alone needs a connect line to have paired the id with a name.
      if (which === "leave" && !hasName && !(hasId && game.console.players?.connect)) {
        problems.push(`${game.id}: player leave pattern has no name group and no connect pattern to resolve an id`);
      }
      if (which === "connect" && !hasId) problems.push(`${game.id}: player connect pattern has no id group`);
      new RegExp(pattern);
    } catch {
      problems.push(`${game.id}: player ${which} pattern does not compile`);
    }
  }

  /* A port the resource environment names that the game does not have
     would simply never be set — and the second server on a node would
     send its players to the first one's port. */
  for (const role of Object.keys(game.resourceEnv?.ports ?? {})) {
    if (!game.ports.some((p) => p.id === role)) problems.push(`${game.id}: resourceEnv names a port "${role}" it does not have`);
  }
  /* A query is asked on one of the game's own ports, over the transport
     that port is published on. Named wrongly, the node refuses the
     question on every pass and the probe reads as never run. */
  for (const probe of game.health.probes) {
    if (probe.kind !== "query") continue;
    for (const condition of probe.when ?? []) {
      if (!game.config.some((f) => f.key === condition.key)) {
        problems.push(`${game.id}: the ${probe.protocol} query depends on a setting "${condition.key}" the game does not have`);
      }
    }
    const plan = queryPlan(probe.protocol);
    if (!plan) continue;
    const id = probe.port ?? plan.defaultPort;
    const port = game.ports.find((p) => p.id === id);
    if (!port) problems.push(`${game.id}: the ${probe.protocol} query names a port "${id}" the game does not have`);
    else if (port.protocol !== "both" && port.protocol !== plan.transport) {
      problems.push(`${game.id}: the ${probe.protocol} query is ${plan.transport} and port "${id}" is ${port.protocol}`);
    }
  }
  /* What the console types to have the game list its commands (ConsoleDialect.commands): lines it can take — Garry's Mod's cut one
     at 254 characters — and a file in the server's own folder, where the panel can read it back. */
  const listing = game.console.commands;
  if (listing) {
    if (listing.ask.length === 0 || listing.ask.length > 10) problems.push(`${game.id}: the console's command list is asked for in no lines, or too many`);
    for (const line of listing.ask) {
      if (line.length === 0 || line.length > 250 || /[\u0000-\u001f\u007f]/.test(line)) {
        problems.push(`${game.id}: a line asking for the console's commands is empty, longer than 250 characters, or not one line`);
      }
    }
    if (!/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_./-]{1,200}$/.test(listing.file)) {
      problems.push(`${game.id}: the console's command list is not a file in the server's own folder`);
    }
  }
  // A resume with nothing paused before it is a command sent for no reason.
  if (game.console.resumeCommand && !game.console.saveCommand) {
    problems.push(`${game.id}: resumeCommand without a saveCommand to undo`);
  }
  // The prefix is what the console redaction matches on.
  for (const [name, prefix] of Object.entries(game.resourceEnv?.secrets ?? {})) {
    if (!/^[a-z][a-z0-9]{2,15}$/.test(prefix)) problems.push(`${game.id}: secret ${name} needs a short lowercase prefix`);
  }
  for (const field of game.config) {
    for (const other of [field.requiredWhen?.key, field.mustNotContain, field.shownWhen?.key]) {
      if (other && !game.config.some((f) => f.key === other)) {
        problems.push(`${game.id}: ${field.key} refers to a setting "${other}" it does not have`);
      }
    }
  }

  /* A setting shown by another one's value (ConfigField.shownWhen) has to be one whose absence means something — not written is a
     variable left out, or a .cfg line taken out — and has to read values the other setting can have, without reading round in a circle;
     one emptied out of its file (unsetWhenEmpty) is a .cfg line, and empty by default, or it would be taken out the first time it is saved. */
  for (const field of game.config) {
    const rule = field.shownWhen;
    if (rule) {
      if (field.target.kind !== "env" && field.target.kind !== "cvar") {
        problems.push(`${game.id}: ${field.key} is shown by another setting and is not an environment variable or a cvar`);
      }
      if (rule.oneOf.length === 0) problems.push(`${game.id}: ${field.key} is shown by no value of ${rule.key}`);
      const decider = game.config.find((f) => f.key === rule.key);
      for (const value of rule.oneOf) {
        if (decider?.options && !decider.options.some((o) => o.value === value)) {
          problems.push(`${game.id}: ${field.key} is shown when ${rule.key} is ${String(value)}, which it does not offer`);
        }
      }
      const seen = new Set([field.key]);
      for (let at = decider; at?.shownWhen; at = game.config.find((f) => f.key === at!.shownWhen!.key)) {
        if (seen.has(at.key)) {
          problems.push(`${game.id}: ${field.key} is shown by a chain of settings that comes back to itself`);
          break;
        }
        seen.add(at.key);
      }
    }
    if (field.unsetWhenEmpty) {
      if (field.target.kind !== "cvar") problems.push(`${game.id}: ${field.key} is taken out of its file when empty and is not a cvar`);
      if (field.default !== "") problems.push(`${game.id}: ${field.key} is taken out of its file when empty and does not start empty`);
    }
    // Written as "", a number is read as 0 by the engine; only one taken out of its file when empty may start empty.
    if (field.type === "number" && field.default === "" && !field.unsetWhenEmpty) {
      problems.push(`${game.id}: ${field.key} is a number that starts empty and is not taken out of its file when empty`);
    }
  }


  return problems;
}
