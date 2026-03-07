"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { API_BASE, apiGet } from "@/lib/api";
import { getUserFromToken, logout } from "@/lib/auth";

type BookRow = { id: string; name: string };

type ThreadRow = {
  id: string;
  title: string;
  status: "open" | "closed";
  class_id?: string | null;
  student_uid?: string | null;
  book_id?: string | null;
  block_id?: string | null;
  created_at: string;
  updated_at: string;
  last_message_at?: string | null;
  last_message_body?: string | null;
};

type ThreadsResponse = { threads: any[] };

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
    const id = (v as any)?.id ?? (v as any)?.threadId ?? (v as any)?.thread_id;
    if (typeof id === "string") return id;
  }
  return String(v);
}

function normalizeThreads(raw: any): ThreadRow[] {
  const arr = Array.isArray(raw?.threads) ? raw.threads : Array.isArray(raw) ? raw : [];
  return arr
    .map((t: any) => {
      const id = toStr(t?.id ?? t?.thread_id ?? t?.threadId);
      if (!id || id === "undefined" || id === "null") return null;
      const title = String(t?.title ?? t?.subject ?? "");
      const status: any = t?.status === "closed" ? "closed" : "open";
      return {
        id,
        title,
        status,
        class_id: t?.class_id ?? t?.classId ?? null,
        student_uid: t?.student_uid ?? t?.studentUid ?? null,
        book_id: t?.book_id ?? t?.bookId ?? null,
        block_id: t?.block_id ?? t?.blockId ?? null,
        created_at: String(t?.created_at ?? t?.createdAt ?? ""),
        updated_at: String(t?.updated_at ?? t?.updatedAt ?? ""),
        last_message_at: t?.last_message_at ?? t?.lastMessageAt ?? null,
        last_message_body: t?.last_message_body ?? t?.lastMessageBody ?? null,
      } as ThreadRow;
    })
    .filter(Boolean) as ThreadRow[];
}

function normalizeClasses(raw: any): { id: string; name: string }[] {
  const arr = raw?.classes;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x: any) => {
      if (typeof x === "string") return { id: x, name: x };
      const id = String(x?.id ?? x?.class_id ?? x?.classId ?? "");
      const name = String(x?.name ?? id);
      return { id, name };
    })
    .filter((x) => x.id);
}

function normalizeBooks(raw: any): BookRow[] {
  const arr = raw?.books;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((b: any) => {
      const id = String(b?.id ?? b?.book_id ?? b?.bookId ?? "");
      const name = String(b?.name ?? b?.title ?? id);
      return { id, name } as BookRow;
    })
    .filter((b) => b.id);
}

export default function TeacherQuestionsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<any | null>(null);

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [classId, setClassId] = useState<string>("");

  // ✅ デフォルト表示は「すべて」
  const [status, setStatus] = useState<"open" | "closed" | "all">("all");

  // 問題集（登録済みから選択）
  const [books, setBooks] = useState<BookRow[]>([]);
  const [bookId, setBookId] = useState<string>("");

  // blockId での絞り込み（章/問題一覧からの導線用・UIはチップ表示）
  const [blockId, setBlockId] = useState<string>("");

  // 生徒フィルタ（プルダウン）：APIに依存せず、取得済み一覧からユニーク抽出
  const [studentUid, setStudentUid] = useState<string>("");

  const [threads, setThreads] = useState<ThreadRow[]>([]);

  useEffect(() => {
    setMounted(true);
    const u = getUserFromToken();
    setUser(u);
    if (!u) {
      router.replace("/login");
      return;
    }
    if (u.role !== "teacher") {
      router.replace("/student");
      return;
    }

    // URL クエリからの初期絞り込み（例: /teacher/questions?blockId=...）
    const b = searchParams?.get("blockId") ?? "";
    if (b && b !== "undefined" && b !== "null") setBlockId(b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canLoad = useMemo(() => !!user && user.role === "teacher", [user]);

  const loadClasses = async () => {
    try {
      const r = await apiGet<any>("/teacher/classes");
      const list = normalizeClasses(r);
      setClasses(list);
    } catch {
      // classes が取れなくても質問一覧は見れるので握りつぶす
    }
  };

  const loadBooks = async () => {
    try {
      const r = await apiGet<any>("/teacher/books");
      setBooks(normalizeBooks(r));
    } catch {
      setBooks([]);
    }
  };

  const loadThreads = async () => {
    if (!canLoad) return;
    setBusy(true);
    setErr(null);
    try {
      const qs: string[] = [];
      if (classId.trim()) qs.push(`classId=${encodeURIComponent(classId.trim())}`);
      if (status !== "all") qs.push(`status=${encodeURIComponent(status)}`);
      if (bookId.trim()) qs.push(`bookId=${encodeURIComponent(bookId.trim())}`);
      if (blockId.trim()) qs.push(`blockId=${encodeURIComponent(blockId.trim())}`);
      const q = qs.length ? `?${qs.join("&")}` : "";
      const r = await apiGet<ThreadsResponse>(`/teacher/questions${q}`);
      setThreads(normalizeThreads(r));
    } catch (e: unknown) {
      const msg = String((e as { message?: unknown })?.message ?? "読み込みに失敗しました。");
      if (msg.includes("401")) {
        logout("teacher");
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
    loadClasses();
    loadBooks();
    loadThreads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canLoad]);

  useEffect(() => {
    if (!canLoad) return;
    loadThreads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, status, bookId, blockId]);

  const studentOptions = useMemo(() => {
    const s = new Set<string>();
    for (const t of threads) {
      const v = (t.student_uid ?? "").trim();
      if (v) s.add(v);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, "ja"));
  }, [threads]);

  const filteredThreads = useMemo(() => {
    const uid = studentUid.trim();
    if (!uid) return threads;
    return threads.filter((t) => (t.student_uid ?? "") === uid);
  }, [threads, studentUid]);

  const openThread = (id: string) => {
    router.push(`/teacher/questions/${encodeURIComponent(id)}`);
  };

  const deleteThreadFromList = async (id: string) => {
    const ok = window.confirm(
      "この質問スレッドを削除しますか？（開発用）\n※メッセージも含めて削除されます。\n※元に戻せません。"
    );
    if (!ok) return;
    setBusy(true);
    setErr(null);
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
      const res = await fetch(`${API_BASE}/teacher/questions/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        setErr(`削除に失敗しました: ${res.status} ${t}`);
        return;
      }
      setThreads((prev) => prev.filter((x) => x.id !== id));
    } catch (e: unknown) {
      setErr(String((e as any)?.message ?? "削除に失敗しました。"));
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
          <h1 className="text-2xl font-bold">質問（教師）</h1>
          <div className="text-sm text-gray-600">生徒からの質問を確認し、返信できます。</div>
        </div>
        <div className="flex gap-2">
          <button className="rounded-lg border px-3 py-2 hover:bg-gray-50 disabled:opacity-50" onClick={loadThreads} disabled={busy}>
            {busy ? "更新中..." : "更新"}
          </button>
          <Link className="rounded-lg border px-3 py-2 bg-white hover:bg-gray-50" href="/teacher">
            戻る
          </Link>
        </div>
      </div>

      {err && <div className="rounded-xl border bg-red-50 p-3 text-sm text-red-800">{err}</div>}

      <div className="rounded-xl border bg-gray-50 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm text-gray-700">クラス</div>
          <select className="rounded-lg border px-2 py-2" value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">（すべて）</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <div className="text-sm text-gray-700 ml-2">状態</div>
          <select className="rounded-lg border px-2 py-2" value={status} onChange={(e) => setStatus(e.target.value as any)}>
            <option value="all">すべて</option>
            <option value="open">未解決</option>
            <option value="closed">解決済み</option>
          </select>

          <div className="text-sm text-gray-700 ml-2">問題集</div>
          <select className="rounded-lg border px-2 py-2" value={bookId} onChange={(e) => setBookId(e.target.value)}>
            <option value="">（すべて）</option>
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>

          <div className="text-sm text-gray-700 ml-2">生徒</div>
          <select className="rounded-lg border px-2 py-2" value={studentUid} onChange={(e) => setStudentUid(e.target.value)}>
            <option value="">（すべて）</option>
            {studentOptions.map((uid) => (
              <option key={uid} value={uid}>
                {uid}
              </option>
            ))}
          </select>

          {blockId.trim() && (
            <div className="ml-2 flex items-center gap-2">
              <span className="rounded-full border bg-white px-2 py-0.5 text-xs text-gray-700">問題で絞り込み中</span>
              <button
                className="rounded-lg border px-2 py-2 bg-white hover:bg-gray-50"
                type="button"
                onClick={() => setBlockId("")}
                title="問題での絞り込みを解除"
              >
                解除
              </button>
            </div>
          )}
        </div>

        <div className="rounded-xl border bg-white">
          <table className="w-full text-sm table-fixed">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3">タイトル / 情報</th>
                <th className="text-left p-3 w-24">状態</th>
                <th className="text-left p-3 w-44">最終更新</th>
                <th className="text-left p-3 w-40">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredThreads.map((t) => (
                <tr
                  key={t.id}
                  className="border-t hover:bg-gray-50 cursor-pointer"
                  onClick={(e) => {
                    const el = e.target as HTMLElement | null;
                    if (el?.closest("a") || el?.closest("button")) return;
                    openThread(t.id);
                  }}
                >
                  <td className="p-3 align-top">
                    <Link
                      href={`/teacher/questions/${encodeURIComponent(t.id)}`}
                      className="block rounded-lg hover:bg-gray-50 -m-2 p-2"
                      aria-label={`質問を開く: ${t.title}`}
                    >
                      <div className="font-semibold underline decoration-gray-300 underline-offset-2 break-words">
                        {t.title}
                      </div>

                      <div className="mt-1 flex flex-wrap gap-1">
                        {t.class_id && (
                          <span className="rounded-full border bg-white px-2 py-0.5 text-xs text-gray-700">
                            クラス: {t.class_id}
                          </span>
                        )}
                        {t.student_uid && (
                          <span className="rounded-full border bg-white px-2 py-0.5 text-xs text-gray-700">
                            生徒: {t.student_uid}
                          </span>
                        )}
                        {t.book_id && (
                          <span className="rounded-full border bg-white px-2 py-0.5 text-xs text-gray-700">
                            問題集: {t.book_id}
                          </span>
                        )}
                        {t.block_id && (
                          <span className="rounded-full border bg-white px-2 py-0.5 text-xs text-gray-700">
                            問題: {t.block_id}
                          </span>
                        )}
                      </div>

                      {t.last_message_body && (
                        <div className="mt-1 text-xs text-gray-500 line-clamp-2 break-words">{t.last_message_body}</div>
                      )}
                      <div className="mt-1 text-xs text-gray-400">ID: {t.id}</div>
                    </Link>
                  </td>

                  <td className="p-3 align-top">
                    {t.status === "open" ? (
                      <span className="rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 text-xs">
                        未解決
                      </span>
                    ) : (
                      <span className="rounded-full bg-gray-100 text-gray-700 border px-2 py-0.5 text-xs">解決済み</span>
                    )}
                  </td>

                  <td className="p-3 align-top text-gray-700 whitespace-nowrap">{fmtDateTime(t.last_message_at || t.updated_at || t.created_at)}</td>

                  <td className="p-3 align-top">
                    <div className="flex flex-col gap-2">
                      <Link className="rounded-lg border px-3 py-2 bg-white hover:bg-gray-50 text-center" href={`/teacher/questions/${encodeURIComponent(t.id)}`}>
                        返信
                      </Link>
                      <button
                        className="rounded-lg border px-3 py-2 bg-white hover:bg-gray-50 disabled:opacity-50"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteThreadFromList(t.id);
                        }}
                        disabled={busy}
                        title="開発用：質問スレッドを削除"
                      >
                        削除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {!busy && filteredThreads.length === 0 && (
                <tr className="border-t">
                  <td className="p-3 text-gray-600" colSpan={4}>
                    該当する質問がありません。
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
