import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  SpecError,
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
    { label: "RCON", host: 25570, container: 25575, protocol: "tcp" },
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
    "25575/tcp": [{ HostPort: "25570" }],
  });
  assert.deepEqual(Object.keys(options.ExposedPorts!).sort(), [
    "25568/tcp",
    "25568/udp",
    "25569/udp",
    "25575/tcp",
  ]);
});

test("the only thing mounted is the server's own directory", () => {
  const options = containerOptions(parseCreate(body({})), SETTINGS);
  const binds = options.HostConfig!.Binds!;
  assert.equal(binds.length, 1);
  assert.equal(binds[0], `${path.resolve(SETTINGS.dataRoot, GOOD.serverId as string)}:/data`);
});
