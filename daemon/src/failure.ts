/* What Docker and the disk said, as what it means.

   The agent answered `{ error: error.message }` for anything it did not foresee, so Docker's own words went to the panel as the panel's
   sentence, and the two likeliest failures of a create on a real machine, a port held by something that is not Geeboard and a full disk,
   read as engine internals: "(HTTP code 500) server error - driver failed programming external connectivity on endpoint … Bind for
   0.0.0.0:25565 failed: port is already allocated", "ENOSPC: no space left on device, write", with a host path and a server's id in the last.
   An API client got a 500 it took for the node being down. Here the cause is read from the text the engine and the operating system give,
   and answered as a code the panel words for the person looking at the node's name, with the port where there is one. The raw text goes to
   the agent's own log, beside the request. Pure: an error and the data root in, a classification out. */

export type FailureCode = "PORT_IN_USE" | "NO_SPACE" | "PERMISSION" | "DOCKER_DOWN" | "DOCKER_PERMISSION" | "IMAGE_REFUSED";

export interface Failure {
  code: FailureCode;
  /** The status the agent answers with. The panel switches on the code; an older panel sees a status that is still about right. */
  status: number;
  /** The agent's own sentence, with no path in it. The panel puts the node's name in its own. */
  message: string;
  details?: { port?: number };
}

function textOf(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "";
}

function errnoOf(error: unknown): string | undefined {
  const code = (error as NodeJS.ErrnoException | null | undefined)?.code;
  return typeof code === "string" ? code : undefined;
}

/* The port the engine named. It names it four ways, by version: where it bound, what it listened on, what it exposed, and (Docker 29) the
   host port it failed to bind. */
function portIn(text: string): number | undefined {
  for (const pattern of [
    /Bind for \S*?:(\d{1,5})\b/i,
    /bind host port \S*?:(\d{1,5})\b/i,
    /listen (?:tcp|udp)\d? \S*?:(\d{1,5})\b/i,
    /exposing port (?:TCP|UDP) \S*?:(\d{1,5})\b/i,
  ]) {
    const found = pattern.exec(text);
    if (found) {
      const port = Number(found[1]);
      if (port >= 1 && port <= 65535) return port;
    }
  }
  return undefined;
}

export function classifyFailure(error: unknown): Failure | null {
  const text = textOf(error);
  const errno = errnoOf(error);

  // The socket first: a permission denied on it is not a permission problem on the data.
  if (/docker\.sock|docker_engine|docker daemon/i.test(text) && (errno === "EACCES" || /permission denied|EACCES/i.test(text))) {
    return { code: "DOCKER_PERMISSION", status: 500, message: "The agent is not allowed to use Docker's socket on this machine." };
  }
  if (
    /Cannot connect to the Docker daemon|is the docker daemon running|docker unreachable/i.test(text) ||
    (/docker\.sock|docker_engine|:2375\b/i.test(text) && (errno === "ECONNREFUSED" || errno === "ENOENT" || /ECONNREFUSED|ENOENT|cannot find the file/i.test(text)))
  ) {
    return { code: "DOCKER_DOWN", status: 503, message: "Docker is not answering on this machine." };
  }

  if (/port is already allocated|address already in use|Ports are not available|forbidden by its access permissions|Bind for \S+ failed/i.test(text)) {
    const port = portIn(text);
    return {
      code: "PORT_IN_USE",
      status: 409,
      message: `${port ? `Port ${port}` : "The game's port"} is already in use on this machine by something that is not this server.`,
      ...(port ? { details: { port } } : {}),
    };
  }

  if (errno === "ENOSPC" || /ENOSPC|no space left on device|disk quota exceeded/i.test(text)) {
    return { code: "NO_SPACE", status: 507, message: "This machine has no space left on its disk." };
  }

  if (/toomanyrequests|pull rate limit|pull access denied|requested access to the resource is denied|manifest unknown|manifest for \S+ not found|unauthorized: authentication required/i.test(text)) {
    return { code: "IMAGE_REFUSED", status: 502, message: "The registry refused the game's image: a pull limit, or a name that does not exist." };
  }

  if (errno === "EACCES" || errno === "EPERM" || /EACCES|EPERM|permission denied|operation not permitted/i.test(text)) {
    return { code: "PERMISSION", status: 500, message: "The agent was not allowed to do that on this machine's disk (permission denied)." };
  }

  return null;
}

/* The text of a failure that was not classified, with this machine's data directory taken out: a person with file access to a server was
   shown "EACCES: permission denied, open '/var/lib/geeboard/servers/<id>/…'", a host path and a server's id they had no use for. */
export function scrubPaths(text: string, dataRoot: string): string {
  /* A container's id, as the engine prints it in "No such container: <id>" and in a name clash: a long hexadecimal string that means nothing to a person
     and is the handle on the engine (the audit of 0.9.5: it reached a member's toast through the panel's "nothing here says container" contract). */
  let out = text.replace(/\b[0-9a-f]{12,64}\b/gi, "<id>");
  if (!dataRoot) return out;
  const forms = new Set([dataRoot, dataRoot.replaceAll("\\", "/"), dataRoot.replaceAll("/", "\\")]);
  for (const form of forms) if (form.length > 1) out = out.split(form).join("<data>");
  return out;
}
