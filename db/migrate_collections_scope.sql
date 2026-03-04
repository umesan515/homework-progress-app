BEGIN;

CREATE TABLE IF NOT EXISTS collections (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM collections WHERE name = 'LEGACY') THEN
    INSERT INTO collections(id, name) VALUES ('legacy', 'LEGACY');
  END IF;
EXCEPTION WHEN unique_violation THEN
  NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='books' AND column_name='collection_id'
  ) THEN
    ALTER TABLE books ADD COLUMN collection_id TEXT;
  END IF;
END $$;

UPDATE books SET collection_id = 'legacy' WHERE collection_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='public' AND table_name='books'
      AND constraint_type='FOREIGN KEY'
      AND constraint_name='books_collection_id_fkey'
  ) THEN
    ALTER TABLE books
      ADD CONSTRAINT books_collection_id_fkey
      FOREIGN KEY (collection_id) REFERENCES collections(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS books_collection_idx ON books(collection_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='blocks' AND column_name='scope'
  ) THEN
    ALTER TABLE blocks ADD COLUMN scope TEXT;
  END IF;
END $$;

UPDATE blocks SET scope = zone WHERE scope IS NULL;

DO $$
BEGIN
  ALTER TABLE blocks ALTER COLUMN scope SET NOT NULL;
EXCEPTION WHEN others THEN
  NULL;
END $$;

CREATE INDEX IF NOT EXISTS blocks_chapter_scope_idx ON blocks(chapter_id, scope);
CREATE INDEX IF NOT EXISTS blocks_chapter_zone_idx  ON blocks(chapter_id, zone);

COMMIT;
