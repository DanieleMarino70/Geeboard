import path from "node:path";
import process from "node:process";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { syncCatalog } from "../src/lib/catalog-sync";
import { nextRun } from "../src/lib/cron";

try {
  process.loadEnvFile(path.join(process.cwd(), ".env"));
} catch {
  /* already in the environment */
}

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

/* Sample workspace — the same fixture the screens were designed
   against, so the UI looks like the canvas on a fresh database. */

const DEV_PASSWORD = "geeboard";

export async function seed() {
  // Order matters: children before parents.
  await db.scheduledTask.deleteMany();
  await db.metricSample.deleteMany();
  await db.playerSession.deleteMany();
  await db.backup.deleteMany();
  await db.activityEvent.deleteMany();
  await db.apiKey.deleteMany();
  await db.server.deleteMany();
  await db.nodeRegistrationToken.deleteMany();
  await db.node.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();

  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 12);

  const [mara, devi, tomas] = await Promise.all([
    db.user.create({
      data: {
        email: "mara@ashfold.gg",
        name: "Mara Kessler",
        initials: "MK",
        role: "OWNER",
        twoFactor: true,
        passwordHash,
        lastSeenAt: new Date(),
      },
    }),
    db.user.create({
      data: {
        email: "devi@ashfold.gg",
        name: "Devi Vasquez",
        initials: "DV",
        role: "ADMIN",
        twoFactor: true,
        passwordHash,
        lastSeenAt: new Date(Date.now() - 4 * 3600_000),
      },
    }),
    db.user.create({
      data: {
        email: "tomas@ashfold.gg",
        name: "Tomas Reiner",
        initials: "TR",
        role: "MODERATOR",
        passwordHash,
        lastSeenAt: new Date(Date.now() - 26 * 3600_000),
      },
    }),
  ]);

  const fra = await db.node.create({
    data: {
      name: "fra-node-02",
      city: "Frankfurt",
      region: "eu-central",
      state: "HEALTHY",
      pingMs: 14,
      cpuPct: 48,
      ramPct: 61,
      diskPct: 39,
      cpuCores: 16,
      ramTotal: 128,
      diskTotal: 3500,
      daemon: "2.4.1",
      registeredAt: new Date(),
      approvedAt: new Date(),
      os: "linux",
      arch: "x64",
      capabilities: ["docker", "steamcmd", "java", "ipv6", "ssd", "backups"],
    },
  });

  const ash = await db.node.create({
    data: {
      name: "ash-node-01",
      city: "Ashburn",
      region: "us-east",
      state: "HEALTHY",
      pingMs: 92,
      cpuPct: 33,
      ramPct: 40,
      diskPct: 28,
      cpuCores: 16,
      ramTotal: 128,
      diskTotal: 3500,
      daemon: "2.4.1",
      registeredAt: new Date(),
      approvedAt: new Date(),
      os: "linux",
      arch: "x64",
      capabilities: ["docker", "steamcmd", "java", "ssd", "backups"],
    },
  });

  await db.node.create({
    data: {
      name: "sgp-node-01",
      city: "Singapore",
      region: "ap-southeast",
      state: "DEGRADED",
      pingMs: 211,
      cpuPct: 88,
      ramPct: 91,
      diskPct: 74,
      cpuCores: 8,
      ramTotal: 64,
      diskTotal: 1800,
      daemon: "2.4.0",
      registeredAt: new Date(),
      approvedAt: new Date(),
      os: "linux",
      arch: "arm64",
      /* No SteamCMD and no Java here on purpose: it is the node the
         compatibility engine has something to say about. */
      capabilities: ["docker", "ipv6"],
    },
  });

  const servers = await Promise.all(
    [
      {
        slug: "aurora",
        name: "Aurora SMP",
        game: "Minecraft",
        version: "1.21.4 · Paper",
        art: "MC",
        state: "RUNNING" as const,
        playersOn: 23,
        playersMax: 40,
        cpuPct: 34,
        ramPct: 62,
        diskPct: 41,
        host: "aurora.ashfold.gg",
        port: 25565,
        memoryLimit: 8,
        cpuLimit: 300,
        diskQuota: 60,
        worldSize: "11.2 GB",
        motd: "Aurora SMP — season four",
        javaFlags: "-Xms4G -Xmx8G -XX:+UseG1GC -XX:MaxGCPauseMillis=200",
        whitelist: true,
        startedAt: new Date(Date.now() - (6 * 24 + 14) * 3600_000),
        nodeId: fra.id,
        ownerId: mara.id,
      },
      {
        slug: "nightfall",
        name: "Nightfall PvP",
        game: "Minecraft",
        version: "1.20.6 · Purpur",
        art: "MC",
        state: "STARTING" as const,
        playersOn: 0,
        playersMax: 80,
        cpuPct: 71,
        ramPct: 44,
        diskPct: 28,
        host: "pvp.ashfold.gg",
        port: 25566,
        memoryLimit: 12,
        cpuLimit: 400,
        diskQuota: 80,
        worldSize: "6.8 GB",
        startedAt: null,
        nodeId: fra.id,
        ownerId: mara.id,
      },
      {
        slug: "creative",
        name: "Ashfold Creative",
        game: "Minecraft",
        version: "1.21.4 · Fabric",
        art: "MC",
        state: "RUNNING" as const,
        playersOn: 18,
        playersMax: 60,
        cpuPct: 22,
        ramPct: 48,
        diskPct: 66,
        host: "build.ashfold.gg",
        port: 25567,
        memoryLimit: 6,
        cpuLimit: 200,
        diskQuota: 120,
        worldSize: "18.4 GB",
        startedAt: new Date(Date.now() - (21 * 24 + 2) * 3600_000),
        nodeId: ash.id,
        ownerId: devi.id,
      },
      {
        slug: "wipe",
        name: "Wipe Wednesday",
        game: "Rust",
        version: "2024.11",
        art: "RUST",
        state: "STOPPED" as const,
        playersOn: 0,
        playersMax: 120,
        cpuPct: 0,
        ramPct: 0,
        diskPct: 54,
        host: "rust.ashfold.gg",
        port: 28015,
        memoryLimit: 16,
        cpuLimit: 600,
        diskQuota: 200,
        worldSize: "9.1 GB",
        startedAt: null,
        nodeId: fra.id,
        ownerId: tomas.id,
      },
    ].map((data) => db.server.create({ data })),
  );

  const aurora = servers[0];

  /* An hour of metrics at one-minute resolution, trending the way the
     usage chart in the design does. */
  const now = Date.now();
  await db.metricSample.createMany({
    data: Array.from({ length: 60 }, (_, i) => {
      const t = i / 59;
      return {
        serverId: aurora.id,
        at: new Date(now - (59 - i) * 60_000),
        cpuPct: Math.round(30 + 18 * Math.sin(t * 6) + 12 * t),
        ramMb: Math.round(4200 + 900 * t + 120 * Math.sin(t * 9)),
        players: Math.round(16 + 8 * t + 2 * Math.sin(t * 7)),
        tps: Number((19.9 - 0.6 * Math.max(0, Math.sin(t * 11))).toFixed(2)),
      };
    }),
  });

  await db.playerSession.createMany({
    data: [
      { serverId: aurora.id, username: "thornfield", uuid: "a4f2b8e0-0000-4000-8000-000000009c1d", pingMs: 14, online: true, playtimeM: 8902 },
      { serverId: aurora.id, username: "lumen_verd", uuid: "b1c3d5e7-0000-4000-8000-000000001a2b", pingMs: 41, online: true, playtimeM: 244 },
      { serverId: aurora.id, username: "kestrelbay", uuid: "c2d4e6f8-0000-4000-8000-000000003c4d", pingMs: 8, online: true, playtimeM: 5520 },
      { serverId: aurora.id, username: "oakhollow", uuid: "d3e5f7a9-0000-4000-8000-000000005e6f", pingMs: 122, online: true, playtimeM: 18660 },
      { serverId: aurora.id, username: "mirefen", uuid: "e4f6a8b0-0000-4000-8000-000000007a8b", pingMs: 0, online: false, playtimeM: 3480, leftAt: new Date(now - 21 * 60_000) },
    ],
  });

  const gb = (n: number) => BigInt(Math.round(n * 1024 ** 3));
  await db.backup.createMany({
    data: [
      { serverId: aurora.id, name: "daily-09-07", sizeBytes: gb(3.42), trigger: "SCHEDULED", state: "COMPLETE", createdAt: new Date(now - 2 * 3600_000), checksum: "sha256:41ab…" },
      { serverId: aurora.id, name: "daily-09-06", sizeBytes: gb(3.31), trigger: "SCHEDULED", state: "COMPLETE", createdAt: new Date(now - 26 * 3600_000), checksum: "sha256:77cd…" },
      { serverId: aurora.id, name: "pre-update", sizeBytes: gb(3.1), trigger: "MANUAL", state: "COMPLETE", createdAt: new Date(now - 4 * 24 * 3600_000), checksum: "sha256:19ef…" },
      { serverId: aurora.id, name: "season-4-launch", sizeBytes: gb(2.9), trigger: "MANUAL", state: "LOCKED", createdAt: new Date(now - 21 * 24 * 3600_000), keepUntil: null },
    ],
  });

  await db.activityEvent.createMany({
    data: [
      { actor: "thornfield", action: "joined", target: "Aurora SMP", tone: "INFO", serverId: aurora.id, createdAt: new Date(now - 2 * 60_000) },
      { actor: "Scheduler", action: "ran the nightly backup", target: "daily-09-07", tone: "ACCENT", serverId: aurora.id, createdAt: new Date(now - 38 * 60_000) },
      { actor: "Mara", action: "raised the heap ceiling to 8 GB", target: "Aurora SMP", tone: "MUTED", userId: mara.id, serverId: aurora.id, createdAt: new Date(now - 3600_000) },
      { actor: "Watchdog", action: "recovered a tick overload", target: "Aurora SMP", tone: "WARNING", serverId: aurora.id, createdAt: new Date(now - 2 * 3600_000) },
      { actor: "Devi", action: "revoked the CI deploy key", target: "ci-deploy-key", tone: "DANGER", userId: devi.id, createdAt: new Date(now - 3 * 3600_000) },
    ],
  });

  await db.apiKey.createMany({
    data: [
      { userId: mara.id, name: "Production deploy", prefix: "gbk_live_8f2a…d417", hash: await bcrypt.hash("sample-key-1", 10), scopes: ["servers:write", "files:write"], lastUsedAt: new Date(now - 2 * 60_000) },
      { userId: mara.id, name: "Grafana metrics", prefix: "gbk_live_4c81…9b02", hash: await bcrypt.hash("sample-key-2", 10), scopes: ["metrics:read"], lastUsedAt: new Date(now - 6 * 60_000) },
      { userId: devi.id, name: "ci-deploy-key", prefix: "gbk_live_2f9a…41c7", hash: await bcrypt.hash("sample-key-3", 10), scopes: ["servers:write", "files:write"], revokedAt: new Date(now - 3 * 3600_000) },
    ],
  });

  const tasks = [
    { name: "Nightly snapshot", kind: "BACKUP" as const, cron: "0 3 * * *", lastResult: "SUCCEEDED" as const, enabled: true },
    { name: "Restart before peak", kind: "RESTART" as const, cron: "0 17 * * *", lastResult: "SUCCEEDED" as const, enabled: true },
    { name: "Broadcast rules", kind: "BROADCAST" as const, cron: "*/30 * * * *", payload: "/say Read the rules at ashfold.gg/rules", lastResult: "SUCCEEDED" as const, enabled: true },
    { name: "Prune old logs", kind: "CLEANUP" as const, cron: "0 4 * * 0", lastResult: "SUCCEEDED" as const, enabled: true },
    { name: "Sync plugin configs", kind: "COMMAND" as const, cron: "0 5 * * 1", payload: "/plugman reload all", lastResult: "FAILED" as const, enabled: true },
    { name: "Seasonal world reset", kind: "CLEANUP" as const, cron: "0 2 1 * *", lastResult: "NEVER_RUN" as const, enabled: false },
  ];

  for (const t of tasks) {
    await db.scheduledTask.create({
      data: {
        ...t,
        serverId: aurora.id,
        nextRunAt: nextRun(t.cron) ?? undefined,
        lastRunAt: t.lastResult === "NEVER_RUN" ? null : new Date(now - 6 * 3600_000),
      },
    });
  }

  /* The game catalog last, so it can link the servers above to the
     versions they are running. Upserts, so a reseed does not orphan
     anything that already pointed at a catalog row.

     Offline on purpose: seeding is something you do on a laptop, on a
     plane, in CI. `npm run games:sync` is what fills in what upstream
     has to say. */
  const catalog = await syncCatalog({ offline: true });

  console.log(
    `seeded: 3 users, 3 nodes, ${servers.length} servers, 60 metric samples, 5 players, 4 backups, ${tasks.length} tasks, 5 events, 3 api keys`,
  );
  console.log(
    `catalog: ${catalog.games} games, ${catalog.versions} versions, ${catalog.linked} servers linked`,
  );
  console.log(`sign in as mara@ashfold.gg / ${DEV_PASSWORD}`);
}

/* Run only when invoked directly (`prisma db seed`), not when a
   verification script imports seed() to reset the database first. */
if (process.argv[1]?.includes("seed.ts")) {
  seed()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => db.$disconnect());
}
