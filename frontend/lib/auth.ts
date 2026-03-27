// 既存 import 互換用エントリ
// admin ロールを「教師系ページでは teacher と同等」に扱い、
// 旧保存トークンや誤った保存キーが残っていても画面遷移できるようにする。

export * from "./auth/index";

import type { JwtUser } from "./auth/jwt";
import { parseJwtUser } from "./auth/jwt";
import {
  LEGACY_TOKEN_KEY,
  TOKEN_KEY_STUDENT,
  TOKEN_KEY_TEACHER,
  type Role,
  getStoredToken,
} from "./auth/token-storage";

function currentPathname(): string {
  if (typeof window === "undefined") return "";
  return window.location.pathname || "";
}

function detectEffectiveRoleFromPath(): Role | null {
  const p = currentPathname();
  if (p.startsWith("/student")) return "student";
  if (p.startsWith("/login")) return null;
  // /teacher 配下に加え、管理者ホームとして使っている / も教師系として扱う
  return "teacher";
}

function isTeacherCompatible(user: JwtUser | null): boolean {
  return !!user && (user.role === "teacher" || user.role === "admin");
}

function isStudentCompatible(user: JwtUser | null): boolean {
  return !!user && user.role === "student";
}

function readParsedToken(key: string): { token: string; user: JwtUser } | null {
  const token = getStoredToken(key);
  if (!token) return null;
  const user = parseJwtUser(token);
  if (!user) return null;
  return { token, user };
}

function firstAcceptedToken(keys: string[], accept: (user: JwtUser) => boolean): string | null {
  for (const key of keys) {
    const hit = readParsedToken(key);
    if (hit && accept(hit.user)) return hit.token;
  }
  return null;
}

function normalizeForTeacher(user: JwtUser | null): JwtUser | null {
  if (!user) return null;
  if (user.role === "admin") {
    return { ...user, role: "teacher" };
  }
  return user;
}

export const getTokenForRole = (role: Role): string | null => {
  if (typeof window === "undefined") return null;

  if (role === "teacher") {
    return firstAcceptedToken(
      [TOKEN_KEY_TEACHER, LEGACY_TOKEN_KEY, TOKEN_KEY_STUDENT],
      (user) => isTeacherCompatible(user),
    );
  }

  return firstAcceptedToken(
    [TOKEN_KEY_STUDENT, LEGACY_TOKEN_KEY, TOKEN_KEY_TEACHER],
    (user) => isStudentCompatible(user),
  );
};

export const getUserFromRoleToken = (role: Role): JwtUser | null => {
  const token = getTokenForRole(role);
  const user = token ? parseJwtUser(token) : null;
  return role === "teacher" ? normalizeForTeacher(user) : user;
};

export const getToken = (): string | null => {
  if (typeof window === "undefined") return null;
  const role = detectEffectiveRoleFromPath();
  if (role === "teacher") return getTokenForRole("teacher");
  if (role === "student") return getTokenForRole("student");
  return getStoredToken(LEGACY_TOKEN_KEY);
};

export const getUserFromToken = (): JwtUser | null => {
  const token = getToken();
  const user = token ? parseJwtUser(token) : null;
  const role = detectEffectiveRoleFromPath();
  if (role === "teacher") return normalizeForTeacher(user);
  return user;
};
