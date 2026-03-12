// lib/auth.ts
export type JwtUser = {
  uid: string;
  role: "student" | "teacher";
  classId?: string | null;
  exp?: number;
};

// 旧キー（互換用）
const LEGACY_TOKEN_KEY = "hw_token";
// 新キー（ロール別）
const TOKEN_KEY_TEACHER = "hw_token_teacher";
const TOKEN_KEY_STUDENT = "hw_token_student";

const base64UrlToJson = (b64url: string) => {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const str = atob(b64 + pad);
  return JSON.parse(str);
};

function parseJwtUser(token: string): JwtUser | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;

  try {
    const p = base64UrlToJson(parts[1]);
    const uid = String(p.uid ?? "");
    const role = String(p.role ?? "");
    const classId = p.classId != null ? String(p.classId) : null;
    const exp = typeof p.exp === "number" ? p.exp : undefined;

    if (!uid || (role !== "student" && role !== "teacher")) return null;
    if (exp && exp * 1000 < Date.now()) return null;

    return { uid, role: role as any, classId, exp };
  } catch {
    return null;
  }
}

function getLegacyTokenForRole(role: "teacher" | "student") {
  if (typeof window === "undefined") return null;
  const legacy = window.localStorage.getItem(LEGACY_TOKEN_KEY);
  if (!legacy) return null;
  const parsed = parseJwtUser(legacy);
  return parsed?.role === role ? legacy : null;
}

function roleKey(role: "teacher" | "student") {
  return role === "teacher" ? TOKEN_KEY_TEACHER : TOKEN_KEY_STUDENT;
}

/**
 * 現在のパスから「どのロール用トークンを使うか」を決める。
 * - /teacher 配下 → teacher token
 * - /student 配下 → student token
 * - それ以外 → legacy fallback
 */
function detectRoleFromPath(): "teacher" | "student" | null {
  if (typeof window === "undefined") return null;
  const p = window.location.pathname || "";
  if (p.startsWith("/teacher")) return "teacher";
  if (p.startsWith("/student")) return "student";
  return null;
}

export const getTokenForRole = (role: "teacher" | "student") => {
  if (typeof window === "undefined") return null;
  const t = window.localStorage.getItem(roleKey(role));
  if (t) return t;
  // 互換：旧キーしか無い場合でも、ロールが一致する時だけ救済する
  return getLegacyTokenForRole(role);
};

export const getUserFromRoleToken = (role: "teacher" | "student"): JwtUser | null => {
  const token = getTokenForRole(role);
  return token ? parseJwtUser(token) : null;
};

/**
 * api.ts など既存コード互換のための getToken()
 * パスに応じて teacher / student のトークンを返す
 */
export const getToken = () => {
  if (typeof window === "undefined") return null;
  const role = detectRoleFromPath();
  if (role === "teacher") return getTokenForRole("teacher");
  if (role === "student") return getTokenForRole("student");
  // /login や / などは legacy fallback
  return window.localStorage.getItem(LEGACY_TOKEN_KEY);
};

export const setTokenForRole = (role: "teacher" | "student", token: string) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(roleKey(role), token);

  // 互換：旧キーも一応入れておく（ただし getToken() は role-key を優先）
  // これにより既存ページが legacy を読んでも動く可能性を残す。
  window.localStorage.setItem(LEGACY_TOKEN_KEY, token);
};

// 既存互換（role を指定しない setToken）
export const setToken = (token: string) => {
  if (typeof window === "undefined") return;
  const role = detectRoleFromPath();
  if (role === "teacher") return setTokenForRole("teacher", token);
  if (role === "student") return setTokenForRole("student", token);
  window.localStorage.setItem(LEGACY_TOKEN_KEY, token);
};

export const logout = (role?: "teacher" | "student") => {
  if (typeof window === "undefined") return;

  if (role) {
    window.localStorage.removeItem(roleKey(role));
    // legacy は残すと混乱するので、開発時は一緒に消す
    window.localStorage.removeItem(LEGACY_TOKEN_KEY);
    return;
  }

  // role未指定なら全部消す
  window.localStorage.removeItem(TOKEN_KEY_TEACHER);
  window.localStorage.removeItem(TOKEN_KEY_STUDENT);
  window.localStorage.removeItem(LEGACY_TOKEN_KEY);
};


export const getUserFromToken = (): JwtUser | null => {
  const t = getToken();
  if (!t) return null;
  return parseJwtUser(t);
};
