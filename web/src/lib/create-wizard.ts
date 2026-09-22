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

export interface StepBlockerInput {
  step: number;
  /** The server's name, already trimmed. */
  name: string;
  nameError: string | null;
  hostError: string | null;
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
