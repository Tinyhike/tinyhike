-- AlterTable: a tag confirmation is a review carrying only tagsConfirmed /
-- tagsDisputed. Requiring a star rating on it would either block the lightest
-- form of contribution or fill the score average with meaningless ratings.
-- Additive (DROP NOT NULL never destroys data); applied via `prisma migrate
-- deploy` for the same drift-reset reason as every migration in this repo.
ALTER TABLE "Review" ALTER COLUMN "score" DROP NOT NULL;
