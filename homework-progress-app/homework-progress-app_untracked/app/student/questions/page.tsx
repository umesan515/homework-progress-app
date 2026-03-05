"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { API_BASE, apiGet } from "@/lib/api";

import { getToken, getUserFromToken, logout } from "@/lib/auth";

type ThreadRow = {
  id: string;
  title: string;
  status: "open" | "closed";
  book_id?: string | null;
  chapter_id?: string | null;
  block_id?: string | null;
  class_id?: string | null;
  created_at: string;
  updated_at: string;
  last_message_at?: string | null;
};

type ThreadsResponse = { threads: any[] };

type CreateResponseAny = any;

function fmtDateTime(d: string | null | undefined) {
  if (!d) return "";
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return "";
  return t.toLocaleString("ja-JP");
}

function toStr(v: any): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "object") {
    const id = v.id ?? v.threadId ?? v.thread_id ?? v.threadID;
    if (typeof id === "string") return id;
  }
  return String(v);
}

function extractThreadId(r: CreateResponseAny): string {
  // 想定: { ok:true, threadId }
  const direct = r?.threadId ?? r?.thread_id ?? r?.id ?? r?.thread?.id ?? r?.thread?.threadId;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  // まれに {thread:{...}} だけ返る場合
  if (typeof r?.thread === "string" && r.thread.trim()) return r.thread.trim();
  return "";
}

function normalizeThreads(raw: any): ThreadRow[] {
  const arr = Array.isArray(raw?.threads) ? raw.threads : Array.isArray(raw) ? raw : [];
  return arr
    .map((t: any) => {
      const id = toStr(t?.id ?? t?.thread_id ?? t?.threadId);
      if (!id) return null;
      const title = String(t?.title ?? t?.subject ?? "");
      const status: any = t?.status === "closed" ? "closed" : "open";
      return {
        id,
        title,
        status,
        book_id: t?.book_id ?? t?.bookId ?? null,
        chapter_id: t?.chapter_id ?? t?.chapterId ?? null,
        block_id: t?.block_id ?? t?.blockId ?? null,
        class_id: t?.class_id ?? t?.classId ?? null,
        created_at: String(t?.created_at ?? t?.createdAt ?? ""),
        updated_at: String(t?.updated_at ?? t?.updatedAt ?? ""),
        last_message_at: t?.last_message_at ?? t?.lastMessageAt ?? null,
      } as ThreadRow;
    })
    .filter(Boolean) as ThreadRow[];
}

export default function StudentQuestionsPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<any | null>(null);

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [threads, setThreads] = useState<ThreadRow[]>([]);

  const [status, setStatus] = useState<"open" | "closed" | "all">("open");

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [bookId, setBookId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [blockId, setBlockId] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);

  useEffect(() => {
    setMounted(true);
    const u = getUserFromToken();
    setUser(u);
    if (!u) {
      router.replace("/login");
      return;
    }
    if (u.role !== "student") {
      router.replace("/teacher");
      return;
    }

    // A: 問題（block）から来た場合はクエリでプリセット
    const qBook = sp?.get("bookId") ?? "";
    const qChap = sp?.get("chapterId") ?? "";
    const qBlock = sp?.get("blockId") ?? "";
    const qTitle = sp?.get("title") ?? "";
    if (qBook) setBookId(qBook);
    if (qChap) setChapterId(qChap);
    if (qBlock) setBlockId(qBlock);
    if (qTitle && !title) setTitle(qTitle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canLoad = useMemo(() => !!user && user.role === "student", [user]);

  const load = async () => {
    if (!canLoad) return;
    setBusy(true);
    setErr(null);
    try {
      const q = status === "all" ? "" : `?status=${encodeURIComponent(status)}`;
      const r = await apiGet<ThreadsResponse>(`/student/questions${q}`);
      setThreads(normalizeThreads(r));
    } catch (e: unknown) {
      const msg = String((e as { message?: unknown })?.message ?? "読み込みに失敗しました。");
      if (msg.includes("401")) {
        logout("student");
        router.replace("/login");
        return;
      }
      setErr(msg);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!canLoad) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canLoad, status]);

  const createThread = async () => {
    if (!title.trim()) {
      setErr("タイトルを入力してください。");
      return;
    }
    if (!body.trim() && !imageFile) {
      setErr("本文または画像を入力してください。");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
fd.append("title", title.trim());
fd.append("body", (body ?? "").toString());
if (bookId.trim()) fd.append("bookId", bookId.trim());
if (chapterId.trim()) fd.append("chapterId", chapterId.trim());
if (blockId.trim()) fd.append("blockId", blockId.trim());
if (imageFile) fd.append("image", imageFile);

const url = `${API_BASE}/student/questions`;
const token = getToken();
const res = await fetch(url, {
  method: "POST",
  headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: fd,
});
const r = await (async () => {
  const ct = res.headers.get("content-type") ?? "";
  const txt = await res.text();
  if (!res.ok) throw new Error(`API ${res.status}: POST ${url}
--- response ---
${txt}`);
  if (ct.includes("application/json")) return JSON.parse(txt || "{}");
  return txt as any;
})();

      const tid = extractThreadId(r);
      if (!tid) {
        // ここで undefined に遷移すると /student/questions/undefined になるので防ぐ
        throw new Error("スレッドIDの取得に失敗しました（API応答を確認してください）。");
      }

      setTitle("");
      setBody("");
      setBookId("");
      setChapterId("");
      setBlockId("");
      setImageFile(null);

      router.push(`/student/questions/${encodeURIComponent(tid)}`);
    } catch (e: unknown) {
      const msg = String((e as { message?: unknown })?.message ?? "送信に失敗しました。");
      setErr(msg);
    } finally {
      setBusy(false);
    }
  };

  if (!mounted) return null;

  return (
    <div className="p-6 space-y-4">
      {/* 見出しは bg-gray-50 枠外 */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">質問</h1>
          <div className="text-sm text-gray-600">先生への質問を送信できます。</div>
        </div>
        <div className="flex gap-2">
          <Link className="rounded-lg border px-3 py-2 bg-white hover:bg-gray-50" href="/student">
            戻る
          </Link>
        </div>
      </div>

      {err && <div className="rounded-xl border bg-red-50 p-3 text-sm text-red-800">{err}</div>}

      <div className="rounded-xl border bg-gray-50 p-4 space-y-3">
        <div className="text-sm font-semibold text-gray-800">新規質問</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            className="rounded-lg border px-3 py-2"
            placeholder="タイトル（例：例題3の解き方）"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="grid grid-cols-3 gap-2">
            <input className="rounded-lg border px-3 py-2" placeholder="bookId（任意）" value={bookId} onChange={(e) => setBookId(e.target.value)} />
            <input
              className="rounded-lg border px-3 py-2"
              placeholder="chapterId（任意）"
              value={chapterId}
              onChange={(e) => setChapterId(e.target.value)}
            />
            <input className="rounded-lg border px-3 py-2" placeholder="blockId（任意）" value={blockId} onChange={(e) => setBlockId(e.target.value)} />
          </div>
        </div>
        <textarea
          className="rounded-lg border px-3 py-2 min-h-[120px]"
          placeholder="質問内容（どこまで分かったか／何が分からないか）"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
<div className="flex items-center gap-3">
  <input
    type="file"
    accept="image/*"
    onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
  />
  {imageFile && <div className="text-xs text-gray-600">画像: {imageFile.name}</div>}
  {imageFile && (
    <button
      type="button"
      className="text-xs text-gray-600 underline"
      onClick={() => setImageFile(null)}
    >
      画像を外す
    </button>
  )}
</div>
        <div className="flex justify-end">
          <button className="rounded-lg bg-emerald-600 text-white px-4 py-2 disabled:opacity-50" onClick={createThread} disabled={busy}>
            {busy ? "送信中..." : "送信"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border bg-gray-50 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm font-semibold text-gray-800">質問一覧</div>
          <div className="flex items-center gap-2">
            <select className="rounded-lg border px-2 py-2" value={status} onChange={(e) => setStatus(e.target.value as any)}>
              <option value="open">未解決</option>
              <option value="closed">解決済み</option>
              <option value="all">すべて</option>
            </select>
            <button className="rounded-lg border px-3 py-2 bg-white hover:bg-gray-50" onClick={load} disabled={busy}>
              {busy ? "更新中..." : "更新"}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="min-w-[780px] w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3">タイトル</th>
                <th className="text-left p-3 w-28">状態</th>
                <th className="text-left p-3 w-56">最終更新</th>
                <th className="text-left p-3 w-28">操作</th>
              </tr>
            </thead>
            <tbody>
              {threads.map((t) => (
                <tr key={t.id} className="border-t">
                  <td className="p-3">
                    <div className="font-semibold">{t.title}</div>
                    <div className="text-xs text-gray-500">ID: {t.id}</div>
                    {(t.book_id || t.block_id) && (
                      <div className="text-xs text-gray-500">
                        {t.book_id ? `book: ${t.book_id}` : ""}
                        {t.chapter_id ? ` / chapter: ${t.chapter_id}` : ""}
                        {t.block_id ? ` / block: ${t.block_id}` : ""}
                      </div>
                    )}
                  </td>
                  <td className="p-3">
                    {t.status === "open" ? (
                      <span className="rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 text-xs">未解決</span>
                    ) : (
                      <span className="rounded-full bg-gray-100 text-gray-700 border px-2 py-0.5 text-xs">解決済み</span>
                    )}
                  </td>
                  <td className="p-3 text-gray-700">{fmtDateTime(t.last_message_at || t.updated_at || t.created_at)}</td>
                  <td className="p-3">
                    <Link className="rounded-lg border px-3 py-2 bg-white hover:bg-gray-50" href={`/student/questions/${encodeURIComponent(t.id)}`}>
                      開く
                    </Link>
                  </td>
                </tr>
              ))}

              {!busy && threads.length === 0 && (
                <tr className="border-t">
                  <td className="p-3 text-gray-600" colSpan={4}>
                    質問がありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
