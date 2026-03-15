import { logout } from "../auth";

export type ApiMeta = {
  method: string;
  url: string;
};

export async function readBodyText(res: Response) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

export async function handle<T>(res: Response, meta: ApiMeta): Promise<T> {
  if (res.status === 401) {
    logout();
    throw new Error(`API 401: ${meta.method} ${meta.url}`);
  }

  if (!res.ok) {
    const bodyText = await readBodyText(res);
    const clipped = bodyText.length > 800 ? `${bodyText.slice(0, 800)}...` : bodyText;

    throw new Error(
      `API ${res.status}: ${meta.method} ${meta.url}\n` +
        (clipped ? `--- response ---\n${clipped}` : ""),
    );
  }

  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return res.json() as Promise<T>;

  const txt = await readBodyText(res);
  return txt as T;
}
