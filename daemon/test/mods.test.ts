import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { installedMods } from "../src/mods.ts";
import { cacheDirFor } from "../src/provision.ts";

/* Reading back what the game downloaded.

   The fixtures are the real shapes, taken off Project Zomboid servers:
   item 2033451936 on 41.78.19, with `<item>/mods/<ModId>/mod.info` and
   `id=` inside it, and the Rawt Building Craft collection on 42.20.4,
   whose mods keep a mod.info in `42.0/`, in `common/`, in both or in
   either — the layouts, directory names and fields below are theirs. */

const MOUNT = "/home/steam/pz-dedicated/steamapps/workshop";
const AT = "/home/steam/pz-dedicated/steamapps/workshop/content/108600";
const SERVER = "server-one";

const dataRoot = mkdtempSync(path.join(tmpdir(), "geeboard-mods-"));
after(() => rmSync(dataRoot, { recursive: true, force: true }));

function itemDir(workshopId: string): string {
  return path.join(cacheDirFor(dataRoot, SERVER, MOUNT), "content", "108600", workshopId);
}

function download(workshopId: string, at: string, info: string | null) {
  const dir = path.join(itemDir(workshopId), at);
  mkdirSync(dir, { recursive: true });
  if (info !== null) writeFileSync(path.join(dir, "mod.info"), info);
  return dir;
}

async function item(workshopId: string) {
  return (await installedMods(dataRoot, SERVER, MOUNT, AT)).find((i) => i.workshopId === workshopId);
}

const bare = { poster: null, versionMin: null, versionMax: null, require: [] };

test("a Build 41 download is read back with the id the game loads it by", async () => {
  download(
    "2033451936",
    "mods/LetMeThink",
    "name=Let Me Think\nid=LetMeThink\ndescription=Menus while paused\nposter=poster.png\nversionMax=41.78\n",
  );

  assert.deepEqual(await item("2033451936"), {
    workshopId: "2033451936",
    mods: [
      {
        dir: "LetMeThink",
        folders: [],
        infos: [
          { ...bare, folder: "", id: "LetMeThink", name: "Let Me Think", poster: "poster.png", versionMax: "41.78" },
        ],
      },
    ],
  });
});

test("a Build 42 download is read in every folder it has, and nothing is chosen here", async () => {
  download("3459887404", "mods/BuildingCraft/42.0", "name=BuildingCraft\nid=BuildingCraft\nversionMin=42.00\nposter=poster.png\n");
  download("3459887404", "mods/BuildingCraft/common", "name=BuildingCraft\nid=BuildingCraft\nversionMin=42.00\nposter=poster.png\n");
  download("3459887404", "mods/BuildingCraft/common/media", null);

  const mod = (await item("3459887404"))?.mods[0];
  assert.deepEqual(mod?.folders, ["42.0", "common"]);
  assert.deepEqual(
    mod?.infos.map((info) => [info.folder, info.id, info.versionMin]),
    [
      ["42.0", "BuildingCraft", "42.00"],
      ["common", "BuildingCraft", "42.00"],
    ],
  );
});

test("an author's directory name with spaces and an apostrophe is read, not skipped", async () => {
  download(
    "3488891189",
    "mods/BuildingCraft Erika's tiles/42.0",
    "name=BuildingCraft - Erika's tiles\nid=BuildingCraftErikastiles\nversionMin=42.00\nrequire=\\BuildingCraft,\\Erikas_Tiles\n",
  );
  download("3488891189", "mods/BuildingCraft Erika's tiles/common", null);

  const mod = (await item("3488891189"))?.mods[0];
  assert.equal(mod?.dir, "BuildingCraft Erika's tiles");
  assert.deepEqual(mod?.folders, ["42.0", "common"]);
  assert.deepEqual(mod?.infos, [
    {
      ...bare,
      folder: "42.0",
      id: "BuildingCraftErikastiles",
      name: "BuildingCraft - Erika's tiles",
      versionMin: "42.00",
      require: ["\\BuildingCraft", "\\Erikas_Tiles"],
    },
  ]);
});

test("a version folder with no mod.info of its own is still reported, since the game still reads it", async () => {
  download("3738485004", "mods/BuildingCraftPipetteCopy/42", null);
  download("3738485004", "mods/BuildingCraftPipetteCopy/common", "id=BuildingCraftPipetteCopy\nposter=poster.png\nposter=JNTM.png\n");

  const mod = (await item("3738485004"))?.mods[0];
  assert.deepEqual(mod?.folders, ["42", "common"]);
  // The first of a repeated key: five posters are one poster.
  assert.deepEqual(mod?.infos, [
    { ...bare, folder: "common", id: "BuildingCraftPipetteCopy", name: "BuildingCraftPipetteCopy", poster: "poster.png" },
  ]);
});

test("one item can carry several mods, which is why the ids are read and not guessed", async () => {
  download("3000000001", "mods/PackOne", "name=Pack One\nid=PackOne\n");
  download("3000000001", "mods/PackTwo/common", "name=Pack Two\nid=PackTwo\n");

  assert.deepEqual(
    (await item("3000000001"))?.mods.map((mod) => [mod.dir, mod.infos.map((info) => info.id)]),
    [
      ["PackOne", ["PackOne"]],
      ["PackTwo", ["PackTwo"]],
    ],
  );
});

test("an older item, with its mod straight inside it, still reads", async () => {
  download("3000000002", "OldStyle", "name=Old Style\nid=OldStyle\n");

  assert.deepEqual((await item("3000000002"))?.mods, [
    { dir: "OldStyle", folders: [], infos: [{ ...bare, folder: "", id: "OldStyle", name: "Old Style" }] },
  ]);
});

test("a mod.info with no id falls back to its directory, and comments are not values", async () => {
  download("3000000003", "mods/NoIdHere", "# id=NotThis\nname=No Id Here\n");

  assert.deepEqual((await item("3000000003"))?.mods[0]?.infos, [{ ...bare, folder: "", id: "NoIdHere", name: "No Id Here" }]);
});

test("a directory with no mod.info anywhere is not a mod", async () => {
  download("3000000005", "mods/JustMedia/media", null);
  assert.deepEqual((await item("3000000005"))?.mods, []);
});

test("something that is not a mod.info is not read into this machine's memory", async () => {
  const dir = download("3000000004", "mods/Huge", "");
  writeFileSync(path.join(dir, "mod.info"), "x".repeat(70 * 1024));

  assert.deepEqual((await item("3000000004"))?.mods, []);
});

test("a mod.info that is a link is not followed", async (t) => {
  const outside = path.join(dataRoot, "outside.info");
  writeFileSync(outside, "id=Outside\n");
  const dir = download("3000000006", "mods/Linked", null);
  try {
    symlinkSync(outside, path.join(dir, "mod.info"));
  } catch {
    // Windows without the privilege to make one: nothing to test.
    t.skip("this machine cannot make a symbolic link");
    return;
  }
  assert.deepEqual((await item("3000000006"))?.mods, []);
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
