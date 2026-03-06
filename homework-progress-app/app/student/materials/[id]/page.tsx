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
    <main className="p-6 space-y-6">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">教材詳細</h1>
        <div className="text-sm text-gray-600">教材の内容を閲覧します。</div>
      </div>
      <section className="rounded-2xl border bg-white p-4 space-y-4">
        {err && <div className="text-sm text-red-600 whitespace-pre-wrap">{err}</div>}
        {!row && !err && <div className="text-sm text-gray-500">読み込み中...</div>}
        {row && <><div className="space-y-2"><div className="text-2xl font-semibold">{row.title}</div><div className="text-sm text-gray-600 whitespace-pre-wrap">{row.description || "説明なし"}</div><div className="flex flex-wrap gap-2 text-xs text-gray-600"><span className="rounded-full bg-gray-100 px-2 py-1">{row.subject}</span>{row.unit_name && <span className="rounded-full bg-gray-100 px-2 py-1">{row.unit_name}</span>}{row.grade_level && <span className="rounded-full bg-gray-100 px-2 py-1">{row.grade_level}</span>}</div></div><MaterialPreview material={row} /></>}
      </section>
      <Link href="/student/materials" className="inline-flex rounded-lg border px-4 py-2 hover:bg-gray-100 hover:shadow-sm transition">一覧へ戻る</Link>
    </main>
  );
}
