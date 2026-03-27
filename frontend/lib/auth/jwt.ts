import type { Role } from "./token-storage";

export type AppRole = Role;

export type JwtUser = {
  uid: string;
  role: AppRole;
  classId?: string | null;
  exp?: number;
};

const base64UrlToJson = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = `${normalized}${"=".repeat((4 - (normalized.length % 4)) % 4)}`;
  return JSON.parse(atob(padded));
};

export function parseJwtUser(token: string): JwtUser | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;

  try {
    const payload = base64UrlToJson(parts[1]);
    const uid = String(payload.uid ?? "");
    const role = String(payload.role ?? "");
    const classId = payload.classId != null ? String(payload.classId) : null;
    const exp = typeof payload.exp === "number" ? payload.exp : undefined;

    if (!uid) return null;
    if (role !== "teacher" && role !== "student" && role !== "admin") return null;
    if (exp && exp * 1000 < Date.now()) return null;

    return { uid, role: role as AppRole, classId, exp };
  } catch {
    return null;
  }
}
