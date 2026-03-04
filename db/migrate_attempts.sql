-- Add collections table + books.collection_id + blocks.scope
BEGIN;

CREATE TABLE IF NOT EXISTS collections (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relname='collections_name_uq' AND n.nspname='public'
  ) THEN
    CREATE UNIQUE INDEX collections_name_uq ON collections(name);
  END IF;
END$$;

ALTER TABLE books ADD COLUMN IF NOT EXISTS collection_id text REFERENCES collections(id) ON DELETE SET NULL;

-- Create a legacy collection and attach existing books if they have no collection_id
DO $$
DECLARE
  legacy_id text;
BEGIN
  SELECT id INTO legacy_id FROM collections WHERE name='LEGACY' LIMIT 1;
  IF legacy_id IS NULL THEN
    legacy_id := 'col_legacy';
    INSERT INTO collections (id, name) VALUES (legacy_id, 'LEGACY');
  END IF;

  UPDATE books SET collection_id = legacy_id WHERE collection_id IS NULL;
END$$;

ALTER TABLE blocks ADD COLUMN IF NOT EXISTS scope text;

-- backfill scope = zone for existing rows
UPDATE blocks SET scope = zone WHERE scope IS NULL;

ALTER TABLE blocks ALTER COLUMN scope SET NOT NULL;

CREATE INDEX IF NOT EXISTS books_collection_idx ON books(collection_id);
CREATE INDEX IF NOT EXISTS blocks_chapter_scope_idx ON blocks(chapter_id, scope);

COMMIT;
