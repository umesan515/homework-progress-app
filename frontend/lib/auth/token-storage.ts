export const LEGACY_TOKEN_KEY = "hw_token";
export const TOKEN_KEY_TEACHER = "hw_token_teacher";
export const TOKEN_KEY_STUDENT = "hw_token_student";
export const TOKEN_KEY_ADMIN = "hw_token_admin";

export type Role = "teacher" | "student" | "admin";

export function roleKey(role: Role) {
  if (role === "teacher") return TOKEN_KEY_TEACHER;
  if (role === "student") return TOKEN_KEY_STUDENT;
  return TOKEN_KEY_ADMIN;
}

export function getStoredToken(key: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(key);
}

export function setStoredToken(key: string, value: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, value);
}

export function removeStoredToken(key: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key);
}
