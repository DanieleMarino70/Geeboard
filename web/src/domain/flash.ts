/* A message that has to outlive a redirect.

   A server action that ends in `redirect()` throws away what it was going to answer with: the page it lands on never hears it. Deleting a
   server ends in one, and what it had to say was which final backup was taken and where it stays, and any DNS record left behind: the two
   things a person most needs after deleting something, and the Servers page showed neither. A flash is the same sentence carried on a
   cookie for one page view: set by the action, drawn by the next page as a toast, cleared as it is shown.

   It is text for a person and nothing else: it decides nothing, is rendered as text and not as markup, and is bounded, so a cookie
   somebody else put there can only make this browser show a sentence, of a few hundred characters, once. */

export type FlashTone = "success" | "warning" | "danger";

export interface Flash {
  id: string;
  tone: FlashTone;
  title: string;
  body: string;
}

export const FLASH_COOKIE = "gb_flash";
export const FLASH_MAX_AGE_SECONDS = 120;
const TITLE_MAX = 160;
const BODY_MAX = 800;

const TONES: readonly FlashTone[] = ["success", "warning", "danger"];

export function encodeFlash(flash: Omit<Flash, "id">, id: string): string {
  return encodeURIComponent(
    JSON.stringify({ id, tone: flash.tone, title: flash.title.slice(0, TITLE_MAX), body: flash.body.slice(0, BODY_MAX) } satisfies Flash),
  );
}

/** What the cookie holds, or null for anything that is not exactly that: nothing is guessed at. */
export function decodeFlash(raw: string | undefined): Flash | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(decodeURIComponent(raw)) as Partial<Flash>;
    if (typeof value.id !== "string" || value.id.length === 0 || value.id.length > 64) return null;
    if (!value.tone || !TONES.includes(value.tone)) return null;
    if (typeof value.title !== "string" || typeof value.body !== "string") return null;
    return { id: value.id, tone: value.tone, title: value.title.slice(0, TITLE_MAX), body: value.body.slice(0, BODY_MAX) };
  } catch {
    return null;
  }
}
