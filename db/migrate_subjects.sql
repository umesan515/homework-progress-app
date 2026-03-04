BEGIN;

-- collections.subject を追加
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='collections' AND column_name='subject'
  ) THEN
    ALTER TABLE collections ADD COLUMN subject TEXT NOT NULL DEFAULT 'other';
  END IF;
END $$;

-- 既存データの埋め
UPDATE collections SET subject='other' WHERE subject IS NULL OR subject='';

-- books.subject を追加（シリーズ無しでも教科で管理するため）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='books' AND column_name='subject'
  ) THEN
    ALTER TABLE books ADD COLUMN subject TEXT NOT NULL DEFAULT 'other';
  END IF;
END $$;

-- collection_id がある本は collections.subject を反映
UPDATE books b
SET subject = COALESCE(c.subject, 'other')
FROM collections c
WHERE b.collection_id = c.id;

COMMIT;
