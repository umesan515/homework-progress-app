function createMaterialsService({ pool, ensureMaterialsTables }) {
  function isValidSubject(x) {
    return (
      x === "math" ||
      x === "english" ||
      x === "japanese" ||
      x === "science" ||
      x === "social" ||
      x === "informatics" ||
      x === "other"
    );
  }

  function normalizeSubject(x) {
    const s = String(x ?? "").trim();
    if (!s) return "other";
    return isValidSubject(s) ? s : "other";
  }

  function isValidMaterialType(x) {
    return x === "image" || x === "video" || x === "interactive" || x === "app";
  }

  function isValidInteractiveKind(x) {
    return x === null || x === undefined || x === "" || x === "linear" || x === "parabola" || x === "bars";
  }

  function normalizeMaterialClassIds(input) {
    if (!Array.isArray(input)) return [];
    return Array.from(new Set(input.map((x) => String(x ?? "").trim()).filter(Boolean))).sort();
  }

  async function readMaterialById(client, id) {
    const r = await client.query(
      `SELECT m.id, m.title, m.description, m.subject, m.unit_name, m.grade_level, m.material_type, m.content_url, m.thumbnail_url, m.interactive_kind, m.interactive_config, m.is_published, m.created_by, m.created_at, m.updated_at, COALESCE(array_remove(array_agg(t.class_id ORDER BY t.class_id), NULL), '{}') AS class_ids
       FROM materials m
       LEFT JOIN material_class_targets t ON t.material_id = m.id
       WHERE m.id = $1
       GROUP BY m.id`,
      [id]
    );
    return r.rows[0] ?? null;
  }

  async function listTeacherMaterials() {
    await ensureMaterialsTables();
    const r = await pool.query(
      `SELECT m.id, m.title, m.description, m.subject, m.unit_name, m.grade_level, m.material_type, m.content_url, m.thumbnail_url, m.interactive_kind, m.interactive_config, m.is_published, m.created_by, m.created_at, m.updated_at, COALESCE(array_remove(array_agg(t.class_id ORDER BY t.class_id), NULL), '{}') AS class_ids
       FROM materials m
       LEFT JOIN material_class_targets t ON t.material_id = m.id
       GROUP BY m.id
       ORDER BY m.updated_at DESC, m.created_at DESC`
    );
    return r.rows;
  }

  async function listStudentMaterials(classId) {
    await ensureMaterialsTables();
    const params = [];
    let visibility = "NOT EXISTS (SELECT 1 FROM material_class_targets t2 WHERE t2.material_id = m.id)";
    if (classId) {
      params.push(classId);
      visibility = `${visibility} OR EXISTS (SELECT 1 FROM material_class_targets t2 WHERE t2.material_id = m.id AND t2.class_id = $1)`;
    }
    const r = await pool.query(
      `SELECT m.id, m.title, m.description, m.subject, m.unit_name, m.grade_level, m.material_type, m.content_url, m.thumbnail_url, m.interactive_kind, m.interactive_config, m.is_published, m.created_by, m.created_at, m.updated_at, COALESCE(array_remove(array_agg(t.class_id ORDER BY t.class_id), NULL), '{}') AS class_ids
       FROM materials m
       LEFT JOIN material_class_targets t ON t.material_id = m.id
       WHERE m.is_published = true AND (${visibility})
       GROUP BY m.id
       ORDER BY m.updated_at DESC, m.created_at DESC`,
      params
    );
    return r.rows;
  }

  return {
    normalizeSubject,
    isValidMaterialType,
    isValidInteractiveKind,
    normalizeMaterialClassIds,
    readMaterialById,
    listTeacherMaterials,
    listStudentMaterials,
  };
}

module.exports = { createMaterialsService };
