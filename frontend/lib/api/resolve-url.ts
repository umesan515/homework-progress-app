export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api";

export function resolveUrl(path: string): string {
  const safePath = path.startsWith("/") ? path : `/${path}`;
  const base = API_BASE.trim();

  if (!base) {
    return safePath;
  }

  if (base.startsWith("http://") || base.startsWith("https://")) {
    return `${base}${safePath}`;
  }

  const normBase = base.startsWith("/") ? base : `/${base}`;
  const normalizedBase = normBase.endsWith("/") ? normBase.slice(0, -1) || "/" : normBase;

  if (normalizedBase === "/") {
    return safePath;
  }

  return `${normalizedBase}${safePath}`;
}
