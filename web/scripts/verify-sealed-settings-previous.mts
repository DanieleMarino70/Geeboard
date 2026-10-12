import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

/* The release before this one, on the database this one migrated: run by verify:sealedsettings from a copy of that release's web/ (its
   own source, beside this checkout's packages), where the imports below are that release's code. The database and the key are in the
   environment. Prints one line of JSON and nothing else.

   `seal`     its poller's start, which seals a server's secret settings and, in 0.11, keeps the clear copy beside them.
   `rollback` what a panel rolled back to it does with a server whose clear copy this release has removed: the password the game is given
              on a rebuild, the Settings page's form, a save of another field from that form, and a key that holds servers:monitor alone. */

const phase = process.argv[2];
const { db } = await import("../src/lib/db");
const { sealServerSettings, storedSettings } = await import("../src/lib/server-secrets");
const { configDrift, currentConfig, renderConfig, scopeToLine, settingsFor } = await import("../src/domain/games/config");
const { requireGame, versionOfServer } = await import("../src/domain/games/registry");

let out: Record<string, unknown> = {};
if (phase === "seal") {
  out = await sealServerSettings();
} else if (phase === "rollback") {
  const { updateServerConfigOp } = await import("../src/lib/config-ops");
  const owner = await db.user.findUniqueOrThrow({ where: { id: process.env.SEALED_OWNER! } });
  const row = (slug: string) => db.server.findUniqueOrThrow({ where: { slug } });

  /* The settings Settings draws its form from, by the page's own expression, read from its source and run on the row: the line is what
     0.11.1 changed (the clear copy alone in 0.11.0, the sealed settings too in 0.11.1), and the page around it needs a request to draw. */
  const page = readFileSync(path.join(process.cwd(), "src", "app", "settings", "page.tsx"), "utf8");
  const expression = /const stored = game \? (.+?) : \{\};/.exec(page)?.[1];
  if (!expression) throw new Error("the Settings page no longer reads its stored settings in one line: this check is looking at nothing");
  const read = new Function("currentConfig", "storedSettings", "game", "selected", `return ${expression};`) as (...args: unknown[]) => Record<string, unknown>;
  // The form, for a server whose files cannot give the password back: a start-up variable, or a node that is away (these have no agent).
  const form = async (gameId: string, slug: string) => {
    const selected = await row(slug);
    // Narrowed to the server's version line, as the page narrows it.
    const definition = requireGame(gameId);
    const game = scopeToLine(definition, versionOfServer(definition, { versionLabel: selected.version })?.line);
    const stored = read(currentConfig, storedSettings, game, selected) as Parameters<typeof configDrift>[1];
    const shown = settingsFor(game, true, { stored, onNode: {}, drift: configDrift(game, stored, {}) });
    return { ...shown.stored, ...shown.onNode };
  };

  // (a) What a rebuild renders for the game: the first lines of rebuildWorkload (lib/update-ops.ts), which read the sealed settings too.
  const rendered = async (gameId: string, slug: string) => {
    const game = requireGame(gameId);
    const stored = storedSettings(await row(slug));
    return renderConfig(game, currentConfig(game, { config: stored }), undefined, { includeEmpty: true, stored });
  };
  const terrariaFile = (await rendered("terraria", "tera")).files.find((f) => f.path === "serverconfig.txt")?.entries.find((e) => e.key === "password")?.value;
  const valheimEnv = (await rendered("valheim", "vh")).env.SERVER_PASS;

  // (b) and (c): the form, and a save of another field from it, sent as the form sends it (every value, settings-form.tsx).
  const teraForm = await form("terraria", "tera");
  const teraSave = await updateServerConfigOp(owner, "tera", { ...teraForm, motd: "saved by the release before" });
  const vhForm = await form("valheim", "vh");
  // Valheim's settings are start-up variables: the save asks for a rebuild before it writes anything, and says what it would change.
  const vhSave = await updateServerConfigOp(owner, "vh", { ...vhForm, serverName: "saved by the release before" });

  // A key this release made with servers:monitor alone, through that release's own route.
  const { GET } = await import("../src/app/api/v1/servers/[id]/metrics/route");
  const metrics = await GET(new Request("http://verify.invalid/api/v1/servers/tera/metrics", { headers: { authorization: `Bearer ${process.env.SEALED_MONITOR_KEY}` } }), {
    params: Promise.resolve({ id: "tera" }),
  });

  out = {
    terrariaFile,
    valheimEnv,
    teraForm: teraForm.password,
    teraSave: { ok: teraSave.ok, title: teraSave.title, body: teraSave.body },
    vhForm: vhForm.password,
    vhChanges: vhSave.plan?.changes.map((c) => c.key) ?? null,
    vhSave: { ok: vhSave.ok, title: vhSave.title },
    monitorKey: metrics.status,
  };
}
console.log(JSON.stringify(out));
await db.$disconnect();
