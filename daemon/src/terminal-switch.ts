import path from "node:path";
import process from "node:process";
import { agentFilePath, readAgentFile, writeAgentFile } from "./agent-file.ts";

/* npm run terminal -- on|off

   Turns the node terminal on or off for a machine that has already
   joined a panel, by writing the `terminal` key of its agent file — the
   same thing `npm run join -- … --terminal` writes for a new node. The
   consent lives on the machine (terminal.ts), so this runs on the
   machine, as the account the agent runs as; the panel has no way to do
   it. The agent reads the file when it starts: restart it afterwards.

   GEEBOARD_TERMINAL in the agent's environment wins over the file, as
   every GEEBOARD_ variable does. A Linux service that sets it in
   /etc/geeboard/agent.env is switched there, not here. */

const USAGE = "Usage: npm run terminal -- on|off";

function main(argv: readonly string[]): number {
  const wanted = argv[0]?.trim().toLowerCase();
  if (argv.length !== 1 || (wanted !== "on" && wanted !== "off")) {
    console.error(`\n${USAGE}\n`);
    return 2;
  }

  const file = agentFilePath();
  let saved;
  try {
    saved = readAgentFile(file);
  } catch (error) {
    console.error(`\n${(error as Error).message}\n`);
    return 1;
  }
  if (!saved) {
    console.error(
      `\nThis machine has not joined a panel: there is no ${file}. ` +
        "Join it first — Nodes → Add a node in the panel gives the command — and pass --terminal to that command instead.\n",
    );
    return 1;
  }

  const { terminal: _was, ...rest } = saved;
  void _was;
  writeAgentFile(file, wanted === "on" ? { ...rest, terminal: true } : rest);

  const restart = process.platform === "win32" ? "restart the Geeboard Agent scheduled task, or sign out and in" : "restart the agent (sudo systemctl restart geeboard-agent)";
  console.log(
    [
      "",
      `Node terminal ${wanted} for ${saved.nodeName}, written to ${file}.`,
      `The agent reads this when it starts: ${restart}. The panel sees the change on the next heartbeat.`,
      process.env.GEEBOARD_TERMINAL !== undefined
        ? `GEEBOARD_TERMINAL is set in this shell (${process.env.GEEBOARD_TERMINAL}); if the agent's environment sets it too, the environment wins over the file.`
        : "",
      "",
    ]
      .filter((line, i, all) => line !== "" || i === 0 || i === all.length - 1)
      .join("\n"),
  );
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exit(main(process.argv.slice(2)));
}
