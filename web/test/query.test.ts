import assert from "node:assert/strict";
import { test } from "node:test";
import {
  A2S_INFO,
  isA2sReply,
  isMinecraftStatus,
  isTerrariaReply,
  judgeQueryReply,
  minecraftStatusRequest,
  queryPlan,
  terrariaHello,
} from "../src/domain/servers/query.ts";

/* The bytes Geeboard sends a game, and the replies it recognises. The
   replies below are the ones the real images gave, September 2026 —
   copied from `scripts/probe-query.mts`, not written from a specification. */

const hex = (s: string) => Uint8Array.from(Buffer.from(s.replace(/\s+/g, ""), "hex"));

test("the Minecraft status request is a handshake to state 1 and an empty request", () => {
  const bytes = Buffer.from(minecraftStatusRequest("localhost", 25565));
  // 19 bytes of handshake: id 0, protocol -1 as a five-byte varint, "localhost", 25565, state 1.
  assert.equal(bytes.toString("hex"), "1300ffffffff0f096c6f63616c686f737463dd01" + "0100");
});

test("Paper 1.21.4's status reply is recognised from its first bytes", () => {
  const reply = hex("9201008f017b2276657273696f6e223a7b226e616d65223a22506170657220312e32312e34222c2270726f746f636f6c");
  assert.equal(isMinecraftStatus(reply), true);
  assert.deepEqual(judgeQueryReply("minecraft-ping", reply, "quiet"), { ok: true });
});

test("something else on the port is not a Minecraft server", () => {
  assert.equal(isMinecraftStatus(new TextEncoder().encode("HTTP/1.1 400 Bad Request\r\n")), false);
  assert.equal(isMinecraftStatus(hex("05")), false);
  assert.equal(judgeQueryReply("minecraft-ping", new TextEncoder().encode("SSH-2.0-OpenSSH"), "quiet").ok, false);
});

test("A2S_INFO is the bare request, and a challenge counts as the game answering", () => {
  assert.equal(Buffer.from(A2S_INFO).toString("latin1"), "\xff\xff\xff\xffTSource Engine Query\0");
  // What a listed Valheim server sent back.
  assert.equal(isA2sReply(hex("ffffffff41b3edf951")), true);
  assert.equal(isA2sReply(hex("ffffffff4911")), true);
  assert.equal(isA2sReply(hex("feffffff0100")), true);
  assert.equal(isA2sReply(hex("ffffffff")), false);
  assert.equal(isA2sReply(hex("00000000414141")), false);
});

test("Terraria's hello is its connect request, with a version no server has", () => {
  assert.equal(Buffer.from(terrariaHello()).toString("hex"), "0d000109" + Buffer.from("Terraria1").toString("hex"));
});

test("Terraria's disconnect is recognised, from vanilla and from TShock", () => {
  // Vanilla 1.4.5.8, 1.4.4.9 and 1.4.3.6: packet 2, "LegacyMultiplayer.4".
  const vanilla = hex("19000202134c65676163794d756c7469706c617965722e3400");
  // TShock 5.2.4 sends the same, then more packets before it lets go.
  const tshock = hex("19000202134c65676163794d756c7469706c617965722e3400 07005200000000 07005200000000");
  assert.equal(isTerrariaReply(vanilla), true);
  assert.equal(isTerrariaReply(tshock), true);
  /* And sometimes the net-module packet comes first. Seen on a real
     1.4.4.9 server through the panel: judged on the first packet alone,
     it went UNHEALTHY while answering perfectly. */
  assert.equal(isTerrariaReply(hex("07005200000000 19000202134c65676163794d756c7469706c617965722e3400")), true);
  // Cut off after the net modules, it is still the game that spoke.
  assert.equal(isTerrariaReply(hex("07005200000000")), true);
  // A frame of a kind no server sends here is something else on the port.
  assert.equal(isTerrariaReply(hex("0700520000000005006100000000")), false);
  assert.equal(isTerrariaReply(hex("0500ff0000")), false);
  assert.equal(isTerrariaReply(hex("19")), false);
});

test("no reply says whether nothing listened or something did and stayed silent", () => {
  const empty = new Uint8Array();
  assert.match(judgeQueryReply("terraria-hello", empty, "refused").detail!, /nothing is listening/);
  assert.match(judgeQueryReply("terraria-hello", empty, "timeout").detail!, /did not answer/);
  assert.match(judgeQueryReply("source-a2s", empty, "timeout").detail!, /did not answer/);
});

test("each protocol is asked where, and how, the game answers it", () => {
  assert.deepEqual(
    (["minecraft-ping", "source-a2s", "terraria-hello"] as const).map((p) => {
      const plan = queryPlan(p)!;
      return [plan.transport, plan.defaultPort];
    }),
    [["tcp", "game"], ["udp", "query"], ["tcp", "game"]],
  );
  // TShock's REST API is named by the type and not spoken.
  assert.equal(queryPlan("terraria-rest"), null);
});
