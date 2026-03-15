function createRuntimeMigrations(pool) {
  let __bookClassesReady = false;
  let __materialsReady = false;

  async function ensureMaterialsTables() {
    if (__materialsReady) return;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS materials (
        id text PRIMARY KEY,
        title text NOT NULL,
        description text,
        subject text NOT NULL DEFAULT 'other',
        unit_name text,
        grade_level text,
        material_type text NOT NULL,
        content_url text,
        thumbnail_url text,
        interactive_kind text,
        interactive_config jsonb,
        is_published boolean NOT NULL DEFAULT false,
        created_by text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS material_class_targets (
        material_id text NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
        class_id text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (material_id, class_id)
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS material_targets_class_idx
      ON material_class_targets(class_id)
    `);

    __materialsReady = true;
  }

  async function ensureBookClassesTable() {
    if (__bookClassesReady) return;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS book_classes (
        book_id text NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        class_id text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (book_id, class_id)
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS book_classes_class_idx
      ON book_classes(class_id)
    `);

    __bookClassesReady = true;
  }

  return {
    ensureMaterialsTables,
    ensureBookClassesTable,
  };
}

module.exports = {
  createRuntimeMigrations,
};
