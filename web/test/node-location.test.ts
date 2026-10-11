import assert from "node:assert/strict";
import { test } from "node:test";
import { REGION_UNSET, locationLine, regionOf } from "../src/domain/nodes/location.ts";

/* A node fresh from registration has its hostname as the location and REGION_UNSET as the region. The node page printed that as
   "127.0.0.1 · unknown", which read like an error (the UI/UX audit of 2026-10-11). */

test("what registration writes is a region not set, not a region called unknown", () => {
  assert.equal(regionOf(REGION_UNSET), null);
  assert.equal(regionOf(""), null);
  assert.equal(regionOf("  "), null);
  assert.equal(regionOf(null), null);
  assert.equal(locationLine("127.0.0.1", REGION_UNSET), "127.0.0.1 · region not set");
});

test("a region a person set is said as it is", () => {
  assert.equal(regionOf("eu-central"), "eu-central");
  assert.equal(locationLine("Falkenstein", "eu-central"), "Falkenstein · eu-central");
  assert.equal(locationLine("", "home"), "home");
});

test("a node with neither says so once", () => {
  assert.equal(locationLine("", ""), "location not set");
  assert.equal(locationLine(null, REGION_UNSET), "location not set");
});
