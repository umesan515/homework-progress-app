import { parseJwtUser, type JwtUser } from "./jwt";
import { detectRoleFromPath } from "./role-detect";
import {
  LEGACY_TOKEN_KEY,
  TOKEN_KEY_ADMIN,
  TOKEN_KEY_STUDENT,
  TOKEN_KEY_TEACHER,
  type Role,
  getStoredToken,
  removeStoredToken,
  roleKey,
  setStoredToken,
} from "./token-storage";

function isTeacherLike(role: string | undefined) {
  return role === "teacher" || role === "admin";
}

function normalizeTeacherPageUser(user: JwtUser | null): JwtUser | null {
  if (!user) return null;
  if (user.role === "admin") {
    return { ...user, role: "teacher" };
  }
  return user;
}

function getLegacyTokenForRole(role: Role) {
  const legacy = getStoredToken(LEGACY_TOKEN_KEY);
  if (!legacy) return null;

  const parsed = parseJwtUser(legacy);
  if (!parsed) return null;

  if (role === "teacher") {
    return isTeacherLike(parsed.role) ? legacy : null;
  }
  return parsed.role === role ? legacy : null;
}

function firstValidToken(keys: string[], accept: (user: JwtUser) => boolean): string | null {
  for (const key of keys) {
    const token = getStoredToken(key);
    if (!token) continue;
    const user = parseJwtUser(token);
    if (user && accept(user)) return token;
  }
  return null;
}

export const getTokenForRole = (role: Role) => {
  if (typeof window === "undefined") return null;

  if (role === "teacher") {
    return (
      firstValidToken([TOKEN_KEY_TEACHER, TOKEN_KEY_ADMIN, LEGACY_TOKEN_KEY], (user) => isTeacherLike(user.role)) ??
      getLegacyTokenForRole("teacher")
    );
  }

  if (role === "admin") {
    return (
      firstValidToken([TOKEN_KEY_ADMIN, LEGACY_TOKEN_KEY], (user) => user.role === "admin") ??
      getLegacyTokenForRole("admin")
    );
  }

  return (
    firstValidToken([TOKEN_KEY_STUDENT, LEGACY_TOKEN_KEY], (user) => user.role === "student") ??
    getLegacyTokenForRole("student")
  );
};

export const getUserFromRoleToken = (role: Role): JwtUser | null => {
  const token = getTokenForRole(role);
  const user = token ? parseJwtUser(token) : null;
  if (role === "teacher") return normalizeTeacherPageUser(user);
  return user;
};

export const getToken = () => {
  if (typeof window === "undefined") return null;
  const role = detectRoleFromPath();
  if (role === "teacher") return getTokenForRole("teacher");
  if (role === "admin") return getTokenForRole("admin") ?? getTokenForRole("teacher");
  if (role === "student") return getTokenForRole("student");
  return getStoredToken(LEGACY_TOKEN_KEY);
};

export const setTokenForRole = (role: Role, token: string) => {
  setStoredToken(roleKey(role), token);
  if (role === "admin") {
    setStoredToken(TOKEN_KEY_TEACHER, token);
  }
  setStoredToken(LEGACY_TOKEN_KEY, token);
};

export const setToken = (token: string) => {
  if (typeof window === "undefined") return;
  const role = detectRoleFromPath();
  if (role === "teacher") return setTokenForRole("teacher", token);
  if (role === "admin") return setTokenForRole("admin", token);
  if (role === "student") return setTokenForRole("student", token);
  setStoredToken(LEGACY_TOKEN_KEY, token);
};

export const logout = (role?: Role) => {
  if (typeof window === "undefined") return;

  if (role === "admin") {
    removeStoredToken(TOKEN_KEY_ADMIN);
    removeStoredToken(TOKEN_KEY_TEACHER);
    removeStoredToken(LEGACY_TOKEN_KEY);
    return;
  }

  if (role === "teacher") {
    removeStoredToken(TOKEN_KEY_TEACHER);
    removeStoredToken(TOKEN_KEY_ADMIN);
    removeStoredToken(LEGACY_TOKEN_KEY);
    return;
  }

  if (role === "student") {
    removeStoredToken(TOKEN_KEY_STUDENT);
    removeStoredToken(LEGACY_TOKEN_KEY);
    return;
  }

  removeStoredToken(TOKEN_KEY_TEACHER);
  removeStoredToken(TOKEN_KEY_STUDENT);
  removeStoredToken(TOKEN_KEY_ADMIN);
  removeStoredToken(LEGACY_TOKEN_KEY);
};

export const getUserFromToken = (): JwtUser | null => {
  const token = getToken();
  if (!token) return null;

  const user = parseJwtUser(token);
  if (!user) return null;

  const role = detectRoleFromPath();
  if (role === "teacher") return normalizeTeacherPageUser(user);
  return user;
};

export type { Role } from "./token-storage";
export type { JwtUser } from "./jwt";
export { detectRoleFromPath } from "./role-detect";
export { LEGACY_TOKEN_KEY, TOKEN_KEY_ADMIN, TOKEN_KEY_STUDENT, TOKEN_KEY_TEACHER, roleKey } from "./token-storage";
export { parseJwtUser } from "./jwt";
