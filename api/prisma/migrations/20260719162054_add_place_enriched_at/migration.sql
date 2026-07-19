-- AlterTable: separate enrichment state from provenance (source).
-- Nullable timestamp; null = not yet enriched. Matches Prisma DateTime? -> TIMESTAMP(3).
ALTER TABLE "Place" ADD COLUMN "enrichedAt" TIMESTAMP(3);
