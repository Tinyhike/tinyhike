-- AlterTable: the indoor/baby tag set (Airbnb-style tags decision, 14 Sep 2026).
-- Purely additive; all nullable, null = unknown. Hand-authored and applied with
-- `prisma migrate deploy` — `migrate dev` would detect the out-of-band PostGIS
-- geom columns as drift and offer to reset the database (see CLAUDE.md pitfall #5).
ALTER TABLE "Place" ADD COLUMN "hasChangingTable" BOOLEAN;
ALTER TABLE "Place" ADD COLUMN "hasHighchair" BOOLEAN;
ALTER TABLE "Place" ADD COLUMN "isBreastfeedingFriendly" BOOLEAN;
ALTER TABLE "Place" ADD COLUMN "isStrollerWide" BOOLEAN;
ALTER TABLE "Place" ADD COLUMN "hasElevator" BOOLEAN;
ALTER TABLE "Place" ADD COLUMN "hasOutdoorSeating" BOOLEAN;
ALTER TABLE "Place" ADD COLUMN "hasPlayCorner" BOOLEAN;
ALTER TABLE "Place" ADD COLUMN "isQuiet" BOOLEAN;
