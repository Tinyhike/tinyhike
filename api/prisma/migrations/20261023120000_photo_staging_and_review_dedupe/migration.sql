-- AlterTable: a PENDING photo lives in the private staging bucket and has no
-- public URL yet. r2Url is set only when moderation approves the photo and copies
-- a re-encoded (EXIF-stripped) version into the public bucket. Additive: DROP NOT
-- NULL never destroys data.
ALTER TABLE "Photo" ALTER COLUMN "r2Url" DROP NOT NULL;

-- One written review (stars and/or comment) per parent per place. A re-rate
-- updates the existing row instead of stacking a new one, which is what stops a
-- single account from stuffing the average. Anonymous tag votes (userId NULL, or
-- no score and no comment) stay unlimited, so the index is partial. Prisma's
-- schema language cannot express a partial index: it exists only here.
CREATE UNIQUE INDEX "Review_one_written_per_user_per_place"
  ON "Review" ("placeId", "userId")
  WHERE "userId" IS NOT NULL AND ("score" IS NOT NULL OR "comment" IS NOT NULL);
