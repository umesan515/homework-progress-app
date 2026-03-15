function createAuthService({ pool, bcrypt, jwt, jwtSecret, jwtExpiresIn }) {
  let devAccountsReady = false;
  let authStorageReady = false;
  let authMode = "memory";
  const memoryAuthUsers = new Map();

  function signToken(user) {
    return jwt.sign(
      { uid: user.uid, role: user.role, classId: user.class_id ?? null },
      jwtSecret,
      { expiresIn: jwtExpiresIn }
    );
  }

  async function detectUserColumns() {
    try {
      const r = await pool.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema='public' AND table_name='users'`
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
        `UPDATE users
         SET login_id = COALESCE(NULLIF(login_id, ''), $2),
             password_hash = COALESCE(NULLIF(password_hash, ''), $3)
         WHERE uid = $1`,
        [uid, loginId, passwordHash]
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
        `SELECT uid, role, class_id, password_hash
         FROM users
         WHERE login_id=$1`,
        [loginId]
      );
      return r.rows[0] ?? null;
    }

    return memoryAuthUsers.get(String(loginId)) ?? null;
  }

  async function ensureDevAccounts() {
    if (devAccountsReady) return;

    await ensureAuthStorage();

    const teacherHash = await bcrypt.hash("teachpass", 12);
    const studentHash = await bcrypt.hash("studpass", 12);

    try {
      await pool.query(
        `
        INSERT INTO users (uid, role, class_id, display_name)
        VALUES
          ('teacher1', 'teacher', NULL, 'teacher1'),
          ('student01', 'student', 'A', 'student01')
        ON CONFLICT (uid)
        DO UPDATE SET
          role = EXCLUDED.role,
          class_id = CASE
            WHEN users.class_id IS NULL OR users.class_id = '' THEN EXCLUDED.class_id
            ELSE users.class_id
          END,
          display_name = CASE
            WHEN users.display_name IS NULL OR users.display_name = '' THEN EXCLUDED.display_name
            ELSE users.display_name
          END
        `
      );
    } catch (e) {
      console.warn("[auth] dev account seed skipped", e?.code || e?.message || e);
    }

    await upsertUserAuth("teacher1", "teacher1", teacherHash, { role: "teacher", class_id: null });
    await upsertUserAuth("student01", "student01", studentHash, { role: "student", class_id: "A" });

    devAccountsReady = true;
  }

  async function login(loginId, password) {
    await ensureDevAccounts();

    const loginIdStr = String(loginId);
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
      user: { uid: u.uid, role: u.role, classId: u.class_id ?? null },
    };
  }

  async function registerStudent({ loginId, password, classId, displayName }) {
    const hash = await bcrypt.hash(String(password), 12);
    const uid = String(loginId);

    await pool.query(
      `
      INSERT INTO users (uid, role, class_id, display_name)
      VALUES ($1, 'student', $2, $3)
      ON CONFLICT (uid)
      DO UPDATE SET
        role='student',
        class_id=EXCLUDED.class_id,
        display_name=EXCLUDED.display_name
      `,
      [uid, classId ?? null, displayName ?? null]
    );

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
  };
}

module.exports = {
  createAuthService,
};
