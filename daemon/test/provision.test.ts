import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  SpecError,
  cacheRoot,
  containerName,
  containerOptions,
  parseCreate,
  type CreateSpec,
} from "../src/provision.ts";

/* A create request becomes a real container with a real port binding on
   a real machine, so most of this file is bad requests being refused. */

const SETTINGS = { managedLabel: "gg.geeboard.server", dataRoot: "/var/lib/geeboard/servers" };

const GOOD: Record<string, unknown> = {
  serverId: "clx0000000000000000000000",
  name: "nightwatch",
  image: "itzg/minecraft-server:java21",
  ports: [
    { label: "Game", host: 25568, protocol: "both" },
    { label: "Query", host: 25569, protocol: "udp" },
    { label: "RCON", host: 25570, container: 25575, protocol: "tcp", loopback: true },
  ],
  memoryMb: 8192,
  cpuLimit: 300,
  env: { EULA: "TRUE", TYPE: "PAPER" },
};

const body = (overrides: Record<string, unknown>) => ({ ...GOOD, ...overrides });

test("a well-formed request parses", () => {
  const spec = parseCreate(body({}));
  assert.equal(spec.serverId, GOOD.serverId);
  assert.equal(spec.memoryMb, 8192);
  assert.equal(spec.ports.length, 3);
  // A port that does not say otherwise maps straight through.
  assert.equal(spec.ports[0]!.container, 25568);
  assert.equal(spec.ports[2]!.container, 25575);
  // Creation starts the server unless it is asked not to.
  assert.equal(spec.start, true);
  assert.equal(parseCreate(body({ start: false })).start, false);
});

test("a server id is checked before it becomes a path segment", () => {
  for (const serverId of ["../escape", "a/b", "", "with space", "x".repeat(129)]) {
    assert.throws(() => parseCreate(body({ serverId })), SpecError, `accepted ${serverId}`);
  }
});

test("the container name has to stay slug-shaped", () => {
  for (const name of ["Nightwatch", "night watch", "-leading", "night_watch", "n".repeat(40)]) {
    assert.throws(() => parseCreate(body({ name })), SpecError, `accepted ${name}`);
  }
  assert.equal(parseCreate(body({ name: "a" })).name, "a");
  assert.equal(parseCreate(body({ name: "mc-1-21-4" })).name, "mc-1-21-4");
});

test("image references are refused unless they look like one", () => {
  const bad = [
    "-rm",                       // reads as a flag to anything that shells out
    "../../etc/passwd",
    "registry.io/../evil",
    "alpine:3.20; rm -rf /",
    "UPPERCASE/repo",
    "alpine:3.20 --privileged",
    "",
  ];
  for (const image of bad) {
    assert.throws(() => parseCreate(body({ image })), SpecError, `accepted ${image}`);
  }

  const good = [
    "alpine",
    "alpine:3.20",
    "itzg/minecraft-server:java21",
    "ghcr.io/geeboard/valheim:1.4.2",
    "registry.example.com:5000/team/game:2024.11",
    "alpine@sha256:" + "a".repeat(64),
  ];
  for (const image of good) {
    assert.equal(parseCreate(body({ image })).image, image);
  }
});

test("privileged and duplicate ports are refused", () => {
  assert.throws(() => parseCreate(body({ ports: [{ label: "Game", host: 80 }] })), SpecError);
  assert.throws(() => parseCreate(body({ ports: [{ label: "Game", host: 70000 }] })), SpecError);
  assert.throws(() => parseCreate(body({ ports: [] })), SpecError);
  assert.throws(() => parseCreate(body({ ports: [{ host: 25565 }] })), SpecError, "no label");
  assert.throws(
    () =>
      parseCreate(
        body({
          ports: [
            { label: "Game", host: 25565, protocol: "tcp" },
            { label: "Query", host: 25565, protocol: "tcp" },
          ],
        }),
      ),
    SpecError,
    "same host port twice",
  );

  /* The same number on different protocols is a real layout, not a
     clash — a game port is usually published on both. */
  const spec = parseCreate(
    body({
      ports: [
        { label: "Game", host: 25565, protocol: "tcp" },
        { label: "Query", host: 25565, protocol: "udp" },
      ],
    }),
  );
  assert.equal(spec.ports.length, 2);
});

test("limits have to be whole numbers inside the possible range", () => {
  assert.throws(() => parseCreate(body({ memoryMb: 64 })), SpecError, "below the floor");
  assert.throws(() => parseCreate(body({ memoryMb: 1024 * 1024 })), SpecError, "above the ceiling");
  assert.throws(() => parseCreate(body({ memoryMb: 512.5 })), SpecError, "fractional");
  assert.throws(() => parseCreate(body({ memoryMb: "8192" })), SpecError, "a string");
  assert.throws(() => parseCreate(body({ cpuLimit: 0 })), SpecError);
  assert.throws(() => parseCreate(body({ cpuLimit: 6400 })), SpecError);
});

test("environment variables are names and strings, or nothing", () => {
  assert.deepEqual(parseCreate(body({ env: undefined })).env, {});
  assert.throws(() => parseCreate(body({ env: { "2BAD": "x" } })), SpecError);
  assert.throws(() => parseCreate(body({ env: { "PATH;rm": "x" } })), SpecError);
  assert.throws(() => parseCreate(body({ env: { EULA: true } })), SpecError);
  assert.throws(() => parseCreate(body({ env: { EULA: "TRUE\0MORE" } })), SpecError, "null byte");
  assert.throws(() => parseCreate(body({ env: ["EULA=TRUE"] })), SpecError, "an array");
});

/* Start arguments. TShock only creates a world when told to on its
   command line, so without these a definition had no way to run it. */
test("start arguments become the entrypoint's arguments, one entry each", () => {
  const args = ["-config", "/data/serverconfig.txt", "-worldname", "a name; with spaces"];
  const options = containerOptions(parseCreate(body({ command: args })), SETTINGS);
  assert.deepEqual(options.Cmd, args, "exec form: no shell ever splits or runs them");
});

test("no start arguments keeps the image's own default command", () => {
  for (const command of [undefined, []]) {
    const options = containerOptions(parseCreate(body({ command })), SETTINGS);
    // An empty Cmd would replace the default with nothing.
    assert.equal("Cmd" in options, false);
  }
});

test("start arguments are strings, bounded, and free of control characters", () => {
  assert.throws(() => parseCreate(body({ command: "-config /data/x" })), SpecError, "a string, not a list");
  assert.throws(() => parseCreate(body({ command: [42] })), SpecError);
  assert.throws(() => parseCreate(body({ command: ["ok\0hidden"] })), SpecError, "null byte");
  assert.throws(() => parseCreate(body({ command: ["line\nanother"] })), SpecError, "newline");
  assert.throws(() => parseCreate(body({ command: ["x".repeat(513)] })), SpecError, "too long");
  assert.throws(() => parseCreate(body({ command: Array.from({ length: 33 }, () => "x") })), SpecError);
});

test("the container definition carries the limits it was given", () => {
  const spec: CreateSpec = parseCreate(body({}));
  const options = containerOptions(spec, SETTINGS);

  assert.equal(options.name, "geeboard-nightwatch");
  assert.equal(containerName("nightwatch"), "geeboard-nightwatch");
  assert.equal(options.Image, "itzg/minecraft-server:java21");
  assert.equal(options.HostConfig!.Memory, 8192 * 1024 * 1024);
  // Swap matches memory, or the ceiling is only advisory.
  assert.equal(options.HostConfig!.MemorySwap, options.HostConfig!.Memory);
  assert.equal(options.HostConfig!.NanoCpus, 3e9);
  assert.deepEqual(options.Env, ["EULA=TRUE", "TYPE=PAPER"]);
});

test("the definition is labelled ours, and says which server it is", () => {
  const options = containerOptions(parseCreate(body({})), SETTINGS);
  assert.equal(options.Labels!["gg.geeboard.server"], GOOD.serverId);
});

test("the console's requirements are part of the definition", () => {
  const options = containerOptions(parseCreate(body({})), SETTINGS);
  // Commands are written to stdin, so it has to stay open.
  assert.equal(options.OpenStdin, true);
  assert.equal(options.StdinOnce, false);
  // No TTY, or Docker stops framing stdout and stderr separately.
  assert.equal(options.Tty, false);
});

test("a crash is left crashed for the poller to find", () => {
  const options = containerOptions(parseCreate(body({})), SETTINGS);
  assert.deepEqual(options.HostConfig!.RestartPolicy, { Name: "no" });
});

test("ports become bindings on both protocols where asked", () => {
  const options = containerOptions(parseCreate(body({})), SETTINGS);
  assert.deepEqual(options.HostConfig!.PortBindings, {
    "25568/tcp": [{ HostPort: "25568" }],
    "25568/udp": [{ HostPort: "25568" }],
    "25569/udp": [{ HostPort: "25569" }],
    "25575/tcp": [{ HostPort: "25570", HostIp: "127.0.0.1" }],
  });
  assert.deepEqual(Object.keys(options.ExposedPorts!).sort(), [
    "25568/tcp",
    "25568/udp",
    "25569/udp",
    "25575/tcp",
  ]);
});

/* RCON behind nothing but a generated password used to be published on
   every interface of the node. */
test("an administrative port is published on loopback only, and nothing else is", () => {
  const spec = parseCreate(body({}));
  assert.deepEqual(
    spec.ports.map((p) => p.loopback),
    [false, false, true],
  );
  assert.throws(
    () => parseCreate(body({ ports: [{ label: "RCON", host: 25570, loopback: "yes" }] })),
    SpecError,
    "a string is not a boolean",
  );
});

test("the only thing mounted is the server's own directory", () => {
  const options = containerOptions(parseCreate(body({})), SETTINGS);
  const binds = options.HostConfig!.Binds!;
  assert.equal(binds.length, 1);
  assert.equal(binds[0], `${path.resolve(SETTINGS.dataRoot, GOOD.serverId as string)}:/data`);
});

/* Where that directory lands inside the container is the game's
   business: Valheim's image keeps its worlds in /config, and mounting at
   /data left them in the container layer. */
test("a game can say where its directory is mounted", () => {
  const options = containerOptions(parseCreate(body({ dataPath: "/config" })), SETTINGS);
  const root = path.resolve(SETTINGS.dataRoot, GOOD.serverId as string);
  assert.deepEqual(options.HostConfig!.Binds, [`${root}:/config`]);
  // Up to five: Zomboid keeps its data in a home directory and its
  // Workshop downloads a level below that.
  assert.equal(parseCreate(body({ dataPath: "/opt/valheim" })).dataPath, "/opt/valheim");
  assert.equal(parseCreate(body({ dataPath: "/home/steam/Zomboid" })).dataPath, "/home/steam/Zomboid");
  assert.equal(
    parseCreate(body({ cachePaths: ["/home/steam/pz-dedicated/steamapps/workshop"] })).cachePaths[0],
    "/home/steam/pz-dedicated/steamapps/workshop",
  );
});

test("a mount point that would break the container is refused", () => {
  for (const dataPath of [
    "/", "/etc", "/usr", "/usr/share", "/proc/self", "/var", "/root", "data", "/data/../etc",
    "/a/b/c/d/e/f", "/data ; rm", "", "/sys/fs",
  ]) {
    assert.throws(() => parseCreate(body({ dataPath })), SpecError, `accepted ${dataPath}`);
  }
});

/* Cache mounts: what an image downloads for itself, kept across
   workloads and out of every archive. Valheim's 2.2 GB of game is the
   reason they exist. */
test("a cache mount is bound from beside the data, never inside it or the archives", () => {
  const spec = parseCreate(body({ dataPath: "/config", cachePaths: ["/opt/valheim"] }));
  const binds = containerOptions(spec, SETTINGS).HostConfig!.Binds!;

  assert.equal(binds.length, 2);
  assert.equal(binds[0], `${path.resolve(SETTINGS.dataRoot, GOOD.serverId as string)}:/config`);
  const [host, mountPoint] = [binds[1]!.slice(0, binds[1]!.lastIndexOf(":")), binds[1]!.slice(binds[1]!.lastIndexOf(":") + 1)];
  assert.equal(mountPoint, "/opt/valheim");
  assert.equal(host, path.resolve(SETTINGS.dataRoot, ".cache", GOOD.serverId as string, "opt-valheim"));
  // Not under the server's directory, which is what a backup archives.
  assert.ok(!host.startsWith(path.resolve(SETTINGS.dataRoot, GOOD.serverId as string) + path.sep));
  assert.equal(cacheRoot(SETTINGS.dataRoot, GOOD.serverId as string), path.resolve(SETTINGS.dataRoot, ".cache", GOOD.serverId as string));
});

test("no cache mounts is the ordinary case, and one mount", () => {
  assert.deepEqual(parseCreate(body({})).cachePaths, []);
  assert.equal(containerOptions(parseCreate(body({})), SETTINGS).HostConfig!.Binds!.length, 1);
});

test("a cache mount obeys the data mount's rules, and may not overlap it", () => {
  for (const cachePaths of [
    ["/etc/passwd"],
    ["/"],
    ["/data"], // the data mount's own path
    ["/data/cache"], // inside it
    ["/opt/a", "/opt/a/b"], // inside each other
    ["/opt/a", "/opt/b", "/opt/c"], // too many
    "/opt/valheim", // not a list
  ]) {
    assert.throws(() => parseCreate(body({ cachePaths })), SpecError, `accepted ${JSON.stringify(cachePaths)}`);
  }
  // The data mount inside a cache mount is refused the same way.
  assert.throws(() => parseCreate(body({ dataPath: "/opt/valheim/config", cachePaths: ["/opt/valheim"] })), SpecError);
});
