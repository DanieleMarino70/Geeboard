/* Runs once, before the server takes a request.

   The check itself is in instrumentation-node.ts and imported only on
   the Node.js runtime, which is Next's own pattern for it: `register` is
   called in every runtime, and a bundle for the Edge one that so much as
   mentions `process.exit` fails to build. Nothing here runs at the edge —
   there is no page or route of this panel that does. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./instrumentation-node");
}
