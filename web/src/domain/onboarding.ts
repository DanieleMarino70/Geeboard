/* The first hour, as steps a person can see: add a node, approve it, make a server on it, start it. Derived from what the panel already knows
   (no row of its own, nothing to dismiss, nothing to get out of step): it is on the Dashboard while one of the four is undone, and gone when
   they are all done — a panel that has a server running does not need telling how to make one.

   Not a tour and not a wizard: the real pages do each step, and this says which one is next and where it is. Pure, so the order and the words
   are held by a test. */

export interface FirstSteps {
  /** Machines that have registered, approved or not. */
  nodesRegistered: number;
  /** Machines somebody has approved: the ones a server can be placed on. */
  nodesApproved: number;
  servers: number;
  /** Servers that are up, or on their way. */
  serversUp: number;
}

export interface FirstStep {
  id: "node" | "approve" | "server" | "start";
  title: string;
  /** What the step is, and what happens when it is done, in a sentence. */
  hint: string;
  href: string;
  /** The words on the button that goes to it. */
  cta: string;
  done: boolean;
}

export function firstSteps(facts: FirstSteps): { steps: FirstStep[]; current: FirstStep | null } {
  const steps: FirstStep[] = [
    {
      id: "node",
      title: "Add a node",
      hint: "A node is a machine that runs the game servers: this one, or another. The page gives you one command to paste on it.",
      href: "/nodes",
      cta: "Add a node",
      done: facts.nodesRegistered > 0,
    },
    {
      id: "approve",
      title: "Approve it",
      hint: "A machine that registers waits until you say it is yours. Nothing is placed on a node until then.",
      href: "/nodes",
      cta: "Approve the node",
      done: facts.nodesApproved > 0,
    },
    {
      id: "server",
      title: "Create your first server",
      hint: "Pick a game; the panel fits it to the machine, downloads it and sets it up, and shows how far it has got.",
      href: "/servers/new",
      cta: "Create a server",
      done: facts.servers > 0,
    },
    {
      id: "start",
      title: "Start it, and connect",
      hint: "When it reads Running, the server's page shows the address players connect with, ready to copy.",
      href: "/servers",
      cta: "Open your servers",
      done: facts.serversUp > 0,
    },
  ];
  return { steps, current: steps.find((s) => !s.done) ?? null };
}
