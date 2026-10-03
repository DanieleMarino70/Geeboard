import { parseImage } from "./image-ref";
import { consolePatternsOf } from "./matcher";
import type { ConfigTarget, GameDefinition } from "./types";

/* What an owner reads before saying yes.

   Approving a game is letting an image somebody chose run on a node. What the
   owner is shown is not the manifest but what the panel *would do* with it: the
   image to the digest, the command and the environment it starts with, the
   ports it opens and to whom, the folders it is given, the words the panel
   will type at its console, the files it will write, the expressions it will
   run on every line it prints. Each is a plain sentence or a short row, in the
   order that someone checking a thing for danger would ask.

   Pure: a definition in, rows out. The page that draws them is
   app/games/community/[id]/page.tsx. */

export interface VersionPreview {
  id: string;
  label: string;
  note: string;
  channel: string;
  released: string;
  /** Installable now; a version marked otherwise is listed and never run. */
  supported: boolean;
  image: { written: string; registry: string; repository: string; tag: string | null; digest: string } | null;
  /** What the container is started with, one argument per entry. */
  args: string[];
  env: Array<{ name: string; value: string }>;
}

export interface PortPreview {
  id: string;
  label: string;
  protocol: string;
  /** Added to the block the node gives the server. */
  offset: number;
  /** The port inside the container, or null where it is the same as outside. */
  container: number | null;
  exposure: "everyone who can reach the node" | "the node itself only (127.0.0.1)";
}

export interface Preview {
  versions: VersionPreview[];
  ports: PortPreview[];
  mounts: Array<{ path: string; what: string }>;
  limits: Array<{ what: string; value: string }>;
  /** What the panel types at the game's console. */
  console: Array<{ when: string; text: string }>;
  probes: string[];
  /** Files in the server's folder that the panel writes, and how. */
  files: Array<{ file: string; how: string }>;
  settings: Array<{ key: string; label: string; type: string; where: string; secret: boolean }>;
  templates: Array<{ name: string; summary: string }>;
  expressions: Array<{ where: string; pattern: string }>;
  requires: string[];
  /** What the panel adds to the environment itself, whatever the manifest says. */
  panelEnv: string[];
}

function whereOf(target: ConfigTarget): string {
  switch (target.kind) {
    case "env":
      return `environment variable ${target.name}`;
    case "properties":
      return `${target.file}, key ${target.key}`;
    case "ini":
      return `${target.file}, [${target.section}] ${target.key}`;
    case "json":
      return `${target.file}, ${target.pointer}`;
    case "lua":
      return `${target.file}, ${target.table}.${target.key}`;
    case "lua-base":
      return `${target.file}, the base of ${target.table}`;
    case "arg":
      return `command-line flag ${target.flag}`;
  }
}

export function previewOf(game: GameDefinition): Preview {
  const installEnv = game.install.kind === "image" ? (game.install.env ?? {}) : {};

  const versions: VersionPreview[] = game.versions.map((v) => {
    const parsed = parseImage(v.image);
    return {
      id: v.id,
      label: v.label,
      note: v.note,
      channel: v.channel,
      released: v.released,
      supported: v.supported !== false,
      image: parsed.ok ? { written: v.image, registry: parsed.ref.registry, repository: parsed.ref.repository, tag: parsed.ref.tag, digest: parsed.ref.digest } : null,
      args: v.args ?? [],
      env: Object.entries({ ...installEnv, ...(v.env ?? {}) }).map(([name, value]) => ({ name, value })),
    };
  });

  const ports: PortPreview[] = game.ports.map((p) => ({
    id: p.id,
    label: p.label,
    protocol: p.protocol === "both" ? "TCP and UDP" : p.protocol.toUpperCase(),
    offset: p.offset,
    container: p.container ?? null,
    exposure: p.public === false ? "the node itself only (127.0.0.1)" : "everyone who can reach the node",
  }));

  const mounts = [
    { path: game.dataPath ?? "/data", what: "the server's own folder: its world, kept, backed up, shown in the file browser" },
    ...(game.cachePaths ?? []).map((path) => ({ path, what: "a cache: kept between rebuilds, in no backup, not shown in the file browser" })),
  ];

  const limits = [
    { what: "memory", value: `${game.limits.memoryGb[0]}–${game.limits.memoryGb[1]} GB (starts at ${game.defaults.memoryGb})` },
    { what: "CPU", value: `${game.limits.cpuLimit[0]}–${game.limits.cpuLimit[1]}% of a core (starts at ${game.defaults.cpuLimit}%)` },
    { what: "disk", value: `${game.limits.diskGb[0]}–${game.limits.diskGb[1]} GB (starts at ${game.defaults.diskGb})` },
    { what: "processes", value: "512, set by the node's agent" },
  ];

  const c = game.console;
  const typed: Array<{ when: string; text: string }> = [];
  if (c.stopCommand) typed.push({ when: "to stop it", text: c.stopCommand });
  if (c.saveCommand) typed.push({ when: "before a backup", text: c.saveCommand });
  if (c.resumeCommand) typed.push({ when: "after a backup", text: c.resumeCommand });
  if (c.saveReady) typed.push({ when: "to ask whether a save has finished", text: c.saveReady.command });
  if (c.broadcastCommand) typed.push({ when: "to tell the players something (%s is the message)", text: c.broadcastCommand });
  for (const probe of game.health.probes) if (probe.kind === "rcon") typed.push({ when: "over RCON, to check it answers", text: probe.command });

  const probes = game.health.probes.map((p) => {
    switch (p.kind) {
      case "port":
        return `Opens a connection to its ${p.port} port`;
      case "log":
        return `Waits for a console line matching ${p.pattern}`;
      case "query":
        return `Asks it a ${p.protocol} question${p.port ? ` on its ${p.port} port` : ""}`;
      case "rcon":
        return `Sends the RCON command ${p.command}`;
      case "process":
        return "Checks that the process is alive";
    }
  });

  /* The files the panel writes: the fixed ones the install names, and one entry per file a setting lands in. */
  const files = new Map<string, Set<string>>();
  const add = (file: string, how: string) => files.set(file, (files.get(file) ?? new Set()).add(how));
  if (game.install.kind === "image") for (const f of game.install.files ?? []) add(f.file, `fixed lines: ${Object.keys(f.entries).join(", ") || "none"}`);
  for (const field of game.config) {
    const t = field.target;
    if (t.kind !== "env" && t.kind !== "arg") add(t.file, `${t.kind} setting ${field.key}`);
  }

  const expressions: Array<{ where: string; pattern: string }> = [];
  const known = new Set<string>();
  const express = (where: string, pattern: string | undefined) => {
    if (pattern) expressions.push({ where, pattern });
    if (pattern) known.add(pattern);
  };
  express("ready line", game.health.readyPattern);
  express("crash line", game.health.crashPattern);
  game.health.failures?.forEach((f, i) => express(`known failure ${i + 1}: ${f.reason}`, f.pattern));
  game.health.probes.forEach((p, i) => p.kind === "log" && express(`health probe ${i + 1}`, p.pattern));
  express("a player joins", game.console.players?.join);
  express("a player leaves", game.console.players?.leave);
  express("a connection id", game.console.players?.connect);
  express("lines the health check causes", game.console.healthLines);
  express("a save has finished", game.console.saveReady?.pattern);
  // Anything consolePatternsOf finds that the above did not name: it would still be run.
  for (const pattern of consolePatternsOf(game)) if (!known.has(pattern)) expressions.push({ where: "a console line", pattern });
  for (const field of game.config) if (field.pattern) expressions.push({ where: `the value of the setting ${field.key}`, pattern: field.pattern.regex });

  return {
    versions,
    ports,
    mounts,
    limits,
    console: typed,
    probes,
    files: [...files].map(([file, how]) => ({ file, how: [...how].join("; ") })),
    settings: game.config.map((f) => ({ key: f.key, label: f.label, type: f.type, where: whereOf(f.target), secret: f.secret === true })),
    templates: game.templates.map((t) => ({ name: t.name, summary: t.summary })),
    expressions,
    requires: [...game.requirements.capabilities],
    panelEnv: ["GEEBOARD_SERVER", ...(game.resourceEnv?.memory ? [game.resourceEnv.memory.name] : []), ...Object.values(game.resourceEnv?.ports ?? {}), ...Object.keys(game.resourceEnv?.secrets ?? {})],
  };
}

/* What an image of a community game can do on the node it runs on, in the words the approval page uses. Measured, not
   assumed: .claude/prompts/0.6.0-parte-0-nota.md. The first list is what the agent will not give it; the second is what
   any container gets from Docker, which is what makes the second list the one to read. */
export const CANNOT_DO: readonly string[] = [
  "run privileged, add capabilities, or be given a device — the agent builds a container from a fixed list of options and a game cannot name others",
  "see the node's files: its only folder from the node is its own server's, and at most two cache folders beside it",
  "use the node's network stack instead of Docker's, or publish a port below 1024",
  "reach the Docker socket, the panel's database or the panel itself on a standard install: they are not where a container can get to them",
  "change an image after it was approved: it is named by digest, so a tag that moves does nothing",
];

export const CAN_DO: readonly string[] = [
  "run any program the image contains, as root inside its container, with Docker's default capabilities, for as long as it runs",
  "use as much of the memory and CPU it was given as it can, and write as much into its own folder as the disk allows",
  "talk to the Internet and to everything on the node's own network — including services on the node itself that listen on every address, such as SSH and the agent's port",
  "on a cloud machine, read the provider's metadata service at 169.254.169.254, which can hold credentials. This is measured on a real node, and is true of every game, not only these",
  "read, change or delete everything in its own server's folder: its world, its settings files and whatever else is there (the node keeps archives beside the folder, not in it, and does not mount them)",
];
