import assert from "node:assert/strict";
import { test } from "node:test";
import { auditDefinition } from "../src/domain/games/audit.ts";
import { MINECRAFT_BEDROCK } from "../src/domain/games/definitions/minecraft-bedrock.ts";
import { MINECRAFT_JAVA } from "../src/domain/games/definitions/minecraft-java.ts";
import { PALWORLD } from "../src/domain/games/definitions/palworld.ts";
import { PROJECT_ZOMBOID } from "../src/domain/games/definitions/project-zomboid.ts";
import { RUST } from "../src/domain/games/definitions/rust.ts";
import { SATISFACTORY } from "../src/domain/games/definitions/satisfactory.ts";
import { TERRARIA } from "../src/domain/games/definitions/terraria.ts";
import { VALHEIM } from "../src/domain/games/definitions/valheim.ts";

/* The registry audits every game it offers when it is imported, so a definition that is wrong cannot be offered. The
   three parked games are not offered, so nothing audited them: Palworld's query probe named a port the game did not
   have, and it was found only by turning every definition into a manifest. A definition that is parked is a definition
   that will be un-parked one day, and it should not be broken when it is. */

const EVERY_DEFINITION = [MINECRAFT_JAVA, MINECRAFT_BEDROCK, TERRARIA, PROJECT_ZOMBOID, VALHEIM, RUST, PALWORLD, SATISFACTORY];

test("every definition Geeboard has, parked ones included, passes the registry's own audit", () => {
  for (const game of EVERY_DEFINITION) {
    assert.deepEqual(auditDefinition(game), [], game.id);
  }
});

test("a query probe is held to a port the game has: the audit catches the mistake Palworld had", () => {
  const broken = { ...PALWORLD, ports: PALWORLD.ports.filter((p) => p.id !== "query") };
  const problems = auditDefinition(broken);
  assert.ok(problems.some((p) => /source-a2s query names a port "query" the game does not have/.test(p)), problems.join(" | "));
});
