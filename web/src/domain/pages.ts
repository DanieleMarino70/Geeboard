/* Pages of a list somebody else counts: the Workshop's shelf.

   Steam says how many items a question matches (`total`), and answers a
   page past its fifty-thousandth result with nothing at all: measured in
   October 2026 on Project Zomboid's Workshop, 24 a page, page 2,084 was
   the last with items when `total` said 67,303. The panel also stops at
   its own hundredth page, which is more than anybody browses and keeps a
   key's daily calls to Steam for something worth having. */

/** Steam's own ceiling: a result past this many is never answered. */
export const STEAM_RESULT_CEILING = 50_000;

/** The panel's ceiling: the pages the shelf offers, whatever Steam counts. */
export const SHELF_PAGE_CEILING = 100;

/** How many items a page of the shelf holds. */
export const SHELF_PAGE_SIZE = 24;

/** The last page there is, for a question Steam counted; at least 1. */
export function lastPage(total: number, perPage = SHELF_PAGE_SIZE, ceiling = SHELF_PAGE_CEILING): number {
  if (!Number.isFinite(total) || total <= 0 || perPage <= 0) return 1;
  const reachable = Math.min(Math.trunc(total), STEAM_RESULT_CEILING);
  return Math.max(1, Math.min(Math.ceil(reachable / perPage), ceiling));
}

/** A page asked for, as a whole number between 1 and the last. */
export function clampPage(page: unknown, last = SHELF_PAGE_CEILING): number {
  const asked = Math.trunc(Number(page));
  if (!Number.isFinite(asked) || asked < 1) return 1;
  return Math.min(asked, Math.max(1, last));
}

/* The page numbers a pager shows: always the first and the last, the
   current one with one on each side, and a gap where pages are left
   out. A gap of exactly one page is that page instead, since "…" would
   take as much room as the number. */
export type PageMark = number | "gap";

export function pageMarks(current: number, last: number): PageMark[] {
  const end = Math.max(1, Math.trunc(last));
  const at = clampPage(current, end);
  const shown = new Set<number>([1, end, at - 1, at, at + 1].filter((n) => n >= 1 && n <= end));
  const sorted = [...shown].sort((a, b) => a - b);
  const marks: PageMark[] = [];
  for (const n of sorted) {
    const previous = marks.length > 0 ? marks[marks.length - 1] : null;
    if (typeof previous === "number" && n - previous === 2) marks.push(previous + 1);
    else if (typeof previous === "number" && n - previous > 2) marks.push("gap");
    marks.push(n);
  }
  return marks;
}
