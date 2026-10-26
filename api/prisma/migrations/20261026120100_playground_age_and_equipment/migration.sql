-- Playground details from OSM (min_age, max_age, playground=* equipment), filled
-- by `pnpm backfill:playgrounds`. Generated offline like the previous migration.
-- Additive only; existing rows get an empty equipment list.

-- AlterTable
ALTER TABLE "Place" ADD COLUMN     "maxAge" INTEGER,
ADD COLUMN     "minAge" INTEGER,
ADD COLUMN     "playEquipment" TEXT[] DEFAULT ARRAY[]::TEXT[];

