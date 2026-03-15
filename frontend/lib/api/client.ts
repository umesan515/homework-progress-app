import { authHeaders } from "./auth-headers";
import { handle } from "./handle";
import { resolveUrl } from "./resolve-url";

export async function apiGet<T>(path: string): Promise<T> {
  const url = resolveUrl(path);
  const res = await fetch(url, {
    cache: "no-store",
    headers: { ...authHeaders() },
  });

  return handle<T>(res, { method: "GET", url });
}

export async function apiPost<T>(path: string, body: any): Promise<T> {
  const url = resolveUrl(path);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });

  return handle<T>(res, { method: "POST", url });
}

export async function apiPostForm<T>(path: string, body: FormData): Promise<T> {
  const url = resolveUrl(path);
  const res = await fetch(url, {
    method: "POST",
    headers: { ...authHeaders() },
    body,
  });

  return handle<T>(res, { method: "POST", url });
}

export async function apiPut<T>(path: string, body: any): Promise<T> {
  const url = resolveUrl(path);
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });

  return handle<T>(res, { method: "PUT", url });
}

export async function apiDelete<T>(path: string): Promise<T> {
  const url = resolveUrl(path);
  const res = await fetch(url, {
    method: "DELETE",
    headers: { ...authHeaders() },
  });

  return handle<T>(res, { method: "DELETE", url });
}
