const express = require("express");

function createTeacherMaterialsRouter({
  pool,
  requireAuth,
  requireRole,
  deps,
}) {
  const router = express.Router();
  const {
    newId,
    ensureMaterialsTables,
    listTeacherMaterials,
    readMaterialById,
    normalizeMaterialClassIds,
    normalizeSubject,
    isValidMaterialType,
    isValidInteractiveKind,
    isSafeSchemaError,
  } = deps;

  router.get("/materials", requireAuth, requireRole("teacher"), async (_req, res) => {
    try {
      res.json(await listTeacherMaterials());
    } catch (e) {
      if (isSafeSchemaError(e)) {
        console.warn("[GET /teacher/materials] material tables unavailable; empty fallback");
        return res.json([]);
      }
      console.error("[GET /teacher/materials]", e);
      res.status(500).json({ error: "server_error" });
    }
  });

  router.get("/materials/:id", requireAuth, requireRole("teacher"), async (req, res) => {
    try {
      await ensureMaterialsTables();
      const row = await readMaterialById(pool, String(req.params.id));
      if (!row) return res.status(404).json({ error: "not_found" });
      res.json(row);
    } catch (e) {
      console.error("[GET /teacher/materials/:id]", e);
      res.status(500).json({ error: "server_error" });
    }
  });

  router.post("/materials", requireAuth, requireRole("teacher"), async (req, res) => {
    const title = String(req.body?.title ?? "").trim();
    const description = String(req.body?.description ?? "").trim() || null;
    const subject = normalizeSubject(req.body?.subject);
    const unitName = String(req.body?.unit_name ?? "").trim() || null;
    const gradeLevel = String(req.body?.grade_level ?? "").trim() || null;
    const materialType = String(req.body?.material_type ?? "").trim();
    const contentUrl = String(req.body?.content_url ?? "").trim() || null;
    const thumbnailUrl = String(req.body?.thumbnail_url ?? "").trim() || null;
    const interactiveKind = req.body?.interactive_kind == null ? null : String(req.body?.interactive_kind).trim() || null;
    const interactiveConfig = req.body?.interactive_config ?? null;
    const isPublished = !!req.body?.is_published;
    const classIds = normalizeMaterialClassIds(req.body?.class_ids);

    if (!title) return res.status(400).json({ error: "missing_title" });
    if (!isValidMaterialType(materialType)) return res.status(400).json({ error: "invalid_material_type" });
    if (!isValidInteractiveKind(interactiveKind)) return res.status(400).json({ error: "invalid_interactive_kind" });
    if (materialType !== "interactive" && !contentUrl) return res.status(400).json({ error: "missing_content_url" });

    const client = await pool.connect();
    try {
      await ensureMaterialsTables();
      await client.query("BEGIN");
      const id = newId("mat");
      await client.query(
        `INSERT INTO materials (id, title, description, subject, unit_name, grade_level, material_type, content_url, thumbnail_url, interactive_kind, interactive_config, is_published, created_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())`,
        [id, title, description, subject, unitName, gradeLevel, materialType, contentUrl, thumbnailUrl, interactiveKind, interactiveConfig, isPublished, req.user.uid]
      );
      for (const classId of classIds) {
        await client.query(
          `INSERT INTO material_class_targets (material_id, class_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [id, classId]
        );
      }
      await client.query("COMMIT");
      res.json(await readMaterialById(client, id));
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("[POST /teacher/materials]", e);
      res.status(500).json({ error: "server_error" });
    } finally {
      client.release();
    }
  });

  router.put("/materials/:id", requireAuth, requireRole("teacher"), async (req, res) => {
    const id = String(req.params.id);
    const title = String(req.body?.title ?? "").trim();
    const description = String(req.body?.description ?? "").trim() || null;
    const subject = normalizeSubject(req.body?.subject);
    const unitName = String(req.body?.unit_name ?? "").trim() || null;
    const gradeLevel = String(req.body?.grade_level ?? "").trim() || null;
    const materialType = String(req.body?.material_type ?? "").trim();
    const contentUrl = String(req.body?.content_url ?? "").trim() || null;
    const thumbnailUrl = String(req.body?.thumbnail_url ?? "").trim() || null;
    const interactiveKind = req.body?.interactive_kind == null ? null : String(req.body?.interactive_kind).trim() || null;
    const interactiveConfig = req.body?.interactive_config ?? null;
    const isPublished = !!req.body?.is_published;
    const classIds = normalizeMaterialClassIds(req.body?.class_ids);

    if (!title) return res.status(400).json({ error: "missing_title" });
    if (!isValidMaterialType(materialType)) return res.status(400).json({ error: "invalid_material_type" });
    if (!isValidInteractiveKind(interactiveKind)) return res.status(400).json({ error: "invalid_interactive_kind" });
    if (materialType !== "interactive" && !contentUrl) return res.status(400).json({ error: "missing_content_url" });

    const client = await pool.connect();
    try {
      await ensureMaterialsTables();
      await client.query("BEGIN");
      const exists = await client.query(`SELECT id FROM materials WHERE id=$1`, [id]);
      if (exists.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "not_found" });
      }
      await client.query(
        `UPDATE materials
            SET title=$2,
                description=$3,
                subject=$4,
                unit_name=$5,
                grade_level=$6,
                material_type=$7,
                content_url=$8,
                thumbnail_url=$9,
                interactive_kind=$10,
                interactive_config=$11,
                is_published=$12,
                updated_at=now()
          WHERE id=$1`,
        [id, title, description, subject, unitName, gradeLevel, materialType, contentUrl, thumbnailUrl, interactiveKind, interactiveConfig, isPublished]
      );
      await client.query(`DELETE FROM material_class_targets WHERE material_id=$1`, [id]);
      for (const classId of classIds) {
        await client.query(
          `INSERT INTO material_class_targets (material_id, class_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [id, classId]
        );
      }
      await client.query("COMMIT");
      res.json(await readMaterialById(client, id));
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("[PUT /teacher/materials/:id]", e);
      res.status(500).json({ error: "server_error" });
    } finally {
      client.release();
    }
  });

  router.delete("/materials/:id", requireAuth, requireRole("teacher"), async (req, res) => {
    try {
      await ensureMaterialsTables();
      const d = await pool.query(`DELETE FROM materials WHERE id=$1 RETURNING id`, [String(req.params.id)]);
      if (d.rows.length === 0) return res.status(404).json({ error: "not_found" });
      res.json({ ok: true, id: d.rows[0].id });
    } catch (e) {
      console.error("[DELETE /teacher/materials/:id]", e);
      res.status(500).json({ error: "server_error" });
    }
  });

  return router;
}

module.exports = { createTeacherMaterialsRouter };
