"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiDelete } from "@/lib/api";
import { getUserFromToken, logout } from "@/lib/auth";

type TemplateRow = {
  id: string;
  name: string;
  mode: "book" | "manual";
  created_at?: string;
  updated_at?: string;
  book_id?: string | null;
  chapter_id?: string | null;
  problem_count?: number | null;
};

export default function TeacherTemplatesPage() {
  const router = useRouter();

  // ✅ 重要：初回レンダーは常に同じ状態（SSRとCSRで一致させる）
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<any | null>(null);

  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [q, setQ] = useState("");

  useEffect(() => {
    // ✅ window/localStorage を使う処理は必ず useEffect 内で
    const u = getUserFromToken();
    setUser(u);
    setReady(true);

    if (!u) {
      router.replace("/login");
      return;
    }
    if (u.role !== "teacher") {
      router.replace("/student");
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await apiGet<TemplateRow[]>("/teacher/templates");
      setTemplates(r ?? []);
    } catch (e: any) {
      const msg = String(e?.message ?? "読み込みに失敗しました。");
      if (msg.includes("401")) {
        logout();
        router.replace("/login");
        return;
      }
      setErr(msg);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!ready) return;
    if (!user) return;
    if (user.role !== "teacher") return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?.uid]);

  const filtered = useMemo(() => {
    const s = q.trim();
    if (!s) return templates;
    return templates.filter((t) => (t.name ?? "").includes(s) || (t.id ?? "").includes(s));
  }, [templates, q]);

  const onDelete = async (id: string) => {
    if (!confirm("このテンプレを削除しますか？")) return;
    setBusy(true);
    setErr(null);
    try {
      await apiDelete(`/teacher/templates/${encodeURIComponent(id)}`);
      await load();
    } catch (e: any) {
      setErr(String(e?.message ?? "削除に失敗しました。"));
    } finally {
      setBusy(false);
    }
  };

  // ✅ SSR/CSRで必ず一致する初期表示
  if (!ready) {
    return <main className="p-6">読み込み中...</main>;
  }
  // ready になった後に role チェックで replace されるが、一瞬の表示も一致させる
  if (!user || user.role !== "teacher") {
    return <main className="p-6">ログインへ遷移中...</main>;
  }

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">課題テンプレート</h1>
          <div className="text-sm text-gray-600">テンプレの作成・編集・配布を行います。</div>
        </div>

        <div className="flex items-center gap-2">
          <Link className="rounded-lg border px-3 py-2 hover:bg-gray-50" href="/teacher/templates/new">
            新規作成
          </Link>
          <Link className="rounded-lg border px-3 py-2 hover:bg-gray-50" href="/teacher">
            教師ホーム
          </Link>
        </div>
      </div>

      {err && <p className="text-sm text-red-600 whitespace-pre-wrap">{err}</p>}

      <div className="flex items-center gap-2 flex-wrap">
        <input
          className="rounded-lg border px-3 py-2 w-72 max-w-full"
          placeholder="検索（名前 / ID）"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          className="rounded-lg border px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
          onClick={load}
          disabled={busy}
          type="button"
        >
          {busy ? "更新中..." : "更新"}
        </button>
        <div className="text-sm text-gray-600">件数：{filtered.length}</div>
      </div>

      <div className="rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-3 text-left">名前</th>
              <th className="p-3 text-left w-28">mode</th>
              <th className="p-3 text-left w-40">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t.id} className="border-t">
                <td className="p-3">
                  <div className="font-medium">{t.name}</div>
                  <div className="text-xs text-gray-500">{t.id}</div>
                </td>
                <td className="p-3">{t.mode}</td>
                <td className="p-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link className="rounded-lg border px-3 py-1.5 hover:bg-gray-50" href={`/teacher/templates/${t.id}`}>
                      詳細
                    </Link>
                    <Link className="rounded-lg border px-3 py-1.5 hover:bg-gray-50" href={`/teacher/templates/${t.id}/edit`}>
                      編集
                    </Link>
                    <Link className="rounded-lg border px-3 py-1.5 hover:bg-gray-50" href={`/teacher/templates/${t.id}/distribute`}>
                      配布
                    </Link>
                    <button
                      className="rounded-lg border px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
                      onClick={() => onDelete(t.id)}
                      disabled={busy}
                      type="button"
                    >
                      削除
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {filtered.length === 0 && (
              <tr className="border-t">
                <td className="p-4 text-gray-600" colSpan={3}>
                  テンプレがありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}