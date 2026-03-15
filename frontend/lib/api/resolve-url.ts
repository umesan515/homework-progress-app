export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

export function resolveUrl(path: string) {
  const base = API_BASE.trim();

  if (base.startsWith("http://") || base.startsWith("https://")) {
    return `${base}${path}`;
  }

  const normBase = base.startsWith("/") ? base : `/${base}`;
  return `${normBase}${path}`;
}
