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
      return [row.title, row.description ?? "", row.unit_name ?? "", row.grade_level ?? "", row.subject ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [rows, q, typeFilter]);

  return (
    <main className="app-shell px-0 py-6 sm:py-8">
      <div className="page-stack">
        <div className="space-y-2">
          <h1 className="page-title">教材置き場</h1>
          <p className="page-subtitle">授業の補助教材を自由に閲覧できます。スマホでは1列、タブレット以上では見やすいカード配置になります。</p>
        </div>

        <section className="space-y-3">
          <h2 className="section-title">検索と絞り込み</h2>
          <div className="surface-muted p-4 sm:p-5">
            <div className="grid gap-3 md:grid-cols-[1fr_220px]">
              <input className="form-control" value={q} onChange={(e) => setQ(e.target.value)} placeholder="教材名・単元・学年で検索" />
              <select className="form-control" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="all">全種別</option>
                <option value="image">画像</option>
                <option value="video">動画</option>
                <option value="interactive">インタラクティブ</option>
                <option value="app">アプリ</option>
              </select>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-500">
              <span className="badge-soft">表示件数 {filtered.length}</span>
            </div>
            {err && <div className="mt-3 text-sm text-rose-600 whitespace-pre-wrap">{err}</div>}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="section-title">公開教材</h2>
          {filtered.length === 0 ? (
            <div className="empty-state">閲覧可能な教材はまだありません。</div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((row) => (
                <Link key={row.id} href={`/student/materials/${encodeURIComponent(row.id)}`} className="action-card overflow-hidden p-0">
                  <div className="aspect-[16/10] bg-slate-100">
                    {row.thumbnail_url ? (
                      <img src={thumb(row.thumbnail_url)} alt={row.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm font-medium text-slate-500">{typeLabel[row.material_type]}</div>
                    )}
                  </div>
                  <div className="p-4 sm:p-5">
                    <div className="flex flex-wrap gap-2">
                      <span className="badge">{typeLabel[row.material_type] ?? row.material_type}</span>
                      {row.subject && <span className="badge-soft">{row.subject}</span>}
                    </div>
                    <div className="mt-3 line-clamp-2 text-lg font-semibold text-slate-900">{row.title}</div>
                    <div className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">{row.description || "説明はまだありません。"}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {row.unit_name && <span className="badge-soft">{row.unit_name}</span>}
                      {row.grade_level && <span className="badge-soft">{row.grade_level}</span>}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
