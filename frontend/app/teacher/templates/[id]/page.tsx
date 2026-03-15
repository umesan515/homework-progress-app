"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { getUserFromToken, logout, type JwtUser } from "@/lib/auth";

type TemplateDetailResp = {
  template: {
    id: string;
    name: string;
    mode: "book" | "manual";
    book_id: string | null;
    book_name: string | null;
    chapter_id: string | null;
    chapter_name: string | null;
    part: string | null;
    chapter_no: number | null;
    problem_count: number | null;
  };
  blocks: Array<{ block_id: string; series: string; zone: string; no: number; label: string; sort_order: number }>;
};

const SERIES_LABEL: Record<string, string> = {
  problem: "問題",
  exercise: "演習",
  comprehensive: "総合",
};
const displayZone = (z: string) => (z === "発展" ? "発展問題" : z);

export default function TeacherTemplateDetailPage() {
  const params = useParams<{ id?: string }>();
  const id = params?.id; // ✅ optional
  const router = useRouter();

  // ✅ Hydration対策：初回レンダーで localStorage を読まない
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<JwtUser | null>(null);

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<TemplateDetailResp | null>(null);

  useEffect(() => {
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

  // ✅ undefinedは API を叩かず一覧へ
  useEffect(() => {
    if (!id || id === "undefined") {
      setErr(null);
      router.replace("/teacher/templates");
    }
  }, [id, router]);

  const load = async () => {
    if (!id || id === "undefined") return;
    setBusy(true);
    setErr(null);
    try {
      const r = await apiGet<TemplateDetailResp>(`/teacher/templates/${encodeURIComponent(id)}`);
      setData(r);
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
    if (!user || user.role !== "teacher") return;
    if (!id || id === "undefined") return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?.uid, id]);

  const summary = useMemo(() => {
    if (!data) return null;
    if (data.template.mode === "manual") {
      const n = data.template.problem_count ?? 0;
      return { count: n, labelsText: n > 0 ? `1..${n}` : "-" };
    }
    return {
      count: data.blocks.length,
      labelsText: data.blocks.map((b) => b.label).slice(0, 20).join(" ") + (data.blocks.length > 20 ? " ..." : ""),
    };
  }, [data]);

  if (!ready) return <main className="p-6">読み込み中...</main>;
  if (!user) return <main className="p-6">ログインへ遷移中...</main>;
  if (!id || id === "undefined") return <main className="p-6">一覧へ戻ります...</main>;

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">テンプレ詳細</h1>
          <div className="text-sm text-gray-600">{data?.template?.name ?? "..."}</div>
        </div>
        <div className="flex gap-2">
          <Link className="rounded-lg border px-3 py-2 hover:bg-gray-50" href="/teacher/templates">
            一覧へ
          </Link>
          <Link className="rounded-lg border px-3 py-2 hover:bg-gray-50" href={`/teacher/templates/${id}/edit`}>
            編集
          </Link>
          <Link className="rounded-lg border px-3 py-2 hover:bg-gray-50" href={`/teacher/templates/${id}/distribute`}>
            配布
          </Link>
        </div>
      </div>

      {err && <p className="text-sm text-red-600 whitespace-pre-wrap">{err}</p>}
      {busy && <p className="text-sm text-gray-600">読み込み中...</p>}

      {data && (
        <div className="rounded-xl border p-4 space-y-2">
          <div className="text-sm">
            <b>種類：</b> {data.template.mode}
          </div>

          {data.template.mode === "book" ? (
            <div className="text-sm text-gray-700">
              <div>
                <b>問題集：</b> {data.template.book_name ?? "?"}
              </div>
              <div>
                <b>章：</b> {data.template.chapter_name ?? "?"}{" "}
                {data.template.part ? `(${data.template.part}${data.template.chapter_no ?? ""})` : ""}
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-700">
              <b>問題数：</b> {data.template.problem_count ?? 0}（配布時ラベルは 1..N）
            </div>
          )}

          <div className="text-sm text-gray-700">
            <b>問題数：</b> {summary?.count ?? 0}
          </div>
          <div className="text-xs text-gray-500">
            <b>ラベル：</b> {summary?.labelsText ?? "-"}
          </div>
        </div>
      )}

      {data?.template.mode === "book" && (
        <div className="rounded-xl border p-4">
          <div className="font-semibold mb-2">含まれるブロック</div>
          <div className="max-h-[420px] overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-2 text-left w-24">系列</th>
                  <th className="p-2 text-left w-40">ゾーン</th>
                  <th className="p-2 text-left w-24">番号</th>
                </tr>
              </thead>
              <tbody>
                {data.blocks.map((b) => (
                  <tr key={b.block_id} className="border-t">
                    <td className="p-2">{SERIES_LABEL[b.series] ?? b.series}</td>
                    <td className="p-2">{displayZone(b.zone)}</td>
                    <td className="p-2">{b.label}</td>
                  </tr>
                ))}
                {data.blocks.length === 0 && (
                  <tr className="border-t">
                    <td className="p-3 text-gray-600" colSpan={3}>
                      ブロックがありません（編集で選択し直してください）。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
