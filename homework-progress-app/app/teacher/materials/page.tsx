"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiDelete, apiGet, API_BASE } from "@/lib/api";
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

function thumb(url: string | null | undefined) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  return `${API_BASE}${url}`;
}

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
    <main className="app-shell px-0 py-6 sm:py-8">
      <div className="page-stack">
        <div className="space-y-2">
          <h1 className="page-title">教材置き場管理</h1>
          <p className="page-subtitle">図・動画・単独HTML教材・インタラクティブ教材を整理し、クラスへ公開できます。</p>
        </div>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="kpi-card">
            <div className="kpi-label">登録教材数</div>
            <div className="mt-2 kpi-value">{rows.length}</div>
            <div className="mt-2 text-sm text-slate-600">教師側で管理している教材の合計です。</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">公開中</div>
            <div className="mt-2 kpi-value">{rows.filter((row) => row.is_published).length}</div>
            <div className="mt-2 text-sm text-slate-600">生徒が閲覧できる教材数です。</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">インタラクティブ教材</div>
            <div className="mt-2 kpi-value">{rows.filter((row) => row.material_type === "interactive").length}</div>
            <div className="mt-2 text-sm text-slate-600">グラフや操作型教材の件数です。</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">クラス指定あり</div>
            <div className="mt-2 kpi-value">{rows.filter((row) => (row.class_ids ?? []).length > 0).length}</div>
            <div className="mt-2 text-sm text-slate-600">公開対象が限定されている教材数です。</div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="section-title">検索と操作</h2>
          <div className="surface-muted p-4 sm:p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="grid flex-1 gap-3 md:grid-cols-[1fr_220px]">
                <input className="form-control" placeholder="タイトル・説明・単元・クラスで検索" value={q} onChange={(e) => setQ(e.target.value)} />
                <select className="form-control" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                  <option value="all">全種別</option>
                  <option value="image">画像</option>
                  <option value="video">動画</option>
                  <option value="interactive">インタラクティブ</option>
                  <option value="app">アプリ</option>
                </select>
              </div>
              <Link href="/teacher/materials/new" className="btn-primary w-full lg:w-auto">教材を新規登録</Link>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-sm text-slate-500">
              <span className="badge-soft">表示件数 {filtered.length}</span>
            </div>
            {err && <div className="mt-3 text-sm text-rose-600 whitespace-pre-wrap">{err}</div>}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="section-title">教材一覧</h2>
          {filtered.length === 0 ? (
            <div className="empty-state">条件に合う教材はありません。</div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((row) => (
                <div key={row.id} className="surface overflow-hidden">
                  <div className="aspect-[16/10] bg-slate-100">
                    {row.thumbnail_url ? (
                      <img src={thumb(row.thumbnail_url)} alt={row.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm font-medium text-slate-500">{typeLabel[row.material_type]}</div>
                    )}
                  </div>
                  <div className="space-y-4 p-4 sm:p-5">
                    <div className="flex flex-wrap gap-2">
                      <span className="badge">{typeLabel[row.material_type] ?? row.material_type}</span>
                      <span className="badge-soft">{subjectLabel[row.subject] ?? row.subject}</span>
                      <span className={row.is_published ? "badge" : "badge-soft"}>{row.is_published ? "公開中" : "非公開"}</span>
                    </div>
                    <div>
                      <div className="line-clamp-2 text-lg font-semibold text-slate-900">{row.title}</div>
                      <div className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">{row.description || "説明はまだありません。"}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {row.unit_name && <span className="badge-soft">{row.unit_name}</span>}
                      {row.grade_level && <span className="badge-soft">{row.grade_level}</span>}
                      {(row.class_ids ?? []).map((cid) => (
                        <span key={cid} className="badge-soft">{cid}</span>
                      ))}
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Link href={`/teacher/materials/${encodeURIComponent(row.id)}/edit`} className="btn-secondary flex-1">
                        編集
                      </Link>
                      <button onClick={() => onDelete(row.id)} className="btn-danger flex-1">
                        削除
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
