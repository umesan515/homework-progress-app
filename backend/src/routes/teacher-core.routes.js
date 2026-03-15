const express = require("express");

function createTeacherCoreRouter({
  pool,
  bcrypt,
  requireAuth,
  requireRole,
  deps,
}) {
  const router = express.Router();
  const {
    detectUserColumns,
    ensureSchoolClassesTable,
    readSchoolClassesStore,
    writeSchoolClassesStore,
    upsertSchoolClass,
    findUserByUid,
    findAnyUserByLoginId,
    upsertStudentUser,
    updateStudentUser,
    upsertUserAuth,
    removeMemoryAuthUserByUid,
    removeSchoolClassFromStore,
    tableAvailable,
    isSafeSchemaError,
  } = deps;

  router.get("/classes", requireAuth, requireRole("teacher"), async (_req, res) => {
    try {
      const classSet = new Set(readSchoolClassesStore());
      const classCounts = new Map();
      const usersCols = await detectUserColumns();
      const hasUsersClassId = usersCols.has("class_id");
      const hasUsersRole = usersCols.has("role");
      const schoolClassesAvailable = await ensureSchoolClassesTable();

      if (schoolClassesAvailable) {
        try {
          const c = await pool.query(
            `SELECT class_id
             FROM school_classes
             WHERE class_id IS NOT NULL AND class_id <> ''
             ORDER BY class_id`
          );
          for (const row of c.rows) classSet.add(row.class_id);
        } catch (e) {
          if (!isSafeSchemaError(e)) throw e;
          console.warn("[GET /teacher/classes] school_classes fallback", e?.code || e?.message || e);
        }
      }

      if (hasUsersClassId) {
        try {
          const whereParts = [`class_id IS NOT NULL`, `class_id <> ''`];
          if (hasUsersRole) whereParts.push(`role='student'`);
          const u = await pool.query(
            `SELECT class_id, COUNT(*)::int AS student_count
             FROM users
             WHERE ${whereParts.join(" AND ")}
             GROUP BY class_id
             ORDER BY class_id`
          );
          for (const row of u.rows) {
            classSet.add(row.class_id);
            classCounts.set(row.class_id, Number(row.student_count || 0));
          }
        } catch (e) {
          if (!isSafeSchemaError(e)) throw e;
          console.warn("[GET /teacher/classes] users fallback", e?.code || e?.message || e);
        }
      }

      if (await tableAvailable("assignment_classes")) {
        try {
          const a = await pool.query(
            `SELECT DISTINCT class_id
             FROM assignment_classes
             WHERE class_id IS NOT NULL AND class_id <> ''
             ORDER BY class_id`
          );
          for (const row of a.rows) classSet.add(row.class_id);
        } catch (e) {
          if (!isSafeSchemaError(e)) throw e;
          console.warn("[GET /teacher/classes] assignment_classes fallback", e?.code || e?.message || e);
        }
      }

      const classIds = Array.from(classSet).sort((a, b) =>
        String(a).localeCompare(String(b), "ja", { numeric: true, sensitivity: "base" })
      );

      writeSchoolClassesStore(classIds);
      return res.json(
        classIds.map((class_id) => ({
          class_id,
          student_count: classCounts.get(class_id) ?? 0,
        }))
      );
    } catch (e) {
      console.error("[GET /teacher/classes]", e);
      return res.status(500).json({ error: "server_error" });
    }
  });

  router.post("/classes", requireAuth, requireRole("teacher"), async (req, res) => {
    const classId = String(req.body?.classId ?? "").trim();
    if (!classId) return res.status(400).json({ error: "missing_class_id" });

    try {
      await upsertSchoolClass(classId);
      return res.json({ ok: true, class_id: classId });
    } catch (e) {
      console.error("[POST /teacher/classes]", e);
      return res.status(500).json({ error: "server_error" });
    }
  });

  router.put("/classes/:classId", requireAuth, requireRole("teacher"), async (req, res) => {
    const currentClassId = String(req.params.classId ?? "").trim();
    const nextClassId = String(req.body?.nextClassId ?? "").trim();
    if (!currentClassId || !nextClassId) return res.status(400).json({ error: "missing_class_id" });

    if (currentClassId === nextClassId) {
      try {
        await upsertSchoolClass(nextClassId);
        return res.json({ ok: true, class_id: nextClassId });
      } catch (e) {
        console.error("[PUT /teacher/classes/:classId same]", e);
        return res.status(500).json({ error: "server_error" });
      }
    }

    const client = await pool.connect();
    try {
      await ensureSchoolClassesTable();
      await client.query("BEGIN");
      const exists = await client.query(`SELECT 1 FROM school_classes WHERE class_id=$1`, [nextClassId]);
      if (exists.rowCount > 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "class_exists" });
      }

      await client.query(
        `INSERT INTO school_classes (class_id, updated_at)
         VALUES ($1, now())
         ON CONFLICT (class_id) DO NOTHING`,
        [currentClassId]
      );
      await client.query(`UPDATE school_classes SET class_id=$2, updated_at=now() WHERE class_id=$1`, [currentClassId, nextClassId]);
      await client.query(`UPDATE users SET class_id=$2 WHERE class_id=$1`, [currentClassId, nextClassId]);

      if (await tableAvailable("assignment_classes")) {
        try {
          await client.query(`UPDATE assignment_classes SET class_id=$2 WHERE class_id=$1`, [currentClassId, nextClassId]);
        } catch (e) {
          if (!isSafeSchemaError(e)) throw e;
        }
      }

      if (await tableAvailable("book_classes")) {
        try {
          await client.query(`UPDATE book_classes SET class_id=$2 WHERE class_id=$1`, [currentClassId, nextClassId]);
        } catch (e) {
          if (!isSafeSchemaError(e)) throw e;
        }
      }

      if (await tableAvailable("material_class_targets")) {
        try {
          await client.query(`UPDATE material_class_targets SET class_id=$2 WHERE class_id=$1`, [currentClassId, nextClassId]);
        } catch (e) {
          if (!isSafeSchemaError(e)) throw e;
        }
      }

      await client.query("COMMIT");
      return res.json({ ok: true, class_id: nextClassId });
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch (_e) {}
      console.error("[PUT /teacher/classes/:classId]", e);
      return res.status(500).json({ error: "server_error" });
    } finally {
      client.release();
    }
  });

  router.get("/students", requireAuth, requireRole("teacher"), async (_req, res) => {
    try {
      const cols = await detectUserColumns();
      const loginIdExpr = cols.has("login_id")
        ? `COALESCE(NULLIF(login_id, ''), uid)`
        : `uid`;

      const r = await pool.query(
        `SELECT uid,
                ${loginIdExpr} AS login_id,
                class_id,
                COALESCE(NULLIF(display_name, ''), uid) AS display_name
         FROM users
         WHERE role='student'
         ORDER BY class_id NULLS LAST,
                  COALESCE(NULLIF(display_name, ''), uid),
                  uid`
      );
      return res.json({ students: r.rows });
    } catch (e) {
      console.error("[GET /teacher/students]", e);
      return res.status(500).json({ error: "server_error" });
    }
  });

  router.post("/students", requireAuth, requireRole("teacher"), async (req, res) => {
    const loginId = String(req.body?.loginId ?? "").trim();
    const password = String(req.body?.password ?? "");
    const classId = String(req.body?.classId ?? "").trim();
    const displayName = String(req.body?.displayName ?? "").trim() || loginId;
    if (!loginId || !password || !classId) return res.status(400).json({ error: "missing_body" });

    try {
      await upsertSchoolClass(classId);
      const existing = await findUserByUid(loginId);
      if (existing && existing.role !== "student") {
        return res.status(409).json({ error: "uid_conflict" });
      }

      const loginHit = await findAnyUserByLoginId(loginId);
      if (loginHit && String(loginHit.uid || "") !== loginId) {
        return res.status(409).json({ error: "login_id_conflict" });
      }

      const hash = await bcrypt.hash(password, 12);
      await upsertStudentUser(loginId, {
        classId,
        displayName,
        loginId,
        passwordHash: hash,
      });
      await upsertUserAuth(loginId, loginId, hash, { role: "student", class_id: classId });
      return res.json({ ok: true, uid: loginId, class_id: classId });
    } catch (e) {
      console.error("[POST /teacher/students]", e);
      return res.status(500).json({ error: "server_error" });
    }
  });

  router.post("/students/bulk", requireAuth, requireRole("teacher"), async (req, res) => {
    const classId = String(req.body?.classId ?? "").trim();
    const password = String(req.body?.password ?? "");
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!classId || !password || rows.length === 0) return res.status(400).json({ error: "missing_body" });

    const created = [];
    const skipped = [];
    const seen = new Set();

    try {
      await upsertSchoolClass(classId);
      const hash = await bcrypt.hash(password, 12);

      for (const raw of rows) {
        const loginId = String(raw?.loginId ?? "").trim();
        const displayName = String(raw?.displayName ?? "").trim() || loginId;

        if (!loginId) {
          skipped.push({ loginId: "", error: "missing_login_id" });
          continue;
        }
        if (seen.has(loginId)) {
          skipped.push({ loginId, error: "duplicate_in_request" });
          continue;
        }
        seen.add(loginId);

        const existing = await findUserByUid(loginId);
        if (existing) {
          if (existing.role !== "student") {
            skipped.push({ loginId, error: "uid_conflict" });
          } else {
            skipped.push({ loginId, error: "already_exists" });
          }
          continue;
        }

        const loginHit = await findAnyUserByLoginId(loginId);
        if (loginHit && String(loginHit.uid || "") !== loginId) {
          skipped.push({ loginId, error: "login_id_conflict" });
          continue;
        }

        try {
          await upsertStudentUser(loginId, {
            classId,
            displayName,
            loginId,
            passwordHash: hash,
          });
          await upsertUserAuth(loginId, loginId, hash, { role: "student", class_id: classId });
          created.push({ uid: loginId, class_id: classId });
        } catch (rowError) {
          console.error("[POST /teacher/students/bulk row]", {
            loginId,
            error: rowError?.message || rowError,
            code: rowError?.code || null,
          });
          skipped.push({ loginId, error: String(rowError?.code || rowError?.message || "row_error") });
        }
      }

      return res.json({ class_id: classId, created, skipped });
    } catch (e) {
      console.error("[POST /teacher/students/bulk]", e);
      return res.status(500).json({ error: "server_error" });
    }
  });

  router.put("/students/:uid", requireAuth, requireRole("teacher"), async (req, res) => {
    const uid = String(req.params.uid ?? "").trim();
    const classId = String(req.body?.classId ?? "").trim();
    const displayName = String(req.body?.displayName ?? "").trim();
    const password = String(req.body?.password ?? "");
    if (!uid || !classId) return res.status(400).json({ error: "missing_body" });

    try {
      await upsertSchoolClass(classId);
      const cols = await detectUserColumns();
      const loginIdExpr = cols.has("login_id")
        ? `COALESCE(NULLIF(login_id, ''), uid) AS login_id`
        : `uid AS login_id`;

      const before = await pool.query(
        `SELECT uid, ${loginIdExpr}
         FROM users
         WHERE uid=$1 AND role='student'`,
        [uid]
      );
      if (before.rowCount === 0) return res.status(404).json({ error: "student_not_found" });

      let hash = "";
      if (password) {
        hash = await bcrypt.hash(password, 12);
      }

      await updateStudentUser(uid, {
        classId,
        displayName: displayName || uid,
        loginId: before.rows[0].login_id || uid,
        passwordHash: hash,
      });

      if (password) {
        await upsertUserAuth(uid, before.rows[0].login_id || uid, hash, { role: "student", class_id: classId });
      }

      return res.json({ ok: true, uid, class_id: classId });
    } catch (e) {
      console.error("[PUT /teacher/students/:uid]", e);
      return res.status(500).json({ error: "server_error" });
    }
  });

  router.delete("/students/:uid", requireAuth, requireRole("teacher"), async (req, res) => {
    const uid = String(req.params.uid ?? "").trim();
    if (!uid) return res.status(400).json({ error: "missing_uid" });

    try {
      const existing = await findUserByUid(uid);
      if (!existing || existing.role !== "student") return res.status(404).json({ error: "student_not_found" });
      await pool.query(`DELETE FROM users WHERE uid=$1 AND role='student'`, [uid]);
      removeMemoryAuthUserByUid(uid);
      return res.json({ ok: true, uid });
    } catch (e) {
      console.error("[DELETE /teacher/students/:uid]", e);
      return res.status(500).json({ error: "server_error" });
    }
  });

  router.delete("/classes/:classId", requireAuth, requireRole("teacher"), async (req, res) => {
    const classId = String(req.params.classId ?? "").trim();
    if (!classId) return res.status(400).json({ error: "missing_class_id" });

    removeSchoolClassFromStore(classId);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let studentRows = { rows: [], rowCount: 0 };
      const usersCols = await detectUserColumns();
      if (usersCols.has("class_id")) {
        try {
          const where = usersCols.has("role") ? `role='student' AND class_id=$1` : `class_id=$1`;
          studentRows = await client.query(`SELECT uid FROM users WHERE ${where}`, [classId]);
          await client.query(`DELETE FROM users WHERE ${where}`, [classId]);
        } catch (e) {
          if (!isSafeSchemaError(e)) throw e;
        }
      }

      if (await tableAvailable("school_classes")) {
        try {
          await client.query(`DELETE FROM school_classes WHERE class_id=$1`, [classId]);
        } catch (e) {
          if (!isSafeSchemaError(e)) throw e;
        }
      }

      if (await tableAvailable("assignment_classes")) {
        try {
          await client.query(`DELETE FROM assignment_classes WHERE class_id=$1`, [classId]);
        } catch (e) {
          if (!isSafeSchemaError(e)) throw e;
        }
      }

      if (await tableAvailable("book_classes")) {
        try {
          await client.query(`DELETE FROM book_classes WHERE class_id=$1`, [classId]);
        } catch (e) {
          if (!isSafeSchemaError(e)) throw e;
        }
      }

      if (await tableAvailable("material_class_targets")) {
        try {
          await client.query(`DELETE FROM material_class_targets WHERE class_id=$1`, [classId]);
        } catch (e) {
          if (!isSafeSchemaError(e)) throw e;
        }
      }

      await client.query("COMMIT");
      for (const row of studentRows.rows) removeMemoryAuthUserByUid(row.uid);
      return res.json({ ok: true, class_id: classId, deleted_students: studentRows.rowCount || 0 });
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch (_e) {}
      console.error("[DELETE /teacher/classes/:classId]", e);
      return res.status(500).json({ error: "server_error" });
    } finally {
      client.release();
    }
  });

  return router;
}

module.exports = {
  createTeacherCoreRouter,
};
