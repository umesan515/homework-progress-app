const path = require("path");
const fs = require("fs");

function createSchoolClassesService({ pool, isSafeSchemaError, storePath }) {
  let schoolClassesReady = false;
  let schoolClassesAvailable = null;
  const resolvedStorePath = storePath || path.join(process.cwd(), "data", "school_classes_fallback.json");

  function ensureParentDir(filePath) {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    } catch (_e) {}
  }

  function sortClassIds(classIds) {
    return Array.from(new Set((classIds || []).map((v) => String(v || "").trim()).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, "ja", { numeric: true, sensitivity: "base" })
    );
  }

  function readSchoolClassesStore() {
    try {
      const raw = fs.readFileSync(resolvedStorePath, "utf8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return sortClassIds(parsed);
    } catch (_e) {
      return [];
    }
  }

  function writeSchoolClassesStore(classIds) {
    const normalized = sortClassIds(classIds);
    ensureParentDir(resolvedStorePath);
    fs.writeFileSync(resolvedStorePath, JSON.stringify(normalized, null, 2), "utf8");
  }

  function addSchoolClassToStore(classId) {
    const normalized = String(classId || "").trim();
    if (!normalized) return;
    const current = readSchoolClassesStore();
    if (current.includes(normalized)) return;
    current.push(normalized);
    writeSchoolClassesStore(current);
  }

  function removeSchoolClassFromStore(classId) {
    const normalized = String(classId || "").trim();
    if (!normalized) return;
    writeSchoolClassesStore(readSchoolClassesStore().filter((v) => v !== normalized));
  }

  async function ensureSchoolClassesTable() {
    if (schoolClassesReady) return true;
    if (schoolClassesAvailable === false) return false;
    try {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS school_classes (
          class_id text PRIMARY KEY,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )`
      );
      schoolClassesReady = true;
      schoolClassesAvailable = true;
      return true;
    } catch (e) {
      if (isSafeSchemaError(e)) {
        schoolClassesAvailable = false;
        console.warn("[school_classes] unavailable, using file fallback", e?.code || e?.message || e);
        return false;
      }
      throw e;
    }
  }

  async function upsertSchoolClass(classId) {
    const normalized = String(classId ?? "").trim();
    if (!normalized) return false;
    addSchoolClassToStore(normalized);
    const available = await ensureSchoolClassesTable();
    if (!available) return false;
    await pool.query(
      `INSERT INTO school_classes (class_id, updated_at)
       VALUES ($1, now())
       ON CONFLICT (class_id)
       DO UPDATE SET updated_at = now()`,
      [normalized]
    );
    return true;
  }

  return {
    readSchoolClassesStore,
    writeSchoolClassesStore,
    removeSchoolClassFromStore,
    ensureSchoolClassesTable,
    upsertSchoolClass,
  };
}

module.exports = { createSchoolClassesService };
