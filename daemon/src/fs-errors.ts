/* The two refusals the file operations make, in a file of their own so that the code that walks a path and the code that uses
   the result can both throw them without importing each other. files.ts re-exports them, which is where everything else
   gets them from. */

export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathError";
  }
}

/* A name that is taken: a move or a rename that would have put one thing over another. rename(2) does that without a word, and a person who
   renames `server.properties.bak` to `server.properties` has not asked to lose the second. */
export class ExistsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExistsError";
  }
}

/* A folder with more names in it than a listing can carry. A game or a mod makes files as fast as it likes, and a listing of two million of them is a
   340 MB answer the panel would parse into objects (the audit of 0.9.5). It is a refusal with a sentence, answered 413. */
export class TooManyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TooManyError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}
