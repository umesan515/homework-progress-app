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
    <main className="page-shell">
      <div className="page-title-block">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="page-title">課題一覧</h1>
            <p className="page-subtitle">配布された課題をまとめて見渡し、詳細ページから記録を入力します。</p>
          </div>
          <Link className="subtle-button self-start" href="/student">ホームへ</Link>
        </div>
        {err && <p className="text-sm text-rose-600">{err}</p>}
      </div>

      <section className="section-stack">
        <div>
          <h2 className="section-heading">配布中の課題</h2>
          <p className="section-caption">以前のカードデザインに近い、見通しのよい一覧に戻しています。</p>
        </div>
        <div className="soft-panel space-y-4">
          {viewRows.length === 0 && !err ? (
            <div className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
              課題がありません。
            </div>
          ) : (
            viewRows.map((r, i) => {
              const empty = Math.max(0, r.total - (r.maru + r.sankaku + r.batsu));
              return (
                <Link
                  key={r.id}
                  href={`/student/assignments/${r.id}`}
                  className={`assignment-list-card ${i % 3 === 0 ? "theme-blue" : i % 3 === 1 ? "theme-emerald" : "theme-violet"}`}
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-xl font-bold text-slate-900">{r.title}</div>
                        {r.tag ? <span className="inline-chip">{r.tag}</span> : null}
                      </div>
                      <div className="mt-2 text-sm text-slate-600">提出期限：{r.dueText}</div>

                      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3">
                          <div className="flex items-center justify-between gap-3 text-sm text-slate-700">
                            <span className="font-semibold">進捗</span>
                            <span>{r.done}/{r.total}（{r.pct}%）</span>
                          </div>
                          <div className="progress-track mt-2">
                            <div className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, r.pct))}%` }} />
                          </div>
                        </div>
                        <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3">
                          <div className="flex items-center justify-between gap-3 text-sm text-slate-700">
                            <span className="font-semibold">理解度</span>
                            <span>○{r.maru} / △{r.sankaku} / ×{r.batsu}</span>
                          </div>
                          <div className="understanding-track mt-2">
                            <div className="u-maru" style={{ width: `${(r.maru / r.totalSafe) * 100}%` }} />
                            <div className="u-sankaku" style={{ width: `${(r.sankaku / r.totalSafe) * 100}%` }} />
                            <div className="u-batsu" style={{ width: `${(r.batsu / r.totalSafe) * 100}%` }} />
                            <div className="u-empty" style={{ width: `${(empty / r.totalSafe) * 100}%` }} />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0">
                      <span className="home-action-card-arrow">開く</span>
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </section>
    </main>
  );
}
