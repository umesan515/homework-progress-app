function createAuthService({ pool, bcrypt, jwt, jwtSecret, jwtExpiresIn }) {
  let devAccountsReady = false;
  let authStorageReady = false;
  let authMode = "memory";
  const memoryAuthUsers = new Map();

  function signToken(user) {
    return jwt.sign(
      {
        uid: user.uid,
        role: user.role,
        classId: user.class_id ?? null,
      },
      jwtSecret,
      { expiresIn: jwtExpiresIn }
    );
  }

  async function detectUserColumns() {
    try {
      const r = await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='users'`
      );
      return new Set(r.rows.map((row) => String(row.column_name)));
    } catch (_e) {
      return new Set();
    }
  }

  function setMemoryAuthUser(user) {
    if (!user || !user.login_id || !user.password_hash) return;
    memoryAuthUsers.set(String(user.login_id), {
      uid: String(user.uid),
      role: String(user.role || "student"),
      class_id: user.class_id ?? null,
      password_hash: String(user.password_hash),
    });
  }

  function removeMemoryAuthUserByUid(uid) {
    const normalizedUid = String(uid || "");
    if (!normalizedUid) return;
    for (const [loginId, user] of memoryAuthUsers.entries()) {
      if (String(user?.uid || "") === normalizedUid) {
        memoryAuthUsers.delete(loginId);
      }
    }
  }

  async function ensureAuthStorage() {
    if (authStorageReady) return;
    try {
      const cols = await detectUserColumns();
      authMode = cols.has("login_id") && cols.has("password_hash") ? "users" : "memory";
    } catch (_e) {
      authMode = "memory";
    }
    authStorageReady = true;
  }

  async function upsertUserAuth(uid, loginId, passwordHash, extraUser = {}) {
    await ensureAuthStorage();
    if (authMode === "users") {
      await pool.query(
        `UPDATE users SET
          login_id = CASE WHEN $2 <> '' THEN $2 ELSE login_id END,
          password_hash = CASE WHEN $3 <> '' THEN $3 ELSE password_hash END,
          role = COALESCE($4, role),
          class_id = $5
        WHERE uid = $1`,
        [uid, loginId, passwordHash, extraUser.role ?? null, extraUser.class_id ?? null]
      );
      return;
    }

    setMemoryAuthUser({
      uid,
      login_id: loginId,
      password_hash: passwordHash,
      role: extraUser.role ?? "student",
      class_id: extraUser.class_id ?? null,
    });
  }

  async function findUserByLoginId(loginId) {
    await ensureAuthStorage();
    if (authMode === "users") {
      const r = await pool.query(
        `SELECT uid, role, class_id, password_hash FROM users WHERE login_id=$1`,
        [loginId]
      );
      return r.rows[0] ?? null;
    }
    return memoryAuthUsers.get(String(loginId)) ?? null;
  }

  async function findAnyUserByLoginId(loginId) {
    const cols = await detectUserColumns();
    if (cols.has("login_id")) {
      const r = await pool.query(
        `SELECT uid, role, class_id, login_id FROM users WHERE login_id=$1 LIMIT 1`,
        [loginId]
      );
      if (r.rows[0]) return r.rows[0];
    }

    const memoryUser = memoryAuthUsers.get(String(loginId));
    if (!memoryUser) return null;
    return {
      uid: memoryUser.uid,
      role: memoryUser.role,
      class_id: memoryUser.class_id ?? null,
      login_id: String(loginId),
    };
  }

  async function findUserByUid(uid) {
    const cols = await detectUserColumns();
    const selectParts = ["uid"];
    if (cols.has("role")) selectParts.push("role");
    if (cols.has("class_id")) selectParts.push("class_id");
    if (cols.has("display_name")) selectParts.push("display_name");
    if (cols.has("login_id")) selectParts.push("login_id");
    if (cols.has("password_hash")) selectParts.push("password_hash");
    const r = await pool.query(`SELECT ${selectParts.join(", ")} FROM users WHERE uid=$1 LIMIT 1`, [uid]);
    return r.rows[0] ?? null;
  }

  async function upsertStudentUser(uid, { classId, displayName, loginId, passwordHash }) {
    const cols = await detectUserColumns();
    const insertCols = ["uid"];
    const insertValues = [uid];
    const updateParts = [];

    if (cols.has("role")) {
      insertCols.push("role");
      insertValues.push("student");
      updateParts.push(`role='student'`);
    }
    if (cols.has("class_id")) {
      insertCols.push("class_id");
      insertValues.push(classId ?? null);
      updateParts.push(`class_id=EXCLUDED.class_id`);
    }
    if (cols.has("display_name")) {
      insertCols.push("display_name");
      insertValues.push(displayName ?? uid);
      updateParts.push(`display_name=EXCLUDED.display_name`);
    }
    if (cols.has("login_id")) {
      insertCols.push("login_id");
      insertValues.push(loginId ?? uid);
      updateParts.push(`login_id=EXCLUDED.login_id`);
    }
    if (cols.has("password_hash") && passwordHash) {
      insertCols.push("password_hash");
      insertValues.push(passwordHash);
      updateParts.push(`password_hash=EXCLUDED.password_hash`);
    }

    const placeholders = insertValues.map((_, idx) => `$${idx + 1}`).join(", ");
    const sql = `
      INSERT INTO users (${insertCols.join(", ")})
      VALUES (${placeholders})
      ON CONFLICT (uid) DO UPDATE SET ${updateParts.join(", ")}
    `;
    await pool.query(sql, insertValues);
  }

  async function updateStudentUser(uid, { classId, displayName, loginId, passwordHash }) {
    const cols = await detectUserColumns();
    const setParts = [];
    const params = [];

    if (cols.has("role")) {
      setParts.push(`role='student'`);
    }
    if (cols.has("class_id")) {
      params.push(classId ?? null);
      setParts.push(`class_id=$${params.length}`);
    }
    if (cols.has("display_name")) {
      params.push(displayName ?? uid);
      setParts.push(`display_name=$${params.length}`);
    }
    if (cols.has("login_id")) {
      params.push(loginId ?? uid);
      setParts.push(`login_id=$${params.length}`);
    }
    if (cols.has("password_hash") && passwordHash) {
      params.push(passwordHash);
      setParts.push(`password_hash=$${params.length}`);
    }
    if (setParts.length === 0) return;

    params.push(uid);
    await pool.query(`UPDATE users SET ${setParts.join(", ")} WHERE uid=$${params.length}`, params);
  }

  async function ensureAdminSeed(passwordHash) {
    try {
      await pool.query(
        `INSERT INTO users (uid, role, class_id, display_name, login_id, password_hash)
         VALUES ('umehara', 'admin', NULL, 'Umehara', 'umehara', $1)
         ON CONFLICT (uid) DO UPDATE SET
           role='admin',
           login_id='umehara',
           password_hash=$1,
           display_name=COALESCE(NULLIF(users.display_name, ''), 'Umehara')`,
        [passwordHash]
      );
    } catch (e) {
      console.warn("[auth] admin seed skipped", e?.code || e?.message || e);
    }

    await upsertUserAuth("umehara", "umehara", passwordHash, { role: "admin", class_id: null });
  }

  async function ensureDevAccounts() {
    if (devAccountsReady) return;

    await ensureAuthStorage();

    const teacherHash = await bcrypt.hash("teachpass", 12);
    const studentHash = await bcrypt.hash("studpass", 12);
    const adminHash = await bcrypt.hash("yuki0515", 12);

    try {
      await pool.query(`
        INSERT INTO users (uid, role, class_id, display_name, login_id, password_hash)
        VALUES
          ('teacher1', 'teacher', NULL, 'teacher1', 'teacher1', $1),
          ('student01', 'student', 'A', 'student01', 'student01', $2)
        ON CONFLICT (uid) DO UPDATE SET
          role = EXCLUDED.role,
          login_id = EXCLUDED.login_id,
          password_hash = EXCLUDED.password_hash,
          class_id = CASE
            WHEN users.class_id IS NULL OR users.class_id = '' THEN EXCLUDED.class_id
            ELSE users.class_id
          END,
          display_name = CASE
            WHEN users.display_name IS NULL OR users.display_name = '' THEN EXCLUDED.display_name
            ELSE users.display_name
          END
      `, [teacherHash, studentHash]);
    } catch (e) {
      console.warn("[auth] dev account seed skipped", e?.code || e?.message || e);
    }

    await upsertUserAuth("teacher1", "teacher1", teacherHash, { role: "teacher", class_id: null });
    await upsertUserAuth("student01", "student01", studentHash, { role: "student", class_id: "A" });
    await ensureAdminSeed(adminHash);
    devAccountsReady = true;
  }

  async function login(loginId, password) {
    await ensureDevAccounts();

    const loginIdStr = String(loginId).trim();
    const passwordStr = String(password);

    if (loginIdStr === "teacher1" && passwordStr === "teachpass") {
      const u = { uid: "teacher1", role: "teacher", class_id: null };
      const token = signToken(u);
      return { ok: true, token, user: { uid: u.uid, role: u.role, classId: null } };
    }
    if (loginIdStr === "student01" && passwordStr === "studpass") {
      const u = { uid: "student01", role: "student", class_id: "A" };
      const token = signToken(u);
      return { ok: true, token, user: { uid: u.uid, role: u.role, classId: "A" } };
    }
    if (loginIdStr === "umehara" && passwordStr === "yuki0515") {
      const u = { uid: "umehara", role: "admin", class_id: null };
      const token = signToken(u);
      return { ok: true, token, user: { uid: u.uid, role: u.role, classId: null } };
    }

    const u = await findUserByLoginId(loginIdStr);
    if (!u) {
      const err = new Error("invalid_credentials");
      err.status = 401;
      err.code = "invalid_credentials";
      throw err;
    }
    if (!u.password_hash) {
      const err = new Error("password_not_set");
      err.status = 401;
      err.code = "password_not_set";
      throw err;
    }

    const ok = await bcrypt.compare(passwordStr, String(u.password_hash));
    if (!ok) {
      const err = new Error("invalid_credentials");
      err.status = 401;
      err.code = "invalid_credentials";
      throw err;
    }

    const token = signToken(u);
    return {
      ok: true,
      token,
      user: {
        uid: u.uid,
        role: u.role,
        classId: u.class_id ?? null,
      },
    };
  }

  async function registerStudent({ loginId, password, classId, displayName }) {
    const hash = await bcrypt.hash(String(password), 12);
    const uid = String(loginId);

    await upsertStudentUser(uid, {
      classId: classId ?? null,
      displayName: displayName ?? null,
      loginId: String(loginId),
      passwordHash: hash,
    });

    await upsertUserAuth(uid, String(loginId), hash, {
      role: "student",
      class_id: classId ?? null,
    });

    return { ok: true, uid };
  }

  return {
    ensureDevAccounts,
    login,
    registerStudent,
    detectUserColumns,
    findUserByUid,
    findAnyUserByLoginId,
    upsertStudentUser,
    updateStudentUser,
    upsertUserAuth,
    removeMemoryAuthUserByUid,
  };
}

module.exports = { createAuthService };
