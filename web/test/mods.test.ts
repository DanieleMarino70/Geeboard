import assert from "node:assert/strict";
import { test } from "node:test";
import { renderConfig } from "../src/domain/games/config.ts";
import { requireGame } from "../src/domain/games/registry.ts";
import { summariseWorkshop, workshopIdFrom } from "../src/domain/games/mods.ts";

/* Mods, as arithmetic: which two keys get written, and what a person is
   allowed to paste. Nothing here talks to Steam or to a node — those
   are verify-mods.mts, against a real server. */

const zomboid = requireGame("project-zomboid");

function entriesOf(files: ReturnType<typeof renderConfig>["files"], key: string) {
  return files.flatMap((file) => file.entries.filter((entry) => entry.key === key).map((entry) => entry.value));
}

test("Project Zomboid says how it takes mods, and where they land", () => {
  assert.equal(zomboid.mods?.provider, "steam-workshop");
  assert.equal(zomboid.mods?.appId, 108600);
  assert.equal(zomboid.mods?.items.key, "WorkshopItems");
  assert.equal(zomboid.mods?.enabled.key, "Mods");
  // The downloads have to be inside a cache mount, or every rebuild refetches them.
  assert.ok(
    zomboid.cachePaths?.some((path) => zomboid.mods!.contentPath.startsWith(path)),
    "the content path must sit inside a cache mount",
  );
});

test("the two keys are written together: ids to download, ids to load", () => {
  const rendered = renderConfig(zomboid, {}, undefined, {
    mods: { items: ["2033451936", "2392709985"], enabled: ["LetMeThink"] },
  });

  assert.deepEqual(entriesOf(rendered.files, "WorkshopItems"), ["2033451936;2392709985"]);
  // Downloaded but not loaded: the second item is fetched and left out.
  assert.deepEqual(entriesOf(rendered.files, "Mods"), ["LetMeThink"]);
});

test("an empty list clears both keys, which is how the last mod comes off", () => {
  const rendered = renderConfig(zomboid, {}, undefined, { mods: { items: [], enabled: [] } });

  assert.deepEqual(entriesOf(rendered.files, "WorkshopItems"), [""]);
  assert.deepEqual(entriesOf(rendered.files, "Mods"), [""]);
});

test("a render with no mods leaves the game's own keys alone", () => {
  const rendered = renderConfig(zomboid, {}, undefined, {});

  assert.deepEqual(entriesOf(rendered.files, "WorkshopItems"), []);
  assert.deepEqual(entriesOf(rendered.files, "Mods"), []);
});

test("a game that takes no mods is not given any", () => {
  const terraria = requireGame("terraria");
  assert.equal(terraria.mods, undefined);

  const rendered = renderConfig(terraria, {}, undefined, {
    mods: { items: ["2033451936"], enabled: ["Whatever"] },
  });
  assert.deepEqual(entriesOf(rendered.files, "WorkshopItems"), []);
});

test("a description is one line by the time it reaches a card", () => {
  const written = "[h1]Big Mod[/h1]\n[b]Adds[/b] things.  See https://example.com for more.";
  assert.equal(summariseWorkshop(written), "Big Mod Adds things. See for more.");
  assert.ok(summariseWorkshop("x".repeat(400)).length <= 220);
});

test("a Workshop link, an id, and things that are neither", () => {
  assert.equal(workshopIdFrom("2033451936"), "2033451936");
  assert.equal(
    workshopIdFrom("https://steamcommunity.com/sharedfiles/filedetails/?id=2033451936"),
    "2033451936",
  );
  assert.equal(
    workshopIdFrom(" https://steamcommunity.com/workshop/filedetails/?id=2392709985&searchtext=x "),
    "2392709985",
  );

  // Somewhere else's link with an id in it is not a Workshop item.
  assert.equal(workshopIdFrom("https://example.com/sharedfiles/filedetails/?id=2033451936"), null);
  assert.equal(workshopIdFrom("Let Me Think"), null);
  assert.equal(workshopIdFrom(""), null);
});
