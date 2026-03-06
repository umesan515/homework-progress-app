"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, API_BASE } from "@/lib/api";
import { getUserFromToken, logout } from "@/lib/auth";
import type { MaterialRow } from "@/lib/types";

const typeLabel: Record<string, string> = {
  image: "画像",
  video: "動画",
  interactive: "インタラクティブ",
  app: "アプリ",
};

function thumb(url: string | null | undefined) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  return `${API_BASE}${url}`;
}

export default function StudentMaterialsPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState<MaterialRow[]>([]);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const user = getUserFromToken();
    setReady(true);
    if (!user) router.replace("/login");
  }, [router]);

  useEffect(() => {
    if (!ready) return;
    apiGet<MaterialRow[]>("/student/materials")
      .then((list) => setRows(Array.isArray(list) ? list : []))
      .catch((e: any) => {
        const msg = String(e?.message ?? "教材一覧の取得に失敗しました。");
        if (msg.includes("401")) {
          logout();
          router.replace("/login");
          return;
        }
        setErr(msg);
      });
  }, [ready, router]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((row) => {
      const okType = typeFilter === "all" ? true : row.material_type === typeFilter;
      if (!okType) return false;
      if (!needle) return true;
      return [row.title, row.description ?? "", row.unit_name ?? "", row.grade_level ?? ""].join(" ").toLowerCase().includes(needle);
    });
  }, [rows, q, typeFilter]);

  return (
    <main className="p-6 space-y-6">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">教材置き場</h1>
        <div className="text-sm text-gray-600">授業の補助教材を自由に閲覧できます。</div>
      </div>
      <section className="rounded-2xl border bg-gray-50 p-4 space-y-3">
        <div className="flex flex-col md:flex-row gap-3 md:items-center">
          <input className="rounded-lg border px-3 py-2 min-w-[240px]" value={q} onChange={(e) => setQ(e.target.value)} placeholder="教材を検索" />
          <select className="rounded-lg border px-3 py-2" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}><option value="all">全種別</option><option value="image">画像</option><option value="video">動画</option><option value="interactive">インタラクティブ</option><option value="app">アプリ</option></select>
        </div>
        {err && <div className="text-sm text-red-600 whitespace-pre-wrap">{err}</div>}
      </section>
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map((row) => (
          <Link key={row.id} href={`/student/materials/${encodeURIComponent(row.id)}`} className="rounded-2xl border bg-white overflow-hidden hover:bg-gray-50 hover:shadow-sm transition">
            <div className="aspect-[16/9] bg-gray-100 flex items-center justify-center overflow-hidden">{row.thumbnail_url ? <img src={thumb(row.thumbnail_url)} alt={row.title} className="w-full h-full object-cover" /> : <div className="text-sm text-gray-500">{typeLabel[row.material_type]}</div>}</div>
            <div className="p-4 space-y-2"><div className="text-lg font-semibold line-clamp-2">{row.title}</div><div className="text-sm text-gray-600 line-clamp-2">{row.description || "説明なし"}</div><div className="flex flex-wrap gap-2 text-xs text-gray-600"><span className="rounded-full bg-gray-100 px-2 py-1">{typeLabel[row.material_type] ?? row.material_type}</span>{row.unit_name && <span className="rounded-full bg-gray-100 px-2 py-1">{row.unit_name}</span>}{row.grade_level && <span className="rounded-full bg-gray-100 px-2 py-1">{row.grade_level}</span>}</div></div>
          </Link>
        ))}
        {filtered.length === 0 && <div className="rounded-2xl border bg-white p-6 text-sm text-gray-500">閲覧可能な教材はまだありません。</div>}
      </section>
    </main>
  );
}
