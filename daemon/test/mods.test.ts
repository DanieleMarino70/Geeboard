import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { installedMods } from "../src/mods.ts";
import { cacheDirFor } from "../src/provision.ts";

/* Reading back what the game downloaded.

   The fixtures are the real shapes, taken off a Project Zomboid server
   that had fetched item 2033451936: `<item>/mods/<ModId>/mod.info` with
   `id=` inside it, which is the name the game loads a mod by and the one
   thing Steam's answer does not contain. */

const MOUNT = "/home/steam/pz-dedicated/steamapps/workshop";
const AT = "/home/steam/pz-dedicated/steamapps/workshop/content/108600";
const SERVER = "server-one";

const dataRoot = mkdtempSync(path.join(tmpdir(), "geeboard-mods-"));
after(() => rmSync(dataRoot, { recursive: true, force: true }));

function download(workshopId: string, at: string, info: string) {
  const dir = path.join(cacheDirFor(dataRoot, SERVER, MOUNT), "content", "108600", workshopId, at);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "mod.info"), info);
  return dir;
}

test("a downloaded item is read back with the id the game loads it by", async () => {
  download(
    "2033451936",
    "mods/LetMeThink",
    "name=Let Me Think\nid=LetMeThink\ndescription=Menus while paused\nposter=poster.png\n",
  );

  const items = await installedMods(dataRoot, SERVER, MOUNT, AT);
  assert.deepEqual(items, [
    { workshopId: "2033451936", mods: [{ id: "LetMeThink", name: "Let Me Think", poster: "poster.png" }] },
  ]);
});

test("one item can carry several mods, which is why the ids are read and not guessed", async () => {
  download("3000000001", "mods/PackOne", "name=Pack One\nid=PackOne\n");
  download("3000000001", "mods/PackTwo", "name=Pack Two\nid=PackTwo\n");

  const item = (await installedMods(dataRoot, SERVER, MOUNT, AT)).find((i) => i.workshopId === "3000000001");
  assert.deepEqual(
    item?.mods.map((mod) => mod.id).sort(),
    ["PackOne", "PackTwo"],
  );
});

test("an older item, with its mod straight inside it, still reads", async () => {
  download("3000000002", "OldStyle", "name=Old Style\nid=OldStyle\n");

  const item = (await installedMods(dataRoot, SERVER, MOUNT, AT)).find((i) => i.workshopId === "3000000002");
  assert.deepEqual(item?.mods, [{ id: "OldStyle", name: "Old Style", poster: null }]);
});

test("a mod.info with no id falls back to its directory, and comments are not values", async () => {
  download("3000000003", "mods/NoIdHere", "# id=NotThis\nname=No Id Here\n");

  const item = (await installedMods(dataRoot, SERVER, MOUNT, AT)).find((i) => i.workshopId === "3000000003");
  assert.deepEqual(item?.mods, [{ id: "NoIdHere", name: "No Id Here", poster: null }]);
});

test("something that is not a mod.info is not read into this machine's memory", async () => {
  const dir = download("3000000004", "mods/Huge", "");
  writeFileSync(path.join(dir, "mod.info"), "x".repeat(70 * 1024));

  const item = (await installedMods(dataRoot, SERVER, MOUNT, AT)).find((i) => i.workshopId === "3000000004");
  assert.deepEqual(item?.mods, []);
});

test("nothing downloaded yet is an empty list, not a fault", async () => {
  assert.deepEqual(await installedMods(dataRoot, "server-two", MOUNT, AT), []);
});

test("a directory outside this server's cache mount is refused", async () => {
  await assert.rejects(
    () => installedMods(dataRoot, SERVER, MOUNT, "/home/steam/pz-dedicated/steamapps/workshop/../../../etc"),
    /escapes|outside|path/i,
  );
  await assert.rejects(() => installedMods(dataRoot, SERVER, "relative/mount", AT), /absolute/i);
});
