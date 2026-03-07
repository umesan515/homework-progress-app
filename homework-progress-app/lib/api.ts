import { getToken, logout } from "./auth";

// NEXT_PUBLIC_API_BASE should be defined in .env.local / deployment environment.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

function resolveUrl(path: string) {
  const base = API_BASE.trim();
  if (base.startsWith("http://") || base.startsWith("https://")) {
    return `${base}${path}`;
  }
  const normBase = base.startsWith("/") ? base : `/${base}`;
  return `${normBase}${path}`;
}

function authHeaders() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function readBodyText(res: Response) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

async function handle(res: Response, meta: { method: string; url: string }) {
  if (res.status === 401) {
    logout();
    throw new Error(`API 401: ${meta.method} ${meta.url}`);
  }

  if (!res.ok) {
    const bodyText = await readBodyText(res);
    const clipped = bodyText.length > 800 ? `${bodyText.slice(0, 800)}...` : bodyText;
    throw new Error(
      `API ${res.status}: ${meta.method} ${meta.url}
` +
        (clipped ? `--- response ---
${clipped}` : "")
    );
  }

  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return res.json();
  const txt = await readBodyText(res);
  return txt as any;
}

export async function apiGet<T>(path: string): Promise<T> {
  const url = resolveUrl(path);
  const res = await fetch(url, {
    cache: "no-store",
    headers: { ...authHeaders() },
  });
  return handle(res, { method: "GET", url });
}

export async function apiPost<T>(path: string, body: any): Promise<T> {
  const url = resolveUrl(path);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  return handle(res, { method: "POST", url });
}

export async function apiPostForm<T>(path: string, body: FormData): Promise<T> {
  const url = resolveUrl(path);
  const res = await fetch(url, {
    method: "POST",
    headers: { ...authHeaders() },
    body,
  });
  return handle(res, { method: "POST", url });
}

export async function apiPut<T>(path: string, body: any): Promise<T> {
  const url = resolveUrl(path);
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  return handle(res, { method: "PUT", url });
}

export async function apiDelete<T>(path: string): Promise<T> {
  const url = resolveUrl(path);
  const res = await fetch(url, {
    method: "DELETE",
    headers: { ...authHeaders() },
  });
  return handle(res, { method: "DELETE", url });
}
