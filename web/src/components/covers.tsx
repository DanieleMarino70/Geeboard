import type { ReactNode } from "react";

/* The games' covers, drawn here.

   Every game's real artwork belongs to somebody — Mojang, Re-Logic, Iron
   Gate, The Indie Stone — and this project is AGPL, which anybody may
   redistribute: committing key art would hand every fork a licence
   problem it did not choose. Fetching it from a store's CDN moves the
   same artwork into the panel without asking, needs the network on every
   render, and covers neither Minecraft.

   So these are drawn: a handful of flat shapes per game, no gradients,
   no ids, no requests, and nothing that has to be there for a page to
   render. They are read at 28 px on a node's page and at 56 px in the
   wizard, which is why each one is three or four shapes and a colour
   somebody could name — a silhouette at that size, not an illustration.

   A game with no cover here falls back to the striped placeholder in
   ui.tsx. That is the honest answer for a game nobody has drawn yet, and
   it is what `art` on a definition has always been for. */

export interface CoverArt {
  /** The square behind the shapes. */
  background: string;
  /** What is drawn on it, in a 64×64 viewBox. */
  shapes: ReactNode;
}

/* A cube, in the two palettes the two Minecrafts are told apart by. The
   game is a world made of these; nothing else needs saying. */
function cube(top: string, left: string, right: string): ReactNode {
  return (
    <>
      <path d="M32 14 L52 25 L32 36 L12 25 Z" fill={top} />
      <path d="M12 25 L32 36 L32 54 L12 43 Z" fill={left} />
      <path d="M52 25 L52 43 L32 54 L32 36 Z" fill={right} />
    </>
  );
}

const COVERS: Record<string, CoverArt> = {
  /* Grass over earth, from above and from the side at once. */
  "minecraft-java": {
    background: "#3b6b3a",
    shapes: cube("#7ac74f", "#7a5236", "#5d3d28"),
  },

  /* The same world, built of stone: Bedrock runs the same game on other
     machines, and reads as a different thing at a glance. */
  "minecraft-bedrock": {
    background: "#2d4a63",
    shapes: cube("#7fb6d6", "#4a6b85", "#375062"),
  },

  /* Sky, grass, earth and a sun: Terraria is a world in layers, and it
     is the layers you see before anything else. */
  terraria: {
    background: "#57a8dd",
    shapes: (
      <>
        <circle cx="46" cy="17" r="7" fill="#ffe08a" />
        <path d="M0 38 Q16 30 32 36 Q48 42 64 34 L64 64 L0 64 Z" fill="#4f9c3f" />
        <path d="M0 46 Q16 40 32 45 Q48 50 64 43 L64 64 L0 64 Z" fill="#7a5236" />
        <rect x="14" y="20" width="4" height="18" rx="1" fill="#5d3d28" />
        <circle cx="16" cy="18" r="8" fill="#3f8a34" />
      </>
    ),
  },

  /* A mountain under a cold sky, with the rune that marks a raised
     stone. Valheim is the tenth world, and it is all weather and rock. */
  valheim: {
    background: "#2b3a4a",
    shapes: (
      <>
        <path d="M4 50 L22 24 L34 42 L44 30 L60 50 Z" fill="#6d8598" />
        <path d="M22 24 L30 36 L14 36 Z" fill="#dce6ed" />
        <path d="M44 30 L50 39 L38 39 Z" fill="#dce6ed" />
        <path d="M32 8 L32 20 M32 12 L38 6 M32 12 L26 6" stroke="#e7c86a" strokeWidth="2.6" strokeLinecap="round" fill="none" />
        <rect x="0" y="50" width="64" height="14" fill="#1f2b36" />
      </>
    ),
  },

  /* A town at night with the power still on in one window. Project
     Zomboid is a map, a curfew and the dark. */
  "project-zomboid": {
    background: "#16211c",
    shapes: (
      <>
        <circle cx="48" cy="16" r="6" fill="#d8e6c8" opacity="0.85" />
        <rect x="6" y="30" width="14" height="26" fill="#2f4536" />
        <rect x="22" y="22" width="12" height="34" fill="#3a5641" />
        <rect x="36" y="34" width="10" height="22" fill="#2b3f32" />
        <rect x="48" y="28" width="12" height="28" fill="#36503d" />
        <rect x="25" y="27" width="3" height="4" fill="#cfe08a" />
        <rect x="51" y="34" width="3" height="4" fill="#cfe08a" />
        <rect x="0" y="56" width="64" height="8" fill="#0f1713" />
      </>
    ),
  },
};

/** The cover for a game, or null when nobody has drawn one. */
export function coverFor(gameId: string | null | undefined): CoverArt | null {
  return gameId ? (COVERS[gameId] ?? null) : null;
}

/** Which games are drawn — for the check that the registry has no gaps. */
export function drawnCovers(): string[] {
  return Object.keys(COVERS);
}
