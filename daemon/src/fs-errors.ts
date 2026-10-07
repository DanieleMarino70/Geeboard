/* The two refusals the file operations make, in a file of their own so that the code that walks a path and the code that uses
   the result can both throw them without importing each other. files.ts re-exports them, which is where everything else
   gets them from. */

export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}
