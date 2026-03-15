import type { Role } from "./token-storage";

export function detectRoleFromPath(): Role | null {
  if (typeof window === "undefined") return null;

  const p = window.location.pathname || "";
  if (p.startsWith("/teacher")) return "teacher";
  if (p.startsWith("/student")) return "student";

  return null;
}
