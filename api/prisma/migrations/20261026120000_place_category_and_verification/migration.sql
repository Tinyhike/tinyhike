-- Hide unverified cafés (Jérôme, 26 Oct 2026). Generated offline with
-- `prisma migrate diff --from-schema-datamodel … --to-schema-datamodel …`, never
-- `migrate dev`: it would diff against the live DB, see geom, trg_place_geom and
-- the partial review index as drift and offer a reset (pitfalls 5 and 22).
-- Additive only: nullable columns the running API does not read. category is
-- filled by `pnpm backfill:osm-tags`, which must run before the API that filters
-- on it is deployed (a null category is hidden).

-- CreateEnum
CREATE TYPE "PlaceCategory" AS ENUM ('PLAYGROUND', 'PARK', 'PICNIC_SITE', 'CAFE');

-- AlterTable
ALTER TABLE "Place" ADD COLUMN     "category" "PlaceCategory",
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT;

-- AddForeignKey
ALTER TABLE "Place" ADD CONSTRAINT "Place_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

