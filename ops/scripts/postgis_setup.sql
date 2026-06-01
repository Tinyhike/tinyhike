-- Idempotent PostGIS setup — runs once at container init via initdb.d

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- geom column on Place (Point)
ALTER TABLE "Place" ADD COLUMN IF NOT EXISTS geom geometry(Point, 4326);

-- Sync geom from lat/lng on insert/update
CREATE OR REPLACE FUNCTION sync_place_geom()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.geom := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_place_geom ON "Place";
CREATE TRIGGER trg_place_geom
  BEFORE INSERT OR UPDATE OF lat, lng ON "Place"
  FOR EACH ROW EXECUTE FUNCTION sync_place_geom();

CREATE INDEX IF NOT EXISTS idx_place_geom ON "Place" USING GIST(geom);

-- geom column on Route (LineString)
ALTER TABLE "Route" ADD COLUMN IF NOT EXISTS geom geometry(LineString, 4326);

CREATE INDEX IF NOT EXISTS idx_route_geom ON "Route" USING GIST(geom);
