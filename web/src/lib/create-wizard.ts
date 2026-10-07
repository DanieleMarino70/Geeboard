/* What stops each step of the create wizard, and on which step it stops.

   Pure, and out here rather than inside the component, because one of
   these rules was wrong in a way that reading the component did not show:
   the rule and the screen that answers it were in different files.

   **The bug this was extracted for.** Memory and CPU are ceilings on what
   a server may take rather than reservations of what it does take, so a
   node that is short of either can still be chosen on purpose — the review
   step offers "Create it anyway, over the node's capacity", writes it to
   the audit log, and the create operation takes `overcommit` for exactly
   that. But the same two checks also blocked **Next** on the resources
   step, which is the step before. The checkbox that clears them is on the
   review step, so the only way to reach it was through a button those
   checks had disabled. Every half of the feature worked and the door
   between them was locked: the API took `"overcommit": true` and nobody
   could get there from the wizard.

   So memory and CPU stop the *create*, on the review step, where the
   sentence that unlocks them is on the screen. Storage stops both, and
   goes on doing so: a full disk takes down every world on the node,
   including the ones belonging to people who did not make this choice,
   and there is no checkbox for it anywhere. */

/** The steps, named. The wizard renders them in this order. */
export const STEP = {
  game: 1,
  version: 2,
  template: 3,
  resources: 4,
  review: 5,
} as const;

/** What a placement is measured against. Structural: the wizard's own
    NodeOption satisfies it, and so does a row read in a test. */
export interface WizardNode {
  name: string;
  ramCommitted: number;
  ramTotal: number;
  /** Hundredths of a core, the same unit as cpuLimit. */
  cpuCommitted: number;
  cpuTotal: number;
  diskCommitted: number;
  diskTotal: number;
}

/* What the wizard starts a server at, given the node it is going on.

   The game's defaults are what the game wants (Minecraft: 8 GB, three cores) and not what the machine has: on the 3 GB, two-core VPS the
   documented proofs ran on, the wizard's first screen asked for a server that could not be created, the node button said "no room for this
   one", and the way forward it offered was the box that overcommits the node. Only Terraria's 2 GB default fit, which is the game the proof
   used, which is why nobody had seen it. The start is fitted to what is uncommitted, in the units the sliders move in, never under what
   the game asks for (a server below that is a decision, not a default). When the game's own floor does not fit, the floor is what is
   kept, and `short` says in numbers what the node has and the game needs, so that the refusal names them. */
export interface FitInput {
  defaults: { memoryGb: number; cpuLimit: number; diskGb: number };
  limits: { memoryGb: readonly [number, number]; cpuLimit: readonly [number, number]; diskGb: readonly [number, number] };
  requirements: { memoryGbMin: number; cpuPctMin: number; diskGbMin: number };
}

export interface Fit {
  memoryGb: number;
  cpuLimit: number;
  diskGb: number;
  /** What was lowered, each as "memory 3 GB instead of 8", or empty when the defaults fit. */
  lowered: string[];
  /** What cannot be met even at the game's floor, in numbers, or empty. */
  short: string[];
}

const CPU_STEP = 50;
const DISK_STEP = 5;

export function fitToNode(game: FitInput, node: WizardNode | null): Fit {
  const { defaults, limits, requirements } = game;
  const out: Fit = { memoryGb: defaults.memoryGb, cpuLimit: defaults.cpuLimit, diskGb: defaults.diskGb, lowered: [], short: [] };
  if (!node) return out;

  const one = (label: string, want: number, free: number, floor: number, step: number, unit: (n: number) => string): number => {
    const room = Math.max(0, Math.floor(free / step) * step);
    if (room >= want) return want;
    if (room >= floor) {
      out.lowered.push(`${label} ${unit(room)} instead of ${unit(want)}`);
      return room;
    }
    out.short.push(`${label}: the game asks for at least ${unit(floor)}, and ${node.name} has ${unit(Math.max(0, free))} uncommitted`);
    return Math.min(want, floor);
  };

  out.memoryGb = one("memory", defaults.memoryGb, node.ramTotal - node.ramCommitted, Math.max(limits.memoryGb[0], requirements.memoryGbMin), 1, (n) => `${n} GB`);
  out.cpuLimit = one("CPU", defaults.cpuLimit, node.cpuTotal - node.cpuCommitted, Math.max(limits.cpuLimit[0], requirements.cpuPctMin), CPU_STEP, (n) => `${n}%`);
  out.diskGb = one("storage", defaults.diskGb, node.diskTotal - node.diskCommitted, Math.max(limits.diskGb[0], requirements.diskGbMin), DISK_STEP, (n) => `${n} GB`);
  return out;
}

export interface StepBlockerInput {
  step: number;
  /** The server's name, already trimmed. */
  name: string;
  nameError: string | null;
  hostError: string | null;
  /** What is in the address field: empty is its own refusal, with no domain of the workspace's to start it from. */
  host?: string;
  /** Null until a node is chosen. */
  node: WizardNode | null;
  memoryGb: number;
  cpuLimit: number;
  diskGb: number;
  /** The review step's checkbox. Never set anywhere else. */
  overcommit: boolean;
  /** Null while the allocator has nothing to offer. */
  portBase: number | null;
  portsPending: boolean;
  /** The chosen node has said it cannot run this game. */
  cannotRunGame: boolean;
}

/** Why this step cannot be left, in the words the footer shows, or null. */
export function stepBlocker(input: StepBlockerInput): string | null {
  const { step, node } = input;

  if (step === STEP.template) {
    if (input.name.length < 2) return "Give the server a name";
    if (input.nameError) return input.nameError;
    if (input.host !== undefined && input.host.trim() === "") return "Give the server an address players will use";
    if (input.hostError) return "That address is not a valid hostname";
  }

  if (step >= STEP.resources) {
    if (!node) return "Pick a node";

    /* Storage first, and at every step: it is the one that cannot be
       promised twice, so nothing later offers a way past it. */
    if (node.diskCommitted + input.diskGb > node.diskTotal) return `${node.name} is out of storage`;
    if (!input.portsPending && input.portBase === null) return `${node.name} has no free port block`;
    // The draft may carry a node chosen before the game was.
    if (input.cannotRunGame) return `${node.name} cannot run this game`;
  }

  /* Only on the review step, where the checkbox that answers them is. */
  if (step >= STEP.review && node && !input.overcommit) {
    if (node.ramCommitted + input.memoryGb > node.ramTotal) return `${node.name} is out of memory`;
    if (node.cpuCommitted + input.cpuLimit > node.cpuTotal) return `${node.name} is out of CPU`;
  }

  return null;
}

/** Whether the review step should ask about overcommitting at all: the
    node is short of memory or CPU, and storage is not the problem. Shared
    with the card that asks, so the question and the refusal agree. */
export function asksToOvercommit(node: WizardNode, input: Pick<StepBlockerInput, "memoryGb" | "cpuLimit" | "diskGb">): boolean {
  if (node.diskCommitted + input.diskGb > node.diskTotal) return false;
  return (
    node.ramCommitted + input.memoryGb > node.ramTotal ||
    node.cpuCommitted + input.cpuLimit > node.cpuTotal
  );
}
