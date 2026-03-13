"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiGet } from "@/lib/api";
import { getUserFromToken, logout } from "@/lib/auth";

type Row = {
  id: string;
  title: string;
  status: "open" | "closed" | "archived";
  due_at: string | null;
  created_at: string;
  class_ids: string[];
  total: number; // assignment_problems の件数（0だと未設定）
};

const formatDue = (dueAt: string | null) => {
  if (!dueAt) return "無期限";
  const d = new Date(dueAt);
  return `${d.toLocaleDateString("ja-JP")} まで`;
};

const statusLabel = (s: Row["status"]) => {
  if (s === "open") return "配布中";
  if (s === "closed") return "停止";
  return "アーカイブ";
};

const statusBadgeClass = (s: Row["status"]) => {
  if (s === "open") return "border-green-500 bg-green-50 text-green-700";
  if (s === "closed") return "border-yellow-500 bg-yellow-50 text-yellow-700";
  return "border-gray-400 bg-gray-50 text-gray-700";
};

const isValidId = (v: unknown): v is string => {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s) return false;
  if (s === "undefined" || s === "null") return false;
  return true;
};

type Filter = "all" | "open" | "stopped" | "closed" | "archived";

const ALL_CLASS_VALUE = "ALL";

function TeacherAssignmentsListPageInner() {
  const router = useRouter();
  const sp = useSearchParams();

  const initialFilter = (() => {
    const q = String(sp?.get("status") ?? "all") as Filter;
    if (q === "open" || q === "stopped" || q === "closed" || q === "archived") return q;
    return "all";
  })();

  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<any | null>(null);

  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selectedClasses, setSelectedClasses] = useState<string[]>([ALL_CLASS_VALUE]);

  useEffect(() => {
    setMounted(true);

    const u = getUserFromToken();
    setUser(u);

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

  const load = async (f: Filter) => {
    setBusy(true);
    setErr(null);
    try {
      const qs = f === "all" ? "" : `?status=${encodeURIComponent(f)}`;
      const r = await apiGet<Row[]>(`/teacher/assignments${qs}`);
      const safe = (r ?? []).filter((x) => isValidId((x as any).id));
      setRows(safe);
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
    if (!mounted) return;
    if (!user || user.role !== "teacher") return;
    load(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, user?.uid, filter]);

  const classOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      for (const cid of r.class_ids ?? []) {
        if (isValidId(cid)) set.add(cid);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ja"));
  }, [rows]);

  const visibleRows = useMemo(() => {
    if (selectedClasses.includes(ALL_CLASS_VALUE)) return rows;
    if (selectedClasses.length === 0) return [];
    return rows.filter((r) => (r.class_ids ?? []).some((cid) => selectedClasses.includes(cid)));
  }, [rows, selectedClasses]);

  const counts = useMemo(() => {
    let open = 0,
      stopped = 0,
      closed = 0,
      archived = 0,
      all = 0;
    for (const r of visibleRows) {
      all++;
      if (r.status === "open") open++;
      else if (r.status === "closed") closed++;
      else archived++;
      if (r.status !== "open") stopped++;
    }
    return { all, open, stopped, closed, archived };
  }, [visibleRows]);

  const setFilterAndUrl = (f: Filter) => {
    setFilter(f);
    const url = f === "all" ? "/teacher/assignments" : `/teacher/assignments?status=${f}`;
    router.replace(url);
  };

  const toggleClass = (cid: string) => {
    setSelectedClasses((prev) => {
      if (cid === ALL_CLASS_VALUE) return [ALL_CLASS_VALUE];
      const next = prev.includes(ALL_CLASS_VALUE) ? [] : [...prev];
      const has = next.includes(cid);
      const updated = has ? next.filter((x) => x !== cid) : [...next, cid];
      return updated.length === 0 ? [ALL_CLASS_VALUE] : updated;
    });
  };

  if (!mounted) return <main className="p-6">読み込み中...</main>;
  if (!user) return <main className="p-6">ログインへ遷移中...</main>;

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">課題一覧</h1>
          <div className="text-sm text-gray-600">配布中／停止／アーカイブを切り替えて確認できます。</div>
        </div>
        <div className="flex gap-2">
          <Link className="rounded-lg border px-3 py-2 hover:bg-gray-50" href="/teacher">
            教師ホームへ
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          className={`rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 ${filter === "all" ? "bg-gray-50" : ""}`}
          onClick={() => setFilterAndUrl("all")}
        >
          すべて
        </button>
        <button
          className={`rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 ${filter === "open" ? "bg-gray-50" : ""}`}
          onClick={() => setFilterAndUrl("open")}
        >
          配布中
        </button>
        <button
          className={`rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 ${filter === "stopped" ? "bg-gray-50" : ""}`}
          onClick={() => setFilterAndUrl("stopped")}
          title="status が open 以外（停止 + アーカイブ）"
        >
          停止のみ
        </button>
        <button
          className={`rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 ${filter === "closed" ? "bg-gray-50" : ""}`}
          onClick={() => setFilterAndUrl("closed")}
        >
          停止（closed）
        </button>
        <button
          className={`rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 ${filter === "archived" ? "bg-gray-50" : ""}`}
          onClick={() => setFilterAndUrl("archived")}
        >
          アーカイブ
        </button>
      </div>

      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-medium text-slate-800">対象クラス</div>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700">
            <input type="checkbox" checked={selectedClasses.includes(ALL_CLASS_VALUE)} onChange={() => toggleClass(ALL_CLASS_VALUE)} />
            全クラス
          </label>
          {classOptions.map((cid) => (
            <label key={cid} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700">
              <input type="checkbox" checked={selectedClasses.includes(cid)} onChange={() => toggleClass(cid)} />
              {cid}
            </label>
          ))}
        </div>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}
      {busy && <p className="text-sm text-gray-600">読み込み中...</p>}

      <div className="text-xs text-gray-600">
        件数：全{counts.all} / 配布中{counts.open} / 停止のみ{counts.stopped} / closed{counts.closed} / archived{counts.archived}
      </div>

      <div className="space-y-3">
        {visibleRows.map((r) => (
          <div key={r.id} className="rounded-xl border p-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Link className="font-semibold hover:underline truncate" href={`/teacher/assignments/${r.id}`}>
                  {r.title}
                </Link>

                <span className={`inline-block rounded-full border px-3 py-1 text-xs ${statusBadgeClass(r.status)}`}>
                  {statusLabel(r.status)}
                </span>

                {r.total === 0 && (
                  <span className="inline-block rounded-full border border-red-500 bg-red-50 text-red-700 px-3 py-1 text-xs">
                    問題ラベル未設定
                  </span>
                )}
              </div>

              <div className="text-sm text-gray-600 mt-1">
                期限：{formatDue(r.due_at)} / 問題数：{r.total}
              </div>

              <div className="text-xs text-gray-600 mt-1">
                クラス：{(r.class_ids ?? []).length ? r.class_ids.join(", ") : "-"}
              </div>
            </div>

            <div className="flex gap-2 shrink-0">
              <Link className="rounded-lg border px-3 py-2 hover:bg-gray-50 text-sm" href={`/teacher/assignments/${r.id}?tab=students`}>
                提出状況
              </Link>
              <Link className="rounded-lg border px-3 py-2 hover:bg-gray-50 text-sm" href={`/teacher/assignments/${r.id}?tab=problems`}>
                問題別
              </Link>
              <Link className="rounded-lg border px-3 py-2 hover:bg-gray-50 text-sm" href={`/teacher/assignments/${r.id}?tab=manage`}>
                管理
              </Link>
            </div>
          </div>
        ))}

        {visibleRows.length === 0 && !busy && !err && <div className="text-sm text-gray-600">該当する課題がありません。</div>}
      </div>
    </main>
  );
}

export default function TeacherAssignmentsListPage() {
  return (
    <Suspense fallback={<main className="p-6">読み込み中...</main>}>
      <TeacherAssignmentsListPageInner />
    </Suspense>
  );
}
