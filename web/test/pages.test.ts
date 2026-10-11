import test from "node:test";
import assert from "node:assert/strict";
import { clampPage, lastPage, pageMarks, SHELF_PAGE_CEILING, STEAM_RESULT_CEILING } from "../src/domain/pages";

test("the last page is the count over the page size, rounded up", () => {
  assert.equal(lastPage(4143, 24, Number.POSITIVE_INFINITY), 173); // "vehicles" on Zomboid's Workshop: page 173 held 15
  assert.equal(lastPage(48, 24), 2);
  assert.equal(lastPage(49, 24), 3);
  assert.equal(lastPage(1, 24), 1);
});

test("nothing counted is still one page, never zero", () => {
  assert.equal(lastPage(0), 1);
  assert.equal(lastPage(-3), 1);
  assert.equal(lastPage(Number.NaN), 1);
});

test("Steam answers nothing past its fifty-thousandth result, so no page past it is offered", () => {
  // Measured: 67,303 counted, page 2,084 the last with items at 24 a page.
  assert.equal(lastPage(67_303, 24, Number.POSITIVE_INFINITY), 2084);
  assert.equal(lastPage(STEAM_RESULT_CEILING * 3, 50, Number.POSITIVE_INFINITY), 1000);
});

test("the shelf stops at its own hundredth page", () => {
  assert.equal(lastPage(67_303), SHELF_PAGE_CEILING);
  assert.equal(lastPage(2_400), 100);
  assert.equal(lastPage(2_399), 100);
  assert.equal(lastPage(2_376), 99);
});

test("a page from the browser is a whole number within the pages there are", () => {
  assert.equal(clampPage("7"), 7);
  assert.equal(clampPage(7.9), 7);
  assert.equal(clampPage(0), 1);
  assert.equal(clampPage(-2), 1);
  assert.equal(clampPage("x"), 1);
  assert.equal(clampPage(undefined), 1);
  assert.equal(clampPage(5000), SHELF_PAGE_CEILING);
  assert.equal(clampPage(9, 4), 4);
});

test("a pager shows the first, the last, and the current page with one on each side", () => {
  assert.deepEqual(pageMarks(1, 1), [1]);
  assert.deepEqual(pageMarks(1, 2), [1, 2]);
  assert.deepEqual(pageMarks(1, 100), [1, 2, "gap", 100]);
  assert.deepEqual(pageMarks(50, 100), [1, "gap", 49, 50, 51, "gap", 100]);
  assert.deepEqual(pageMarks(100, 100), [1, "gap", 99, 100]);
});

test("a gap of one page is that page, since the dots would take as much room", () => {
  assert.deepEqual(pageMarks(3, 100), [1, 2, 3, 4, "gap", 100]);
  assert.deepEqual(pageMarks(4, 7), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(pageMarks(5, 7), [1, "gap", 4, 5, 6, 7]);
});

test("a current page out of range is read as the nearest one there is", () => {
  assert.deepEqual(pageMarks(0, 5), [1, 2, "gap", 5]);
  assert.deepEqual(pageMarks(9, 5), [1, "gap", 4, 5]);
});
