/* What a person may paste, and what a Workshop page says once the
   markup is taken off it.

   Here rather than beside the Steam client in lib/, because neither of
   these needs a network, a key or a server: they are rules about text,
   and rules about text are testable on their own. */

/** A Workshop id from a link, a number, or nothing that is one. */
export function workshopIdFrom(raw: string): string | null {
  const text = raw.trim();
  if (/^\d{1,20}$/.test(text)) return text;

  try {
    const url = new URL(text);
    // Somebody else's link with an id in it is not a Workshop item.
    if (!/(^|\.)steamcommunity\.com$/i.test(url.hostname)) return null;
    const id = url.searchParams.get("id");
    return id && /^\d{1,20}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/* Workshop descriptions are BBCode, often long, and written for a page
   with headings and images. The panel shows one line of it, so it takes
   one: tags out, links out, whitespace collapsed, cut at a length that
   fits a card. */
export function summariseWorkshop(description: string): string {
  const text = description
    .replace(/\[\/?[^\]]{1,40}\]/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 220 ? `${text.slice(0, 217)}…` : text;
}
