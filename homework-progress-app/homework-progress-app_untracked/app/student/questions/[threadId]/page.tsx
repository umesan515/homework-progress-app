"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { API_BASE, apiGet, apiPut } from "@/lib/api";
import { getToken, getUserFromToken, logout } from "@/lib/auth";

type Thread = {
  id: string;
  title: string;
  status: "open" | "closed";
  book_id?: string | null;
  chapter_id?: string | null;
  block_id?: string | null;
  class_id?: string | null;
  student_uid: string;
  created_at: string;
  updated_at: string;
};

type Msg = {
  id: string;
  thread_id: string;
  sender_role: "student" | "teacher";
  sender_uid?: string | null;
  body: string;
  image_path?: string | null;
  image_mime?: string | null;
  image_size?: number | null;
  created_at: string;
};

type DetailResponse = { thread: Thread; messages: Msg[] };

function fmtDateTime(d: string | null | undefined) {
  if (!d) return "";
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return "";
  return t.toLocaleString("ja-JP");
}

function isBadThreadId(id: string) {
  const v = String(id ?? "").trim();
  return !v || v === "undefined" || v === "null";
}

export default function StudentQuestionThreadPage(props: { params?: { threadId?: string } }) {
  const router = useRouter();
  const routeParams = useParams() as { threadId?: string };

  // Nextのバージョン差や遷移状況で props.params が取れないことがあるため useParams 優先
  const threadIdRaw = (routeParams?.threadId ?? props?.params?.threadId ?? "") as string;
  const threadId = decodeURIComponent(String(threadIdRaw ?? ""));
  const badId = isBadThreadId(threadId);

  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<any | null>(null);

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);

  const [body, setBody] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canLoad = useMemo(() => !!user && user.role === "student", [user]);

  const load = async () => {
    if (!canLoad) return;
    if (badId) {
      setErr(`スレッドIDが不正です（${threadId || "undefined"}）。一覧から開き直してください。`);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await apiGet<DetailResponse>(`/student/questions/${encodeURIComponent(threadId)}`);
      setThread(r.thread);
      setMessages(Array.isArray(r.messages) ? r.messages : []);
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
  }, [canLoad, threadId]);

  const send = async () => {
    const bodyText = (body ?? "").trim();
    const hasImage = !!imageFile;
    if (!bodyText && !hasImage) return;

    if (badId) {
      setErr(`スレッドIDが不正です（${threadId || "undefined"}）。一覧から開き直してください。`);
      return;
    }

    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("body", bodyText); // 空でもOK（画像のみ対応）
      if (imageFile) fd.append("image", imageFile);

      const url = `${API_BASE}/student/questions/${encodeURIComponent(threadId)}/messages`;
      const token = getToken();
      const res = await fetch(url, {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: fd,
      });

      const txt = await res.text();
      if (!res.ok) {
        throw new Error(`API ${res.status}: POST ${url}\n--- response ---\n${txt}`);
      }

      setBody("");
      setImageFile(null);
      await load();
    } catch (e: unknown) {
      const msg = String((e as { message?: unknown })?.message ?? "送信に失敗しました。");
      setErr(msg);
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (next: "open" | "closed") => {
    if (badId) {
      setErr(`スレッドIDが不正です（${threadId || "undefined"}）。一覧から開き直してください。`);
      return;
    }
    setStatusBusy(true);
    setErr(null);
    try {
      await apiPut(`/student/questions/${encodeURIComponent(threadId)}/status`, { status: next });
      await load();
    } catch (e: unknown) {
      const msg = String((e as { message?: unknown })?.message ?? "更新に失敗しました。");
      setErr(msg);
    } finally {
      setStatusBusy(false);
    }
  };

  if (!mounted) return null;

  return (
    <div className="p-6 space-y-4">
      {/* 見出しは bg-gray-50 枠外 */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">質問詳細</h1>
          <div className="text-sm text-gray-600">ID: {threadId}</div>
        </div>
        <div className="flex gap-2">
          <button className="rounded-lg border px-3 py-2 hover:bg-gray-50 disabled:opacity-50" onClick={load} disabled={busy}>
            {busy ? "更新中..." : "更新"}
          </button>
          <Link className="rounded-lg border px-3 py-2 bg-white hover:bg-gray-50" href="/student/questions">
            戻る
          </Link>
        </div>
      </div>

      {err && <div className="rounded-xl border bg-red-50 p-3 text-sm text-red-800">{err}</div>}

      <div className="rounded-xl border bg-gray-50 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <div className="text-sm text-gray-600">タイトル</div>
            <div className="text-lg font-semibold">{thread?.title ?? ""}</div>
          </div>
          <div>
            {thread?.status === "open" ? (
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 text-xs">未解決</span>
                <button
                  type="button"
                  disabled={statusBusy}
                  className="rounded-lg border bg-white px-3 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
                  onClick={() => changeStatus("closed")}
                >
                  解決した
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-gray-100 text-gray-700 border px-2 py-0.5 text-xs">解決済み</span>
                <button
                  type="button"
                  disabled={statusBusy}
                  className="rounded-lg border bg-white px-3 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
                  onClick={() => changeStatus("open")}
                >
                  未解決に戻す
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="text-xs text-gray-500">作成: {fmtDateTime(thread?.created_at)} / 更新: {fmtDateTime(thread?.updated_at)}</div>

        <div className="rounded-xl border bg-white p-3 space-y-3">
          {messages.map((m) => (
            <div key={m.id} className="rounded-xl border p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-gray-500">{m.sender_role === "teacher" ? "先生" : "あなた"} ・ {fmtDateTime(m.created_at)}</div>
              </div>
              {!!m.body && <div className="whitespace-pre-wrap text-sm text-gray-800 mt-1">{m.body}</div>}

              {m.image_path && (
                <div className="mt-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={m.image_path.startsWith("http") ? m.image_path : `${API_BASE}${m.image_path}`}
                    alt="attachment"
                    className="max-w-full rounded-lg border bg-white"
                  />
                </div>
              )}
            </div>
          ))}

          {!busy && messages.length === 0 && <div className="text-sm text-gray-600">メッセージがありません。</div>}
        </div>

        <div className="space-y-2">
          <div className="text-sm font-semibold text-gray-800">追記</div>
          <textarea
            className="rounded-lg border px-3 py-2 w-full min-h-[120px]"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="追加で伝えたいことを書いてください。"
          />

          <div className="flex items-center justify-between gap-3">
            <label className="text-sm text-gray-700">
              <span className="mr-2">画像</span>
              <input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] ?? null)} />
            </label>
            {imageFile ? (
              <button className="text-sm text-gray-600 underline" onClick={() => setImageFile(null)} type="button">
                選択解除
              </button>
            ) : (
              <span className="text-sm text-gray-400">未選択</span>
            )}
          </div>

          <button
            className="rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 disabled:opacity-50"
            onClick={send}
            disabled={busy || (!body.trim() && !imageFile) || badId}
          >
            {busy ? "送信中..." : "送信"}
          </button>
        </div>
      </div>
    </div>
  );
}
