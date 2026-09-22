/* What a Workshop collection amounts to, as a list of items to add.

   A collection is not something the game can download: it is a list of
   other items, and Project Zomboid is told item ids one by one. So the
   panel expands it — and what Steam hands back, measured across a few
   hundred Zomboid collections, is messier than "a list":

     - a collection can link other collections, which link more;
     - two collections can link each other, so a walk that follows
       links without remembering where it has been never ends;
     - a linked collection mostly repeats the one that links it (180 of
       181 items, in one pair), so the same item turns up twice;
     - a link can point at a collection that is gone.

   The rules here: a linked collection's items go where the link sits,
   because an author who put a framework pack first meant it to load
   first; each item is kept where it first appears; each collection is
   walked once; and the whole thing stops at a size nobody means by
   "add this collection", and says that it stopped.

   Steam is not called from here. Whoever asks passes a function that
   answers "what is in these collections", which is how this is tested
   without a network. */

export interface CollectionEntry {
  id: string;
  /** A linked collection rather than an item. */
  collection: boolean;
}

/** What is inside each id that is a collection; ids that are not are absent. */
export type CollectionChildren = (ids: string[]) => Promise<ReadonlyMap<string, CollectionEntry[]>>;

export interface ExpandedCollection {
  /** Every item, in the order they would be added, each once. */
  items: string[];
  /** Collections reached through links and walked, in the order they were met. */
  linked: string[];
  /** Which of `items` only a linked collection holds: the pasted one does not list them itself. */
  fromLinked: string[];
  /** Linked collections Steam did not answer for: deleted, hidden, or never one. */
  missing: string[];
  /** True when a limit cut the walk short. */
  truncated: boolean;
}

export const COLLECTION_LIMITS = {
  /* The largest Zomboid collection measured held 805 items; a thousand
     is past anything a server runs and short of a list that could not
     be shown on one page. */
  items: 1000,
  /** Collections asked about, the pasted one included. */
  collections: 50,
};

export async function expandCollection(
  root: string,
  childrenOf: CollectionChildren,
  limits: { items: number; collections: number } = COLLECTION_LIMITS,
): Promise<ExpandedCollection | null> {
  /* Asked level by level, so a collection with ten links is one more
     request rather than ten. */
  const tree = new Map<string, CollectionEntry[]>();
  const asked = new Set<string>();
  let frontier = [root];
  while (frontier.length > 0 && asked.size < limits.collections) {
    const batch = frontier.slice(0, limits.collections - asked.size);
    batch.forEach((id) => asked.add(id));
    const found = await childrenOf(batch);
    for (const id of batch) {
      const children = found.get(id);
      if (children) tree.set(id, children);
    }
    frontier = [
      ...new Set(
        batch.flatMap((id) => tree.get(id) ?? []).filter((c) => c.collection && !asked.has(c.id)).map((c) => c.id),
      ),
    ];
  }

  if (!tree.has(root)) return null;

  const items: string[] = [];
  const kept = new Set<string>();
  const linked: string[] = [];
  const missing: string[] = [];
  const entered = new Set<string>([root]);
  let truncated = false;

  const walk = (id: string) => {
    for (const child of tree.get(id) ?? []) {
      if (truncated) return;
      if (child.collection) {
        // A cycle, or a collection already walked from somewhere else.
        if (entered.has(child.id)) continue;
        entered.add(child.id);
        if (tree.has(child.id)) {
          linked.push(child.id);
          walk(child.id);
        } else if (asked.has(child.id)) {
          missing.push(child.id);
        } else {
          // Never asked about: the collection limit ran out first.
          truncated = true;
        }
      } else if (!kept.has(child.id)) {
        if (items.length >= limits.items) {
          truncated = true;
          return;
        }
        kept.add(child.id);
        items.push(child.id);
      }
    }
  };
  walk(root);

  /* Not "what the links placed": a link can place an item early that the
     pasted collection also lists further down, and that item did not
     come only from the link. */
  const own = new Set((tree.get(root) ?? []).filter((c) => !c.collection).map((c) => c.id));
  const fromLinked = items.filter((id) => !own.has(id));

  return { items, linked, fromLinked, missing, truncated };
}
