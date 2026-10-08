import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";

/* Who else on this machine can read what the agent keeps.

   A world, the RCON password in a server's properties and every backup archive are in the data root, and on a Linux machine with another
   account (a home server a friend has a shell on, a VPS shared with a project) the folders the agent makes were readable by that account:
   `mkdir` with the default mode is 0755 and a created file is 0644. The Windows installer sets an ACL for exactly this; Linux did not say
   anything (the audit of 0.9.5).

   The data root is traversable and not listable (0711): a person who does not know a server's id, a long random string, cannot find its
   folder. The two folders only the agent uses, where archives and uploads are written, are the agent's and nobody else's (0700) whatever
   mode the files in them have. What a game container needs (its own server folder, the cache mount) is left as it is: the container's user
   is whatever the image runs as. Where this cannot be done (an agent that is not the owner of the folder) it is said and the agent goes on. */

export const DATA_ROOT_MODE = 0o711;
export const PRIVATE_MODE = 0o700;
export const PRIVATE_FOLDERS = [".backups", ".uploads"] as const;

export async function keepDataRootPrivate(dataRoot: string, say: (message: string, fields: { detail: string }) => void): Promise<void> {
  if (process.platform !== "linux") return;
  try {
    await mkdir(dataRoot, { recursive: true });
    await chmod(dataRoot, DATA_ROOT_MODE);
    for (const name of PRIVATE_FOLDERS) {
      const dir = path.join(dataRoot, name);
      await mkdir(dir, { recursive: true, mode: PRIVATE_MODE });
      await chmod(dir, PRIVATE_MODE);
    }
  } catch (error) {
    say("the data root could not be made private to this account; other accounts on the machine may read what is in it", {
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
