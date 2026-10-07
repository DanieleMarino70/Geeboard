/* Putting sentences together without printing ".." or "intact and backup complete is locked".

   A message the panel shows is built from parts that were written apart, and some of the parts are somebody else's: an error's own text,
   a node's answer. Twelve places appended a full stop to a message that might already end in one, and four others stripped it by hand
   with their own regular expression. `bare` is the one way to take a part to where a sentence of the panel's own can continue it, and
   test/text.test.ts reads the source for a message interpolated in front of a full stop without it. */

/** The text without the full stops and the white space at its end: ready to have something put after it. */
export function bare(text: string): string {
  return text.replace(/[\s.]+$/, "");
}

/** Sentences joined: each one ends in exactly one full stop, whether or not it came with one. Empty parts are left out. */
export function sentences(...parts: Array<string | null | undefined | false>): string {
  return parts
    .filter((part): part is string => typeof part === "string" && bare(part).length > 0)
    .map((part) => `${bare(part)}.`)
    .join(" ");
}
