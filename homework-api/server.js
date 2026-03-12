const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const cors = require("cors");
const helmet = require("helmet");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

dotenv.config();

const app = express();

const uploadsRootEnv = process.env.UPLOAD_DIR || "uploads";
const resolvedUploadsRoot = path.isAbsolute(uploadsRootEnv) ? uploadsRootEnv : path.join(__dirname, uploadsRootEnv);

// --- uploads (question images) ---
const uploadsRoot = resolvedUploadsRoot;
const questionUploadsDir = path.join(uploadsRoot, "questions");
try {
  fs.mkdirSync(questionUploadsDir, { recursive: true });
} catch (e) {
  // ignore
}
app.use("/uploads", express.static(uploadsRoot));

const materialUploadsDir = path.join(uploadsRoot, "materials");
const materialImageDir = path.join(materialUploadsDir, "images");
const materialVideoDir = path.join(materialUploadsDir, "videos");
const materialThumbDir = path.join(materialUploadsDir, "thumbs");
const materialAppDir = path.join(materialUploadsDir, "apps");
for (const dir of [materialUploadsDir, materialImageDir, materialVideoDir, materialThumbDir, materialAppDir]) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_e) {}
}

const makeDiskUpload = (destinationDir, fileSize, allowFile) =>
  multer({
    storage: multer.diskStorage({
      destination: function (_req, _file, cb) { cb(null, destinationDir); },
      filename: function (_req, file, cb) {
        const safeBase = path.basename(file.originalname || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
        const ext = path.extname(safeBase).slice(0, 20);
        const stem = path.basename(safeBase, ext).slice(0, 60) || "file";
        cb(null, `${Date.now()}_${Math.random().toString(16).slice(2)}_${stem}${ext}`);
      },
    }),
    limits: { fileSize },
    fileFilter: function (req, file, cb) {
      try { if (!allowFile(file)) return cb(new Error("invalid_file_type")); cb(null, true); } catch (e) { cb(e); }
    },
  });

const materialImageUpload = makeDiskUpload(materialImageDir, 10 * 1024 * 1024, (file) => String(file.mimetype || "").startsWith("image/"));
const materialThumbUpload = makeDiskUpload(materialThumbDir, 10 * 1024 * 1024, (file) => String(file.mimetype || "").startsWith("image/"));
const materialVideoUpload = makeDiskUpload(materialVideoDir, 250 * 1024 * 1024, (file) => /^video\/(mp4|webm|ogg)/.test(String(file.mimetype || "")));
const materialAppUpload = makeDiskUpload(materialAppDir, 20 * 1024 * 1024, (file) => {
  const mime = String(file.mimetype || "").toLowerCase();
  const ext = path.extname(file.originalname || "").toLowerCase();
  return mime === "text/html" || ext === ".html" || ext === ".htm";
});

const questionUpload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, questionUploadsDir);
    },
    filename: function (req, file, cb) {
      const ext = path.extname(file.originalname || "").slice(0, 16);
      cb(null, `${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`);
    },
  }),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});
app.use(helmet({ crossOriginResourcePolicy: false }));

const corsOrigins = String(process.env.CORS_ORIGIN || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin || corsOrigins.length === 0 || corsOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("cors_not_allowed"));
  },
}));
app.use(express.json({ limit: "10mb" }));

const JWT_SECRET = process.env.JWT_SECRET || "DEV_SECRET_CHANGE_ME";
const JWT_EXPIRES_IN = "14d";

const dbConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.PGHOST || "127.0.0.1",
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER || "postgres",
      password: process.env.PGPASSWORD || process.env.PG_PASSWORD || "",
      database: process.env.PGDATABASE || "homework_app",
    };

const pool = new Pool(dbConfig);
async function tableAvailable(tableName) {
  try {
    const target = String(tableName || "").includes(".") ? String(tableName) : `public.${String(tableName)}`;
    const r = await pool.query(`SELECT to_regclass($1) IS NOT NULL AS exists`, [target]);
    return !!r.rows?.[0]?.exists;
  } catch (_e) {
    return false;
  }
}

function isMissingRelationError(e) {
  return String(e?.code || "") === "42P01";
}

function isPermissionError(e) {
  return String(e?.code || "") === "42501";
}

function isSafeSchemaError(e) {
  return isMissingRelationError(e) || isPermissionError(e);
}


// =========================
// DB: lightweight migrations (runtime safety)
// =========================
let __bookClassesReady = false;
let __materialsReady = false;
async function ensureMaterialsTables() {
  if (__materialsReady) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS materials (id text PRIMARY KEY, title text NOT NULL, description text, subject text NOT NULL DEFAULT 'other', unit_name text, grade_level text, material_type text NOT NULL, content_url text, thumbnail_url text, interactive_kind text, interactive_config jsonb, is_published boolean NOT NULL DEFAULT false, created_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS material_class_targets (material_id text NOT NULL REFERENCES materials(id) ON DELETE CASCADE, class_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (material_id, class_id))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS material_targets_class_idx ON material_class_targets(class_id)`);
  __materialsReady = true;
}
async function ensureBookClassesTable() {
  if (__bookClassesReady) return;
  // 既存環境でも壊れないように IF NOT EXISTS
  await pool.query(
    `CREATE TABLE IF NOT EXISTS book_classes (
      book_id    text NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      class_id   text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (book_id, class_id)
    )`
  );
  await pool.query(`CREATE INDEX IF NOT EXISTS book_classes_class_idx ON book_classes(class_id)`);
  __bookClassesReady = true;
}

const nowIso = () => new Date().toISOString();

function newId(prefix) {
  // 例: tpl_... / asg_... / book_...
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`;
  return `${prefix}_${id.replaceAll("-", "")}`;
}

function isValidMark(x) {
  return x === "maru" || x === "sankaku" || x === "batsu";
}

function normalizeAttemptNo(x) {
  // attemptNo は省略可（既存互換）。1〜3に丸めず、範囲外はnull。
  if (x === undefined || x === null || x === "") return 1;
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (i < 1 || i > 3) return null;
  return i;
}
function isValidAssignmentStatus(x) {
  return x === "open" || x === "closed" || x === "archived";
}
function isValidSeries(x) {
  return x === "problem" || x === "exercise" || x === "comprehensive";
}
function isValidTemplateMode(x) {
  return x === "book" || x === "manual";
}

function isValidSubject(x) {
  // UI側の教科選択と合わせる
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

function isValidMaterialType(x) { return x === "image" || x === "video" || x === "interactive" || x === "app"; }
function isValidInteractiveKind(x) { return x === null || x === undefined || x === "" || x === "linear" || x === "parabola" || x === "bars"; }
function normalizeMaterialClassIds(input) { if (!Array.isArray(input)) return []; return Array.from(new Set(input.map((x) => String(x ?? "").trim()).filter(Boolean))).sort(); }
async function readMaterialById(client, id) { const r = await client.query(`SELECT m.id, m.title, m.description, m.subject, m.unit_name, m.grade_level, m.material_type, m.content_url, m.thumbnail_url, m.interactive_kind, m.interactive_config, m.is_published, m.created_by, m.created_at, m.updated_at, COALESCE(array_remove(array_agg(t.class_id ORDER BY t.class_id), NULL), '{}') AS class_ids FROM materials m LEFT JOIN material_class_targets t ON t.material_id = m.id WHERE m.id = $1 GROUP BY m.id`, [id]); return r.rows[0] ?? null; }
async function listTeacherMaterials() { await ensureMaterialsTables(); const r = await pool.query(`SELECT m.id, m.title, m.description, m.subject, m.unit_name, m.grade_level, m.material_type, m.content_url, m.thumbnail_url, m.interactive_kind, m.interactive_config, m.is_published, m.created_by, m.created_at, m.updated_at, COALESCE(array_remove(array_agg(t.class_id ORDER BY t.class_id), NULL), '{}') AS class_ids FROM materials m LEFT JOIN material_class_targets t ON t.material_id = m.id GROUP BY m.id ORDER BY m.updated_at DESC, m.created_at DESC`); return r.rows; }
async function listStudentMaterials(classId) { await ensureMaterialsTables(); const params = []; let visibility = "NOT EXISTS (SELECT 1 FROM material_class_targets t2 WHERE t2.material_id = m.id)"; if (classId) { params.push(classId); visibility = `${visibility} OR EXISTS (SELECT 1 FROM material_class_targets t2 WHERE t2.material_id = m.id AND t2.class_id = $1)`; } const r = await pool.query(`SELECT m.id, m.title, m.description, m.subject, m.unit_name, m.grade_level, m.material_type, m.content_url, m.thumbnail_url, m.interactive_kind, m.interactive_config, m.is_published, m.created_by, m.created_at, m.updated_at, COALESCE(array_remove(array_agg(t.class_id ORDER BY t.class_id), NULL), '{}') AS class_ids FROM materials m LEFT JOIN material_class_targets t ON t.material_id = m.id WHERE m.is_published = true AND (${visibility}) GROUP BY m.id ORDER BY m.updated_at DESC, m.created_at DESC`, params); return r.rows; }
function materialUploadHandler(upload, routePath, urlPrefix) { app.post(routePath, requireAuth, requireRole("teacher"), (req, res) => { upload.single("file")(req, res, (err) => { if (err) { const msg = String(err?.message || err || "upload_error"); const status = msg.includes("invalid_file_type") ? 400 : 500; return res.status(status).json({ error: msg }); } if (!req.file) return res.status(400).json({ error: "missing_file" }); return res.json({ ok: true, url: `${urlPrefix}/${req.file.filename}`, filename: req.file.filename, mimetype: req.file.mimetype, size: req.file.size }); }); }); }

function signToken(user) {
  return jwt.sign(
    { uid: user.uid, role: user.role, classId: user.class_id ?? null },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function requireAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: "missing_token" });

  try {
    const payload = jwt.verify(m[1], JWT_SECRET);
    req.user = payload; // { uid, role, classId }
    next();
  } catch (_e) {
    return res.status(401).json({ error: "invalid_token" });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "missing_token" });
    if (req.user.role !== role) return res.status(403).json({ error: "forbidden" });
    next();
  };
}

app.get("/health", async (_req, res) => {
  try {
    const r = await pool.query("SELECT 1 AS ok");
    res.json({ ok: true, db: r.rows[0].ok === 1, time: nowIso() });
  } catch (e) {
    console.error("[health]", e);
    res.status(500).json({ ok: false, error: "db_connect_failed" });
  }
});

/**
 * -----------
 * Auth
 * -----------
 */
app.post("/auth/login", async (req, res) => {
  try {
    const { loginId, password } = req.body ?? {};
    if (!loginId || !password) return res.status(400).json({ error: "missing_body" });

    const r = await pool.query(
      `SELECT uid, role, class_id, password_hash
       FROM users
       WHERE login_id=$1`,
      [String(loginId)]
    );
    if (r.rows.length === 0) return res.status(401).json({ error: "invalid_credentials" });

    const u = r.rows[0];
    if (!u.password_hash) return res.status(401).json({ error: "password_not_set" });

    const ok = await bcrypt.compare(String(password), String(u.password_hash));
    if (!ok) return res.status(401).json({ error: "invalid_credentials" });

    const token = signToken(u);
    res.json({
      ok: true,
      token,
      user: { uid: u.uid, role: u.role, classId: u.class_id ?? null },
    });
  } catch (e) {
    console.error("[POST /auth/login]", e);
    res.status(500).json({ error: "server_error" });
  }
});

app.post("/auth/register-student", requireAuth, requireRole("teacher"), async (req, res) => {
  const { loginId, password, classId, displayName } = req.body ?? {};
  if (!loginId || !password) return res.status(400).json({ error: "missing_body" });

  try {
    const hash = await bcrypt.hash(String(password), 12);
    const uid = String(loginId);

    await pool.query(
      `
      INSERT INTO users (uid, role, class_id, display_name, login_id, password_hash)
      VALUES ($1, 'student', $2, $3, $4, $5)
      ON CONFLICT (uid)
      DO UPDATE SET
        role='student',
        class_id=EXCLUDED.class_id,
        display_name=EXCLUDED.display_name,
        login_id=EXCLUDED.login_id,
        password_hash=EXCLUDED.password_hash
      `,
      [uid, classId ?? null, displayName ?? null, String(loginId), hash]
    );

    res.json({ ok: true, uid });
  } catch (e) {
    console.error("[POST /auth/register-student]", e);
    res.status(500).json({ error: "server_error" });
  }
});

/**
 * =========================
 * Teacher: Classes
 * =========================
 */
app.get("/teacher/classes", requireAuth, requireRole("teacher"), async (_req, res) => {
  try {
    const classSet = new Set();

    const u = await pool.query(
      `SELECT DISTINCT class_id
       FROM users
       WHERE role='student' AND class_id IS NOT NULL AND class_id <> ''
       ORDER BY class_id`
    );
    for (const row of u.rows) classSet.add(row.class_id);

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
        console.warn("[GET /teacher/classes] assignment_classes unavailable; users only fallback");
      }
    }

    const classIds = Array.from(classSet).sort();
    return res.json(classIds.map((class_id) => ({ class_id })));
  } catch (e) {
    console.error("[GET /teacher/classes]", e);
    return res.status(500).json({ error: "server_error" });
  }
});

app.get("/teacher/classes/summary", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    const classId = String(req.query.classId ?? "ALL");
    const limitRaw = Number(req.query.limit ?? 10);
    const limit = Math.max(1, Math.min(20, isFinite(limitRaw) ? limitRaw : 10));
    const hasAssignmentClasses = await tableAvailable("assignment_classes");
    const hasAssignmentProblems = await tableAvailable("assignment_problems");

    let students = [];
    if (classId === "ALL") {
      const r = await pool.query(
        `SELECT uid, class_id, COALESCE(display_name, uid) AS name
         FROM users
         WHERE role='student' AND class_id IS NOT NULL AND class_id <> ''
         ORDER BY class_id, COALESCE(display_name, uid)`
      );
      students = r.rows.map((x) => ({ uid: x.uid, classId: x.class_id, name: x.name }));
    } else {
      const r = await pool.query(
        `SELECT uid, class_id, COALESCE(display_name, uid) AS name
         FROM users
         WHERE role='student' AND class_id=$1
         ORDER BY COALESCE(display_name, uid)`,
        [classId]
      );
      students = r.rows.map((x) => ({ uid: x.uid, classId: x.class_id, name: x.name }));
    }

    let assignRows = [];
    try {
      if (classId === "ALL") {
        let sql = `SELECT a.id, a.title, a.status, a.due_at, a.created_at, ARRAY[]::text[] AS class_ids, 0::int AS total FROM assignments a WHERE a.status='open' ORDER BY a.created_at DESC LIMIT $1`;
        if (hasAssignmentClasses && hasAssignmentProblems) {
          sql = `
            WITH cls AS (
              SELECT assignment_id, array_agg(class_id ORDER BY class_id) AS class_ids
              FROM assignment_classes
              GROUP BY assignment_id
            ),
            tot AS (
              SELECT assignment_id, COUNT(*)::int AS total
              FROM assignment_problems
              GROUP BY assignment_id
            )
            SELECT a.id, a.title, a.status, a.due_at, a.created_at,
                   COALESCE(c.class_ids, ARRAY[]::text[]) AS class_ids,
                   COALESCE(t.total,0)::int AS total
            FROM assignments a
            LEFT JOIN cls c ON c.assignment_id=a.id
            LEFT JOIN tot t ON t.assignment_id=a.id
            WHERE a.status='open'
            ORDER BY a.created_at DESC
            LIMIT $1`;
        } else if (hasAssignmentClasses) {
          sql = `
            WITH cls AS (
              SELECT assignment_id, array_agg(class_id ORDER BY class_id) AS class_ids
              FROM assignment_classes
              GROUP BY assignment_id
            )
            SELECT a.id, a.title, a.status, a.due_at, a.created_at,
                   COALESCE(c.class_ids, ARRAY[]::text[]) AS class_ids,
                   0::int AS total
            FROM assignments a
            LEFT JOIN cls c ON c.assignment_id=a.id
            WHERE a.status='open'
            ORDER BY a.created_at DESC
            LIMIT $1`;
        } else if (hasAssignmentProblems) {
          sql = `
            WITH tot AS (
              SELECT assignment_id, COUNT(*)::int AS total
              FROM assignment_problems
              GROUP BY assignment_id
            )
            SELECT a.id, a.title, a.status, a.due_at, a.created_at,
                   ARRAY[]::text[] AS class_ids,
                   COALESCE(t.total,0)::int AS total
            FROM assignments a
            LEFT JOIN tot t ON t.assignment_id=a.id
            WHERE a.status='open'
            ORDER BY a.created_at DESC
            LIMIT $1`;
        }
        const r = await pool.query(sql, [limit]);
        assignRows = r.rows;
      } else {
        if (!hasAssignmentClasses) {
          return res.json({ classId, rows: [] });
        }
        let sql = `
          WITH visible AS (
            SELECT a.id, a.title, a.status, a.due_at, a.created_at
            FROM assignments a
            JOIN assignment_classes ac ON ac.assignment_id=a.id
            WHERE a.status='open'
              AND (ac.class_id=$1 OR ac.class_id='ALL')
            GROUP BY a.id
          ),
          cls AS (
            SELECT assignment_id, array_agg(class_id ORDER BY class_id) AS class_ids
            FROM assignment_classes
            GROUP BY assignment_id
          )
          SELECT v.id, v.title, v.status, v.due_at, v.created_at,
                 COALESCE(c.class_ids, ARRAY[]::text[]) AS class_ids,
                 0::int AS total
          FROM visible v
          LEFT JOIN cls c ON c.assignment_id=v.id
          ORDER BY v.created_at DESC
          LIMIT $2`;
        if (hasAssignmentProblems) {
          sql = `
            WITH visible AS (
              SELECT a.id, a.title, a.status, a.due_at, a.created_at
              FROM assignments a
              JOIN assignment_classes ac ON ac.assignment_id=a.id
              WHERE a.status='open'
                AND (ac.class_id=$1 OR ac.class_id='ALL')
              GROUP BY a.id
            ),
            cls AS (
              SELECT assignment_id, array_agg(class_id ORDER BY class_id) AS class_ids
              FROM assignment_classes
              GROUP BY assignment_id
            ),
            tot AS (
              SELECT assignment_id, COUNT(*)::int AS total
              FROM assignment_problems
              GROUP BY assignment_id
            )
            SELECT v.id, v.title, v.status, v.due_at, v.created_at,
                   COALESCE(c.class_ids, ARRAY[]::text[]) AS class_ids,
                   COALESCE(t.total,0)::int AS total
            FROM visible v
            LEFT JOIN cls c ON c.assignment_id=v.id
            LEFT JOIN tot t ON t.assignment_id=v.id
            ORDER BY v.created_at DESC
            LIMIT $2`;
        }
        const r = await pool.query(sql, [classId, limit]);
        assignRows = r.rows;
      }
    } catch (e) {
      if (!isSafeSchemaError(e)) throw e;
      console.warn("[GET /teacher/classes/summary] assignment tables unavailable; empty fallback");
      return res.json({ classId, rows: [] });
    }

    const allStudents = students;
    const filterStudentsForAssignment = (aClassIds) => {
      const cls = Array.isArray(aClassIds) ? aClassIds : [];
      if (cls.includes("ALL")) return allStudents;
      const set = new Set(cls.filter((c) => c && c !== "ALL"));
      return allStudents.filter((s) => set.has(s.classId));
    };

    const out = [];
    for (const a of assignRows) {
      const total = Number(a.total ?? 0);
      const targetStudents = classId === "ALL" ? filterStudentsForAssignment(a.class_ids) : allStudents;
      const uids = targetStudents.map((s) => s.uid);
      if (uids.length === 0 || total <= 0) {
        out.push({ id: a.id, title: a.title, status: a.status, due_at: a.due_at, created_at: a.created_at, class_ids: a.class_ids ?? [], total, students: targetStudents.length, started: 0, completed: 0, unstarted: targetStudents.length, avgPct: 0, tag: null });
        continue;
      }
      const marks = await pool.query(
        `SELECT student_uid, COUNT(DISTINCT label)::int AS done
         FROM submission_marks
         WHERE assignment_id=$1 AND student_uid = ANY($2::text[])
         GROUP BY student_uid`,
        [a.id, uids]
      );
      const doneMap = new Map(marks.rows.map((x) => [x.student_uid, Number(x.done ?? 0)]));
      let started = 0, completed = 0, unstarted = 0, sumPct = 0;
      for (const s of targetStudents) {
        const done = doneMap.get(s.uid) ?? 0;
        const doneC = total > 0 ? Math.min(done, total) : 0;
        const pct = total > 0 ? (doneC / total) * 100 : 0;
        if (doneC === 0) unstarted++; else started++;
        if (total > 0 && doneC === total) completed++;
        sumPct += pct;
      }
      const avgPct = targetStudents.length > 0 ? Math.round(sumPct / targetStudents.length) : 0;
      out.push({ id: a.id, title: a.title, status: a.status, due_at: a.due_at, created_at: a.created_at, class_ids: a.class_ids ?? [], total, students: targetStudents.length, started, completed, unstarted, avgPct: Math.max(0, Math.min(100, avgPct)), tag: null });
    }

    return res.json({ classId, rows: out });
  } catch (e) {
    console.error("[GET /teacher/classes/summary]", e);
    res.status(500).json({ error: "server_error" });
  }
});

app.get("/teacher/classes/heatmap", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    const classId = String(req.query.classId ?? "");
    const limitRaw = Number(req.query.limit ?? 8);
    const limit = Math.max(1, Math.min(20, isFinite(limitRaw) ? limitRaw : 8));
    const hasAssignmentClasses = await tableAvailable("assignment_classes");
    const hasAssignmentProblems = await tableAvailable("assignment_problems");
    if (!hasAssignmentProblems) {
      if (classId === "ALL") return res.json({ classId: "ALL", classIds: [], assignments: [], heat: {}, unstarted: {} });
      if (!classId) return res.status(400).json({ error: "class_required" });
      const studs = await pool.query(`SELECT uid, class_id, COALESCE(display_name, uid) AS name FROM users WHERE role='student' AND class_id=$1 ORDER BY COALESCE(display_name, uid)`, [classId]);
      const students = studs.rows.map((x) => ({ uid: x.uid, name: x.name, classId: x.class_id }));
      return res.json({ classId, students, assignments: [], heat: {}, unstarted: {} });
    }

    /**
     * classId === "ALL" のとき：
     * - 行：クラス
     * - 列：最新open課題（limit件）
     * - セル：そのクラスの平均進捗（％）
     * - 未：未着手人数
     */
    if (classId === "ALL") {
      // クラス一覧（users + assignment_classes の両方から集める）
      const classSet = new Set();

      const u = await pool.query(
        `SELECT DISTINCT class_id
         FROM users
         WHERE role='student' AND class_id IS NOT NULL AND class_id <> ''
         ORDER BY class_id`
      );
      for (const row of u.rows) classSet.add(row.class_id);

      const a = await pool.query(
        `SELECT DISTINCT class_id
         FROM assignment_classes
         WHERE class_id IS NOT NULL AND class_id <> '' AND class_id <> 'ALL'
         ORDER BY class_id`
      );
      for (const row of a.rows) classSet.add(row.class_id);

      const classIds = Array.from(classSet).sort((x, y) => String(x).localeCompare(String(y), "ja"));

      // 表示対象の課題（openの最新limit件）
      const assigns = await pool.query(
        `
        WITH visible AS (
          SELECT a.id, a.title, a.status, a.due_at, a.created_at
          FROM assignments a
          WHERE a.status='open'
          ORDER BY a.created_at DESC
          LIMIT $1
        ),
        tot AS (
          SELECT assignment_id, COUNT(*)::int AS total
          FROM assignment_problems
          GROUP BY assignment_id
        )
        SELECT v.id, v.title, v.due_at, v.created_at, COALESCE(t.total,0)::int AS total
        FROM visible v
        LEFT JOIN tot t ON t.assignment_id=v.id
        ORDER BY v.created_at DESC
        `,
        [limit]
      );

      const assignments = assigns.rows.map((x) => ({
        id: x.id,
        title: x.title,
        due_at: x.due_at,
        created_at: x.created_at,
        total: Number(x.total ?? 0),
      }));

      // 初期化
      const heat = {}; // heat[classId][assignmentId] = avgPct
      const unstarted = {}; // unstarted[classId][assignmentId] = count
      for (const c of classIds) {
        heat[c] = {};
        unstarted[c] = {};
        for (const asg of assignments) {
          heat[c][asg.id] = 0;
          unstarted[c][asg.id] = 0;
        }
      }

      if (classIds.length === 0 || assignments.length === 0) {
        return res.json({ classId: "ALL", classIds, assignments, heat, unstarted });
      }

      // 各クラスの生徒数
      const sc = await pool.query(
        `
        SELECT class_id, COUNT(*)::int AS n
        FROM users
        WHERE role='student' AND class_id IS NOT NULL AND class_id <> ''
        GROUP BY class_id
        `
      );
      const nStudents = new Map(sc.rows.map((r) => [r.class_id, Number(r.n ?? 0)]));

      const aids = assignments.map((x) => x.id);

      // クラス×課題で、(sum_done, started人数) をまとめて取る
      // sum_done = submission_marks の行数合計（＝done数合計）
      // started = その課題で1つでもmarkがある生徒数
      const agg = await pool.query(
        `
        SELECT u.class_id,
               sm.assignment_id,
               COUNT(DISTINCT (sm.student_uid, sm.label))::int AS sum_done,
               COUNT(DISTINCT sm.student_uid)::int AS started
        FROM users u
        JOIN submission_marks sm ON sm.student_uid = u.uid
        WHERE u.role='student'
          AND u.class_id IS NOT NULL AND u.class_id <> ''
          AND sm.assignment_id = ANY($1::text[])
        GROUP BY u.class_id, sm.assignment_id
        `,
        [aids]
      );

      const sumDoneMap = new Map(); // key: class__aid -> sum_done
      const startedMap = new Map(); // key: class__aid -> started
      for (const r of agg.rows) {
        const key = `${r.class_id}__${r.assignment_id}`;
        sumDoneMap.set(key, Number(r.sum_done ?? 0));
        startedMap.set(key, Number(r.started ?? 0));
      }

      for (const c of classIds) {
        const n = nStudents.get(c) ?? 0;
        for (const asg of assignments) {
          const key = `${c}__${asg.id}`;
          const total = Number(asg.total ?? 0);
          const sumDone = sumDoneMap.get(key) ?? 0;
          const started = startedMap.get(key) ?? 0;

          // avgPct = (sum_done)/(total*n) *100
          const avgPct =
            total > 0 && n > 0 ? Math.round((sumDone / (total * n)) * 100) : 0;

          heat[c][asg.id] = Math.max(0, Math.min(100, avgPct));

          // 未着手 = 生徒数 - started
          const un = Math.max(0, n - started);
          unstarted[c][asg.id] = un;
        }
      }

      return res.json({ classId: "ALL", classIds, assignments, heat, unstarted });
    }

    /**
     * classId が特定クラスのとき：従来通り「生徒×課題」
     */
    if (!classId) {
      return res.status(400).json({ error: "class_required" });
    }

    const studs = await pool.query(
      `
      SELECT uid, class_id, COALESCE(display_name, uid) AS name
      FROM users
      WHERE role='student' AND class_id=$1
      ORDER BY COALESCE(display_name, uid)
      `,
      [classId]
    );
    const students = studs.rows.map((x) => ({ uid: x.uid, name: x.name, classId: x.class_id }));

    const assigns = await pool.query(
      `
      WITH visible AS (
        SELECT a.id, a.title, a.status, a.due_at, a.created_at
        FROM assignments a
        JOIN assignment_classes ac ON ac.assignment_id=a.id
        WHERE a.status='open'
          AND (ac.class_id=$1 OR ac.class_id='ALL')
        GROUP BY a.id
      ),
      tot AS (
        SELECT assignment_id, COUNT(*)::int AS total
        FROM assignment_problems
        GROUP BY assignment_id
      )
      SELECT v.id, v.title, v.due_at, v.created_at, COALESCE(t.total,0)::int AS total
      FROM visible v
      LEFT JOIN tot t ON t.assignment_id=v.id
      ORDER BY v.created_at DESC
      LIMIT $2
      `,
      [classId, limit]
    );
    const assignments = assigns.rows.map((x) => ({
      id: x.id,
      title: x.title,
      due_at: x.due_at,
      created_at: x.created_at,
      total: Number(x.total ?? 0),
    }));

    const heat = {};
    for (const s of students) heat[s.uid] = {};
    const unstarted = {};
    for (const a of assignments) unstarted[a.id] = 0;

    if (students.length === 0 || assignments.length === 0) {
      return res.json({ classId, students, assignments, heat, unstarted });
    }

    const uids = students.map((s) => s.uid);
    const aids = assignments.map((a) => a.id);

    const marks = await pool.query(
      `
      SELECT assignment_id, student_uid, COUNT(DISTINCT label)::int AS done
      FROM submission_marks
      WHERE assignment_id = ANY($1::text[])
        AND student_uid   = ANY($2::text[])
      GROUP BY assignment_id, student_uid
      `,
      [aids, uids]
    );

    const doneMap = new Map();
    for (const row of marks.rows) {
      doneMap.set(`${row.student_uid}__${row.assignment_id}`, Number(row.done ?? 0));
    }

    const totalMap = new Map(assignments.map((a) => [a.id, a.total]));

    for (const s of students) {
      for (const a of assignments) {
        const total = totalMap.get(a.id) ?? 0;
        const done = doneMap.get(`${s.uid}__${a.id}`) ?? 0;
        const doneC = total > 0 ? Math.min(done, total) : 0;
        const pct = total > 0 ? Math.round((doneC / total) * 100) : 0;
        heat[s.uid][a.id] = Math.max(0, Math.min(100, pct));
        if (pct === 0) unstarted[a.id] += 1;
      }
    }

    res.json({ classId, students, assignments, heat, unstarted });
  } catch (e) {
    console.error("[GET /teacher/classes/heatmap]", e);
    res.status(500).json({ error: "server_error" });
  }
});

app.get("/teacher/classes/heatmap-all", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit ?? 8);
    const limit = Math.max(1, Math.min(20, isFinite(limitRaw) ? limitRaw : 8));
    const hasAssignmentProblems = await tableAvailable("assignment_problems");
    if (!hasAssignmentProblems) {
      return res.json({ classIds: [], assignments: [], heat: {}, unstarted: {} });
    }

    // クラス一覧（生徒が属するクラス）
    const cls = await pool.query(
      `
      SELECT DISTINCT class_id
      FROM users
      WHERE role='student' AND class_id IS NOT NULL AND class_id <> ''
      ORDER BY class_id
      `
    );
    const classIds = cls.rows.map((x) => String(x.class_id));

    // 最新 open 課題（全クラス向け・特定クラス向けも含めて取得）
    const assigns = await pool.query(
      `
      WITH visible AS (
        SELECT a.id, a.title, a.due_at, a.created_at
        FROM assignments a
        WHERE a.status='open'
      ),
      tot AS (
        SELECT assignment_id, COUNT(*)::int AS total
        FROM assignment_problems
        GROUP BY assignment_id
      )
      SELECT v.id, v.title, v.due_at, v.created_at, COALESCE(t.total,0)::int AS total
      FROM visible v
      LEFT JOIN tot t ON t.assignment_id=v.id
      ORDER BY v.created_at DESC
      LIMIT $1
      `,
      [limit]
    );

    const assignments = assigns.rows.map((x) => ({
      id: x.id,
      title: x.title,
      due_at: x.due_at,
      created_at: x.created_at,
      total: Number(x.total ?? 0),
    }));

    // 初期形
    const heat = {};
    const unstarted = {};
    for (const c of classIds) {
      heat[c] = {};
      unstarted[c] = {};
      for (const a of assignments) {
        heat[c][a.id] = 0;
        unstarted[c][a.id] = 0;
      }
    }

    if (classIds.length === 0 || assignments.length === 0) {
      return res.json({ classIds, assignments, heat, unstarted });
    }

    const aids = assignments.map((a) => a.id);

    // クラス×課題の平均進捗／未着手数をSQLで一括集計
    const agg = await pool.query(
      `
      WITH studs AS (
        SELECT uid, class_id
        FROM users
        WHERE role='student' AND class_id = ANY($1::text[])
      ),
      tot AS (
        SELECT assignment_id, COUNT(*)::int AS total
        FROM assignment_problems
        WHERE assignment_id = ANY($2::text[])
        GROUP BY assignment_id
      ),
      done AS (
        SELECT assignment_id, student_uid, COUNT(DISTINCT label)::int AS done
        FROM submission_marks
        WHERE assignment_id = ANY($2::text[])
        GROUP BY assignment_id, student_uid
      ),
      base AS (
        SELECT
          s.class_id,
          a.assignment_id,
          COALESCE(t.total, 0)::int AS total,
          COALESCE(d.done, 0)::int  AS done
        FROM studs s
        CROSS JOIN (SELECT unnest($2::text[]) AS assignment_id) a
        LEFT JOIN tot t  ON t.assignment_id  = a.assignment_id
        LEFT JOIN done d ON d.assignment_id  = a.assignment_id AND d.student_uid = s.uid
      )
      SELECT
        class_id,
        assignment_id,
        ROUND(AVG(
          CASE WHEN total > 0 THEN (LEAST(done, total)::float / total) * 100 ELSE 0 END
        ))::int AS avg_pct,
        COUNT(*) FILTER (WHERE COALESCE(done,0)=0)::int AS unstarted
      FROM base
      GROUP BY class_id, assignment_id
      `,
      [classIds, aids]
    );

    for (const row of agg.rows) {
      const c = String(row.class_id);
      const aid = String(row.assignment_id);
      const pct = Number(row.avg_pct ?? 0);
      const un = Number(row.unstarted ?? 0);
      if (!heat[c]) heat[c] = {};
      if (!unstarted[c]) unstarted[c] = {};
      heat[c][aid] = Math.max(0, Math.min(100, pct));
      unstarted[c][aid] = Math.max(0, un);
    }

    res.json({ classIds, assignments, heat, unstarted });
  } catch (e) {
    console.error("[GET /teacher/classes/heatmap-all]", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ===== 全クラス（クラス行）ヒートマップ =====
// 行：クラスID、列：最新open課題（limit件）
// 値：クラス内生徒の平均進捗％、未着手人数も返す
app.get("/teacher/classes/heatmap-classes", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    const hasAssignmentProblems = await tableAvailable("assignment_problems");
    if (!hasAssignmentProblems) {
      return res.json({ classIds: [], assignments: [], heat: {}, unstarted: {} });
    }
    const limitRaw = Number(req.query.limit ?? 8);
    const limit = Math.max(1, Math.min(12, Number.isFinite(limitRaw) ? limitRaw : 8)); // 全クラスは上限控えめ

    // クラス一覧（生徒が存在するクラスのみ）
    const cls = await pool.query(`
      SELECT DISTINCT class_id
      FROM users
      WHERE role='student' AND class_id IS NOT NULL AND class_id <> ''
      ORDER BY class_id
    `);
    const classIds = cls.rows.map((x) => x.class_id);

    // 最新 open 課題（limit件）＋総問題数(total)
    const assigns = await pool.query(
      `
      WITH tot AS (
        SELECT assignment_id, COUNT(*)::int AS total
        FROM assignment_problems
        GROUP BY assignment_id
      )
      SELECT a.id, a.title, a.due_at, a.created_at, COALESCE(t.total,0)::int AS total
      FROM assignments a
      LEFT JOIN tot t ON t.assignment_id=a.id
      WHERE a.status='open'
      ORDER BY a.created_at DESC
      LIMIT $1
      `,
      [limit]
    );

    const assignments = assigns.rows.map((x) => ({
      id: x.id,
      title: x.title,
      due_at: x.due_at,
      created_at: x.created_at,
      total: Number(x.total ?? 0),
    }));

    // 初期形（空でも返せるように）
    const heat = {};
    const unstarted = {};
    for (const c of classIds) {
      heat[c] = {};
      unstarted[c] = {};
      for (const a of assignments) {
        heat[c][a.id] = 0;
        unstarted[c][a.id] = 0;
      }
    }

    if (classIds.length === 0 || assignments.length === 0) {
      return res.json({ classIds, assignments, heat, unstarted });
    }

    const aids = assignments.map((a) => a.id);

    // 生徒（全クラス）
    const studs = await pool.query(`
      SELECT uid, class_id
      FROM users
      WHERE role='student' AND class_id IS NOT NULL AND class_id <> ''
    `);

    const students = studs.rows.map((x) => ({ uid: x.uid, classId: x.class_id }));
    if (students.length === 0) {
      return res.json({ classIds, assignments, heat, unstarted });
    }

    // 生徒×課題の done 数（marksの件数）
    const marks = await pool.query(
      `
      SELECT assignment_id, student_uid, COUNT(DISTINCT label)::int AS done
      FROM submission_marks
      WHERE assignment_id = ANY($1::text[])
      GROUP BY assignment_id, student_uid
      `,
      [aids]
    );

    const doneMap = new Map();
    for (const row of marks.rows) {
      doneMap.set(`${row.student_uid}__${row.assignment_id}`, Number(row.done ?? 0));
    }

    const totalMap = new Map(assignments.map((a) => [a.id, a.total]));

    // 集計（JS側で安全に：DBに過大負荷をかけない）
    // key: classId__assignmentId -> {sumPct, n, un}
    const agg = new Map();

    for (const s of students) {
      for (const a of assignments) {
        const total = totalMap.get(a.id) ?? 0;
        const done = doneMap.get(`${s.uid}__${a.id}`) ?? 0;
        const doneC = total > 0 ? Math.min(done, total) : 0;
        const pct = total > 0 ? Math.round((doneC / total) * 100) : 0;

        const key = `${s.classId}__${a.id}`;
        const cur = agg.get(key) ?? { sumPct: 0, n: 0, un: 0 };
        cur.sumPct += Math.max(0, Math.min(100, pct));
        cur.n += 1;
        if (pct === 0) cur.un += 1;
        agg.set(key, cur);
      }
    }

    for (const c of classIds) {
      for (const a of assignments) {
        const key = `${c}__${a.id}`;
        const cur = agg.get(key);
        if (!cur || cur.n === 0) {
          heat[c][a.id] = 0;
          unstarted[c][a.id] = 0;
          continue;
        }
        heat[c][a.id] = Math.round(cur.sumPct / cur.n);
        unstarted[c][a.id] = cur.un;
      }
    }

    return res.json({ classIds, assignments, heat, unstarted });
  } catch (e) {
    console.error("[GET /teacher/classes/heatmap-classes]", e);
    return res.status(500).json({ error: "server_error" });
  }
});

/**
 * =========================
 * Assignments（共通/教師）
 * =========================
 */
app.get("/assignments", requireAuth, async (req, res) => {
  try {
    const role = req.user.role;
    const classId =
      role === "student" ? req.user.classId : req.query.classId ? String(req.query.classId) : null;

    if (classId) {
      const r = await pool.query(
        `
        SELECT a.id, a.title, a.status, a.due_at, a.created_at
        FROM assignments a
        JOIN assignment_classes ac ON ac.assignment_id = a.id
        WHERE a.status='open'
          AND (ac.class_id = $1 OR ac.class_id = 'ALL')
        ORDER BY a.created_at DESC
        `,
        [classId]
      );
      return res.json(r.rows);
    }

    const r = await pool.query(
      `SELECT id, title, status, due_at, created_at
       FROM assignments
       WHERE status='open'
       ORDER BY created_at DESC`
    );
    res.json(r.rows);
  } catch (e) {
    console.error("[GET /assignments]", e);
    res.status(500).json({ error: "server_error" });
  }
});

app.get("/teacher/assignments", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    const q = String(req.query.status ?? "all");
    let where = "";
    if (q === "open") where = "WHERE a.status='open'";
    else if (q === "stopped") where = "WHERE a.status<>'open'";
    else if (q === "closed") where = "WHERE a.status='closed'";
    else if (q === "archived") where = "WHERE a.status='archived'";

    const hasAssignmentClasses = await tableAvailable("assignment_classes");
    const hasAssignmentProblems = await tableAvailable("assignment_problems");
    let sql = `SELECT a.id, a.title, a.status, a.due_at, a.created_at, ARRAY[]::text[] AS class_ids, 0::int AS total FROM assignments a ${where} ORDER BY a.created_at DESC`;
    if (hasAssignmentClasses && hasAssignmentProblems) {
      sql = `
        WITH cls AS (
          SELECT assignment_id, array_agg(class_id ORDER BY class_id) AS class_ids
          FROM assignment_classes
          GROUP BY assignment_id
        ),
        tot AS (
          SELECT assignment_id, COUNT(*)::int AS total
          FROM assignment_problems
          GROUP BY assignment_id
        )
        SELECT a.id, a.title, a.status, a.due_at, a.created_at,
               COALESCE(c.class_ids, ARRAY[]::text[]) AS class_ids,
               COALESCE(t.total, 0)::int AS total
        FROM assignments a
        LEFT JOIN cls c ON c.assignment_id = a.id
        LEFT JOIN tot t ON t.assignment_id = a.id
        ${where}
        ORDER BY a.created_at DESC`;
    } else if (hasAssignmentClasses) {
      sql = `
        WITH cls AS (
          SELECT assignment_id, array_agg(class_id ORDER BY class_id) AS class_ids
          FROM assignment_classes
          GROUP BY assignment_id
        )
        SELECT a.id, a.title, a.status, a.due_at, a.created_at,
               COALESCE(c.class_ids, ARRAY[]::text[]) AS class_ids,
               0::int AS total
        FROM assignments a
        LEFT JOIN cls c ON c.assignment_id = a.id
        ${where}
        ORDER BY a.created_at DESC`;
    } else if (hasAssignmentProblems) {
      sql = `
        WITH tot AS (
          SELECT assignment_id, COUNT(*)::int AS total
          FROM assignment_problems
          GROUP BY assignment_id
        )
        SELECT a.id, a.title, a.status, a.due_at, a.created_at,
               ARRAY[]::text[] AS class_ids,
               COALESCE(t.total, 0)::int AS total
        FROM assignments a
        LEFT JOIN tot t ON t.assignment_id = a.id
        ${where}
        ORDER BY a.created_at DESC`;
    }

    const r = await pool.query(sql);
    res.json(r.rows);
  } catch (e) {
    if (isSafeSchemaError(e)) {
      console.warn("[GET /teacher/assignments] assignment tables unavailable; empty fallback");
      return res.json([]);
    }
    console.error("[GET /teacher/assignments]", e);
    res.status(500).json({ error: "server_error" });
  }
});

/**
 * =================================
 * Teacher Assignment Detail helpers
 * =================================
 */

/**
 * GET /teacher/assignments/:id/base
 * 課題の基本情報 + 配布クラス + 問題ラベル一覧
 */
app.get(
  "/teacher/assignments/:id/base",
  requireAuth,
  requireRole("teacher"),
  async (req, res) => {
    try {
      const assignmentId = String(req.params.id);

      const a = await pool.query(
        `SELECT id, title, status, due_at, created_at
         FROM assignments
         WHERE id=$1`,
        [assignmentId]
      );
      if (a.rows.length === 0) return res.status(404).json({ error: "not_found" });

      const cls = await pool.query(
        `SELECT class_id
         FROM assignment_classes
         WHERE assignment_id=$1
         ORDER BY class_id`,
        [assignmentId]
      );

      const probs = await pool.query(
        `SELECT label
         FROM assignment_problems
         WHERE assignment_id=$1
         ORDER BY sort_order ASC, label ASC`,
        [assignmentId]
      );

      res.json({
        assignment: a.rows[0],
        classIds: cls.rows.map((r) => r.class_id),
        labels: probs.rows.map((r) => r.label),
      });
    } catch (e) {
      console.error("[GET /teacher/assignments/:id/base]", e);
      res.status(500).json({ error: "server_error" });
    }
  }
);

/**
 * GET /teacher/assignments/:id/students?classId=<class>
 * 生徒別の提出状況（label -> mark, marked_at）
 */
app.get(
  "/teacher/assignments/:id/students",
  requireAuth,
  requireRole("teacher"),
  async (req, res) => {
    try {
      const assignmentId = String(req.params.id);
      const classId = String(req.query.classId ?? "");
      if (!classId || classId === "ALL") return res.status(400).json({ error: "class_required" });

      // 対象生徒
      const studs = await pool.query(
        `
        SELECT uid, class_id, COALESCE(display_name, uid) AS name
        FROM users
        WHERE role='student' AND class_id=$1
        ORDER BY COALESCE(display_name, uid)
        `,
        [classId]
      );
      const students = studs.rows.map((x) => ({
        uid: x.uid,
        name: x.name,
        classId: x.class_id,
      }));

      if (students.length === 0) return res.json({ students: [] });

      const uids = students.map((s) => s.uid);

      // submissions.updated_at（生徒ごとの最終更新）
      const sub = await pool.query(
        `
        SELECT student_uid, updated_at
        FROM submissions
        WHERE assignment_id=$1
          AND student_uid = ANY($2::text[])
        `,
        [assignmentId, uids]
      );
      const updatedAtMap = new Map(sub.rows.map((r) => [r.student_uid, r.updated_at]));

      // marks（label -> mark / marked_at）
      const marks = await pool.query(
        `
        SELECT student_uid, label, mark, marked_at
        FROM (
          SELECT DISTINCT ON (student_uid, label)
            student_uid, label, mark, marked_at
          FROM submission_marks
          WHERE assignment_id=$1
            AND student_uid = ANY($2::text[])
          ORDER BY student_uid, label, attempt_no DESC, marked_at DESC
        ) t
        `,
        [assignmentId, uids]
      );

      const statusMap = new Map(); // uid -> Record<label, mark>
      const timeMap = new Map(); // uid -> Record<label, marked_at>

      for (const uid of uids) {
        statusMap.set(uid, {});
        timeMap.set(uid, {});
      }

      for (const r of marks.rows) {
        const uid = r.student_uid;
        const s = statusMap.get(uid) ?? {};
        const t = timeMap.get(uid) ?? {};
        s[r.label] = r.mark;
        t[r.label] = r.marked_at;
        statusMap.set(uid, s);
        timeMap.set(uid, t);
      }

      const resp = students.map((s) => ({
        uid: s.uid,
        name: s.name,
        classId: s.classId,
        updatedAt: updatedAtMap.get(s.uid) ?? null,
        statusByLabel: statusMap.get(s.uid) ?? {},
        timeByLabel: timeMap.get(s.uid) ?? {},
      }));

      res.json({ students: resp });
    } catch (e) {
      console.error("[GET /teacher/assignments/:id/students]", e);
      res.status(500).json({ error: "server_error" });
    }
  }
);

app.get("/assignments/:id", requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id);

    const a = await pool.query(
      `SELECT id, title, status, due_at, created_at
       FROM assignments
       WHERE id=$1`,
      [id]
    );
    if (a.rows.length === 0) return res.status(404).json({ error: "not_found" });

    const p = await pool.query(
      `SELECT label, block_id, sort_order
       FROM assignment_problems
       WHERE assignment_id=$1
       ORDER BY sort_order ASC`,
      [id]
    );

    res.json({ assignment: a.rows[0], problems: p.rows });
  } catch (e) {
    console.error("[GET /assignments/:id]", e);
    res.status(500).json({ error: "server_error" });
  }
});

app.get("/teacher/assignments/:id/base", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    const id = String(req.params.id);

    const a = await pool.query(
      `SELECT id, title, status, due_at, created_at
       FROM assignments
       WHERE id=$1`,
      [id]
    );
    if (a.rows.length === 0) return res.status(404).json({ error: "not_found" });

    const c = await pool.query(
      `SELECT class_id
       FROM assignment_classes
       WHERE assignment_id=$1
       ORDER BY class_id`,
      [id]
    );
    const classIds = c.rows.map((x) => x.class_id);

    const p = await pool.query(
      `SELECT label
       FROM assignment_problems
       WHERE assignment_id=$1
       ORDER BY sort_order ASC, label ASC`,
      [id]
    );
    const labels = p.rows.map((x) => x.label);

    res.json({ assignment: a.rows[0], classIds, labels });
  } catch (e) {
    console.error("[GET /teacher/assignments/:id/base]", e);
    res.status(500).json({ error: "server_error" });
  }
});

app.put("/teacher/assignments/:id/problems", requireAuth, requireRole("teacher"), async (req, res) => {
  const assignmentId = String(req.params.id);

  const raw = req.body?.labels;
  const labelsIn = Array.isArray(raw) ? raw.map((x) => String(x)) : null;
  if (!labelsIn) return res.status(400).json({ error: "missing_labels" });

  // trim + remove empty + de-dup (keep order)
  const seen = new Set();
  const labels = [];
  for (const s of labelsIn) {
    const t = String(s ?? "").trim();
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    labels.push(t);
  }

  // 上限（事故防止）
  if (labels.length > 500) return res.status(400).json({ error: "too_many_labels" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 課題存在チェック
    const a = await client.query(`SELECT id FROM assignments WHERE id=$1`, [assignmentId]);
    if (a.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not_found" });
    }

    // 既存を入れ替え（block_id は manual を想定し null）
    await client.query(`DELETE FROM assignment_problems WHERE assignment_id=$1`, [assignmentId]);

    for (let i = 0; i < labels.length; i++) {
      await client.query(
        `
        INSERT INTO assignment_problems (assignment_id, label, block_id, sort_order)
        VALUES ($1,$2,NULL,$3)
        ON CONFLICT (assignment_id,label) DO NOTHING
        `,
        [assignmentId, labels[i], i]
      );
    }

    await client.query("COMMIT");
    res.json({ ok: true, assignmentId, count: labels.length });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[PUT /teacher/assignments/:id/problems]", e);
    res.status(500).json({ error: "server_error" });
  } finally {
    client.release();
  }
});

app.put(
  "/teacher/assignments/:id/problems",
  requireAuth,
  requireRole("teacher"),
  async (req, res) => {
    const assignmentId = String(req.params.id);
    const labelsRaw = req.body?.labels;

    if (!Array.isArray(labelsRaw)) {
      return res.status(400).json({ error: "labels_must_be_array" });
    }

    // sanitize + unique (順序維持)
    const seen = new Set();
    const labels = [];
    for (const x of labelsRaw) {
      const s = String(x ?? "").trim();
      if (!s) continue;
      if (s.length > 40) return res.status(400).json({ error: "label_too_long", label: s });
      if (!seen.has(s)) {
        seen.add(s);
        labels.push(s);
      }
    }

    if (labels.length > 500) {
      return res.status(400).json({ error: "too_many_labels" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 既存 problems を置換
      await client.query(`DELETE FROM assignment_problems WHERE assignment_id=$1`, [assignmentId]);

      for (let i = 0; i < labels.length; i++) {
        await client.query(
          `
          INSERT INTO assignment_problems (assignment_id, label, block_id, sort_order)
          VALUES ($1, $2, NULL, $3)
          `,
          [assignmentId, labels[i], i]
        );
      }

      // labels から外れた提出記録だけ掃除（残したい場合はこのDELETEを消してもOK）
      if (labels.length === 0) {
        await client.query(`DELETE FROM submission_marks WHERE assignment_id=$1`, [assignmentId]);
        await client.query(`DELETE FROM submission_times WHERE assignment_id=$1`, [assignmentId]);
      } else {
        await client.query(
          `DELETE FROM submission_marks
           WHERE assignment_id=$1
             AND NOT (label = ANY($2::text[]))`,
          [assignmentId, labels]
        );
        await client.query(
          `DELETE FROM submission_times
           WHERE assignment_id=$1
             AND NOT (label = ANY($2::text[]))`,
          [assignmentId, labels]
        );
      }

      await client.query("COMMIT");
      res.json({ ok: true, assignmentId, count: labels.length, labels });
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("[PUT /teacher/assignments/:id/problems]", e);
      res.status(500).json({ error: "server_error" });
    } finally {
      client.release();
    }
  }
);

app.post("/assignments/:id/status", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    const id = String(req.params.id);
    const { status } = req.body ?? {};
    if (!status) return res.status(400).json({ error: "missing_body" });
    if (!isValidAssignmentStatus(String(status)))
      return res.status(400).json({ error: "invalid_status" });

    const u = await pool.query(
      `UPDATE assignments SET status=$2 WHERE id=$1 RETURNING id, status`,
      [id, String(status)]
    );
    if (u.rows.length === 0) return res.status(404).json({ error: "not_found" });

    res.json({ ok: true, id: u.rows[0].id, status: u.rows[0].status });
  } catch (e) {
    console.error("[POST /assignments/:id/status]", e);
    res.status(500).json({ error: "server_error" });
  }
});

app.post("/assignments/:id/delete", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    const id = String(req.params.id);
    const d = await pool.query(`DELETE FROM assignments WHERE id=$1 RETURNING id`, [id]);
    if (d.rows.length === 0) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, id: d.rows[0].id });
  } catch (e) {
    console.error("[POST /assignments/:id/delete]", e);
    res.status(500).json({ error: "server_error" });
  }
});

/**
 * 教師：問題別分析（全クラス合算対応）
 * GET /teacher/assignments/:id/by-problem?classId=ALL|<class>
 */
app.get(
  "/teacher/assignments/:id/by-problem",
  requireAuth,
  requireRole("teacher"),
  async (req, res) => {
    try {
      const assignmentId = String(req.params.id);
      const classId = req.query.classId ? String(req.query.classId) : "ALL";

      const probs = await pool.query(
        `SELECT label
         FROM assignment_problems
         WHERE assignment_id=$1
         ORDER BY sort_order ASC, label ASC`,
        [assignmentId]
      );
      const labels = probs.rows.map((x) => x.label);

      let uids = [];
      if (classId !== "ALL") {
        const us = await pool.query(
          `SELECT uid FROM users WHERE role='student' AND class_id=$1`,
          [classId]
        );
        uids = us.rows.map((x) => x.uid);
      } else {
        const cls = await pool.query(
          `SELECT class_id FROM assignment_classes WHERE assignment_id=$1`,
          [assignmentId]
        );
        const classIds = cls.rows.map((x) => x.class_id);

        if (classIds.includes("ALL")) {
          const us = await pool.query(`SELECT uid FROM users WHERE role='student'`);
          uids = us.rows.map((x) => x.uid);
        } else if (classIds.length === 0) {
          uids = [];
        } else {
          const us = await pool.query(
            `SELECT uid FROM users WHERE role='student' AND class_id = ANY($1::text[])`,
            [classIds]
          );
          uids = us.rows.map((x) => x.uid);
        }
      }

      const n = uids.length;

      if (n === 0) {
        return res.json({
          classId,
          labels,
          n: 0,
          stats: labels.map((label) => ({
            label,
            maru: 0,
            sankaku: 0,
            batsu: 0,
            none: 0,
            maruPct: 0,
            sankakuPct: 0,
            batsuPct: 0,
            nonePct: 0,
            review: 0,
            reviewPct: 0,
          })),
        });
      }

      const mk = await pool.query(
        `
        SELECT label, mark
        FROM (
          SELECT DISTINCT ON (student_uid, label)
            student_uid, label, mark
          FROM submission_marks
          WHERE assignment_id=$1 AND student_uid = ANY($2::text[])
          ORDER BY student_uid, label, attempt_no DESC, marked_at DESC
        ) t
        `,
        [assignmentId, uids]
      );

      const maru = new Map();
      const sankaku = new Map();
      const batsu = new Map();
      for (const label of labels) {
        maru.set(label, 0);
        sankaku.set(label, 0);
        batsu.set(label, 0);
      }

      for (const row of mk.rows) {
        const label = row.label;
        const mark = row.mark;
        if (!maru.has(label)) continue;
        if (mark === "maru") maru.set(label, maru.get(label) + 1);
        else if (mark === "sankaku") sankaku.set(label, sankaku.get(label) + 1);
        else if (mark === "batsu") batsu.set(label, batsu.get(label) + 1);
      }

      const stats = labels.map((label) => {
        const m = maru.get(label) ?? 0;
        const s = sankaku.get(label) ?? 0;
        const b = batsu.get(label) ?? 0;
        const done = m + s + b;
        const none = Math.max(0, n - done);
        const maruPct = Math.round((m / n) * 100);
        const sankakuPct = Math.round((s / n) * 100);
        const batsuPct = Math.round((b / n) * 100);
        const nonePct = Math.round((none / n) * 100);
        const review = s + b;
        const reviewPct = Math.round((review / n) * 100);

        return {
          label,
          maru: m,
          sankaku: s,
          batsu: b,
          none,
          maruPct,
          sankakuPct,
          batsuPct,
          nonePct,
          review,
          reviewPct,
        };
      });

      res.json({ classId, labels, n, stats });
    } catch (e) {
      console.error("[GET /teacher/assignments/:id/by-problem]", e);
      res.status(500).json({ error: "server_error" });
    }
  }
);

/**
 * =========================
 * Student: assignments (progress summary)
 * =========================
 */
app.get("/student/assignments", requireAuth, requireRole("student"), async (req, res) => {
  try {
    const uid = req.user.uid;
    const classId = req.user.classId;
    if (!classId) return res.json([]);

    const r = await pool.query(
      `
      WITH visible AS (
        SELECT a.id, a.title, a.status, a.due_at, a.created_at
        FROM assignments a
        JOIN assignment_classes ac ON ac.assignment_id = a.id
        WHERE a.status='open'
          AND (ac.class_id = $2 OR ac.class_id = 'ALL')
        GROUP BY a.id
      ),
      totals AS (
        SELECT assignment_id, COUNT(*)::int AS total
        FROM assignment_problems
        GROUP BY assignment_id
      ),
      latest AS (
        SELECT DISTINCT ON (assignment_id, label)
          assignment_id, label, mark
        FROM submission_marks
        WHERE student_uid = $1
        ORDER BY assignment_id, label, attempt_no DESC, marked_at DESC
      ),
      marks AS (
        SELECT
          assignment_id,
          COUNT(*) FILTER (WHERE mark='maru')::int    AS maru,
          COUNT(*) FILTER (WHERE mark='sankaku')::int AS sankaku,
          COUNT(*) FILTER (WHERE mark='batsu')::int   AS batsu
        FROM latest
        GROUP BY assignment_id
      )
      SELECT
        v.id, v.title, v.status, v.due_at, v.created_at,
        COALESCE(t.total, 0)::int AS total,
        COALESCE(m.maru, 0)::int AS maru,
        COALESCE(m.sankaku, 0)::int AS sankaku,
        COALESCE(m.batsu, 0)::int AS batsu
      FROM visible v
      LEFT JOIN totals t ON t.assignment_id = v.id
      LEFT JOIN marks  m ON m.assignment_id = v.id
      ORDER BY v.created_at DESC
      `,
      [uid, classId]
    );

    const rows = r.rows.map((x) => {
      const total = Number(x.total ?? 0);
      const maru = Number(x.maru ?? 0);
      const sankaku = Number(x.sankaku ?? 0);
      const batsu = Number(x.batsu ?? 0);
      const done = maru + sankaku + batsu;
      const doneC = total > 0 ? Math.min(done, total) : 0;
      const pct = total > 0 ? Math.round((doneC / total) * 100) : 0;

      return {
        id: x.id,
        title: x.title,
        status: x.status,
        due_at: x.due_at,
        created_at: x.created_at,
        total,
        maru,
        sankaku,
        batsu,
        done: doneC,
        pct,
        tag: null,
      };
    });

    res.json(rows);
  } catch (e) {
    console.error("[GET /student/assignments]", e);
    res.status(500).json({ error: "server_error" });
  }
});

/**
 * =========================
 * Submissions（生徒用）
 * =========================
 */
app.get("/submissions", requireAuth, async (req, res) => {
  try {
    const assignmentId = req.query.assignmentId ? String(req.query.assignmentId) : null;
    if (!assignmentId) return res.status(400).json({ error: "missing_params" });

    const attemptNoRaw = req.query.attemptNo ?? null;
    const attemptNo = attemptNoRaw === null ? null : normalizeAttemptNo(attemptNoRaw);
    if (attemptNoRaw !== null && attemptNo === null) {
      return res.status(400).json({ error: "invalid_attempt_no" });
    }

    const uid = req.user.uid;

    const s = await pool.query(
      `SELECT assignment_id, student_uid, created_at, updated_at
       FROM submissions
       WHERE assignment_id=$1 AND student_uid=$2`,
      [assignmentId, uid]
    );

    // 理解度（最大3回分）
    const m = await pool.query(
      `SELECT label, attempt_no, mark, marked_at
       FROM submission_marks
       WHERE assignment_id=$1 AND student_uid=$2`,
      [assignmentId, uid]
    );

    // 学習時間（分）（最大3回分）
    const t = await pool.query(
      `SELECT label, attempt_no, minutes, updated_at
       FROM submission_times
       WHERE assignment_id=$1 AND student_uid=$2`,
      [assignmentId, uid]
    );

    const marksByAttempt = { 1: {}, 2: {}, 3: {} };
    const markedAtByAttempt = { 1: {}, 2: {}, 3: {} };
    for (const row of m.rows) {
      const aNo = Number(row.attempt_no);
      if (aNo !== 1 && aNo !== 2 && aNo !== 3) continue;
      marksByAttempt[aNo][row.label] = row.mark;
      markedAtByAttempt[aNo][row.label] = row.marked_at;
    }

    const minutesByAttempt = { 1: {}, 2: {}, 3: {} };
    const timeUpdatedAtByAttempt = { 1: {}, 2: {}, 3: {} };
    for (const row of t.rows) {
      const aNo = Number(row.attempt_no);
      if (aNo !== 1 && aNo !== 2 && aNo !== 3) continue;
      minutesByAttempt[aNo][row.label] = Number(row.minutes);
      timeUpdatedAtByAttempt[aNo][row.label] = row.updated_at;
    }

    // 既存互換：attemptNo 指定時はその回の statusByLabel を返す
    const legacyAttempt = attemptNo ?? 1;
    const statusByLabel = marksByAttempt[legacyAttempt] ?? {};
    const timeByLabel = minutesByAttempt[legacyAttempt] ?? {};

    res.json({
      submission: s.rows[0] ?? null,
      attemptNo: legacyAttempt,
      marksByAttempt,
      minutesByAttempt,
      markedAtByAttempt,
      timeUpdatedAtByAttempt,
      // legacy
      statusByLabel,
      timeByLabel,
    });
  } catch (e) {
    console.error("[GET /submissions]", e);
    res.status(500).json({ error: "server_error" });
  }
});

app.post("/submissions/mark", requireAuth, requireRole("student"), async (req, res) => {
  const { assignmentId, label, mark, attemptNo: attemptNoBody } = req.body ?? {};
  if (!assignmentId || !label || !mark) return res.status(400).json({ error: "missing_body" });
  if (!isValidMark(mark)) return res.status(400).json({ error: "invalid_mark" });

  const attemptNo = normalizeAttemptNo(attemptNoBody);
  if (attemptNo === null) return res.status(400).json({ error: "invalid_attempt_no" });

  const uid = req.user.uid;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `
      INSERT INTO submissions (assignment_id, student_uid)
      VALUES ($1, $2)
      ON CONFLICT (assignment_id, student_uid)
      DO UPDATE SET updated_at = now()
      `,
      [assignmentId, uid]
    );

    const cur = await client.query(
      `SELECT mark FROM submission_marks
       WHERE assignment_id=$1 AND student_uid=$2 AND label=$3 AND attempt_no=$4`,
      [assignmentId, uid, String(label), attemptNo]
    );

    if (cur.rows.length > 0 && cur.rows[0].mark === mark) {
      await client.query("COMMIT");
      return res.json({ ok: true, changed: false });
    }

    await client.query(
      `
      INSERT INTO submission_marks (assignment_id, student_uid, label, attempt_no, mark, marked_at)
      VALUES ($1,$2,$3,$4,$5, now())
      ON CONFLICT (assignment_id, student_uid, label, attempt_no)
      DO UPDATE SET mark = EXCLUDED.mark, marked_at = now()
      `,
      [assignmentId, uid, String(label), attemptNo, mark]
    );

    await client.query("COMMIT");
    res.json({ ok: true, changed: true });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[POST /submissions/mark]", e);
    res.status(500).json({ error: "server_error" });
  } finally {
    client.release();
  }
});

// 学習時間（分）の保存（理解度とは独立）
app.post("/submissions/time", requireAuth, requireRole("student"), async (req, res) => {
  const { assignmentId, label, time, minutes, attemptNo: attemptNoBody } = req.body ?? {};
  if (!assignmentId || !label) return res.status(400).json({ error: "missing_body" });

  const attemptNo = normalizeAttemptNo(attemptNoBody);
  if (attemptNo === null) return res.status(400).json({ error: "invalid_attempt_no" });

  // 既存UI互換：time に文字列が来る想定がある
  const raw = minutes ?? time;
  const n = Number(String(raw ?? "").trim());
  if (!Number.isFinite(n)) return res.status(400).json({ error: "invalid_minutes" });
  const mins = Math.trunc(n);
  if (mins < 0 || mins > 1440) return res.status(400).json({ error: "invalid_minutes" });

  const uid = req.user.uid;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `
      INSERT INTO submissions (assignment_id, student_uid)
      VALUES ($1, $2)
      ON CONFLICT (assignment_id, student_uid)
      DO UPDATE SET updated_at = now()
      `,
      [assignmentId, uid]
    );

    await client.query(
      `
      INSERT INTO submission_times (assignment_id, student_uid, label, attempt_no, minutes, updated_at)
      VALUES ($1,$2,$3,$4,$5, now())
      ON CONFLICT (assignment_id, student_uid, label, attempt_no)
      DO UPDATE SET minutes = EXCLUDED.minutes, updated_at = now()
      `,
      [assignmentId, uid, String(label), attemptNo, mins]
    );

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[POST /submissions/time]", e);
    res.status(500).json({ error: "server_error" });
  } finally {
    client.release();
  }
});

app.post("/submissions/clear", requireAuth, requireRole("student"), async (req, res) => {
  const { assignmentId, label, attemptNo: attemptNoBody } = req.body ?? {};
  if (!assignmentId || !label) return res.status(400).json({ error: "missing_body" });

  const attemptNo = normalizeAttemptNo(attemptNoBody);
  if (attemptNo === null) return res.status(400).json({ error: "invalid_attempt_no" });

  const uid = req.user.uid;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `DELETE FROM submission_marks
       WHERE assignment_id=$1 AND student_uid=$2 AND label=$3 AND attempt_no=$4`,
      [assignmentId, uid, String(label), attemptNo]
    );

    // 時間も消す（同じattemptNo）
    await client.query(
      `DELETE FROM submission_times
       WHERE assignment_id=$1 AND student_uid=$2 AND label=$3 AND attempt_no=$4`,
      [assignmentId, uid, String(label), attemptNo]
    );

    const left = await client.query(
      `SELECT 1 FROM submission_marks
       WHERE assignment_id=$1 AND student_uid=$2
       LIMIT 1`,
      [assignmentId, uid]
    );

    if (left.rows.length === 0) {
      await client.query(
        `DELETE FROM submissions WHERE assignment_id=$1 AND student_uid=$2`,
        [assignmentId, uid]
      );
    } else {
      await client.query(
        `UPDATE submissions SET updated_at=now()
         WHERE assignment_id=$1 AND student_uid=$2`,
        [assignmentId, uid]
      );
    }

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[POST /submissions/clear]", e);
    res.status(500).json({ error: "server_error" });
  } finally {
    client.release();
  }
});

app.post("/submissions/reset", requireAuth, requireRole("student"), async (req, res) => {
  const { assignmentId } = req.body ?? {};
  if (!assignmentId) return res.status(400).json({ error: "missing_body" });

  const uid = req.user.uid;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `DELETE FROM submission_marks WHERE assignment_id=$1 AND student_uid=$2`,
      [assignmentId, uid]
    );
    await client.query(
      `DELETE FROM submission_times WHERE assignment_id=$1 AND student_uid=$2`,
      [assignmentId, uid]
    );
    await client.query(
      `DELETE FROM submissions WHERE assignment_id=$1 AND student_uid=$2`,
      [assignmentId, uid]
    );

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[POST /submissions/reset]", e);
    res.status(500).json({ error: "server_error" });
  } finally {
    client.release();
  }
});

/**
 * =========================
 * Teacher: Books / Chapters / Blocks
 * =========================
 */

/** -------------------------
 * Problem Collections (教材シリーズ)
 * - 例: 4STEP / FocusGold / サクシード
 * ------------------------- */
app.get("/teacher/collections", requireAuth, requireRole("teacher"), async (_req, res) => {
  try {
    // subject列追加(migration)が未適用でも落ちないようにフォールバックする
    try {
      const q = await pool.query(
        "SELECT id, name, subject, created_at FROM collections ORDER BY name ASC"
      );
      return res.json({ collections: q.rows });
    } catch (e1) {
      if (String(e1?.code ?? "") !== "42703") throw e1;

      const q2 = await pool.query("SELECT id, name, created_at FROM collections ORDER BY name ASC");
      return res.json({
        collections: q2.rows.map((row) => ({ ...row, subject: null })),
      });
    }
  } catch (e) {
    console.error("[GET /teacher/collections]", e);
    return res.status(500).json({ error: "server_error" });
  }
});

app.post("/teacher/collections", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    const { name, subject } = req.body || {};
    const n = (name || "").trim();
    if (!n) return res.status(400).json({ error: "bad_request" });

    const subj = normalizeSubject(subject);
    const id = newId("col");

    // subject列追加(migration)が未適用でも落ちないようにフォールバックする
    try {
      await pool.query("INSERT INTO collections (id, name, subject) VALUES ($1, $2, $3)", [
        id,
        n,
        subj,
      ]);
    } catch (e1) {
      if (String(e1?.code ?? "") !== "42703") throw e1;
      await pool.query("INSERT INTO collections (id, name) VALUES ($1, $2)", [id, n]);
    }

    return res.json({ ok: true, id });
  } catch (e) {
    console.error("[POST /teacher/collections]", e);
    return res.status(500).json({ error: "server_error" });
  }
});

// シリーズ名/教科の更新
app.put("/teacher/collections/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    const id = String(req.params.id || "");
    if (!id) return res.status(400).json({ error: "bad_request" });
    if (id === "legacy") return res.status(400).json({ error: "cannot_update_legacy" });

    const name = String(req.body?.name ?? "").trim();
    const subject = normalizeSubject(req.body?.subject);
    if (!name) return res.status(400).json({ error: "missing_name" });

    // subject列追加(migration)が未適用でも落ちないようにフォールバックする
    let r;
    try {
      r = await pool.query("UPDATE collections SET name=$2, subject=$3 WHERE id=$1", [
        id,
        name,
        subject,
      ]);
    } catch (e1) {
      if (String(e1?.code ?? "") !== "42703") throw e1;
      r = await pool.query("UPDATE collections SET name=$2 WHERE id=$1", [id, name]);
    }

    if (r.rowCount === 0) return res.status(404).json({ error: "not_found" });
    return res.json({ ok: true });
  } catch (e) {
    console.error("[PUT /teacher/collections/:id]", e);
    if (String(e?.code ?? "") === "23505") {
      return res.status(409).json({ error: "duplicate_name" });
    }
    return res.status(500).json({ error: "server_error" });
  }
});

// シリーズ削除（参照中は409）
app.delete(
  "/teacher/collections/:id",
  requireAuth,
  requireRole("teacher"),
  async (req, res) => {
    try {
      const id = String(req.params.id || "");
      if (!id) return res.status(400).json({ error: "bad_request" });
      if (id === "legacy") return res.status(400).json({ error: "cannot_delete_legacy" });

      // 先に使用状況を確認（FK制約エラーを500にしない）
      const used = await pool.query("SELECT 1 FROM books WHERE collection_id=$1 LIMIT 1", [id]);
      if (used.rowCount > 0) {
        return res.status(409).json({
          error: "in_use",
          message: "このシリーズは問題集に使用されているため削除できません。",
        });
      }

      const r = await pool.query("DELETE FROM collections WHERE id=$1", [id]);
      if (r.rowCount === 0) return res.status(404).json({ error: "not_found" });
      return res.json({ ok: true });
    } catch (e) {
      console.error("[DELETE /teacher/collections/:id]", e);
      const code = String(e?.code ?? "");
      if (code === "23503") {
        return res.status(409).json({
          error: "in_use",
          message: "このシリーズは他のデータに参照されているため削除できません。",
        });
      }
      return res.status(500).json({ error: "server_error" });
    }
  }
);

app.get("/teacher/books", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    const classId = String(req.query?.classId ?? "").trim();

    // subject列追加(migration)が未適用でも落ちないように、まず新スキーマで試して、
    // 42703(undefined_column) の場合は旧スキーマにフォールバックする。
    try {
      if (classId) {
        const r = await pool.query(
          `SELECT b.id, b.name, b.created_at, b.collection_id,
                  b.subject,
                  c.name AS collection_name,
                  c.subject AS collection_subject
           FROM books b
           JOIN book_classes bc ON bc.book_id = b.id
           LEFT JOIN collections c ON c.id = b.collection_id
           WHERE bc.class_id = $1
           ORDER BY COALESCE(c.name, 'その他') ASC, b.name ASC`,
          [classId]
        );
        return res.json(r.rows);
      }

      const r = await pool.query(
        `SELECT b.id, b.name, b.created_at, b.collection_id,
                b.subject,
                c.name AS collection_name,
                c.subject AS collection_subject
         FROM books b
         LEFT JOIN collections c ON c.id = b.collection_id
         ORDER BY COALESCE(c.name, 'その他') ASC, b.name ASC`
      );
      return res.json(r.rows);
    } catch (e1) {
      if (String(e1?.code ?? "") !== "42703") throw e1;

      const r2 = await pool.query(
        classId
          ? `SELECT b.id, b.name, b.created_at, b.collection_id,
                    c.name AS collection_name
             FROM books b
             JOIN book_classes bc ON bc.book_id = b.id
             LEFT JOIN collections c ON c.id = b.collection_id
             WHERE bc.class_id = $1
             ORDER BY COALESCE(c.name, 'その他') ASC, b.name ASC`
          : `SELECT b.id, b.name, b.created_at, b.collection_id,
                    c.name AS collection_name
             FROM books b
             LEFT JOIN collections c ON c.id = b.collection_id
             ORDER BY COALESCE(c.name, 'その他') ASC, b.name ASC`,
        classId ? [classId] : []
      );

      // フロント互換のため、subject系フィールドを補完して返す
      return res.json(
        r2.rows.map((row) => ({
          ...row,
          subject: null,
          collection_subject: null,
        }))
      );
    }
  } catch (e) {
    console.error("[GET /teacher/books]", e);
    return res.status(500).json({ error: "server_error" });
  }
});

app.post("/teacher/books", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    const name = String(req.body?.name ?? "").trim();
    const collectionId = (req.body?.collectionId ?? req.body?.collection_id ?? null);
    const subjectRaw = req.body?.subject;
    if (!name) return res.status(400).json({ error: "missing_name" });

    // book には subject を直接持たせる（シリーズ無しでも教科で扱えるように）
    // collection がある場合は collection.subject を優先
    let subject = normalizeSubject(subjectRaw);
    if (collectionId) {
      const c = await pool.query("SELECT subject FROM collections WHERE id=$1", [collectionId]);
      if (c.rows.length > 0) subject = normalizeSubject(c.rows[0].subject);
    }

    const id = newId("book");
    await pool.query(
      `INSERT INTO books (id, name, collection_id) VALUES ($1,$2,$3)`,
      [id, name, collectionId]
    );

    // migration 未適用の環境もあるため、subject列が無い場合は握りつぶす
    try {
      await pool.query("UPDATE books SET subject=$2 WHERE id=$1", [id, subject]);
    } catch (_e) {
      // no-op
    }
    res.json({ ok: true, id });
  } catch (e) {
    console.error("[POST /teacher/books]", e);
    res.status(500).json({ error: "server_error" });
  }
});

app.delete("/teacher/books/:bookId", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    const bookId = String(req.params.bookId);
    const d = await pool.query(`DELETE FROM books WHERE id=$1 RETURNING id`, [bookId]);
    if (d.rows.length === 0) return res.status(404).json({ error: "not_found" });
    // chapters/blocks は FK ON DELETE CASCADE で消える
    res.json({ ok: true, id: d.rows[0].id });
  } catch (e) {
    console.error("[DELETE /teacher/books/:bookId]", e);
    res.status(500).json({ error: "server_error" });
  }
});

app.get("/teacher/books/:bookId", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    const bookId = String(req.params.bookId ?? "").trim();
    if (!bookId || bookId === "undefined" || bookId === "null") {
      return res.json({
        book: { id: "", name: "問題集", collection_id: null, subject: "other" },
        collection: null,
        chapters: [],
      });
    }
    const b = await pool.query(`SELECT id, name FROM books WHERE id=$1`, [bookId]);
    if (b.rows.length === 0) return res.status(404).json({ error: "not_found" });

    const c = await pool.query(
      `SELECT id, book_id, name, part, chapter_no, sort_order, created_at
       FROM chapters
       WHERE book_id=$1
       ORDER BY
         CASE upper(coalesce(part,'未設定'))
           WHEN 'I' THEN 10
           WHEN 'A' THEN 20
           WHEN 'II' THEN 30
           WHEN 'B' THEN 40
           WHEN '未設定' THEN 999
           ELSE 500
         END,
         COALESCE(chapter_no, 9999),
         COALESCE(sort_order, 9999),
         name`,
      [bookId]
    );

    res.json({ book: b.rows[0], chapters: c.rows });
  } catch (e) {
    if (isSafeSchemaError(e)) {
      console.warn("[GET /teacher/books/:bookId] book tables unavailable; placeholder fallback");
      return res.json({
        book: { id: "", name: "問題集", collection_id: null, subject: "other" },
        collection: null,
        chapters: [],
      });
    }
    console.error("[GET /teacher/books/:bookId]", e);
    res.status(500).json({ error: "server_error" });
  }
});

// =========================
// Teacher: Book ↔ Class usage
// =========================
app.get(
  "/teacher/books/:bookId/classes",
  requireAuth,
  requireRole("teacher"),
  async (req, res) => {
    try {
      const bookId = String(req.params.bookId ?? "").trim();
      if (!bookId || bookId === "undefined" || bookId === "null") return res.json({ classIds: [] });
      await ensureBookClassesTable();

      const b = await pool.query(`SELECT id FROM books WHERE id=$1`, [bookId]);
      if (b.rows.length === 0) return res.status(404).json({ error: "not_found" });

      const r = await pool.query(
        `SELECT class_id
         FROM book_classes
         WHERE book_id=$1
         ORDER BY class_id`,
        [bookId]
      );
      return res.json({ classIds: r.rows.map((x) => x.class_id) });
    } catch (e) {
      if (isSafeSchemaError(e)) {
        console.warn("[GET /teacher/books/:bookId/classes] book_classes unavailable; empty fallback");
        return res.json({ classIds: [] });
      }
      console.error("[GET /teacher/books/:bookId/classes]", e);
      return res.status(500).json({ error: "server_error" });
    }
  }
);

app.put(
  "/teacher/books/:bookId/classes",
  requireAuth,
  requireRole("teacher"),
  async (req, res) => {
    const bookId = String(req.params.bookId);
    try {
      await ensureBookClassesTable();

      const b = await pool.query(`SELECT id FROM books WHERE id=$1`, [bookId]);
      if (b.rows.length === 0) return res.status(404).json({ error: "not_found" });

      const raw = req.body?.classIds ?? req.body?.classes ?? req.body?.class_ids;
      const ids = Array.isArray(raw) ? raw : [];
      const classIds = Array.from(
        new Set(
          ids
            .map((x) => (x == null ? "" : String(x).trim()))
            .filter((x) => x.length > 0)
        )
      ).sort();

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`DELETE FROM book_classes WHERE book_id=$1`, [bookId]);
        for (const cid of classIds) {
          await client.query(
            `INSERT INTO book_classes (book_id, class_id)
             VALUES ($1,$2)
             ON CONFLICT DO NOTHING`,
            [bookId, cid]
          );
        }
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }

      return res.json({ ok: true, bookId, classIds });
    } catch (e) {
      console.error("[PUT /teacher/books/:bookId/classes]", e);
      return res.status(500).json({ error: "server_error" });
    }
  }
);

app.get(
  "/teacher/classes/:classId/books",
  requireAuth,
  requireRole("teacher"),
  async (req, res) => {
    try {
      await ensureBookClassesTable();
      const classId = String(req.params.classId);
      const r = await pool.query(
        `SELECT b.id, b.name, b.collection_id, b.subject, b.created_at
         FROM book_classes bc
         JOIN books b ON b.id = bc.book_id
         WHERE bc.class_id=$1
         ORDER BY b.name ASC`,
        [classId]
      );
      return res.json({ classId, books: r.rows });
    } catch (e) {
      console.error("[GET /teacher/classes/:classId/books]", e);
      return res.status(500).json({ error: "server_error" });
    }
  }
);

app.get(
  "/teacher/classes/:classId/books/summary",
  requireAuth,
  requireRole("teacher"),
  async (req, res) => {
    try {
      await ensureBookClassesTable();
      const classId = String(req.params.classId);

      // subject列が無い旧スキーマ環境もあるため、まず新スキーマで試して 42703 ならフォールバック
      try {
        const r = await pool.query(
          `SELECT
             b.id,
             b.name,
             b.created_at,
             b.collection_id,
             b.subject,
             c.name AS collection_name,
             c.subject AS collection_subject,
             COUNT(DISTINCT ch.id) AS chapter_count,
             COUNT(bl.id) AS block_count,
             SUM(CASE WHEN bl.series='problem' THEN 1 ELSE 0 END) AS problem_count,
             SUM(CASE WHEN bl.series='exercise' THEN 1 ELSE 0 END) AS exercise_count,
             SUM(CASE WHEN bl.series='comprehensive' THEN 1 ELSE 0 END) AS comprehensive_count,
             MAX(bl.created_at) AS last_block_at,
             MAX(ch.created_at) AS last_chapter_at
           FROM book_classes bc
           JOIN books b ON b.id = bc.book_id
           LEFT JOIN collections c ON c.id = b.collection_id
           LEFT JOIN chapters ch ON ch.book_id = b.id
           LEFT JOIN blocks bl ON bl.chapter_id = ch.id
           WHERE bc.class_id=$1
           GROUP BY b.id, c.name, c.subject
           ORDER BY COALESCE(c.name,'その他') ASC, b.name ASC`,
          [classId]
        );
        return res.json({ classId, books: r.rows });
      } catch (e1) {
        if (String(e1?.code ?? "") !== "42703") throw e1;

        const r2 = await pool.query(
          `SELECT
             b.id,
             b.name,
             b.created_at,
             b.collection_id,
             c.name AS collection_name,
             COUNT(DISTINCT ch.id) AS chapter_count,
             COUNT(bl.id) AS block_count,
             SUM(CASE WHEN bl.series='problem' THEN 1 ELSE 0 END) AS problem_count,
             SUM(CASE WHEN bl.series='exercise' THEN 1 ELSE 0 END) AS exercise_count,
             SUM(CASE WHEN bl.series='comprehensive' THEN 1 ELSE 0 END) AS comprehensive_count,
             MAX(bl.created_at) AS last_block_at,
             MAX(ch.created_at) AS last_chapter_at
           FROM book_classes bc
           JOIN books b ON b.id = bc.book_id
           LEFT JOIN collections c ON c.id = b.collection_id
           LEFT JOIN chapters ch ON ch.book_id = b.id
           LEFT JOIN blocks bl ON bl.chapter_id = ch.id
           WHERE bc.class_id=$1
           GROUP BY b.id, c.name
           ORDER BY COALESCE(c.name,'その他') ASC, b.name ASC`,
          [classId]
        );

        return res.json({
          classId,
          books: r2.rows.map((row) => ({
            ...row,
            subject: null,
            collection_subject: null,
          })),
        });
      }
    } catch (e) {
      console.error("[GET /teacher/classes/:classId/books/summary]", e);
      return res.status(500).json({ error: "server_error" });
    }
  }
);



app.get("/teacher/books/:bookId/chapters", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    const bookId = String(req.params.bookId ?? "").trim();
    if (!bookId || bookId === "undefined" || bookId === "null") return res.json({ chapters: [] });
    const b = await pool.query(`SELECT id FROM books WHERE id=$1`, [bookId]);
    if (b.rows.length === 0) return res.status(404).json({ error: "not_found" });

    const c = await pool.query(
      `SELECT id, book_id, name, part, chapter_no, sort_order, created_at
       FROM chapters
       WHERE book_id=$1
       ORDER BY
         CASE upper(coalesce(part,'未設定'))
           WHEN 'I' THEN 10
           WHEN 'A' THEN 20
           WHEN 'II' THEN 30
           WHEN 'B' THEN 40
           WHEN '未設定' THEN 999
           ELSE 500
         END,
         COALESCE(chapter_no, 9999),
         COALESCE(sort_order, 9999),
         name`,
      [bookId]
    );

    return res.json({ chapters: c.rows });
  } catch (e) {
    if (isSafeSchemaError(e)) {
      console.warn("[GET /teacher/books/:bookId/chapters] chapter tables unavailable; empty fallback");
      return res.json({ chapters: [] });
    }
    console.error("[GET /teacher/books/:bookId/chapters]", e);
    return res.status(500).json({ error: "server_error" });
  }
});

app.post("/teacher/books/:bookId/chapters", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    const bookId = String(req.params.bookId);

    const name = String(req.body?.name ?? "").trim();
    const partRaw = req.body?.part;
    const part = partRaw == null ? null : String(partRaw).trim() || null;

    const chapterNoRaw = req.body?.chapterNo;
    const chapterNoNum = Number(chapterNoRaw);
    const chapterNo =
      chapterNoRaw == null || chapterNoRaw === "" || !Number.isFinite(chapterNoNum) || chapterNoNum <= 0 ? null : chapterNoNum;

    if (!name) return res.status(400).json({ error: "missing_name" });

    // sort_orderは、chapterNoがあるならchapterNo、無いなら末尾に追加
    let sortOrder = 0;
    if (chapterNo != null) {
      sortOrder = chapterNo;
    } else {
      const mx = await pool.query("SELECT COALESCE(MAX(sort_order), 0) AS mx FROM chapters WHERE book_id=$1", [bookId]);
      sortOrder = Number(mx.rows?.[0]?.mx ?? 0) + 1;
    }

    const id = newId("ch");
    await pool.query(
      `INSERT INTO chapters (id, book_id, name, part, chapter_no, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, bookId, name, part, chapterNo, sortOrder]
    );

    res.json({ ok: true, id });
  } catch (e) {
    console.error("[POST /teacher/books/:bookId/chapters]", e);
    res.status(500).json({ error: "server_error" });
  }
});

app.delete("/teacher/chapters/:chapterId", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    const chapterId = String(req.params.chapterId);
    const d = await pool.query(`DELETE FROM chapters WHERE id=$1 RETURNING id`, [chapterId]);
    if (d.rows.length === 0) return res.status(404).json({ error: "not_found" });
    // blocks は FK ON DELETE CASCADE で消える
    res.json({ ok: true, id: d.rows[0].id });
  } catch (e) {
    console.error("[DELETE /teacher/chapters/:chapterId]", e);
    res.status(500).json({ error: "server_error" });
  }
});

app.get(
  "/teacher/chapters/:chapterId/blocks",
  requireAuth,
  requireRole("teacher"),
  async (req, res) => {
    try {
      const chapterId = String(req.params.chapterId);

      const c = await pool.query(
        `SELECT id, book_id, name, part, chapter_no
         FROM chapters
         WHERE id=$1`,
        [chapterId]
      );
      if (c.rows.length === 0) return res.status(404).json({ error: "not_found" });

      const b = await pool.query(
        `SELECT id, chapter_id, series, zone, scope, no, label, sort_order, created_at
         FROM blocks
         WHERE chapter_id=$1
         ORDER BY sort_order ASC, no ASC`,
        [chapterId]
      );

      res.json({ chapter: c.rows[0], blocks: b.rows });
    } catch (e) {
      console.error("[GET /teacher/chapters/:chapterId/blocks]", e);
      res.status(500).json({ error: "server_error" });
    }
  }
);

app.post(
  "/teacher/chapters/:chapterId/blocks/bulk",
  requireAuth,
  requireRole("teacher"),
  async (req, res) => {
    const chapterId = String(req.params.chapterId);
    const series = String(req.body?.series ?? "");
    const zone = String(req.body?.zone ?? "").trim() || "未設定";
    const scope = String(req.body?.scope ?? "").trim() || zone;
    const from = Number(req.body?.from ?? 0);
    const to = Number(req.body?.to ?? 0);

    if (!isValidSeries(series)) return res.status(400).json({ error: "invalid_series" });
    if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= 0) {
      return res.status(400).json({ error: "invalid_range" });
    }
    const f = Math.min(from, to);
    const t = Math.max(from, to);
    if (t - f > 800) return res.status(400).json({ error: "too_many" });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const exist = await client.query(
        `SELECT scope, no FROM blocks WHERE chapter_id=$1 AND series=$2 AND scope=$3`,
        [chapterId, series, scope]
      );
      const existSet = new Set(exist.rows.map((x) => `${x.scope}#${x.no}`));

      const created = [];
      for (let n = f; n <= t; n++) {
        const key = `${scope}#${n}`;
        if (existSet.has(key)) continue;

        const id = newId("blk");
        const label = String(n);
        const sortOrderBase = series === "problem" ? 1_000_000 : series === "exercise" ? 2_000_000 : 3_000_000;
        const sortOrder = sortOrderBase + n;

        await client.query(
          `INSERT INTO blocks (id, chapter_id, series, zone, scope, no, label, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, chapterId, series, zone, scope, n, label, sortOrder]
        );
        created.push(id);
      }

      await client.query("COMMIT");
      res.json({ ok: true, created });
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("[POST /teacher/chapters/:chapterId/blocks/bulk]", e);
      res.status(500).json({ error: "server_error" });
    } finally {
      client.release();
    }
  }
);

app.post("/teacher/blocks/bulk-update", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    const series = req.body?.series !== undefined ? String(req.body.series) : null;
    const zone = req.body?.zone !== undefined ? String(req.body.zone).trim() : null;
    const scope = req.body?.scope !== undefined ? String(req.body.scope).trim() : null;

    if (ids.length === 0) return res.status(400).json({ error: "missing_ids" });
    if (series !== null && !isValidSeries(series)) return res.status(400).json({ error: "invalid_series" });

    // 何も変更項目が無い場合はエラー
    if (series === null && zone === null && scope === null) {
      return res.status(400).json({ error: "missing_fields" });
    }

    // 変更後の値を決める（指定が無ければ現状維持）
    const r = await pool.query(
      `
      UPDATE blocks b
      SET
        series = COALESCE($2, b.series),
        zone = COALESCE($3, b.zone),
        scope = COALESCE($4, b.scope),
        sort_order =
          (CASE COALESCE($2, b.series)
            WHEN 'problem' THEN 1000000
            WHEN 'exercise' THEN 2000000
            ELSE 3000000
          END) + b.no
      WHERE b.id = ANY($1::text[])
      RETURNING b.id
      `,
      [ids, series, zone, scope]
    );

    res.json({ ok: true, updated: r.rows.map((x) => x.id) });
  } catch (e) {
    console.error("[POST /teacher/blocks/bulk-update]", e);
    res.status(500).json({ error: "server_error" });
  }
});

app.delete("/teacher/blocks/:blockId", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    const blockId = String(req.params.blockId);
    const d = await pool.query(`DELETE FROM blocks WHERE id=$1 RETURNING id`, [blockId]);
    if (d.rows.length === 0) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, id: d.rows[0].id });
  } catch (e) {
    console.error("[DELETE /teacher/blocks/:blockId]", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ---- Blocks: single edit / move / renumber ----

app.put("/teacher/blocks/:blockId", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    const blockId = String(req.params.blockId);

    const series = req.body?.series !== undefined ? String(req.body.series) : null;
    const zone = req.body?.zone !== undefined ? String(req.body.zone).trim() : null;
    const scope = req.body?.scope !== undefined ? String(req.body.scope).trim() : null;
    const no = req.body?.no !== undefined ? Number(req.body.no) : null;
    const label = req.body?.label !== undefined ? String(req.body.label) : null;

    if (series !== null && !isValidSeries(series)) return res.status(400).json({ error: "invalid_series" });
    if (no !== null && (!Number.isFinite(no) || no <= 0)) return res.status(400).json({ error: "invalid_no" });

    // 何も更新が無い
    if (series === null && zone === null && scope === null && no === null && label === null) {
      return res.status(400).json({ error: "missing_fields" });
    }

    const r = await pool.query(
      `
      UPDATE blocks b
      SET
        series = COALESCE($2, b.series),
        zone = COALESCE($3, b.zone),
        scope = COALESCE($4, b.scope),
        no = COALESCE($5, b.no),
        label = COALESCE($6, b.label),
        sort_order =
          (CASE COALESCE($2, b.series)
            WHEN 'problem' THEN 1000000
            WHEN 'exercise' THEN 2000000
            ELSE 3000000
          END) + COALESCE($5, b.no)
      WHERE b.id=$1
      RETURNING b.id
      `,
      [blockId, series, zone, scope, no, label]
    );

    if (r.rows.length === 0) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) {
    console.error("[PUT /teacher/blocks/:blockId]", e);
    res.status(500).json({ error: "server_error" });
  }
});

app.post("/teacher/blocks/move", requireAuth, requireRole("teacher"), async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  const targetChapterId = String(req.body?.targetChapterId ?? "");
  if (ids.length === 0) return res.status(400).json({ error: "missing_ids" });
  if (!targetChapterId) return res.status(400).json({ error: "missing_target" });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 移動先章が存在するか
    const ch = await client.query(`SELECT id FROM chapters WHERE id=$1`, [targetChapterId]);
    if (ch.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "chapter_not_found" });
    }

    // 現状の series/no を維持しつつ、chapter_id を更新
    const r = await client.query(
      `UPDATE blocks
       SET chapter_id=$2
       WHERE id = ANY($1::text[])
       RETURNING id`,
      [ids, targetChapterId]
    );

    await client.query('COMMIT');
    res.json({ ok: true, moved: r.rows.map((x) => x.id) });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[POST /teacher/blocks/move]', e);
    res.status(500).json({ error: 'server_error' });
  } finally {
    client.release();
  }
});

app.post("/teacher/chapters/:chapterId/blocks/renumber", requireAuth, requireRole("teacher"), async (req, res) => {
  // 指定された (series, scope) のブロックを sort_order,no,label の整合を取り直す
  const chapterId = String(req.params.chapterId);
  const series = String(req.body?.series ?? '');
  const scope = String(req.body?.scope ?? '').trim();
  const startAtRaw = Number(req.body?.startAt ?? 1);
  const startAt = Number.isFinite(startAtRaw) && startAtRaw > 0 ? Math.trunc(startAtRaw) : 1;

  if (!isValidSeries(series)) return res.status(400).json({ error: 'invalid_series' });
  if (!scope) return res.status(400).json({ error: 'missing_scope' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const r = await client.query(
      `SELECT id
       FROM blocks
       WHERE chapter_id=$1 AND series=$2 AND COALESCE(scope,'')=$3
       ORDER BY sort_order ASC, no ASC, created_at ASC`,
      [chapterId, series, scope]
    );

    const ids = r.rows.map((x) => x.id);
    const updated = [];
    for (let i = 0; i < ids.length; i++) {
      const no = startAt + i;
      const sortOrderBase = series === 'problem' ? 1000000 : series === 'exercise' ? 2000000 : 3000000;
      const sortOrder = sortOrderBase + no;
      const id = ids[i];
      await client.query(
        `UPDATE blocks
         SET no=$2, label=$3, sort_order=$4
         WHERE id=$1`,
        [id, no, String(no), sortOrder]
      );
      updated.push(id);
    }

    await client.query('COMMIT');
    res.json({ ok: true, updated, count: updated.length });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[POST /teacher/chapters/:chapterId/blocks/renumber]', e);
    res.status(500).json({ error: 'server_error' });
  } finally {
    client.release();
  }
});

app.post("/teacher/blocks/bulk-delete", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    if (ids.length === 0) return res.status(400).json({ error: "missing_ids" });

    const d = await pool.query(`DELETE FROM blocks WHERE id = ANY($1::text[]) RETURNING id`, [ids]);
    res.json({ ok: true, deleted: d.rows.map((x) => x.id) });
  } catch (e) {
    console.error("[POST /teacher/blocks/bulk-delete]", e);
    res.status(500).json({ error: "server_error" });
  }
});

/**
 * =========================
 * Teacher: Templates
 * =========================
 * - manual は schema 上 problem_count のみ保存可能（labels配列はDBに無い）
 * - book は template_blocks で block 集合を持つ
 */
app.get("/teacher/templates", requireAuth, requireRole("teacher"), async (_req, res) => {
  try {
    const r = await pool.query(
      `
      SELECT
        t.id, t.name, t.mode, t.created_by, t.created_at, t.updated_at,
        t.book_id, b.name AS book_name,
        t.chapter_id, c.name AS chapter_name,
        c.part, c.chapter_no,
        t.problem_count
      FROM templates t
      LEFT JOIN books b ON b.id=t.book_id
      LEFT JOIN chapters c ON c.id=t.chapter_id
      ORDER BY t.created_at DESC
      `
    );
    res.json(r.rows);
  } catch (e) {
    if (isSafeSchemaError(e)) {
      console.warn("[GET /teacher/templates] template tables unavailable; empty fallback");
      return res.json([]);
    }
    console.error("[GET /teacher/templates]", e);
    res.status(500).json({ error: "server_error" });
  }
});

app.get("/teacher/templates/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    const id = String(req.params.id);

    const t = await pool.query(
      `
      SELECT
        t.id, t.name, t.mode, t.created_by, t.created_at, t.updated_at,
        t.book_id, b.name AS book_name,
        t.chapter_id, c.name AS chapter_name,
        c.part, c.chapter_no,
        t.problem_count
      FROM templates t
      LEFT JOIN books b ON b.id=t.book_id
      LEFT JOIN chapters c ON c.id=t.chapter_id
      WHERE t.id=$1
      `,
      [id]
    );
    if (t.rows.length === 0) return res.status(404).json({ error: "not_found" });

    let blocks = [];
    if (t.rows[0].mode === "book") {
      const r = await pool.query(
        `
        SELECT
          tb.block_id,
          bl.series, bl.zone, bl.no, bl.label, bl.sort_order
        FROM template_blocks tb
        JOIN blocks bl ON bl.id = tb.block_id
        WHERE tb.template_id=$1
        ORDER BY bl.sort_order ASC, bl.no ASC
        `,
        [id]
      );
      blocks = r.rows;
    }

    res.json({ template: t.rows[0], blocks });
  } catch (e) {
    console.error("[GET /teacher/templates/:id]", e);
    res.status(500).json({ error: "server_error" });
  }
});

app.post("/teacher/templates", requireAuth, requireRole("teacher"), async (req, res) => {
  const { name, mode } = req.body ?? {};
  const m = String(mode ?? "");

  if (!name || !String(name).trim()) return res.status(400).json({ error: "missing_name" });
  if (!isValidTemplateMode(m)) return res.status(400).json({ error: "invalid_mode" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const id = newId("tpl");
    const tName = String(name).trim();

    if (m === "manual") {
      const problemCount = Number(req.body?.problemCount ?? 0);
      if (!Number.isFinite(problemCount) || problemCount <= 0 || problemCount > 500) {
        return res.status(400).json({ error: "invalid_problemCount" });
      }

      await client.query(
        `
        INSERT INTO templates (id, name, mode, created_by, problem_count)
        VALUES ($1,$2,'manual',$3,$4)
        `,
        [id, tName, req.user.uid, problemCount]
      );

      await client.query("COMMIT");
      return res.json({ ok: true, id });
    }

    // book
    const bookId = String(req.body?.bookId ?? "");
    const chapterId = String(req.body?.chapterId ?? "");
    const blockIds = Array.isArray(req.body?.blockIds) ? req.body.blockIds.map(String) : [];
    if (!bookId || !chapterId) return res.status(400).json({ error: "missing_book_chapter" });
    if (blockIds.length === 0) return res.status(400).json({ error: "missing_blockIds" });

    await client.query(
      `
      INSERT INTO templates (id, name, mode, created_by, book_id, chapter_id)
      VALUES ($1,$2,'book',$3,$4,$5)
      `,
      [id, tName, req.user.uid, bookId, chapterId]
    );

    // template_blocks
    for (const bid of blockIds) {
      await client.query(
        `INSERT INTO template_blocks (template_id, block_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [id, bid]
      );
    }

    await client.query("COMMIT");
    res.json({ ok: true, id });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[POST /teacher/templates]", e);
    res.status(500).json({ error: "server_error" });
  } finally {
    client.release();
  }
});

app.put("/teacher/templates/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  const id = String(req.params.id);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const cur = await client.query(`SELECT id, mode FROM templates WHERE id=$1`, [id]);
    if (cur.rows.length === 0) return res.status(404).json({ error: "not_found" });

    const name = String(req.body?.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "missing_name" });

    const mode = String(cur.rows[0].mode);

    if (mode === "manual") {
      const problemCount = Number(req.body?.problemCount ?? 0);
      if (!Number.isFinite(problemCount) || problemCount <= 0 || problemCount > 500) {
        return res.status(400).json({ error: "invalid_problemCount" });
      }

      await client.query(
        `UPDATE templates SET name=$2, problem_count=$3, updated_at=now() WHERE id=$1`,
        [id, name, problemCount]
      );

      await client.query("COMMIT");
      return res.json({ ok: true });
    }

    // book
    const blockIds = Array.isArray(req.body?.blockIds) ? req.body.blockIds.map(String) : [];
    if (blockIds.length === 0) return res.status(400).json({ error: "missing_blockIds" });

    await client.query(`UPDATE templates SET name=$2, updated_at=now() WHERE id=$1`, [id, name]);

    await client.query(`DELETE FROM template_blocks WHERE template_id=$1`, [id]);
    for (const bid of blockIds) {
      await client.query(
        `INSERT INTO template_blocks (template_id, block_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [id, bid]
      );
    }

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[PUT /teacher/templates/:id]", e);
    res.status(500).json({ error: "server_error" });
  } finally {
    client.release();
  }
});

app.delete("/teacher/templates/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    const id = String(req.params.id);
    const d = await pool.query(`DELETE FROM templates WHERE id=$1 RETURNING id`, [id]);
    if (d.rows.length === 0) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, id: d.rows[0].id });
  } catch (e) {
    console.error("[DELETE /teacher/templates/:id]", e);
    res.status(500).json({ error: "server_error" });
  }
});

/**
 * =========================
 * Teacher: Distribute (multiple classes)
 * POST /teacher/templates/:id/distribute
 * body: { title, dueAt?: string|null, classIds: string[], status?: 'open' }
 */
app.post(
  "/teacher/templates/:id/distribute",
  requireAuth,
  requireRole("teacher"),
  async (req, res) => {
    const templateId = String(req.params.id);
    const title = String(req.body?.title ?? "").trim();
    const classIds = Array.isArray(req.body?.classIds) ? req.body.classIds.map(String) : [];
    const dueAt = req.body?.dueAt ? String(req.body.dueAt) : null;

    if (!title) return res.status(400).json({ error: "missing_title" });
    if (classIds.length === 0) return res.status(400).json({ error: "missing_classIds" });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const t = await client.query(
        `SELECT id, name, mode, book_id, chapter_id, problem_count
         FROM templates
         WHERE id=$1`,
        [templateId]
      );
      if (t.rows.length === 0) return res.status(404).json({ error: "not_found" });

      const tpl = t.rows[0];

      let labels = [];
      let blockIds = [];
      if (tpl.mode === "manual") {
        const n = Number(tpl.problem_count ?? 0);
        if (!n || n <= 0) return res.status(400).json({ error: "invalid_template" });
        labels = Array.from({ length: n }, (_, i) => String(i + 1));
      } else {
        const bl = await client.query(
          `
          SELECT bl.id, bl.label, bl.sort_order
          FROM template_blocks tb
          JOIN blocks bl ON bl.id = tb.block_id
          WHERE tb.template_id=$1
          ORDER BY bl.sort_order ASC, bl.no ASC
          `,
          [templateId]
        );
        blockIds = bl.rows.map((x) => x.id);
        labels = bl.rows.map((x) => x.label);
        if (labels.length === 0) return res.status(400).json({ error: "empty_blocks" });
      }

      const assignmentId = newId("asg");

      await client.query(
        `
        INSERT INTO assignments (id, title, status, template_id, created_by, due_at, book_id, chapter_id)
        VALUES ($1,$2,'open',$3,$4,$5,$6,$7)
        `,
        [
          assignmentId,
          title,
          templateId,
          req.user.uid,
          dueAt ? new Date(dueAt) : null,
          tpl.book_id ?? null,
          tpl.chapter_id ?? null,
        ]
      );

      for (const cid of classIds) {
        await client.query(
          `INSERT INTO assignment_classes (assignment_id, class_id)
           VALUES ($1,$2)
           ON CONFLICT DO NOTHING`,
          [assignmentId, cid]
        );
      }

      for (let i = 0; i < labels.length; i++) {
        const label = labels[i];
        const blockId = tpl.mode === "book" ? blockIds[i] : null;
        await client.query(
          `
          INSERT INTO assignment_problems (assignment_id, label, block_id, sort_order)
          VALUES ($1,$2,$3,$4)
          ON CONFLICT (assignment_id,label) DO NOTHING
          `,
          [assignmentId, label, blockId, i]
        );
      }

      await client.query("COMMIT");
      res.json({ ok: true, assignmentId });
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("[POST /teacher/templates/:id/distribute]", e);
      res.status(500).json({ error: "server_error" });
    } finally {
      client.release();
    }
  }
);

const port = process.env.PORT || 4000;

/**
 * =========================
 * 質問（Q&A）: Thread + Messages
 * =========================
 * - student: 質問作成/閲覧/追記
 * - teacher: 一覧/閲覧/返信/ステータス変更
 *
 * 方針:
 * - 既存環境を壊さないため、テーブルは IF NOT EXISTS で自動作成
 * - threadId が "undefined" のような異常値の時は 400 を返す（フロントの不具合検知を容易に）
 */

let __questionsTablesReady = false;
let __qtCols = null; // Set<string> | null

async function loadQuestionThreadColumns() {
  try {
    const r = await pool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name='question_threads'`
    );
    __qtCols = new Set(r.rows.map((x) => String(x.column_name)));
  } catch (e) {
    console.error("[questions] load columns failed", e);
    __qtCols = null;
  }
}

function hasQtCol(name) {
  return __qtCols ? __qtCols.has(String(name)) : true; // unknown => assume exists
}

function qtSelect(col, alias, fallbackLiteral /* string | null */ = null) {
  const a = alias || col;
  if (hasQtCol(col)) return `qt.${col} AS ${a}`;
  if (fallbackLiteral !== null) return `${fallbackLiteral} AS ${a}`;
  return `NULL AS ${a}`;
}

async function ensureQuestionsTables() {
  if (__questionsTablesReady) return;
  await pool.query(
    `CREATE TABLE IF NOT EXISTS question_threads (
      id           text PRIMARY KEY,
      book_id      text,
      chapter_id   text,
      block_id     text,
      student_uid  text NOT NULL,
      class_id     text,
      title        text NOT NULL,
      status       text NOT NULL DEFAULT 'open',
      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_at   timestamptz NOT NULL DEFAULT now()
    )`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS question_messages (
      id           text PRIMARY KEY,
      thread_id    text NOT NULL REFERENCES question_threads(id) ON DELETE CASCADE,
      sender_role  text NOT NULL,
      sender_uid   text,
      body         text NOT NULL DEFAULT '',
      image_path   text,
      image_mime   text,
      image_size   integer,
      created_at   timestamptz NOT NULL DEFAULT now()
    )`
  );


// Backfill/extend columns for existing environments
await pool.query(`ALTER TABLE question_threads ADD COLUMN IF NOT EXISTS book_id text`);
await pool.query(`ALTER TABLE question_threads ADD COLUMN IF NOT EXISTS chapter_id text`);
await pool.query(`ALTER TABLE question_threads ADD COLUMN IF NOT EXISTS block_id text`);
await pool.query(`ALTER TABLE question_threads ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`);
await pool.query(`ALTER TABLE question_threads ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open'`);
await pool.query(`ALTER TABLE question_messages ADD COLUMN IF NOT EXISTS image_path text`);
await pool.query(`ALTER TABLE question_messages ADD COLUMN IF NOT EXISTS image_mime text`);
await pool.query(`ALTER TABLE question_messages ADD COLUMN IF NOT EXISTS image_size integer`);

  await pool.query(`CREATE INDEX IF NOT EXISTS q_threads_student_idx ON question_threads(student_uid, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS q_threads_class_idx ON question_threads(class_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS q_threads_block_idx ON question_threads(block_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS q_msgs_thread_idx ON question_messages(thread_id, created_at ASC)`);
  await loadQuestionThreadColumns();
  __questionsTablesReady = true;
}

function isValidQuestionStatus(s) {
  return s === "open" || s === "closed";
}

function isBadThreadId(id) {
  const v = String(id ?? "").trim();
  return !v || v === "undefined" || v === "null";
}

// --- student ---

app.get("/student/questions", requireAuth, requireRole("student"), async (req, res) => {
  try {
    await ensureQuestionsTables();
    const uid = String(req.user.uid);
    const status = req.query.status ? String(req.query.status) : null;

    const conds = [`qt.student_uid=$1`];
    const params = [uid];
    let idx = 2;

    if (status && isValidQuestionStatus(status) && hasQtCol("status")) {
      conds.push(`qt.status=$${idx++}`);
      params.push(status);
    }

    const where = `WHERE ${conds.join(" AND ")}`;

    const select = [
      "qt.id",
      "qt.title",
      hasQtCol("status") ? "qt.status" : "'open'::text AS status",
      qtSelect("book_id"),
      qtSelect("chapter_id"),
      qtSelect("block_id"),
      qtSelect("class_id"),
      "qt.created_at",
      hasQtCol("updated_at") ? "qt.updated_at" : "qt.created_at AS updated_at",
      `(SELECT MAX(created_at) FROM question_messages qm WHERE qm.thread_id=qt.id) AS last_message_at`,
    ].join(", ");

    const sql = `
      SELECT ${select}
      FROM question_threads qt
      ${where}
      ORDER BY COALESCE((SELECT MAX(created_at) FROM question_messages qm WHERE qm.thread_id=qt.id), qt.created_at) DESC
    `;

    const r = await pool.query(sql, params);
    return res.json({ threads: r.rows });
  } catch (e) {
    console.error("[GET /student/questions]", e);
    return res.status(500).json({ error: "server_error" });
  }
});


app.post("/student/questions", requireAuth, requireRole("student"), questionUpload.single("image"), async (req, res) => {
  try {
    await ensureQuestionsTables();
    const uid = String(req.user.uid);
    const classId = req.user.classId ? String(req.user.classId) : null;

    const { title, body, bookId, chapterId, blockId } = req.body ?? {};
const titleText = String(title ?? "").trim();
const bodyText = String(body ?? "").trim();
const hasImage = !!req.file;
if (!titleText) return res.status(400).json({ error: "missing_title" });
if (!bodyText && !hasImage) return res.status(400).json({ error: "missing_body" });

    const threadId = newId("qth");
    await pool.query(
      `INSERT INTO question_threads (id, book_id, chapter_id, block_id, student_uid, class_id, title, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'open')`,
      [threadId, bookId ?? null, chapterId ?? null, blockId ?? null, uid, classId, String(title)]
    );

    const msgId = newId("qmsg");
    await pool.query(
      `INSERT INTO question_messages (id, thread_id, sender_role, sender_uid, body, image_path, image_mime, image_size)
       VALUES ($1,$2,'student',$3,$4,$5,$6,$7)`
      ,
      [msgId, threadId, uid, bodyText, req.file ? `/uploads/questions/${req.file.filename}` : null, req.file?.mimetype ?? null, req.file?.size ?? null]
    );

    await pool.query(`UPDATE question_threads SET updated_at=now() WHERE id=$1`, [threadId]);

    return res.json({ ok: true, threadId, thread: { id: threadId } });
  } catch (e) {
    console.error("[POST /student/questions]", e);
    return res.status(500).json({ error: "server_error" });
  }
});

app.get("/student/questions/:threadId", requireAuth, requireRole("student"), async (req, res) => {
  try {
    await ensureQuestionsTables();
    const uid = String(req.user.uid);
    const threadId = String(req.params.threadId);
    if (isBadThreadId(threadId)) return res.status(400).json({ error: "bad_thread_id" });

    const t = await pool.query(
      `SELECT id, title, status, book_id, chapter_id, block_id, class_id, student_uid, created_at, updated_at
       FROM question_threads
       WHERE id=$1`,
      [threadId]
    );
    if (t.rows.length === 0) return res.status(404).json({ error: "not_found" });
    if (String(t.rows[0].student_uid) !== uid) return res.status(403).json({ error: "forbidden" });

    const m = await pool.query(
      `SELECT id, thread_id, sender_role, sender_uid, body, image_path, image_mime, image_size, created_at
       FROM question_messages
       WHERE thread_id=$1
       ORDER BY created_at ASC`,
      [threadId]
    );

    return res.json({ thread: t.rows[0], messages: m.rows });
  } catch (e) {
    console.error("[GET /student/questions/:threadId]", e);
    return res.status(500).json({ error: "server_error" });
  }
});

app.post("/student/questions/:threadId/messages", requireAuth, requireRole("student"), questionUpload.single("image"), async (req, res) => {
  try {
    await ensureQuestionsTables();
    const uid = String(req.user.uid);
    const threadId = String(req.params.threadId);
    if (isBadThreadId(threadId)) return res.status(400).json({ error: "bad_thread_id" });

    const t = await pool.query(`SELECT student_uid, status FROM question_threads WHERE id=$1`, [threadId]);
    if (t.rows.length === 0) return res.status(404).json({ error: "not_found" });
    if (String(t.rows[0].student_uid) !== uid) return res.status(403).json({ error: "forbidden" });

    const { body } = req.body ?? {};
const bodyText = String(body ?? "").trim();
const hasImage = !!req.file;
if (!bodyText && !hasImage) return res.status(400).json({ error: "missing_body" });

    const msgId = newId("qmsg");
    await pool.query(
      `INSERT INTO question_messages (id, thread_id, sender_role, sender_uid, body, image_path, image_mime, image_size)
       VALUES ($1,$2,'student',$3,$4,$5,$6,$7)`
      ,
      [msgId, threadId, uid, bodyText, req.file ? `/uploads/questions/${req.file.filename}` : null, req.file?.mimetype ?? null, req.file?.size ?? null]
    );
    await pool.query(`UPDATE question_threads SET updated_at=now() WHERE id=$1`, [threadId]);
    return res.json({ ok: true, id: msgId });
  } catch (e) {
    console.error("[POST /student/questions/:threadId/messages]", e);
    return res.status(500).json({ error: "server_error" });
  }
});



app.put("/student/questions/:threadId/status", requireAuth, requireRole("student"), async (req, res) => {
  try {
    await ensureQuestionsTables();
    const uid = String(req.user.uid);
    const threadId = String(req.params.threadId);
    if (isBadThreadId(threadId)) return res.status(400).json({ error: "bad_thread_id" });

    const status = String(req.body?.status ?? "");
    if (!isValidQuestionStatus(status)) return res.status(400).json({ error: "bad_status" });

    const t = await pool.query(`SELECT student_uid FROM question_threads WHERE id=$1`, [threadId]);
    if (t.rows.length === 0) return res.status(404).json({ error: "not_found" });
    if (String(t.rows[0].student_uid) !== uid) return res.status(403).json({ error: "forbidden" });

    const u = await pool.query(
      `UPDATE question_threads SET status=$2, updated_at=now() WHERE id=$1 RETURNING id, status`,
      [threadId, status]
    );
    return res.json({ ok: true, thread: u.rows[0] });
  } catch (e) {
    console.error("[PUT /student/questions/:threadId/status]", e);
    return res.status(500).json({ error: "server_error" });
  }
});


// =========================
// Notifications (Questions)
// =========================
app.get("/student/notifications", requireAuth, requireRole("student"), async (req, res) => {
  try {
    // since は ISO文字列想定。無ければ7日前。
    const sinceRaw = String(req.query?.since ?? "").trim();
    let since = null;
    if (sinceRaw) {
      const d = new Date(sinceRaw);
      if (!Number.isNaN(d.getTime())) since = d.toISOString();
    }
    if (!since) {
      const d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      since = d.toISOString();
    }

    const limit = Math.min(Math.max(parseInt(String(req.query?.limit ?? "20"), 10) || 20, 1), 50);

    const q = await pool.query(
      `
      SELECT
        m.thread_id,
        t.title,
        m.body,
        m.image_path,
        m.created_at
      FROM question_messages m
      JOIN question_threads t ON t.id = m.thread_id
      WHERE t.student_uid = $1
        AND m.sender_role = 'teacher'
        AND m.created_at > $2
      ORDER BY m.created_at DESC
      LIMIT ${limit}
      `,
      [req.user.uid, since]
    );

    res.json({ notifications: q.rows ?? [] });
  } catch (e) {
    console.error("[GET /student/notifications]", e);
    res.status(500).json({ error: "server_error" });
  }
});

// --- teacher ---

app.get("/teacher/questions", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    await ensureQuestionsTables();
    const status = req.query.status ? String(req.query.status) : null;
    const classId = req.query.classId ? String(req.query.classId) : null;
    const bookId = req.query.bookId ? String(req.query.bookId) : null;
    const blockId = req.query.blockId ? String(req.query.blockId) : null;
    const studentUid = req.query.studentUid ? String(req.query.studentUid) : null;

    const conds = [];
    const params = [];
    let idx = 1;

    if (status && isValidQuestionStatus(status) && hasQtCol("status")) {
      conds.push(`qt.status=$${idx++}`);
      params.push(status);
    }
    if (classId && hasQtCol("class_id")) {
      conds.push(`qt.class_id=$${idx++}`);
      params.push(classId);
    }
    if (bookId && hasQtCol("book_id")) {
      conds.push(`qt.book_id=$${idx++}`);
      params.push(bookId);
    }
    if (blockId && hasQtCol("block_id")) {
      conds.push(`qt.block_id=$${idx++}`);
      params.push(blockId);
    }
    if (studentUid && hasQtCol("student_uid")) {
      conds.push(`qt.student_uid=$${idx++}`);
      params.push(studentUid);
    }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const select = [
      "qt.id",
      "qt.title",
      hasQtCol("status") ? "qt.status" : "'open'::text AS status",
      qtSelect("class_id"),
      qtSelect("student_uid"),
      qtSelect("book_id"),
      qtSelect("chapter_id"),
      qtSelect("block_id"),
      "qt.created_at",
      hasQtCol("updated_at") ? "qt.updated_at" : "qt.created_at AS updated_at",
      `(SELECT MAX(created_at) FROM question_messages qm WHERE qm.thread_id=qt.id) AS last_message_at`,
      `(SELECT body FROM question_messages qm WHERE qm.thread_id=qt.id ORDER BY created_at DESC LIMIT 1) AS last_message_body`,
    ].join(", ");

    const sql = `
      SELECT ${select}
      FROM question_threads qt
      ${where}
      ORDER BY COALESCE((SELECT MAX(created_at) FROM question_messages qm WHERE qm.thread_id=qt.id), qt.created_at) DESC
    `;

    const r = await pool.query(sql, params);
    return res.json({ threads: r.rows });
  } catch (e) {
    if (isSafeSchemaError(e)) {
      console.warn("[GET /teacher/questions] question tables unavailable; empty fallback");
      return res.json({ threads: [] });
    }
    console.error("[GET /teacher/questions]", e);
    return res.status(500).json({ error: "server_error" });
  }
});

// block 紐付け運用：章内の質問数を block_id ごとに返す
// GET /teacher/questions/counts?chapterId=...&status=open|closed
app.get("/teacher/questions/counts", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    await ensureQuestionsTables();
    const chapterId = req.query.chapterId ? String(req.query.chapterId) : null;
    const status = req.query.status ? String(req.query.status) : "open";

    if (!chapterId) return res.status(400).json({ error: "missing_chapterId" });
    if (!hasQtCol("chapter_id") || !hasQtCol("block_id")) return res.json({ counts: {} });

    const conds = ["qt.chapter_id=$1", "qt.block_id IS NOT NULL", "qt.block_id<>''"];
    const params = [chapterId];
    let idx = 2;

    if (status && isValidQuestionStatus(status) && hasQtCol("status")) {
      conds.push(`qt.status=$${idx++}`);
      params.push(status);
    }

    const sql = `
      SELECT qt.block_id AS block_id, COUNT(*)::int AS cnt
      FROM question_threads qt
      WHERE ${conds.join(" AND ")}
      GROUP BY qt.block_id
    `;

    const r = await pool.query(sql, params);
    const counts = {};
    for (const row of r.rows) {
      const bid = String(row.block_id ?? "");
      if (!bid) continue;
      counts[bid] = Number(row.cnt ?? 0);
    }
    return res.json({ counts });
  } catch (e) {
    console.error("[GET /teacher/questions/counts]", e);
    return res.status(500).json({ error: "server_error" });
  }
});


app.get("/teacher/questions/:threadId", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    await ensureQuestionsTables();
    const threadId = String(req.params.threadId);
    if (isBadThreadId(threadId)) return res.status(400).json({ error: "bad_thread_id" });

    const t = await pool.query(
      `SELECT id, title, status, book_id, chapter_id, block_id, class_id, student_uid, created_at, updated_at
       FROM question_threads
       WHERE id=$1`,
      [threadId]
    );
    if (t.rows.length === 0) return res.status(404).json({ error: "not_found" });

    const m = await pool.query(
      `SELECT id, thread_id, sender_role, sender_uid, body, image_path, image_mime, image_size, created_at
       FROM question_messages
       WHERE thread_id=$1
       ORDER BY created_at ASC`,
      [threadId]
    );

    return res.json({ thread: t.rows[0], messages: m.rows });
  } catch (e) {
    console.error("[GET /teacher/questions/:threadId]", e);
    return res.status(500).json({ error: "server_error" });
  }
});

app.post("/teacher/questions/:threadId/messages", requireAuth, requireRole("teacher"), questionUpload.single("image"), async (req, res) => {
  try {
    await ensureQuestionsTables();
    const threadId = String(req.params.threadId);
    if (isBadThreadId(threadId)) return res.status(400).json({ error: "bad_thread_id" });

    const t = await pool.query(`SELECT id FROM question_threads WHERE id=$1`, [threadId]);
    if (t.rows.length === 0) return res.status(404).json({ error: "not_found" });

    const { body } = req.body ?? {};
    const bodyText = String(body ?? "").trim();
    const hasImage = !!req.file;
    if (!bodyText && !hasImage) return res.status(400).json({ error: "missing_body" });

    const msgId = newId("qmsg");
    const imagePath = req.file ? `/uploads/questions/${req.file.filename}` : null;

    await pool.query(
      `INSERT INTO question_messages (id, thread_id, sender_role, sender_uid, body, image_path, image_mime, image_size)
       VALUES ($1,$2,'teacher',$3,$4,$5,$6,$7)`,
      [msgId, threadId, String(req.user.uid), bodyText, imagePath, req.file?.mimetype ?? null, req.file?.size ?? null]
    );

    await pool.query(`UPDATE question_threads SET updated_at=now() WHERE id=$1`, [threadId]);
    return res.json({ ok: true, id: msgId });
  } catch (e) {
    console.error("[POST /teacher/questions/:threadId/messages]", e);
    return res.status(500).json({ error: "server_error" });
  }
});


// --- DEV: delete a message (teacher only) ---
app.delete("/teacher/questions/:threadId/messages/:messageId", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    await ensureQuestionsTables();
    const threadId = String(req.params.threadId);
    const messageId = String(req.params.messageId);
    if (isBadThreadId(threadId)) return res.status(400).json({ error: "bad_thread_id" });
    if (!messageId) return res.status(400).json({ error: "missing_message_id" });

    const t = await pool.query(`SELECT id FROM question_threads WHERE id=$1`, [threadId]);
    if (t.rows.length === 0) return res.status(404).json({ error: "not_found" });

    // 開発用：teacherが削除できるのは teacher が送ったメッセージのみ（誤削除防止）
    const d = await pool.query(
      `DELETE FROM question_messages
       WHERE id=$1 AND thread_id=$2 AND sender_role='teacher'
       RETURNING id`,
      [messageId, threadId]
    );
    if (d.rows.length === 0) return res.status(404).json({ error: "message_not_found" });

    await pool.query(`UPDATE question_threads SET updated_at=now() WHERE id=$1`, [threadId]);
    return res.json({ ok: true, id: d.rows[0].id });
  } catch (e) {
    console.error("[DELETE /teacher/questions/:threadId/messages/:messageId]", e);
    return res.status(500).json({ error: "server_error" });
  }
});

app.put("/teacher/questions/:threadId/status", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    await ensureQuestionsTables();
    const threadId = String(req.params.threadId);
    if (isBadThreadId(threadId)) return res.status(400).json({ error: "bad_thread_id" });

    const status = String(req.body?.status ?? "");
    if (!isValidQuestionStatus(status)) return res.status(400).json({ error: "bad_status" });

    const u = await pool.query(`UPDATE question_threads SET status=$2, updated_at=now() WHERE id=$1 RETURNING id, status`, [threadId, status]);
    if (u.rows.length === 0) return res.status(404).json({ error: "not_found" });
    return res.json({ ok: true, thread: u.rows[0] });
  } catch (e) {
    console.error("[PUT /teacher/questions/:threadId/status]", e);
    return res.status(500).json({ error: "server_error" });
  }
});


app.delete("/teacher/questions/:threadId", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    await ensureQuestionsTables();
    const threadId = String(req.params.threadId);
    if (isBadThreadId(threadId)) return res.status(400).json({ error: "bad_thread_id" });

    // 開発段階のため：教師はスレッド（質問）を削除できる
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 存在確認
      const t = await client.query(`SELECT id FROM question_threads WHERE id=$1`, [threadId]);
      if (t.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "not_found" });
      }

      await client.query(`DELETE FROM question_messages WHERE thread_id=$1`, [threadId]);
      await client.query(`DELETE FROM question_threads WHERE id=$1`, [threadId]);

      await client.query("COMMIT");
      return res.json({ ok: true });
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch {}
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("[DELETE /teacher/questions/:threadId]", e);
    return res.status(500).json({ error: "server_error" });
  }
});


app.get("/teacher/notifications", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    const hasQuestionThreads = await tableAvailable("question_threads");
    const hasQuestionMessages = await tableAvailable("question_messages");
    if (!hasQuestionThreads || !hasQuestionMessages) {
      return res.json({ notifications: [] });
    }
    const sinceRaw = String(req.query?.since ?? "").trim();
    let since = null;
    if (sinceRaw) {
      const d = new Date(sinceRaw);
      if (!Number.isNaN(d.getTime())) since = d.toISOString();
    }
    if (!since) {
      const d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      since = d.toISOString();
    }

    const classId = String(req.query?.classId ?? "").trim();
    const limit = Math.min(Math.max(parseInt(String(req.query?.limit ?? "20"), 10) || 20, 1), 50);

    // classId指定がある場合はそのクラスのスレッドだけ
    const params = [since];
    let where = "m.sender_role = 'student' AND m.created_at > $1";
    if (classId) {
      params.push(classId);
      where += ` AND (t.class_id = $${params.length})`;
    }

    const q = await pool.query(
      `
      SELECT
        m.thread_id,
        t.title,
        t.class_id,
        t.student_uid,
        m.body,
        m.image_path,
        m.created_at
      FROM question_messages m
      JOIN question_threads t ON t.id = m.thread_id
      WHERE ${where}
      ORDER BY m.created_at DESC
      LIMIT ${limit}
      `,
      params
    );

    res.json({ notifications: q.rows ?? [] });
  } catch (e) {
    if (isSafeSchemaError(e)) {
      console.warn("[GET /teacher/notifications] question tables unavailable; empty fallback");
      return res.json({ notifications: [] });
    }
    console.error("[GET /teacher/notifications]", e);
    res.status(500).json({ error: "server_error" });
  }
});



/**
 * =========================
 * Materials
 * =========================
 */
materialUploadHandler(materialImageUpload, "/teacher/materials/upload/image", "/uploads/materials/images");
materialUploadHandler(materialVideoUpload, "/teacher/materials/upload/video", "/uploads/materials/videos");
materialUploadHandler(materialThumbUpload, "/teacher/materials/upload/thumb", "/uploads/materials/thumbs");
materialUploadHandler(materialAppUpload, "/teacher/materials/upload/app", "/uploads/materials/apps");
app.get("/teacher/materials", requireAuth, requireRole("teacher"), async (_req, res) => { try { res.json(await listTeacherMaterials()); } catch (e) { if (isSafeSchemaError(e)) { console.warn("[GET /teacher/materials] material tables unavailable; empty fallback"); return res.json([]); } console.error("[GET /teacher/materials]", e); res.status(500).json({ error: "server_error" }); } });
app.get("/teacher/materials/:id", requireAuth, requireRole("teacher"), async (req, res) => { try { await ensureMaterialsTables(); const row = await readMaterialById(pool, String(req.params.id)); if (!row) return res.status(404).json({ error: "not_found" }); res.json(row); } catch (e) { console.error("[GET /teacher/materials/:id]", e); res.status(500).json({ error: "server_error" }); } });
app.post("/teacher/materials", requireAuth, requireRole("teacher"), async (req, res) => { const title = String(req.body?.title ?? "").trim(); const description = String(req.body?.description ?? "").trim() || null; const subject = normalizeSubject(req.body?.subject); const unitName = String(req.body?.unit_name ?? "").trim() || null; const gradeLevel = String(req.body?.grade_level ?? "").trim() || null; const materialType = String(req.body?.material_type ?? "").trim(); const contentUrl = String(req.body?.content_url ?? "").trim() || null; const thumbnailUrl = String(req.body?.thumbnail_url ?? "").trim() || null; const interactiveKind = req.body?.interactive_kind == null ? null : String(req.body?.interactive_kind).trim() || null; const interactiveConfig = req.body?.interactive_config ?? null; const isPublished = !!req.body?.is_published; const classIds = normalizeMaterialClassIds(req.body?.class_ids); if (!title) return res.status(400).json({ error: "missing_title" }); if (!isValidMaterialType(materialType)) return res.status(400).json({ error: "invalid_material_type" }); if (!isValidInteractiveKind(interactiveKind)) return res.status(400).json({ error: "invalid_interactive_kind" }); if (materialType !== "interactive" && !contentUrl) return res.status(400).json({ error: "missing_content_url" }); const client = await pool.connect(); try { await ensureMaterialsTables(); await client.query("BEGIN"); const id = newId("mat"); await client.query(`INSERT INTO materials (id, title, description, subject, unit_name, grade_level, material_type, content_url, thumbnail_url, interactive_kind, interactive_config, is_published, created_by, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())`, [id, title, description, subject, unitName, gradeLevel, materialType, contentUrl, thumbnailUrl, interactiveKind, interactiveConfig, isPublished, req.user.uid]); for (const classId of classIds) await client.query(`INSERT INTO material_class_targets (material_id, class_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, classId]); await client.query("COMMIT"); res.json(await readMaterialById(client, id)); } catch (e) { await client.query("ROLLBACK"); console.error("[POST /teacher/materials]", e); res.status(500).json({ error: "server_error" }); } finally { client.release(); } });
app.put("/teacher/materials/:id", requireAuth, requireRole("teacher"), async (req, res) => { const id = String(req.params.id); const title = String(req.body?.title ?? "").trim(); const description = String(req.body?.description ?? "").trim() || null; const subject = normalizeSubject(req.body?.subject); const unitName = String(req.body?.unit_name ?? "").trim() || null; const gradeLevel = String(req.body?.grade_level ?? "").trim() || null; const materialType = String(req.body?.material_type ?? "").trim(); const contentUrl = String(req.body?.content_url ?? "").trim() || null; const thumbnailUrl = String(req.body?.thumbnail_url ?? "").trim() || null; const interactiveKind = req.body?.interactive_kind == null ? null : String(req.body?.interactive_kind).trim() || null; const interactiveConfig = req.body?.interactive_config ?? null; const isPublished = !!req.body?.is_published; const classIds = normalizeMaterialClassIds(req.body?.class_ids); if (!title) return res.status(400).json({ error: "missing_title" }); if (!isValidMaterialType(materialType)) return res.status(400).json({ error: "invalid_material_type" }); if (!isValidInteractiveKind(interactiveKind)) return res.status(400).json({ error: "invalid_interactive_kind" }); if (materialType !== "interactive" && !contentUrl) return res.status(400).json({ error: "missing_content_url" }); const client = await pool.connect(); try { await ensureMaterialsTables(); await client.query("BEGIN"); const exists = await client.query(`SELECT id FROM materials WHERE id=$1`, [id]); if (exists.rows.length === 0) { await client.query("ROLLBACK"); return res.status(404).json({ error: "not_found" }); } await client.query(`UPDATE materials SET title=$2, description=$3, subject=$4, unit_name=$5, grade_level=$6, material_type=$7, content_url=$8, thumbnail_url=$9, interactive_kind=$10, interactive_config=$11, is_published=$12, updated_at=now() WHERE id=$1`, [id, title, description, subject, unitName, gradeLevel, materialType, contentUrl, thumbnailUrl, interactiveKind, interactiveConfig, isPublished]); await client.query(`DELETE FROM material_class_targets WHERE material_id=$1`, [id]); for (const classId of classIds) await client.query(`INSERT INTO material_class_targets (material_id, class_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, classId]); await client.query("COMMIT"); res.json(await readMaterialById(client, id)); } catch (e) { await client.query("ROLLBACK"); console.error("[PUT /teacher/materials/:id]", e); res.status(500).json({ error: "server_error" }); } finally { client.release(); } });
app.delete("/teacher/materials/:id", requireAuth, requireRole("teacher"), async (req, res) => { try { await ensureMaterialsTables(); const d = await pool.query(`DELETE FROM materials WHERE id=$1 RETURNING id`, [String(req.params.id)]); if (d.rows.length === 0) return res.status(404).json({ error: "not_found" }); res.json({ ok: true, id: d.rows[0].id }); } catch (e) { console.error("[DELETE /teacher/materials/:id]", e); res.status(500).json({ error: "server_error" }); } });
app.get("/student/materials", requireAuth, async (req, res) => { try { const classId = req.user?.role === "student" ? req.user.classId ?? null : null; res.json(await listStudentMaterials(classId)); } catch (e) { console.error("[GET /student/materials]", e); res.status(500).json({ error: "server_error" }); } });
app.get("/student/materials/:id", requireAuth, async (req, res) => { try { const classId = req.user?.role === "student" ? req.user.classId ?? null : null; const rows = await listStudentMaterials(classId); const row = rows.find((x) => x.id === String(req.params.id)); if (!row) return res.status(404).json({ error: "not_found" }); res.json(row); } catch (e) { console.error("[GET /student/materials/:id]", e); res.status(500).json({ error: "server_error" }); } });

app.listen(port, () => {
  const uploadInfo = path.relative(__dirname, uploadsRoot) || uploadsRoot;
  console.log(`API running on port ${port}`);
  console.log(`Uploads root: ${uploadInfo}`);
  if (JWT_SECRET === "DEV_SECRET_CHANGE_ME") {
    console.warn("[warn] JWT_SECRET is using the development fallback. Set JWT_SECRET in .env before publishing.");
  }
});

/**
 * =========================
 * Calendar: Test Events (shared)
 * =========================
 * - teacher: create/delete, list all (optionally classId)
 * - student: list for own class + ALL
 *
 * GET  /calendar/tests
 *   teacher: ?classId=ALL|<class>（省略=ALL相当）
 *   student: クエリ無視（自分のclassId + ALL）
 *
 * POST /teacher/test-events
 *   body: { title: string, date: "YYYY-MM-DD", classIds: string[] }  ※ classIds には "ALL" 可
 *
 * DELETE /teacher/test-events/:id
 */

app.get("/calendar/tests", requireAuth, async (req, res) => {
  try {
    const role = req.user.role;

    if (role === "teacher") {
      const classId = String(req.query.classId ?? "ALL");

      // classId を指定した場合はそのクラス + ALL、ALLの場合は全て
      if (classId && classId !== "ALL") {
        const r = await pool.query(
          `
          SELECT
            e.id, e.title, e.event_date, e.created_at, e.created_by,
            array_agg(c.class_id ORDER BY c.class_id) AS class_ids
          FROM test_events e
          JOIN test_event_classes c ON c.event_id = e.id
          WHERE c.class_id = $1 OR c.class_id = 'ALL'
          GROUP BY e.id
          ORDER BY e.event_date ASC, e.created_at ASC
          `,
          [classId]
        );
        return res.json(r.rows);
      }

      const r = await pool.query(
        `
        SELECT
          e.id, e.title, e.event_date, e.created_at, e.created_by,
          array_agg(c.class_id ORDER BY c.class_id) AS class_ids
        FROM test_events e
        JOIN test_event_classes c ON c.event_id = e.id
        GROUP BY e.id
        ORDER BY e.event_date ASC, e.created_at ASC
        `
      );
      return res.json(r.rows);
    }

    // student
    const classId = req.user.classId ?? null;
    if (!classId) return res.json([]); // クラス未設定なら何も出さない

    const r = await pool.query(
      `
      SELECT
        e.id, e.title, e.event_date, e.created_at, e.created_by,
        array_agg(c.class_id ORDER BY c.class_id) AS class_ids
      FROM test_events e
      JOIN test_event_classes c ON c.event_id = e.id
      WHERE c.class_id = $1 OR c.class_id = 'ALL'
      GROUP BY e.id
      ORDER BY e.event_date ASC, e.created_at ASC
      `,
      [classId]
    );
    res.json(r.rows);
  } catch (e) {
    if (isSafeSchemaError(e)) {
      console.warn("[GET /calendar/tests] test event tables unavailable; empty fallback");
      return res.json([]);
    }
    console.error("[GET /calendar/tests]", e);
    res.status(500).json({ error: "server_error" });
  }
});

app.post("/teacher/test-events", requireAuth, requireRole("teacher"), async (req, res) => {
  const title = String(req.body?.title ?? "").trim();
  const date = String(req.body?.date ?? "").trim(); // YYYY-MM-DD
  const classIds = Array.isArray(req.body?.classIds) ? req.body.classIds.map(String) : [];

  if (!title) return res.status(400).json({ error: "missing_title" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "invalid_date" });
  if (classIds.length === 0) return res.status(400).json({ error: "missing_classIds" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const id = newId("test");
    await client.query(
      `INSERT INTO test_events (id, title, event_date, created_by) VALUES ($1,$2,$3,$4)`,
      [id, title, date, req.user.uid]
    );

    for (const cid of classIds) {
      await client.query(
        `INSERT INTO test_event_classes (event_id, class_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [id, cid]
      );
    }

    await client.query("COMMIT");
    res.json({ ok: true, id });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[POST /teacher/test-events]", e);
    res.status(500).json({ error: "server_error" });
  } finally {
    client.release();
  }
});

app.delete("/teacher/test-events/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    const id = String(req.params.id);
    const d = await pool.query(`DELETE FROM test_events WHERE id=$1 RETURNING id`, [id]);
    if (d.rows.length === 0) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, id: d.rows[0].id });
  } catch (e) {
    console.error("[DELETE /teacher/test-events/:id]", e);
    res.status(500).json({ error: "server_error" });
  }
});
