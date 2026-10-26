#!/usr/bin/env bash
# Rebuild the dev database (tinyhike_dev) from a dump of production, without the
# accounts and what they wrote. See DEPLOY.md, "Dev environment".
#
# What is left out, at dump time (the rows never leave the production database):
# User, MagicToken, Review, Photo, List and its tables, Follow, Track. The links
# back to accounts are cleared on what is kept: Place.submittedById and
# verifiedById (verifiedAt stays, so dev shows the same places as production),
# Route.authorId and Route.trackId.
#
# Production is only read (pg_dump). The dev database is dropped and recreated:
# anything done in it since the last refresh is lost.
#
# Usage, as the tinyhike user (it calls sudo -u postgres):
#   /srv/tinyhike-dev/ops/scripts/dev-db-refresh.sh
# then, if the dev checkout has migrations production doesn't:
#   cd /srv/tinyhike-dev/api && pnpm db:migrate
#
# One-time setup it relies on: the tinyhike_dev role (DEPLOY.md).
set -euo pipefail

PROD_DB=tinyhike
DEV_DB=tinyhike_dev
DEV_ROLE=tinyhike_dev

if [[ "$DEV_DB" == "$PROD_DB" ]]; then
  echo "refusing: the dev database name is the production one" >&2
  exit 1
fi

pg() { sudo -u postgres "$@"; }
psql_dev() { pg psql -q -X -v ON_ERROR_STOP=1 -d "$DEV_DB" "$@"; }

if [[ "$(pg psql -X -Atc "SELECT 1 FROM pg_roles WHERE rolname = '$DEV_ROLE'")" != 1 ]]; then
  echo "role $DEV_ROLE is missing: create it first (DEPLOY.md, Dev environment)" >&2
  exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
chmod 700 "$work"

echo "1/5 dump $PROD_DB, without accounts, reviews, photos, lists, follows, tracks"
pg pg_dump -Fc -d "$PROD_DB" \
  --exclude-table-data='"User"' \
  --exclude-table-data='"MagicToken"' \
  --exclude-table-data='"Review"' \
  --exclude-table-data='"Photo"' \
  --exclude-table-data='"List"' \
  --exclude-table-data='"ListTranslation"' \
  --exclude-table-data='"ListPlace"' \
  --exclude-table-data='"ListCollaborator"' \
  --exclude-table-data='"Follow"' \
  --exclude-table-data='"Track"' \
  > "$work/prod.dump"

echo "2/5 recreate $DEV_DB, owned by $DEV_ROLE, with production's extensions"
pg dropdb --if-exists "$DEV_DB"
pg createdb -O "$DEV_ROLE" "$DEV_DB"
# PostGIS is not a trusted extension: a superuser creates it, the restore skips it.
for ext in $(pg psql -X -Atd "$PROD_DB" -c "SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY oid"); do
  psql_dev -c "CREATE EXTENSION IF NOT EXISTS \"$ext\""
done

# Everything but the extensions and what they own (the topology schema and its
# tables, spatial_ref_sys), restored as the dev role so it owns every table.
pg_restore -l "$work/prod.dump" | grep -v -E 'EXTENSION|SCHEMA (- )?topology|[A-Z] topology |spatial_ref_sys' > "$work/restore.list"
# pg_restore runs as postgres: let it read the dump, and no one else.
sudo chgrp postgres "$work" "$work/prod.dump" "$work/restore.list"
chmod 750 "$work"
chmod 640 "$work/prod.dump" "$work/restore.list"
restore() {
  pg pg_restore --no-owner --no-privileges --role="$DEV_ROLE" --exit-on-error \
    -L "$work/restore.list" -d "$DEV_DB" "$@" "$work/prod.dump"
}

echo "3/5 restore tables, then data"
restore --section=pre-data
restore --section=data

echo "4/5 clear the links to accounts, then constraints, indexes and triggers"
psql_dev -c "SET ROLE $DEV_ROLE" \
  -c 'UPDATE "Place" SET "submittedById" = NULL, "verifiedById" = NULL WHERE "submittedById" IS NOT NULL OR "verifiedById" IS NOT NULL' \
  -c 'UPDATE "Route" SET "authorId" = NULL, "trackId" = NULL WHERE "authorId" IS NOT NULL OR "trackId" IS NOT NULL'
restore --section=post-data

echo "5/5 check"
psql_dev -At -c "
  SELECT 'accounts '  || (SELECT count(*) FROM \"User\")
    || ', reviews '   || (SELECT count(*) FROM \"Review\")
    || ', tokens '    || (SELECT count(*) FROM \"MagicToken\")
    || ', places '    || (SELECT count(*) FROM \"Place\")
    || ', place triggers ' || (SELECT count(*) FROM pg_trigger WHERE tgrelid = '\"Place\"'::regclass AND NOT tgisinternal)
    || ', migrations ' || (SELECT count(*) FROM _prisma_migrations)"
echo "prod places: $(pg psql -X -Atd "$PROD_DB" -c 'SELECT count(*) FROM "Place"')"
echo "done. If the dev checkout has newer migrations: cd /srv/tinyhike-dev/api && pnpm db:migrate"
