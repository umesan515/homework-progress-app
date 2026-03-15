import { parseJwtUser, type JwtUser } from "./jwt";
import { detectRoleFromPath } from "./role-detect";
import {
  LEGACY_TOKEN_KEY,
  type Role,
  getStoredToken,
  removeStoredToken,
  roleKey,
  setStoredToken,
  TOKEN_KEY_STUDENT,
  TOKEN_KEY_TEACHER,
} from "./token-storage";

function getLegacyTokenForRole(role: Role) {
  const legacy = getStoredToken(LEGACY_TOKEN_KEY);
  if (!legacy) return null;

  const parsed = parseJwtUser(legacy);
  return parsed?.role === role ? legacy : null;
}

export const getTokenForRole = (role: Role) => {
  const token = getStoredToken(roleKey(role));
  if (token) return token;

  return getLegacyTokenForRole(role);
};

export const getUserFromRoleToken = (role: Role): JwtUser | null => {
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

  return getStoredToken(LEGACY_TOKEN_KEY);
};

export const setTokenForRole = (role: Role, token: string) => {
  setStoredToken(roleKey(role), token);
  // 互換：旧キーも一応入れておく（ただし getToken() は role-key を優先）
  // これにより既存ページが legacy を読んでも動く可能性を残す。
  setStoredToken(LEGACY_TOKEN_KEY, token);
};

// 既存互換（role を指定しない setToken）
export const setToken = (token: string) => {
  if (typeof window === "undefined") return;

  const role = detectRoleFromPath();
  if (role === "teacher") return setTokenForRole("teacher", token);
  if (role === "student") return setTokenForRole("student", token);

  setStoredToken(LEGACY_TOKEN_KEY, token);
};

export const logout = (role?: Role) => {
  if (typeof window === "undefined") return;

  if (role) {
    removeStoredToken(roleKey(role));
    // legacy は残すと混乱するので、開発時は一緒に消す
    removeStoredToken(LEGACY_TOKEN_KEY);
    return;
  }

  removeStoredToken(TOKEN_KEY_TEACHER);
  removeStoredToken(TOKEN_KEY_STUDENT);
  removeStoredToken(LEGACY_TOKEN_KEY);
};

export const getUserFromToken = (): JwtUser | null => {
  const token = getToken();
  if (!token) return null;
  return parseJwtUser(token);
};

export type { Role } from "./token-storage";
export type { JwtUser } from "./jwt";
export { detectRoleFromPath } from "./role-detect";
export {
  LEGACY_TOKEN_KEY,
  TOKEN_KEY_STUDENT,
  TOKEN_KEY_TEACHER,
  roleKey,
} from "./token-storage";
export { parseJwtUser } from "./jwt";
