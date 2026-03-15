"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { logout } from "@/lib/auth";
import MaterialPreview from "@/components/MaterialPreview";
import type { MaterialRow } from "@/lib/types";

export default function StudentMaterialDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const materialId = String(params?.id ?? "");
  const [row, setRow] = useState<MaterialRow | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!materialId) return;
    apiGet<MaterialRow>(`/student/materials/${encodeURIComponent(materialId)}`)
      .then(setRow)
      .catch((e: any) => {
        const msg = String(e?.message ?? "教材の取得に失敗しました。");
        if (msg.includes("401")) {
          logout();
          router.replace("/login");
          return;
        }
        setErr(msg);
      });
  }, [materialId, router]);

  return (
    <main className="app-shell px-0 py-6 sm:py-8">
      <div className="page-stack">
        <div className="space-y-2">
          <h1 className="page-title">教材詳細</h1>
          <p className="page-subtitle">教材を大きく表示します。スマホでも横にはみ出しにくい構成にしています。</p>
        </div>

        <section className="space-y-3">
          <h2 className="section-title">教材内容</h2>
          <div className="surface p-4 sm:p-6">
            {err && <div className="text-sm text-rose-600 whitespace-pre-wrap">{err}</div>}
            {!row && !err && <div className="text-sm text-slate-500">読み込み中...</div>}
            {row && (
              <div className="space-y-5">
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <span className="badge">{row.subject}</span>
                    {row.unit_name && <span className="badge-soft">{row.unit_name}</span>}
                    {row.grade_level && <span className="badge-soft">{row.grade_level}</span>}
                  </div>
                  <div className="text-2xl font-bold text-slate-900">{row.title}</div>
                  <div className="text-sm leading-7 text-slate-600 whitespace-pre-wrap">{row.description || "説明はまだありません。"}</div>
                </div>
                <MaterialPreview material={row} />
              </div>
            )}
          </div>
        </section>

        <div>
          <Link href="/student/materials" className="btn-secondary w-full sm:w-auto">一覧へ戻る</Link>
        </div>
      </div>
    </main>
  );
}
