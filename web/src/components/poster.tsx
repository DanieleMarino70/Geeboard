import clsx from "clsx";
import { coverFor } from "@/components/covers";
import type { PosterRef } from "@/lib/game-posters";

/* A game's poster: a 2:3 picture with the game's name and badges written over its foot, and what the game asks of a node shown over the
   rest on hover and on keyboard focus. The Games page draws a wall of them, each a link to the game's page, and the wizard's first step the
   same ones as a radio group. Where a game is a mark beside a server's name (the dashboard, the server lists, a server's and a node's
   page, the wizard's summary) the same poster is cut square by Cover (ui.tsx), from the height its definition names.

   No component here holds state or runs in the browser by itself, so the server components and the wizard (a client one) share it. The
   outer control is the caller's — a link on the Games page, a radio in the wizard — and carries `group`: what moves on hover and focus
   here moves for it. */

export interface PosterGame {
  id: string;
  name: string;
  /** The definition's two lines of text, for the poster of a game nobody has drawn. */
  art: string;
  official: boolean;
  community: boolean;
}

/* The art moves only for a person who has not asked for less movement: a slight zoom on hover and on keyboard focus. Everyone else gets
   the change of colour and opacity alone (the details below fade in; they do not slide). */
const ART =
  "absolute inset-0 h-full w-full motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-(--ease-out-soft) motion-safe:group-hover:scale-[1.04] motion-safe:group-focus-visible:scale-[1.04]";

/* The picture alone, filling the box it is put in (which is the caller's, and 2:3).

   The game's poster when the panel holds one: a plain <img> with its own size, because the file is already the panel's, already sized,
   and served from its own storage, so there is nothing for next/image to fetch or resize and no request leaves at render. Its alt is
   empty: the name is written beside it or over it, and "poster of Valheim" after "Valheim" says nothing twice.

   Otherwise the drawn cover (covers.tsx) on a taller page: the same 64-unit drawing, a little below the top, on its own background, with
   its ground carried down to the bottom edge, where the name is written over it. A game nobody has drawn (a community game is always
   one) is the stripes and its two lines of text, as the square Cover has always been. */
export function PosterArt({ game, tag, poster }: { game: string; tag: string; poster?: PosterRef | null }) {
  if (poster) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- the panel's own file, sized, served from its storage: see above
      <img src={poster.src} width={poster.width} height={poster.height} loading="lazy" decoding="async" alt="" className={clsx(ART, "object-cover")} />
    );
  }

  const art = coverFor(game);
  if (art) {
    return (
      <svg viewBox="0 0 64 96" aria-hidden className={ART}>
        <rect width="64" height="96" fill={art.background} />
        <rect y="69" width="64" height="27" fill={art.ground ?? art.background} />
        <g transform="translate(0 6)">{art.shapes}</g>
      </svg>
    );
  }

  return (
    <div
      aria-hidden
      className={clsx(ART, "grid items-start justify-items-center px-3 pt-[38%]")}
      style={{ background: "repeating-linear-gradient(135deg, var(--card-2) 0 10px, var(--bg-2) 10px 20px)" }}
    >
      <span className="text-center font-mono text-[11px] leading-tight text-ink-3">{tag}</span>
    </div>
  );
}

/* A badge on a poster: in the top corner, each on a chip of the scrim. The panel's Badge sits on its own tint, which over a picture is
   whatever the picture is; this one is the word and an edge in the dark theme's colours on the scrim, which test/contrast checks over
   white and over black. In the corner and not in the strip, so that every strip is a name and one line, and the names on a row line up.
   The word's colour is on an inner span: .gb-dark-surface paints its own text in the ink, outside the utilities' layer, and on the same
   element it won over text-accent-fg. */
function PosterBadge({ tone, children }: { tone: "accent" | "warning"; children: React.ReactNode }) {
  return (
    <span
      className={clsx(
        "gb-dark-surface rounded-full border bg-poster-scrim px-[7px] py-[2px] font-mono text-[9.5px] tracking-[0.06em] uppercase",
        tone === "accent" ? "border-accent-line" : "border-warning-line",
      )}
    >
      <span className={tone === "accent" ? "text-accent-fg" : "text-warning-fg"}>{children}</span>
    </span>
  );
}

/* What the outer control is labelled and described by. Labelled by the name, its badges and the line under it, in that order and as
   separate pieces, so a screen reader hears "Valheim, official, 1 hosted here" and then, as the description, what the game asks: not one
   run-on sentence of everything on the card. */
export function posterIds(base: string, game: PosterGame): { labelledBy: string; details: string } {
  const badged = game.official || game.community;
  return {
    labelledBy: [`${base}-name`, ...(badged ? [`${base}-badges`] : []), `${base}-line`].join(" "),
    details: `${base}-details`,
  };
}

/* Everything inside a poster: the picture, its badges, the details, and the strip with the name. `base` is what posterIds() was given.

   The texts are on --poster-scrim in a .gb-dark-surface, so they are in the dark theme's inks in either theme: the picture under them is
   nobody's choice of colour. The name is a heading on the Games page and plain text in the wizard, where it is inside a radio (a button,
   which a heading cannot be in). */
export function PosterBody({
  game,
  poster,
  base,
  heading = false,
  line,
  details,
  mark,
}: {
  game: PosterGame;
  poster?: PosterRef | null;
  base: string;
  heading?: boolean;
  /** Under the name: "2 hosted here", "4 GB · 3 versions". */
  line: string;
  /** What shows on hover and keyboard focus. */
  details: React.ReactNode;
  /** Beside the name: the wizard's radio. */
  mark?: React.ReactNode;
}) {
  const Name = heading ? "h2" : "span";
  const badged = game.official || game.community;
  return (
    <>
      <PosterArt game={game.id} tag={game.art} poster={poster} />
      <div className="absolute inset-0 flex flex-col">
        {/* The details fill what the strip leaves, below the badges, and are written from the strip's edge upwards. They fade in; for a
            person who has not asked for less movement they also rise a few pixels. Clipped at the top if a narrow poster cannot hold
            them: the game's page has it all. */}
        <div
          id={`${base}-details`}
          className={clsx(
            "gb-dark-surface flex min-h-0 flex-1 flex-col justify-end overflow-hidden bg-poster-scrim px-3 pb-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100",
            badged ? "pt-9" : "pt-3",
          )}
        >
          <div className="flex flex-col gap-[6px] text-[11px] leading-snug text-ink-2 motion-safe:translate-y-1 motion-safe:transition-transform motion-safe:duration-200 motion-safe:group-hover:translate-y-0 motion-safe:group-focus-visible:translate-y-0">
            {details}
          </div>
        </div>
        <div className="gb-dark-surface relative shrink-0 bg-poster-scrim px-3 pt-[9px] pb-[11px]">
          {/* The picture darkens into the strip rather than meeting it at a line. Nothing is written on the fade. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-full h-8 bg-linear-to-t from-poster-scrim to-transparent transition-opacity duration-200 group-hover:opacity-0 group-focus-visible:opacity-0"
          />
          <div className="flex items-start gap-2">
            <Name id={`${base}-name`} className="line-clamp-2 min-w-0 flex-1 text-[13px] leading-tight font-semibold tracking-[-0.015em] text-ink">
              {game.name}
            </Name>
            {mark}
          </div>
          <div id={`${base}-line`} className="mt-[5px] font-mono text-[10px] text-ink-2">
            {line}
          </div>
        </div>
      </div>
      {badged && (
        <div id={`${base}-badges`} className="absolute top-2 left-2 flex flex-wrap gap-1 pr-2">
          {game.official && <PosterBadge tone="accent">official</PosterBadge>}
          {game.community && <PosterBadge tone="warning">community</PosterBadge>}
        </div>
      )}
    </>
  );
}

/* The frame every poster is drawn in: 2:3, the card's edge and radius (kept on focus, where the base style would round the ring to 4 px),
   and the hover that changes the edge's colour and nothing else. The caller adds the selected state. */
export const POSTER_FRAME =
  "group relative block aspect-[2/3] w-full overflow-hidden rounded-[14px] border border-line bg-card shadow-e1 transition-[border-color,box-shadow] duration-200 hover:border-line-2";
