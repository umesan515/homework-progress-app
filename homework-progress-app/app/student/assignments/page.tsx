"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { getUserFromToken, logout } from "@/lib/auth";

type Row = {
  id: string;
  title: string;
  status: string;
  due_at: string | null;
  created_at: string;

  total: number;
  maru: number;
  sankaku: number;
  batsu: number;
  done: number;
  pct: number;
  tag?: string | null;
};

const formatDue = (dueAt: string | null) => {
  if (!dueAt) return "無期限";
  const d = new Date(dueAt);
  return `${d.toLocaleDateString("ja-JP")} まで`;
};

const isValidId = (v: unknown): v is string => {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s) return false;
  if (s === "undefined" || s === "null") return false;
  return true;
};

export default function StudentAssignmentsPage() {
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<any | null>(null);

  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);

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

    (async () => {
      setErr(null);
      const r = await apiGet<Row[]>("/student/assignments");
      setRows((r ?? []).filter((x) => isValidId((x as any).id)));
    })().catch((e: any) => {
      const msg = String(e?.message ?? "読み込みエラー");
      if (msg.includes("401")) {
        logout();
        router.replace("/login");
        return;
      }
      setErr(msg);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const viewRows = useMemo(() => {
    return rows.map((r) => ({
      ...r,
      dueText: formatDue(r.due_at),
      totalSafe: Math.max(1, r.total || 0),
    }));
  }, [rows]);

  if (!mounted) return <main className="p-6">確認中...</main>;
  if (!user) return <main className="p-6">ログインへ遷移中...</main>;

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">課題一覧</h1>
        <Link className="rounded-lg border px-3 py-2 hover:bg-gray-50" href="/student">
          ホームへ
        </Link>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}

      <div className="space-y-3">
        {viewRows.map((r) => (
          <Link
            key={r.id}
            href={`/student/assignments/${r.id}`}
            className="block rounded-xl border p-4 hover:bg-gray-50"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold truncate">{r.title}</div>
                <div className="text-sm text-gray-600">期限：{r.dueText}</div>

                {r.tag ? (
                  <div className="mt-2">
                    <span className="inline-block rounded-full border px-3 py-1 text-xs text-gray-700 bg-white">
                      {r.tag}
                    </span>
                  </div>
                ) : null}

                <div className="text-sm text-gray-600 mt-2">
                  進捗：{r.done}/{r.total}（{r.pct}%）{" "}
                  <span className="text-xs">
                    ○{r.maru} / △{r.sankaku} / ×{r.batsu}
                  </span>
                </div>
              </div>
              <div className="text-sm text-gray-500 shrink-0">開く</div>
            </div>
          </Link>
        ))}

        {viewRows.length === 0 && !err && (
          <div className="text-sm text-gray-600">課題がありません。</div>
        )}
      </div>
    </main>
  );
}