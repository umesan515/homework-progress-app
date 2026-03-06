"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiDelete, apiGet } from "@/lib/api";
import { getUserFromToken, logout } from "@/lib/auth";
import type { MaterialRow } from "@/lib/types";

const subjectLabel: Record<string, string> = {
  math: "数学",
  english: "英語",
  japanese: "国語",
  science: "理科",
  social: "社会",
  informatics: "情報",
  other: "その他",
};

const typeLabel: Record<string, string> = {
  image: "画像",
  video: "動画",
  interactive: "インタラクティブ",
  app: "アプリ",
};

export default function TeacherMaterialsPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState<MaterialRow[]>([]);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setReady(true);
    const user = getUserFromToken();
    if (!user) {
      router.replace("/login");
      return;
    }
    if (user.role !== "teacher") {
      router.replace("/student");
      return;
    }
  }, [router]);

  const load = async () => {
    try {
      setErr(null);
      const list = await apiGet<MaterialRow[]>("/teacher/materials");
      setRows(Array.isArray(list) ? list : []);
    } catch (e: any) {
      const msg = String(e?.message ?? "教材一覧の取得に失敗しました。");
      if (msg.includes("401")) {
        logout();
        router.replace("/login");
        return;
      }
      setErr(msg);
    }
  };

  useEffect(() => {
    if (!ready) return;
    load();
  }, [ready]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((row) => {
      const okType = typeFilter === "all" ? true : row.material_type === typeFilter;
      if (!okType) return false;
      if (!needle) return true;
      const hay = [row.title, row.description ?? "", row.unit_name ?? "", row.grade_level ?? "", ...(row.class_ids ?? [])]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [q, rows, typeFilter]);

  const onDelete = async (id: string) => {
    const ok = window.confirm("この教材を削除します。よろしいですか？");
    if (!ok) return;
    try {
      await apiDelete(`/teacher/materials/${encodeURIComponent(id)}`);
      await load();
    } catch (e: any) {
      setErr(String(e?.message ?? "削除に失敗しました。"));
    }
  };

  return (
    <main className="p-6 space-y-6">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">教材置き場管理</h1>
        <div className="text-sm text-gray-600">図・動画・単独HTML教材・インタラクティブ教材を登録できます。</div>
      </div>

      <section className="rounded-2xl bg-gray-50 p-4 space-y-4 border">
        <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
          <div className="flex flex-col md:flex-row gap-3 md:items-center">
            <input className="rounded-lg border px-3 py-2 min-w-[240px]" placeholder="タイトル・説明・単元などで検索" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="rounded-lg border px-3 py-2" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">全種別</option>
              <option value="image">画像</option>
              <option value="video">動画</option>
              <option value="interactive">インタラクティブ</option>
              <option value="app">アプリ</option>
            </select>
          </div>
          <Link href="/teacher/materials/new" className="rounded-lg border px-4 py-2 bg-white hover:bg-gray-100 hover:shadow-sm transition text-center">新規教材を追加</Link>
        </div>
        {err && <div className="text-sm text-red-600 whitespace-pre-wrap">{err}</div>}
      </section>

      <section className="space-y-3">
        <div className="text-lg font-semibold text-gray-700">登録済み教材</div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {filtered.map((row) => (
            <article key={row.id} className="rounded-2xl border bg-white p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <div className="text-lg font-semibold break-words">{row.title}</div>
                  <div className="text-sm text-gray-600 break-words">{row.description || "説明なし"}</div>
                </div>
                <div className={`shrink-0 rounded-full px-3 py-1 text-xs ${row.is_published ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-700"}`}>{row.is_published ? "公開中" : "非公開"}</div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-gray-600">
                <span className="rounded-full bg-gray-100 px-2 py-1">{typeLabel[row.material_type] ?? row.material_type}</span>
                <span className="rounded-full bg-gray-100 px-2 py-1">{subjectLabel[row.subject] ?? row.subject}</span>
                {row.unit_name && <span className="rounded-full bg-gray-100 px-2 py-1">{row.unit_name}</span>}
                {row.grade_level && <span className="rounded-full bg-gray-100 px-2 py-1">{row.grade_level}</span>}
                <span className="rounded-full bg-gray-100 px-2 py-1">対象: {(row.class_ids ?? []).length > 0 ? row.class_ids.join(", ") : "全体"}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href={`/student/materials/${encodeURIComponent(row.id)}`} className="rounded-lg border px-3 py-2 hover:bg-gray-100 hover:shadow-sm transition">閲覧</Link>
                <Link href={`/teacher/materials/${encodeURIComponent(row.id)}/edit`} className="rounded-lg border px-3 py-2 hover:bg-gray-100 hover:shadow-sm transition">編集</Link>
                <button className="rounded-lg border px-3 py-2 hover:bg-red-50 hover:border-red-300 transition" onClick={() => onDelete(row.id)}>削除</button>
              </div>
            </article>
          ))}
          {filtered.length === 0 && <div className="rounded-2xl border bg-white p-6 text-sm text-gray-500">教材はまだ登録されていません。</div>}
        </div>
      </section>
    </main>
  );
}
