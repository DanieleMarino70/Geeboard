/* A console line as text, without the codes a terminal reads.

   itzg's Minecraft image colours the lines of its own start
   ("[init]", "[mc-image-helper]"), and the console showed them raw: the
   escape character as a glyph, then "[39m" or "[0;39m" before the
   words. Docker keeps what a container writes byte for byte, so the
   codes reach the panel whether or not anything reads them as colour.

   Taken off here, where a line comes in from a node, so the page, the
   server's last lines, a download, the players read from the console
   and every pattern a definition matches all see the same words. The
   colours are not drawn: a level already colours a line.

   - CSI, `ESC [` (or the one-byte U+009B), parameters, a final letter:
     colours, cursor moves, erasing a line.
   - OSC, `ESC ]` (or U+009D), up to BEL or `ESC \`: a terminal's title,
     a link; one with no end runs to the end of the line.
   - Any other escape, `ESC` and the character after it, and an `ESC`
     on its own at the end of a line. */
const ESCAPES = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]|(?:\u001b\]|\u009d)[^\u0007\u001b\u009c]*(?:\u0007|\u001b\\|\u009c)?|\u001b[ -/]*[0-~]|\u001b/g;

/** A line without its terminal escapes, otherwise as it was. */
export function plainLine(line: string): string {
  return line.replace(ESCAPES, "");
}
