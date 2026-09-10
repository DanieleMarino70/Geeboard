import type { GameDefinition, HealthProbe } from "../games/types";

/* Is the game answering?

   A running container is not a healthy game server. It is the thing an
   operator most wants to believe and the thing least worth believing:
   a Minecraft server that has run out of heap keeps its container alive
   while refusing every connection, and a Zomboid server that failed to
   load its map sits there consuming CPU and accepting nobody.

   So health is a question about the game, asked with the probes the
   game's own definition names. The definition decides which; this
   decides what the answers add up to. */

export type HealthVerdict =
  /** Every probe that ran, passed. */
  | "healthy"
  /** A probe failed, and the server has had long enough to boot. */
  | "unhealthy"
  /** Still inside its boot grace. Not yet news. */
  | "booting"
  /** Nothing could be checked. Not the same as healthy. */
  | "unknown";

export interface ProbeOutcome {
  kind: HealthProbe["kind"];
  label: string;
  /** null when the probe could not be run at all. */
  ok: boolean | null;
  detail?: string;
}

export interface HealthReport {
  verdict: HealthVerdict;
  probes: ProbeOutcome[];
  /** The first failure, phrased for a person. Null when nothing failed. */
  reason: string | null;
  /** Probes Geeboard cannot execute yet, named rather than hidden. */
  skipped: string[];
  /** How long the server has been up, in seconds. Null when it is not. */
  uptimeSeconds: number | null;
}

/* What the poller gathered before asking. Deliberately plain data: the
   whole point of separating this out is that the arithmetic can be
   tested without a node, a socket or a clock that moves. */
export interface HealthEvidence {
  running: boolean;
  startedAt: Date | null;
  /* TCP reachability per port id, as reported by the node. `null` means
     the probe could not be attempted — a node that did not answer is
     not a failing game server. */
  ports: Record<string, boolean | null>;
  /** Recent console output, newest last. */
  logLines: string[];
  now?: Date;
}

/* Probe kinds that need a game's own wire protocol.

   Implementing them means either teaching the node to speak Minecraft's
   handshake and Source's A2S — game knowledge in the one place it must
   not go — or giving it an endpoint that writes arbitrary bytes to a
   port on request, which is a port scanner with an HTTP interface.
   Neither is worth doing casually, so for now they are named as skipped
   and a verdict is never claimed on their behalf. */
const NOT_YET_EXECUTABLE: ReadonlySet<HealthProbe["kind"]> = new Set(["query", "rcon"]);

function labelFor(probe: HealthProbe): string {
  switch (probe.kind) {
    case "port":
      return `Port ${probe.port} accepting connections`;
    case "log":
      return "Console reported it ready";
    case "query":
      return `Game query (${probe.protocol})`;
    case "rcon":
      return "RCON responding";
    case "process":
      return "Process running";
  }
}

export function assessServerHealth(
  game: Pick<GameDefinition, "health" | "name">,
  evidence: HealthEvidence,
): HealthReport {
  const now = evidence.now ?? new Date();
  const uptimeSeconds = evidence.startedAt
    ? Math.max(0, Math.round((now.getTime() - evidence.startedAt.getTime()) / 1000))
    : null;

  /* A server that is not running is not unhealthy — it is off, which is
     a state the panel already has a word for. Health only has anything
     to say about something that is supposed to be serving players. */
  if (!evidence.running) {
    return { verdict: "unknown", probes: [], reason: null, skipped: [], uptimeSeconds: null };
  }

  const probes: ProbeOutcome[] = [];
  const skipped: string[] = [];

  for (const probe of game.health.probes) {
    const label = labelFor(probe);

    if (NOT_YET_EXECUTABLE.has(probe.kind)) {
      skipped.push(label);
      probes.push({ kind: probe.kind, label, ok: null, detail: "not implemented yet" });
      continue;
    }

    probes.push(run(probe, label, evidence));
  }

  /* The crash pattern is not one of the game's probes — it is a fact
     about what the server said, and it outranks anything the probes
     found. A process that has printed an out-of-memory error is not
     healthy because its port still answers. */
  const crashed = matches(game.health.crashPattern, evidence.logLines);
  if (crashed) {
    probes.push({
      kind: "log",
      label: "No crash reported",
      ok: false,
      detail: crashed,
    });
  }

  const failure = probes.find((p) => p.ok === false);
  const ran = probes.some((p) => p.ok !== null);

  /* Inside the boot grace, a failing probe is expected rather than
     alarming. Rust generates its map for a quarter of an hour and
     Zomboid builds its map cache; calling either unhealthy would
     restart a server that was working perfectly. */
  const booting =
    uptimeSeconds !== null && uptimeSeconds < game.health.bootGraceSeconds && Boolean(failure);

  const verdict: HealthVerdict = booting
    ? "booting"
    : !ran
      ? "unknown"
      : failure
        ? "unhealthy"
        : "healthy";

  return {
    verdict,
    probes,
    reason: verdict === "unhealthy" ? (failure?.detail ?? failure?.label ?? null) : null,
    skipped,
    uptimeSeconds,
  };
}

function run(probe: HealthProbe, label: string, evidence: HealthEvidence): ProbeOutcome {
  switch (probe.kind) {
    case "port": {
      const reachable = evidence.ports[probe.port];
      if (reachable === undefined || reachable === null) {
        return { kind: probe.kind, label, ok: null, detail: "the node did not answer" };
      }
      return {
        kind: probe.kind,
        label,
        ok: reachable,
        detail: reachable ? undefined : `nothing is listening on the ${probe.port} port`,
      };
    }

    case "log": {
      const hit = matches(probe.pattern, evidence.logLines);
      /* No console output at all is not a failure. A server whose logs
         have rotated past its startup line is still running, and
         reporting it as unhealthy on that basis would be worse than
         saying nothing. */
      if (evidence.logLines.length === 0) {
        return { kind: probe.kind, label, ok: null, detail: "no recent console output" };
      }
      return {
        kind: probe.kind,
        label,
        ok: Boolean(hit),
        detail: hit ? undefined : "the console has not reported it ready",
      };
    }

    case "process":
      // Reaching here means the server is running; see the guard above.
      return { kind: probe.kind, label, ok: true };

    default:
      return { kind: probe.kind, label, ok: null };
  }
}

/* A pattern from a definition, applied to console output.

   Definitions are trusted code rather than user input, but a bad regex
   is still a bad regex — one that throws would take the whole poll pass
   with it, for every server on the node. */
function matches(pattern: string | undefined, lines: string[]): string | null {
  if (!pattern) return null;

  let expression: RegExp;
  try {
    expression = new RegExp(pattern);
  } catch {
    return null;
  }

  for (let i = lines.length - 1; i >= 0; i--) {
    if (expression.test(lines[i]!)) return lines[i]!;
  }
  return null;
}
