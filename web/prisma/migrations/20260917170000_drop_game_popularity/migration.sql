-- The catalog no longer carries a popularity figure: it was written into
-- the game definitions, nobody counted it, and the panel presented it
-- beside numbers it had actually counted.
ALTER TABLE "games" DROP COLUMN "popularity";
