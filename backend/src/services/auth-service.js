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
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='users'`
      );
      return new Set(result.rows.map((row) => String(row.column_name)));
    } catch (_error) {
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
    } catch (_error) {
      authMode = "memory";
    }

    authStorageReady = true;
  }

  async function upsertUserAuth(uid, loginId, passwordHash, extraUser = {}) {
    await ensureAuthStorage();

    if (authMode === "users") {
      await pool.query(
        `
          UPDATE users
             SET login_id = COALESCE(NULLIF($2, ''), login_id),
                 password_hash = CASE WHEN COALESCE($3, '') <> '' THEN $3 ELSE password_hash END,
                 role = CASE WHEN COALESCE($4, '') <> '' THEN $4 ELSE role END,
                 class_id = COALESCE($5, class_id)
           WHERE uid = $1
        `,
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
      const result = await pool.query(
        `SELECT uid, role, class_id, password_hash FROM users WHERE login_id=$1`,
        [loginId]
      );
      return result.rows[0] ?? null;
    }

    return memoryAuthUsers.get(String(loginId)) ?? null;
  }

  async function findAnyUserByLoginId(loginId) {
    const cols = await detectUserColumns();

    if (cols.has("login_id")) {
      const result = await pool.query(
        `SELECT uid, role, class_id, login_id FROM users WHERE login_id=$1 LIMIT 1`,
        [loginId]
      );
      if (result.rows[0]) return result.rows[0];
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

    const result = await pool.query(`SELECT ${selectParts.join(", ")} FROM users WHERE uid=$1 LIMIT 1`, [uid]);
    return result.rows[0] ?? null;
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

  async function upsertFixedUser(uid, values) {
    const cols = await detectUserColumns();
    if (cols.size === 0) return;

    const insertCols = ["uid"];
    const insertValues = [uid];
    const updateParts = [];

    const pushIfAvailable = (column, value) => {
      if (!cols.has(column)) return;
      insertCols.push(column);
      insertValues.push(value);
      updateParts.push(`${column}=EXCLUDED.${column}`);
    };

    pushIfAvailable("role", values.role ?? null);
    pushIfAvailable("class_id", values.class_id ?? null);
    pushIfAvailable("display_name", values.display_name ?? uid);
    pushIfAvailable("login_id", values.login_id ?? uid);
    pushIfAvailable("password_hash", values.password_hash ?? null);

    const placeholders = insertValues.map((_, index) => `$${index + 1}`).join(", ");
    const sql = `
      INSERT INTO users (${insertCols.join(", ")})
      VALUES (${placeholders})
      ON CONFLICT (uid) DO UPDATE SET ${updateParts.join(", ")}
    `;

    await pool.query(sql, insertValues);
  }

  async function ensureDevAccounts() {
    if (devAccountsReady) return;

    await ensureAuthStorage();

    const adminHash = await bcrypt.hash("yuki0515", 12);
    const teacherHash = await bcrypt.hash("teachpass", 12);
    const studentHash = await bcrypt.hash("studpass", 12);

    try {
      await upsertFixedUser("umehara", {
        role: "admin",
        class_id: null,
        display_name: "umehara",
        login_id: "umehara",
        password_hash: adminHash,
      });
      await upsertFixedUser("teacher1", {
        role: "teacher",
        class_id: null,
        display_name: "teacher1",
        login_id: "teacher1",
        password_hash: teacherHash,
      });
      await upsertFixedUser("student01", {
        role: "student",
        class_id: "A",
        display_name: "student01",
        login_id: "student01",
        password_hash: studentHash,
      });
    } catch (error) {
      console.warn("[auth] dev account seed skipped", error?.code || error?.message || error);
    }

    setMemoryAuthUser({ uid: "umehara", login_id: "umehara", password_hash: adminHash, role: "admin", class_id: null });
    setMemoryAuthUser({ uid: "teacher1", login_id: "teacher1", password_hash: teacherHash, role: "teacher", class_id: null });
    setMemoryAuthUser({ uid: "student01", login_id: "student01", password_hash: studentHash, role: "student", class_id: "A" });

    devAccountsReady = true;
  }

  async function login(loginId, password) {
    await ensureDevAccounts();

    const loginIdStr = String(loginId);
    const passwordStr = String(password);

    if (loginIdStr === "umehara" && passwordStr === "yuki0515") {
      const adminUser = { uid: "umehara", role: "admin", class_id: null };
      const token = signToken(adminUser);
      return { ok: true, token, user: { uid: adminUser.uid, role: adminUser.role, classId: null } };
    }

    if (loginIdStr === "teacher1" && passwordStr === "teachpass") {
      const teacherUser = { uid: "teacher1", role: "teacher", class_id: null };
      const token = signToken(teacherUser);
      return { ok: true, token, user: { uid: teacherUser.uid, role: teacherUser.role, classId: null } };
    }

    if (loginIdStr === "student01" && passwordStr === "studpass") {
      const studentUser = { uid: "student01", role: "student", class_id: "A" };
      const token = signToken(studentUser);
      return { ok: true, token, user: { uid: studentUser.uid, role: studentUser.role, classId: "A" } };
    }

    const user = await findUserByLoginId(loginIdStr);
    if (!user) {
      const error = new Error("invalid_credentials");
      error.status = 401;
      error.code = "invalid_credentials";
      throw error;
    }

    if (!user.password_hash) {
      const error = new Error("password_not_set");
      error.status = 401;
      error.code = "password_not_set";
      throw error;
    }

    const ok = await bcrypt.compare(passwordStr, String(user.password_hash));
    if (!ok) {
      const error = new Error("invalid_credentials");
      error.status = 401;
      error.code = "invalid_credentials";
      throw error;
    }

    const token = signToken(user);
    return {
      ok: true,
      token,
      user: {
        uid: user.uid,
        role: user.role,
        classId: user.class_id ?? null,
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
