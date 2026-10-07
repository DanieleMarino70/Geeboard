/* What a console that would not open was told, in the words the reader sees.

   The console is an EventSource, and a browser's EventSource cannot read the body of an answer that is not a stream: a 401, a 403, a 404 or
   a 503 from the route (each of which names its reason) ended in "Disconnected" and an empty box. The hook asks once more, with a fetch of
   the same address, when the stream gives up, and gives what came back to this. Pure: a status (null when nothing answered) and the body. */

export function explainConsoleRefusal(status: number | null, body: string): string {
  if (status === null) return "The panel did not answer. Check your connection, or try again in a moment: it may be restarting.";
  if (status === 401) return "Your session has ended. Sign in again to watch the console.";
  if (status === 404) return "This server no longer exists.";

  // The route's own sentence: a plain text for a refusal of the role, JSON for a node without an agent.
  let said = body.trim();
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message === "string" && parsed.message.trim()) said = parsed.message.trim();
  } catch {
    /* not JSON: the text is the sentence */
  }
  if (status === 403 || status === 503) return said || (status === 403 ? "You may not watch this server's console." : "The node's agent is not available.");
  if (status >= 500) return `The panel did not answer properly (HTTP ${status}). It may be restarting; try again in a moment.`;
  return said || `The panel refused it (HTTP ${status}).`;
}
