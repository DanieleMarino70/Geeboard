import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyFailure, scrubPaths } from "../src/failure.ts";

/* What Docker and the disk said, as what it means: the messages are the engine's usual ones, as they are printed. */

const said = (text: string, errno?: string) => classifyFailure(Object.assign(new Error(text), errno ? { code: errno } : {}));

test("a port held by something else is a PORT_IN_USE with the port, however the engine words it", () => {
  const bound = said("(HTTP code 500) server error - driver failed programming external connectivity on endpoint geeboard-aurora (4f2a): Bind for 0.0.0.0:25565 failed: port is already allocated");
  assert.equal(bound?.code, "PORT_IN_USE");
  assert.equal(bound?.status, 409);
  assert.deepEqual(bound?.details, { port: 25565 });
  assert.equal(bound?.message, "Port 25565 is already in use on this machine by something that is not this server.");

  // Docker Desktop on Windows, a port inside a range the system keeps.
  const windows = said("(HTTP code 500) server error - Ports are not available: exposing port TCP 0.0.0.0:16261 -> 127.0.0.1:0: listen tcp 0.0.0.0:16261: bind: An attempt was made to access a socket in a way forbidden by its access permissions.");
  assert.equal(windows?.code, "PORT_IN_USE");
  assert.deepEqual(windows?.details, { port: 16261 });

  // Docker 29, as the VPS printed it.
  const docker29 = said("(HTTP code 500) server error - failed to set up container networking: driver failed programming external connectivity on endpoint geeboard-p20a (85b4): failed to bind host port 0.0.0.0:25565/tcp: address already in use ");
  assert.equal(docker29?.code, "PORT_IN_USE");
  assert.deepEqual(docker29?.details, { port: 25565 });

  const udp = said("listen udp4 0.0.0.0:2456: bind: address already in use");
  assert.deepEqual(udp?.details, { port: 2456 });

  // No port in the text: still said, without one.
  assert.equal(said("address already in use")?.message, "The game's port is already in use on this machine by something that is not this server.");
});

test("a name that is taken is not a port, and stays what it was", () => {
  assert.equal(said('Conflict. The container name "/geeboard-aurora" is already in use by container "4f2a"'), null);
});

test("a full disk is NO_SPACE, by the errno or by the words, and the path stays out of the sentence", () => {
  const byCode = said("ENOSPC: no space left on device, write '/var/lib/geeboard/servers/cmu123/world/level.dat'", "ENOSPC");
  assert.equal(byCode?.code, "NO_SPACE");
  assert.equal(byCode?.status, 507);
  assert.doesNotMatch(byCode!.message, /\/var\/lib|cmu123/);
  assert.equal(said("write /data/x: no space left on device")?.code, "NO_SPACE");
});

test("Docker's socket is told from the disk: down, and not allowed", () => {
  assert.equal(said("connect ECONNREFUSED /var/run/docker.sock", "ECONNREFUSED")?.code, "DOCKER_DOWN");
  assert.equal(said("Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?")?.code, "DOCKER_DOWN");
  assert.equal(said("connect ENOENT //./pipe/docker_engine", "ENOENT")?.code, "DOCKER_DOWN");
  const denied = said("connect EACCES /var/run/docker.sock", "EACCES");
  assert.equal(denied?.code, "DOCKER_PERMISSION");
  assert.equal(said("permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock")?.code, "DOCKER_PERMISSION");
});

test("an image the registry will not give is IMAGE_REFUSED, and a permission on the disk is PERMISSION", () => {
  assert.equal(said("toomanyrequests: You have reached your pull rate limit. You may increase the limit by authenticating")?.code, "IMAGE_REFUSED");
  assert.equal(said("pull access denied for geeboard/nothing, repository does not exist or may require 'docker login'")?.code, "IMAGE_REFUSED");
  assert.equal(said("manifest for itzg/minecraft-server:nope not found: manifest unknown")?.code, "IMAGE_REFUSED");
  const permission = said("EACCES: permission denied, open '/var/lib/geeboard/servers/cmu123/server.properties'", "EACCES");
  assert.equal(permission?.code, "PERMISSION");
  assert.doesNotMatch(permission!.message, /\/var\/lib|cmu123/);
});

test("anything else is not classified, and what is not an error is not either", () => {
  assert.equal(said("something odd happened"), null);
  assert.equal(classifyFailure(undefined), null);
  assert.equal(classifyFailure({}), null);
});

test("the data directory is taken out of a message that is shown as it is", () => {
  const root = "/var/lib/geeboard/servers";
  assert.equal(scrubPaths(`cannot open '${root}/cmu123/world/level.dat'`, root), "cannot open '<data>/cmu123/world/level.dat'");
  assert.equal(scrubPaths("D:\\GameServers\\cmu123 is locked", "D:\\GameServers"), "<data>\\cmu123 is locked");
  assert.equal(scrubPaths("C:/ProgramData/Geeboard/servers/x", "C:\\ProgramData\\Geeboard\\servers"), "<data>/x");
  assert.equal(scrubPaths("nothing to take out", root), "nothing to take out");
  assert.equal(scrubPaths("text", ""), "text");
});

test("a container id the engine put in its words is taken out of what is sent", () => {
  const id = "9f3b2c1a7d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8";
  assert.equal(scrubPaths(`(HTTP code 404) no such container - No such container: ${id}`, "/data"), "(HTTP code 404) no such container - No such container: <id>");
  assert.equal(scrubPaths(`Conflict. The container name "/geeboard-aurora" is already in use by container "${id}".`, ""), 'Conflict. The container name "/geeboard-aurora" is already in use by container "<id>".');
  assert.equal(scrubPaths("took 123456789abc ms", ""), "took <id> ms", "a short run of hex is read as an id too: the sentence is for a person, and nothing else here is that long");
  assert.equal(scrubPaths("port 25565 and slug cmu123", ""), "port 25565 and slug cmu123");
});
