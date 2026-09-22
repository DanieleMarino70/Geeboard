import assert from "node:assert/strict";
import { test } from "node:test";
import { expandCollection, type CollectionEntry } from "../src/domain/games/collections.ts";

/* Expanding a Workshop collection, against a Steam made of a map. The
   shapes are the ones measured on the real Workshop: two collections
   that link each other, a chain three deep, a link to a collection that
   is gone, and a linked collection that repeats most of the one linking
   it. */

const item = (id: string): CollectionEntry => ({ id, collection: false });
const link = (id: string): CollectionEntry => ({ id, collection: true });

function steam(collections: Record<string, CollectionEntry[]>) {
  const calls: string[][] = [];
  const childrenOf = async (ids: string[]) => {
    calls.push(ids);
    return new Map(ids.filter((id) => id in collections).map((id) => [id, collections[id]!]));
  };
  return { childrenOf, calls };
}

test("an item is not a collection", async () => {
  const { childrenOf } = steam({});
  assert.equal(await expandCollection("2033451936", childrenOf), null);
});

test("a plain collection is its items, in its order", async () => {
  const { childrenOf } = steam({ root: [item("c"), item("a"), item("b")] });
  const expanded = await expandCollection("root", childrenOf);
  assert.deepEqual(expanded, { items: ["c", "a", "b"], linked: [], fromLinked: [], missing: [], truncated: false });
});

test("a linked collection's items go where the link sits, each item once", async () => {
  const { childrenOf } = steam({
    root: [item("a"), link("maps"), item("z")],
    // Repeats "a", met already, and "z", which it reaches first.
    maps: [item("a"), item("m1"), item("m2"), item("z")],
  });
  const expanded = await expandCollection("root", childrenOf);
  assert.deepEqual(expanded?.items, ["a", "m1", "m2", "z"]);
  assert.deepEqual(expanded?.linked, ["maps"]);
  // Only what the pasted collection does not list itself came from the link — not "z", which the link merely placed first.
  assert.deepEqual(expanded?.fromLinked, ["m1", "m2"]);
});

test("two collections that link each other are each walked once", async () => {
  const { childrenOf } = steam({
    front: [item("1"), link("back"), item("2")],
    back: [item("3"), link("front"), item("1")],
  });
  const expanded = await expandCollection("front", childrenOf);
  assert.deepEqual(expanded?.items, ["1", "3", "2"]);
  assert.deepEqual(expanded?.linked, ["back"]);
  assert.equal(expanded?.truncated, false);
});

test("a chain is followed to the end, asked a level at a time", async () => {
  const { childrenOf, calls } = steam({
    top: [link("middle"), link("side"), item("t")],
    middle: [link("bottom"), item("m")],
    side: [item("s")],
    bottom: [item("b")],
  });
  const expanded = await expandCollection("top", childrenOf);
  assert.deepEqual(expanded?.items, ["b", "m", "s", "t"]);
  assert.deepEqual(expanded?.linked, ["middle", "bottom", "side"]);
  // One request per level, not one per collection.
  assert.deepEqual(calls, [["top"], ["middle", "side"], ["bottom"]]);
});

test("a link to a collection that is gone is named, and the rest is kept", async () => {
  const { childrenOf } = steam({ root: [item("a"), link("deleted"), item("b")] });
  const expanded = await expandCollection("root", childrenOf);
  assert.deepEqual(expanded?.items, ["a", "b"]);
  assert.deepEqual(expanded?.missing, ["deleted"]);
  assert.equal(expanded?.truncated, false);
});

test("the item limit stops the walk and says so", async () => {
  const { childrenOf } = steam({ root: ["1", "2", "3", "4"].map(item) });
  const expanded = await expandCollection("root", childrenOf, { items: 3, collections: 50 });
  assert.deepEqual(expanded?.items, ["1", "2", "3"]);
  assert.equal(expanded?.truncated, true);
});

test("the collection limit stops the walk and says so, rather than calling it missing", async () => {
  const { childrenOf, calls } = steam({
    root: [item("r"), link("one"), link("two")],
    one: [item("o")],
    two: [item("t")],
  });
  const expanded = await expandCollection("root", childrenOf, { items: 1000, collections: 2 });
  assert.deepEqual(calls, [["root"], ["one"]]);
  assert.deepEqual(expanded?.items, ["r", "o"]);
  assert.deepEqual(expanded?.missing, []);
  assert.equal(expanded?.truncated, true);
});
