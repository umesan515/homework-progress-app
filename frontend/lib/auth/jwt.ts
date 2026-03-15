import type { Role } from "./token-storage";

export type JwtUser = {
  uid: string;
  role: Role;
  classId?: string | null;
  exp?: number;
};

const base64UrlToJson = (b64url: string) => {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const str = atob(b64 + pad);
  return JSON.parse(str);
};

export function parseJwtUser(token: string): JwtUser | null {
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

    return { uid, role: role as Role, classId, exp };
  } catch {
    return null;
  }
}
