/* Puts one of the health queries to a port on this machine and says what
   came back — the bytes domain/servers/query.ts builds, sent the way the
   node sends them (daemon/src/exchange.ts), with no panel, agent or
   database in between.

   For measuring a protocol against a game's real image before a
   definition is allowed to declare it:

     npx tsx scripts/probe-query.mts terraria-hello 17777 [times]

   A game that does not survive this does not get the probe. */

import { exchange } from "../../daemon/src/exchange.ts";
import { judgeQueryReply, queryPlan, type ExchangeEnd } from "../src/domain/servers/query.ts";
import type { QueryProtocol } from "../src/domain/games/types.ts";

const [protocol, portArg, timesArg] = process.argv.slice(2);
const plan = queryPlan(protocol as QueryProtocol);
if (!plan || !portArg) {
  console.error("usage: probe-query.mts <minecraft-ping|source-a2s|terraria-hello> <host port> [times]");
  process.exit(2);
}

for (let i = 0; i < Number(timesArg ?? 1); i++) {
  const result = await exchange({
    transport: plan.transport,
    port: Number(portArg),
    payload: Buffer.from(plan.payload),
    timeoutMs: plan.timeoutMs,
    maxBytes: plan.maxBytes,
  });
  const reply = Buffer.from(result.reply, "base64");
  const verdict = judgeQueryReply(protocol as QueryProtocol, reply, result.ended as ExchangeEnd);
  console.log(
    `${verdict.ok ? "ok  " : "FAIL"} ${result.ended} ${result.bytes}B ${result.ms}ms  ${reply.subarray(0, 48).toString("hex")}` +
      (verdict.detail ? `  — ${verdict.detail}` : ""),
  );
  await new Promise((r) => setTimeout(r, 500));
}
