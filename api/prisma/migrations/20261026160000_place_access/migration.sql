-- Place.access, from OSM's access tag (Jérôme, 26 Oct 2026). PRIVATE is hidden
-- unless verified, CUSTOMERS gets a mention on the sheet. Every existing row
-- starts OPEN, i.e. visible as today, until pnpm backfill:osm-tags fills it.
-- Generated offline with prisma migrate diff, read before applying: no DROP,
-- nothing on geom, its trigger or the partial index on Review.

-- CreateEnum
CREATE TYPE "PlaceAccess" AS ENUM ('OPEN', 'CUSTOMERS', 'PRIVATE');

-- AlterTable
ALTER TABLE "Place" ADD COLUMN     "access" "PlaceAccess" NOT NULL DEFAULT 'OPEN';

