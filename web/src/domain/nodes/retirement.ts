/* Whether a node can be taken out of the fleet for good, and if not, why.

   The order is the safety of it, and each step is one a person can see:

     delete its servers    the only step that cleans the machine up —
                           it removes containers, worlds and backups,
                           and refuses if the node cannot be reached
     drain it              so nothing new is placed there meanwhile
     remove it             the panel's record, and nothing else

   Removing never touches the machine. It cannot — a node being retired is
   as often a dead one as a live one — and a panel that went looking for
   things to delete on a machine it was forgetting would be deleting on the
   strength of a record it was about to throw away. So everything on the
   machine has to be gone through the panel first, which is what this
   refuses on. */

export interface NodeRetirement {
  /** Servers still placed on it. Removal waits for zero. */
  servers: number;
  /** Drained or under maintenance: out of rotation on purpose. */
  outOfRotation: boolean;
  /** What still stands in the way, or null when it can be removed now. */
  blocker: string | null;
}

export function retirementOf(node: { name: string; state: string; servers: number }): NodeRetirement {
  const outOfRotation = node.state === "DRAINING" || node.state === "MAINTENANCE";
  const blocker =
    node.servers > 0
      ? `${node.name} still hosts ${node.servers} server${node.servers === 1 ? "" : "s"}. Delete ${
          node.servers === 1 ? "it" : "them"
        } first — moving servers between nodes is not built yet.`
      : !outOfRotation
        ? `Drain ${node.name} first, so nothing is placed on it while it is being retired.`
        : null;
  return { servers: node.servers, outOfRotation, blocker };
}
