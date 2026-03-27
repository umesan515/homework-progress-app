import type { Role } from "./token-storage";

export function detectRoleFromPath(): Role | null {
  if (typeof window === "undefined") return null;

  const pathname = window.location.pathname || "";
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/teacher")) return "teacher";
  if (pathname.startsWith("/student")) return "student";
  return null;
}
