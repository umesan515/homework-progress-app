"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { getUserFromToken, logout } from "@/lib/auth";

const ALL_CLASS_VALUE = "ALL";

type ClassRow = { class_id: string; student_count?: number };

function normalizeClassRows(payload: unknown): string[] {
  if (Array.isArray(payload)) {
    return Array.from(new Set(payload.map((row) => {
      if (typeof row === "string") return row.trim();
      if (row && typeof row === "object" && "class_id" in row) return String((row as { class_id?: unknown }).class_id ?? "").trim();
      return "";
    }).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ja", { numeric: true, sensitivity: "base" }));
  }
  if (payload && typeof payload === "object" && Array.isArray((payload as { classIds?: unknown }).classIds)) {
    return Array.from(new Set(((payload as { classIds: unknown[] }).classIds ?? []).map((row) => String(row ?? "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ja", { numeric: true, sensitivity: "base" }));
  }
  return [];
}

type SummaryRow = {
  id: string;
  title: string;
  status: string;
  due_at: string | null;
  created_at: string;
  class_ids: string[];
  total: number;

  students: number;
  started: number;
  completed: number;
  unstarted: number;
  avgPct: number;
  tag: string | null;
};

type SummaryResp = { classId: string; rows: SummaryRow[] };

type HeatmapResp = {
  classId: string;
  students: Array<{ uid: string; name: string; classId: string }>;
  assignments: Array<{ id: string; title: string; due_at: string | null; created_at: string; total: number }>;
  heat: Record<string, Record<string, number>>;
  unstarted: Record<string, number>;
};

type HeatmapAllResp = {
  classIds: string[];
  assignments: Array<{ id: string; title: string; due_at: string | null; created_at: string; total: number }>;
  heat: Record<string, Record<string, number>>;
  unstarted: Record<string, Record<string, number>>;
};

type TeacherAssignmentRow = {
  id: string;
  title: string;
  status: "open" | "closed" | "archived";
  due_at: string | null;
  created_at: string;
  class_ids: string[];
  total: number;
};

type ByProblemResp = {
  classId: string;
  labels: string[];
  n: number;
  stats: Array<{
    label: string;
    maru: number;
    sankaku: number;
    batsu: number;
    none: number;
    maruPct: number;
    sankakuPct: number;
    batsuPct: number;
    nonePct: number;
    review: number;
    reviewPct: number;
  }>;
};

const clamp = (x: number, min: number, max: number) => Math.max(min, Math.min(max, x));

const formatDue = (dueAt: string | null) => {
  if (!dueAt) return "無期限";
  const d = new Date(dueAt);
  return `${d.toLocaleDateString("ja-JP")} まで`;
};

function pctColor(pct: number) {
  const p = clamp(pct, 0, 100) / 100;
  const g = Math.round(255 - 55 * p);
  const r = Math.round(255 - 85 * p);
  const b = Math.round(255 - 75 * p);
  return `rgb(${r},${g},${b})`;
}

type SortKey = "reviewPct" | "none" | "batsuPct" | "maruPctAsc";

type BookRow = { id: string; name: string; created_at: string; collection_id?: string | null; subject?: string | null };

export default function TeacherClassesDashboardPage() {
  const router = useRouter();

  // ★ mounted方式（hydration対策）
  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<any | null>(null);

  const [err, setErr] = useState<string | null>(null);

  const [classIds, setClassIds] = useState<string[]>([]);
  const [selectedClass, setSelectedClass] = useState<string>(ALL_CLASS_VALUE);
  const [selectedExtraClasses, setSelectedExtraClasses] = useState<string[]>([]);

  const [tab, setTab] = useState<"summary" | "heatmap" | "problems" | "books">("summary");

  // summary
  const [busySummary, setBusySummary] = useState(false);
  const [summaryRows, setSummaryRows] = useState<SummaryRow[]>([]);

  // heatmap
  const [busyHeat, setBusyHeat] = useState(false);
  const [heatN, setHeatN] = useState<number>(8);
  const [heatData, setHeatData] = useState<HeatmapResp | null>(null);
  const [heatAllData, setHeatAllData] = useState<HeatmapAllResp | null>(null);
  const [heatToast, setHeatToast] = useState<string | null>(null);

  // problems
  const [busyProb, setBusyProb] = useState(false);
  const [probN, setProbN] = useState<number>(10);
  const [probAssignments, setProbAssignments] = useState<TeacherAssignmentRow[]>([]);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string>("");
  const [problemData, setProblemData] = useState<ByProblemResp | null>(null);

  // problems - analysis controls
  const [sortKey, setSortKey] = useState<SortKey>("reviewPct");
  const [minReviewPct, setMinReviewPct] = useState<number>(25);
  const [hideEasy, setHideEasy] = useState<boolean>(true); // reviewPctや未着手が小さいものを隠す
  const [onlyNeedsFollow, setOnlyNeedsFollow] = useState<boolean>(false); // しきい値以上だけ

  // books
  const [busyBooks, setBusyBooks] = useState(false);
  const [classBooks, setClassBooks] = useState<BookRow[]>([]);

  const effectiveSelectedClassIds = useMemo(() => {
    if (selectedClass === ALL_CLASS_VALUE) return [] as string[];
    return Array.from(new Set([selectedClass, ...selectedExtraClasses].filter((c) => c && c !== ALL_CLASS_VALUE))).sort((a, b) =>
      a.localeCompare(b, "ja", { numeric: true, sensitivity: "base" })
    );
  }, [selectedClass, selectedExtraClasses]);

  const selectedSingleClass = effectiveSelectedClassIds.length === 1 ? effectiveSelectedClassIds[0] : "";
  const isAllClassesSelected = effectiveSelectedClassIds.length === 0;
  const isMultiClassesSelected = effectiveSelectedClassIds.length > 1;
  const selectedScopeLabel = isAllClassesSelected
    ? "全クラス（合算）"
    : effectiveSelectedClassIds.join(", ");

  const toggleExtraClass = (classId: string) => {
    if (!classId || classId === ALL_CLASS_VALUE) return;
    if (selectedClass === ALL_CLASS_VALUE) return;
    if (classId === selectedClass) return;
    setSelectedExtraClasses((prev) =>
      prev.includes(classId) ? prev.filter((x) => x !== classId) : [...prev, classId].sort((a, b) => a.localeCompare(b, "ja", { numeric: true, sensitivity: "base" }))
    );
  };

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

    // クラス一覧
    (async () => {
      setErr(null);
      const r = await apiGet<unknown>("/teacher/classes");
      const list = normalizeClassRows(r);
      setClassIds(list);
      setSelectedClass(ALL_CLASS_VALUE);
      setSelectedExtraClasses([]);
    })().catch((e: unknown) => {
      const msg = String((e as { message?: unknown })?.message ?? "読み込みエラー");
      if (msg.includes("401")) {
        logout();
        router.replace("/login");
        return;
      }
      setErr(msg);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canLoad = useMemo(() => !!user && user.role === "teacher", [user]);

  const loadSummary = async () => {
    if (!canLoad) return;
    setBusySummary(true);
    setErr(null);
    setSummaryRows([]);
    try {
      const sp = new URLSearchParams();
      if (effectiveSelectedClassIds.length > 1) sp.set("classIds", effectiveSelectedClassIds.join(","));
      else sp.set("classId", selectedSingleClass || ALL_CLASS_VALUE);
      sp.set("limit", "10");
      const r = await apiGet<SummaryResp>(`/teacher/classes/summary?${sp.toString()}`);
      setSummaryRows(r?.rows ?? []);
    } catch (e: unknown) {
      const msg = String((e as { message?: unknown })?.message ?? "読み込みに失敗しました。");
      if (msg.includes("401")) {
        logout();
        router.replace("/login");
        return;
      }
      setErr(msg);
    } finally {
      setBusySummary(false);
    }
  };

  const loadHeatmap = async () => {
    if (!canLoad) return;

    setBusyHeat(true);
    setErr(null);
    setHeatToast(null);
    setHeatData(null);
    setHeatAllData(null);

    try {
      const limit = clamp(heatN, 1, 20);

      if (effectiveSelectedClassIds.length === 0) {
        const r = await apiGet<HeatmapAllResp>(`/teacher/classes/heatmap-all?limit=${encodeURIComponent(String(limit))}`);
        setHeatAllData(r);
        setHeatToast("全クラス（合算）：クラス別平均進捗を作成しました。");
      } else if (effectiveSelectedClassIds.length === 1) {
        const r = await apiGet<HeatmapResp>(
          `/teacher/classes/heatmap?classId=${encodeURIComponent(selectedSingleClass)}&limit=${encodeURIComponent(String(limit))}`
        );
        setHeatData(r);
        setHeatToast(`${selectedSingleClass}：生徒別進捗を作成しました。`);
      } else {
        const r = await apiGet<HeatmapAllResp>(
          `/teacher/classes/heatmap-all?classIds=${encodeURIComponent(effectiveSelectedClassIds.join(","))}&limit=${encodeURIComponent(String(limit))}`
        );
        setHeatAllData(r);
        setHeatToast(`${selectedScopeLabel}：クラス別平均進捗を作成しました。`);
      }
    } catch (e: unknown) {
      const msg = String((e as { message?: unknown })?.message ?? "読み込みに失敗しました。");
      if (msg.includes("401")) {
        logout();
        router.replace("/login");
        return;
      }
      if (msg.includes("class_required")) setErr("クラスを選択して作成してください。");
      else setErr(msg);
    } finally {
      setBusyHeat(false);
    }
  };

  const loadBooks = async () => {
    if (!canLoad) return;

    setBusyBooks(true);
    setErr(null);
    setClassBooks([]);

    try {
      if (effectiveSelectedClassIds.length !== 1) {
        setErr("『使用問題集』は単一クラスを選択して表示してください。");
        return;
      }

      const r = await apiGet<BookRow[]>(`/teacher/books?classId=${encodeURIComponent(selectedSingleClass)}`);
      setClassBooks(Array.isArray(r) ? r : []);
    } catch (e: unknown) {
      const msg = String((e as { message?: unknown })?.message ?? "読み込みに失敗しました。");
      if (msg.includes("401")) {
        logout();
        router.replace("/login");
        return;
      }
      setErr(msg);
    } finally {
      setBusyBooks(false);
    }
  };

  const loadProbAssignmentList = async () => {
    if (!canLoad) return;
    setErr(null);
    setBusyProb(true);
    setProbAssignments([]);
    setSelectedAssignmentId("");
    setProblemData(null);

    try {
      const sp = new URLSearchParams();
      sp.set("status", "open");
      if (effectiveSelectedClassIds.length > 0) sp.set("classIds", effectiveSelectedClassIds.join(","));
      const all = (await apiGet<TeacherAssignmentRow[]>(`/teacher/assignments?${sp.toString()}`)) ?? [];
      const list = all.slice(0, clamp(probN, 1, 20));
      setProbAssignments(list);
      setSelectedAssignmentId(list[0]?.id ?? "");
    } catch (e: unknown) {
      const msg = String((e as { message?: unknown })?.message ?? "読み込みに失敗しました。");
      if (msg.includes("401")) {
        logout();
        router.replace("/login");
        return;
      }
      setErr(msg);
    } finally {
      setBusyProb(false);
    }
  };

  const loadProblemStats = async (assignmentId: string) => {
    if (!canLoad) return;
    if (!assignmentId) return;

    setBusyProb(true);
    setErr(null);
    setProblemData(null);
    try {
      const sp = new URLSearchParams();
      if (effectiveSelectedClassIds.length > 1) sp.set("classIds", effectiveSelectedClassIds.join(","));
      else sp.set("classId", selectedSingleClass || "ALL");
      const r = await apiGet<ByProblemResp>(
        `/teacher/assignments/${encodeURIComponent(assignmentId)}/by-problem?${sp.toString()}`
      );
      setProblemData(r);
    } catch (e: unknown) {
      const msg = String((e as { message?: unknown })?.message ?? "読み込みに失敗しました。");
      if (msg.includes("401")) {
        logout();
        router.replace("/login");
        return;
      }
      setErr(msg);
    } finally {
      setBusyProb(false);
    }
  };

  // 初期ロード：概要（クラス選択が変わっても概要を更新）
  useEffect(() => {
    if (!canLoad) return;
    loadSummary().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canLoad, selectedClass, selectedExtraClasses.join(",")]);

  // タブ切替時のロード
  useEffect(() => {
    if (!canLoad) return;
    if (tab === "summary") loadSummary().catch(() => {});
    if (tab === "heatmap") loadHeatmap().catch(() => {});
    if (tab === "problems") loadProbAssignmentList().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // problems: 課題選択が変わったら分析を再ロード
  useEffect(() => {
    if (!canLoad) return;
    if (tab !== "problems") return;
    if (!selectedAssignmentId) return;
    loadProblemStats(selectedAssignmentId).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAssignmentId, selectedClass, selectedExtraClasses.join(",")]);

  const selectedAssignment = useMemo(
    () => probAssignments.find((a) => a.id === selectedAssignmentId) ?? null,
    [probAssignments, selectedAssignmentId]
  );

  // 「要フォロー」の定義（このページの目的に合わせて）
  // - reviewPct が高い（△/×が多い） or nonePct が高い（未着手が多い）
  const needsFollow = (s: ByProblemResp["stats"][number]) => {
    const th = clamp(minReviewPct, 0, 100);
    const follow = s.reviewPct >= th || s.nonePct >= th;
    if (!follow) return false;
    if (!onlyNeedsFollow) return true;
    return follow;
  };

  const sortedProblemStats = useMemo(() => {
    if (!problemData) return [];
    let arr = [...(problemData.stats ?? [])];

    // hideEasy: どちらも低いものを薄める（見通し重視）
    if (hideEasy) {
      const th = clamp(minReviewPct, 0, 100);
      arr = arr.filter((s) => s.reviewPct >= th || s.nonePct >= th || s.batsuPct >= th);
    }

    // onlyNeedsFollow: さらに厳密に「要フォロー」だけ残す
    if (onlyNeedsFollow) {
      arr = arr.filter((s) => needsFollow(s));
    }

    // sort
    arr.sort((a, b) => {
      if (sortKey === "reviewPct") return b.reviewPct - a.reviewPct || b.nonePct - a.nonePct;
      if (sortKey === "none") return b.nonePct - a.nonePct || b.reviewPct - a.reviewPct;
      if (sortKey === "batsuPct") return b.batsuPct - a.batsuPct || b.reviewPct - a.reviewPct;
      // maruPctAsc
      return a.maruPct - b.maruPct || b.reviewPct - a.reviewPct;
    });

    return arr;
  }, [problemData, sortKey, minReviewPct, hideEasy, onlyNeedsFollow]);

  const followTop = useMemo(() => sortedProblemStats.slice(0, 10), [sortedProblemStats]);

  const totalN = useMemo(() => {
    if (!problemData) return 0;
    return problemData.n ?? 0;
  }, [problemData]);

  if (!mounted) return <main className="p-6">認証確認中...</main>;
  if (!user) return <main className="p-6">ログインへ遷移中...</main>;

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">クラス別進捗（ダッシュボード）</h1>
          <div className="text-sm text-gray-600">クラス単位の課題状況と、問題傾向の把握</div>
        </div>
        <div className="flex gap-2">
          <Link className="rounded-lg border px-3 py-2 hover:bg-gray-50" href="/teacher">
            教師ホームへ
          </Link>
          <Link className="rounded-lg border px-3 py-2 hover:bg-gray-50" href="/teacher/assignments">
            配布済み課題へ
          </Link>
        </div>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-sm">対象：</div>
        <select
          className="rounded-lg border px-3 py-2"
          value={selectedClass}
          onChange={(e) => {
            const next = e.target.value;
            setSelectedClass(next);
            if (next === ALL_CLASS_VALUE) setSelectedExtraClasses([]);
            else setSelectedExtraClasses((prev) => prev.filter((c) => c !== next));
          }}
        >
          <option value={ALL_CLASS_VALUE}>全クラス（合算）</option>
          {classIds.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <div className="text-xs text-gray-600">現在：{selectedScopeLabel}</div>

        <div className="ml-3 flex gap-2">
          <button
            className={`rounded-lg border px-3 py-2 text-sm ${tab === "summary" ? "bg-gray-100" : "hover:bg-gray-50"}`}
            onClick={() => setTab("summary")}
          >
            概要
          </button>
          <button
            className={`rounded-lg border px-3 py-2 text-sm ${tab === "heatmap" ? "bg-gray-100" : "hover:bg-gray-50"}`}
            onClick={() => setTab("heatmap")}
          >
            ヒートマップ
          </button>
          <button
            className={`rounded-lg border px-3 py-2 text-sm ${tab === "problems" ? "bg-gray-100" : "hover:bg-gray-50"}`}
            onClick={() => setTab("problems")}
          >
            問題別
          </button>

          <button
            className={`rounded-lg border px-3 py-2 text-sm ${tab === "books" ? "bg-gray-100" : "hover:bg-gray-50"}`}
            onClick={() => setTab("books")}
          >
            使用問題集
          </button>
        </div>

        <button
          className="rounded-lg border px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
          onClick={() => {
            if (tab === "summary") loadSummary();
            if (tab === "heatmap") loadHeatmap();
            if (tab === "problems") {
              if (!selectedAssignmentId) loadProbAssignmentList();
              else loadProblemStats(selectedAssignmentId);
            }
            if (tab === "books") loadBooks();
          }}
          disabled={busySummary || busyHeat || busyProb || busyBooks}
        >
          {busySummary || busyHeat || busyProb || busyBooks ? "更新中..." : "更新"}
        </button>

        <div className="text-xs text-gray-500">
          ※ ヒートマップ：全クラスまたは複数クラス選択では「クラス別平均進捗」、単一クラス選択では「生徒別進捗」。
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-sm">追加選択：</div>
        {classIds.map((c) => {
          const active = c === selectedClass || selectedExtraClasses.includes(c);
          return (
            <button
              key={c}
              type="button"
              className={`rounded-full border px-3 py-1 text-sm ${active ? "bg-gray-100" : "hover:bg-gray-50"} ${selectedClass === ALL_CLASS_VALUE && c !== selectedClass ? "opacity-50" : ""}`}
              onClick={() => {
                if (c === selectedClass) return;
                toggleExtraClass(c);
              }}
              disabled={selectedClass === ALL_CLASS_VALUE}
            >
              {active ? "✓ " : ""}
              {c}
            </button>
          );
        })}
        <div className="text-xs text-gray-500">※ プルダウンで主対象を選び、必要なクラスだけ追加できます。</div>
      </div>

      {/* ----------------- SUMMARY ----------------- */}
      {tab === "summary" && (
        <div className="space-y-2">
          {busySummary && <div className="text-sm text-gray-600">読み込み中...</div>}

          {!busySummary && (
            <div className="overflow-x-auto rounded-xl border">
              <table className="min-w-[980px] w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left p-3 w-64">課題</th>
                    <th className="text-left p-3 w-40">期限</th>
                    <th className="text-left p-3 w-24">問題数</th>
                    <th className="text-left p-3 w-24">対象</th>
                    <th className="text-left p-3">開始/完了/未着手</th>
                    <th className="text-left p-3 w-40">平均進捗</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryRows.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="p-3">
                        <Link className="font-semibold hover:underline" href={`/teacher/assignments/${r.id}`}>
                          {r.title}
                        </Link>
                        <div className="text-xs text-gray-500">
                          配布先：{(r.class_ids ?? []).length ? (r.class_ids ?? []).join(", ") : "未設定"}
                        </div>
                      </td>
                      <td className="p-3 text-gray-700">{formatDue(r.due_at)}</td>
                      <td className="p-3 text-gray-700">{r.total}</td>
                      <td className="p-3 text-gray-700">{r.students}</td>
                      <td className="p-3 text-gray-700">
                        開始 {r.started} / 完了 {r.completed} / 未 {r.unstarted}
                      </td>
                      <td className="p-3">
                        <div className="h-3 rounded-full border overflow-hidden">
                          <div className="h-3 bg-gray-900" style={{ width: `${clamp(r.avgPct, 0, 100)}%`, opacity: 0.15 }} />
                        </div>
                        <div className="text-xs text-gray-600 text-right mt-1">{clamp(r.avgPct, 0, 100)}%</div>
                      </td>
                    </tr>
                  ))}

                  {summaryRows.length === 0 && !busySummary && (
                    <tr className="border-t">
                      <td className="p-3 text-gray-600" colSpan={6}>
                        表示できる課題がありません（open課題が無い可能性があります）。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="text-xs text-gray-500">
            ※ 平均進捗は「対象生徒の (完了数/問題数) の平均」です。未着手も平均に含みます。
          </div>
        </div>
      )}

      {/* ----------------- BOOKS ----------------- */}
      {tab === "books" && (
        <div className="space-y-2">
          <div className="text-sm text-gray-700">※ このクラスで「使用中」として登録されている問題集一覧です（問題集詳細のチェックで管理）。</div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              className="rounded-lg border px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
              disabled={busyBooks}
              onClick={loadBooks}
            >
              {busyBooks ? "読み込み中..." : "読み込む"}
            </button>

            {effectiveSelectedClassIds.length !== 1 && <div className="text-sm text-gray-600">単一クラスを選択してください。</div>}
          </div>

          <div className="overflow-x-auto rounded-xl border">
            <table className="min-w-[720px] w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-3">問題集</th>
                  <th className="text-left p-3 w-40">作成日</th>
                  <th className="text-left p-3 w-40">操作</th>
                </tr>
              </thead>
              <tbody>
                {classBooks.map((b) => (
                  <tr key={b.id} className="border-t">
                    <td className="p-3">
                      <div className="font-semibold">{b.name}</div>
                      <div className="text-xs text-gray-500">ID: {b.id}</div>
                    </td>
                    <td className="p-3 text-gray-700">{new Date(b.created_at).toLocaleDateString("ja-JP")}</td>
                    <td className="p-3">
                      <Link className="rounded-lg border px-3 py-2 bg-white hover:bg-gray-50" href={`/teacher/books/${b.id}`}>
                        詳細
                      </Link>
                    </td>
                  </tr>
                ))}

                {!busyBooks && classBooks.length === 0 && (
                  <tr className="border-t">
                    <td className="p-3 text-gray-600" colSpan={3}>
                      {effectiveSelectedClassIds.length !== 1
                        ? "単一クラスを選択してください。"
                        : "このクラスで使用中の問題集がありません。問題集詳細から『使用クラス』を登録してください。"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ----------------- HEATMAP ----------------- */}
      {tab === "heatmap" && (
        <div className="space-y-3">
          <div className="text-sm text-gray-700">
            ※ 全クラスまたは複数クラス選択では「クラス別平均進捗」、単一クラス選択時は「生徒別進捗」を表示します。
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-sm">表示課題数：</div>
            <input
              className="rounded-lg border px-3 py-2 w-24"
              type="number"
              value={heatN}
              min={1}
              max={20}
              onChange={(e) => setHeatN(Number(e.target.value || 8))}
            />

            <button
              className="rounded-lg border px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
              disabled={busyHeat}
              onClick={loadHeatmap}
              title={effectiveSelectedClassIds.length === 1 ? "選択クラスを作成" : "選択範囲を作成"}
            >
              {busyHeat ? "作成中..." : "作成"}
            </button>

            {heatToast && <span className="text-sm text-gray-600">{heatToast}</span>}
          </div>

          {busyHeat && <div className="text-sm text-gray-600">読み込み中...</div>}

          {!busyHeat && effectiveSelectedClassIds.length !== 1 && (
            <>
              {heatAllData ? (
                <div className="overflow-x-auto rounded-xl border">
                  <table className="min-w-[980px] w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left p-3 w-40">クラス</th>
                        {heatAllData.assignments.map((a) => (
                          <th key={a.id} className="text-left p-3 w-28">
                            <div className="font-semibold truncate">{a.title}</div>
                            <div className="text-xs text-gray-500">{formatDue(a.due_at)}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {heatAllData.classIds.map((c) => (
                        <tr key={c} className="border-t">
                          <td className="p-3 font-semibold">{c}</td>
                          {heatAllData.assignments.map((a) => {
                            const pct = heatAllData.heat?.[c]?.[a.id] ?? 0;
                            const un = heatAllData.unstarted?.[c]?.[a.id] ?? 0;
                            return (
                              <td key={a.id} className="p-3">
                                <div
                                  className="rounded-lg border px-2 py-1 text-center"
                                  style={{ backgroundColor: pctColor(pct) }}
                                  title={`平均進捗 ${pct}% / 未着手 ${un}`}
                                >
                                  {pct}%
                                </div>
                                <div className="text-xs text-gray-500 mt-1">未 {un}</div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}

                      {heatAllData.classIds.length === 0 && (
                        <tr className="border-t">
                          <td className="p-3 text-gray-600" colSpan={1 + heatAllData.assignments.length}>
                            クラスがありません。
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-sm text-gray-600">「作成」を押すと表示されます。</div>
              )}
            </>
          )}

          {!busyHeat && effectiveSelectedClassIds.length === 1 && (
            <>
              {heatData ? (
                <div className="overflow-x-auto rounded-xl border">
                  <table className="min-w-[980px] w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left p-3 w-40">生徒</th>
                        {heatData.assignments.map((a) => (
                          <th key={a.id} className="text-left p-3 w-28">
                            <div className="font-semibold truncate">{a.title}</div>
                            <div className="text-xs text-gray-500">{formatDue(a.due_at)}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {heatData.students.map((s) => (
                        <tr key={s.uid} className="border-t">
                          <td className="p-3 font-semibold">{s.name}</td>
                          {heatData.assignments.map((a) => {
                            const pct = heatData.heat?.[s.uid]?.[a.id] ?? 0;
                            const un = heatData.unstarted?.[s.uid] ?? 0;
                            return (
                              <td key={a.id} className="p-3">
                                <div
                                  className="rounded-lg border px-2 py-1 text-center"
                                  style={{ backgroundColor: pctColor(pct) }}
                                  title={`進捗 ${pct}%`}
                                >
                                  {pct}%
                                </div>
                                <div className="text-xs text-gray-500 mt-1">{un > 0 ? `未 ${un}` : ""}</div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}

                      {heatData.students.length === 0 && (
                        <tr className="border-t">
                          <td className="p-3 text-gray-600" colSpan={1 + heatData.assignments.length}>
                            生徒がありません。
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-sm text-gray-600">「作成」を押すと表示されます。</div>
              )}
            </>
          )}
        </div>
      )}

      {/* ----------------- PROBLEMS ----------------- */}
      {tab === "problems" && (
        <div className="space-y-3">
          <div className="text-sm text-gray-700">
            目的：<b>フォローが必要な問題（△/×が多い・未着手が多い）</b>を上位に出し、指導につなげます。
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-sm">表示課題数：</div>
            <input
              className="rounded-lg border px-3 py-2 w-24"
              type="number"
              value={probN}
              min={1}
              max={20}
              onChange={(e) => setProbN(Number(e.target.value || 10))}
            />

            <button
              className="rounded-lg border px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
              disabled={busyProb}
              onClick={loadProbAssignmentList}
              title="open課題から取得します"
            >
              {busyProb ? "読込中..." : "課題を読み込む"}
            </button>

            <div className="text-xs text-gray-500">※ open課題のみ（配布中）を対象にします。</div>
          </div>

          {probAssignments.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-sm">課題：</div>
              <select
                className="rounded-lg border px-3 py-2 min-w-[360px] max-w-full"
                value={selectedAssignmentId}
                onChange={(e) => setSelectedAssignmentId(e.target.value)}
              >
                {probAssignments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title}（{formatDue(a.due_at)} / 問題数 {a.total}）
                  </option>
                ))}
              </select>

              {selectedAssignmentId && (
                <Link
                  className="rounded-lg border px-3 py-2 hover:bg-gray-50 text-sm"
                  href={`/teacher/assignments/${selectedAssignmentId}?tab=problems`}
                >
                  課題詳細（問題登録へ）
                </Link>
              )}
            </div>
          )}

          {busyProb && <div className="text-sm text-gray-600">読み込み中...</div>}

          {!busyProb && selectedAssignment && problemData && (
            <>
              {/* 未登録ガイド */}
              {(!problemData.labels || problemData.labels.length === 0) && (
                <div className="rounded-xl border p-4 bg-yellow-50 text-sm text-yellow-800">
                  この課題は <b>問題ラベルが未登録</b>です。まず{" "}
                  <Link className="underline" href={`/teacher/assignments/${selectedAssignment.id}?tab=problems`}>
                    課題詳細 → 問題登録
                  </Link>{" "}
                  で 1..N 生成（または貼り付け）→ 保存してください。
                </div>
              )}

              {/* 分析コントロール */}
              <div className="rounded-xl border p-4 space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="text-sm">
                    対象人数：<b>{totalN}</b>
                    <span className="text-xs text-gray-500 ml-2">
                      （{selectedScopeLabel}）
                    </span>
                  </div>

                  <div className="ml-auto flex items-center gap-2 flex-wrap">
                    <div className="text-sm">並び：</div>
                    <select className="rounded-lg border px-3 py-2" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                      <option value="reviewPct">要復習%（△/×）が高い順</option>
                      <option value="none">未着手%が高い順</option>
                      <option value="batsuPct">×%が高い順</option>
                      <option value="maruPctAsc">○%が低い順</option>
                    </select>

                    <div className="text-sm ml-2">しきい値%：</div>
                    <input
                      className="rounded-lg border px-3 py-2 w-20"
                      type="number"
                      min={0}
                      max={100}
                      value={minReviewPct}
                      onChange={(e) => setMinReviewPct(Number(e.target.value || 0))}
                      title="要復習% または 未着手% の判定に使います"
                    />

                    <label className="flex items-center gap-2 text-sm ml-2">
                      <input type="checkbox" checked={hideEasy} onChange={(e) => setHideEasy(e.target.checked)} />
                      見通し重視（低い行を隠す）
                    </label>

                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={onlyNeedsFollow} onChange={(e) => setOnlyNeedsFollow(e.target.checked)} />
                      要フォローのみ
                    </label>
                  </div>
                </div>

                {/* Top10 */}
                <div className="text-sm">
                  <b>要フォロー上位（最大10）</b>
                  <div className="text-xs text-gray-600">
                    条件：要復習% または 未着手% が {clamp(minReviewPct, 0, 100)}% 以上
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {followTop.length === 0 ? (
                    <div className="text-sm text-gray-600">該当なし（しきい値を下げると表示されます）。</div>
                  ) : (
                    followTop.map((s) => (
                      <span
                        key={s.label}
                        className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs bg-white"
                        title={`○${s.maruPct}% △${s.sankakuPct}% ×${s.batsuPct}% 未${s.nonePct}% / 要復習${s.reviewPct}%`}
                      >
                        <b className="font-mono">{s.label}</b>
                        <span className="text-gray-600">要復習 {s.reviewPct}%</span>
                        <span className="text-gray-500">未 {s.nonePct}%</span>
                      </span>
                    ))
                  )}
                </div>
              </div>

              {/* 表 */}
              <div className="overflow-x-auto rounded-xl border">
                <table className="min-w-[1100px] w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left p-3 w-28">問題</th>
                      <th className="text-left p-3 w-48">内訳（バー）</th>
                      <th className="text-left p-3 w-72">割合</th>
                      <th className="text-left p-3 w-48">人数</th>
                      <th className="text-left p-3 w-28">要復習%</th>
                      <th className="text-left p-3 w-28">未着手%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedProblemStats.map((s) => {
                      const follow = s.reviewPct >= clamp(minReviewPct, 0, 100) || s.nonePct >= clamp(minReviewPct, 0, 100);
                      const barMaru = clamp(s.maruPct, 0, 100);
                      const barSan = clamp(s.sankakuPct, 0, 100);
                      const barBat = clamp(s.batsuPct, 0, 100);
                      const barNon = clamp(s.nonePct, 0, 100);

                      return (
                        <tr key={s.label} className="border-t">
                          <td className="p-3 font-mono font-semibold">{s.label}</td>

                          <td className="p-3">
                            <div className="h-3 rounded-full border overflow-hidden flex" title="○/△/×/未 の割合バー">
                              <div style={{ width: `${barMaru}%`, background: "rgba(0,0,0,0.08)" }} />
                              <div style={{ width: `${barSan}%`, background: "rgba(0,0,0,0.16)" }} />
                              <div style={{ width: `${barBat}%`, background: "rgba(0,0,0,0.26)" }} />
                              <div style={{ width: `${barNon}%`, background: "rgba(0,0,0,0.04)" }} />
                            </div>
                            <div className="text-xs text-gray-500 mt-1">○ / △ / × / 未</div>
                          </td>

                          <td className="p-3">
                            <div className={`inline-block rounded-lg border px-2 py-1 text-xs ${follow ? "bg-yellow-50 border-yellow-400 text-yellow-800" : "bg-white"}`}>
                              ○{s.maruPct}% △{s.sankakuPct}% ×{s.batsuPct}% 未{s.nonePct}%
                            </div>
                          </td>

                          <td className="p-3 text-gray-700">
                            ○{s.maru} / △{s.sankaku} / ×{s.batsu} / 未{s.none}
                          </td>

                          <td className="p-3">
                            <div
                              className="rounded-lg border px-2 py-1 text-center"
                              style={{ backgroundColor: pctColor(s.reviewPct) }}
                              title="要復習%（△/×の合計）"
                            >
                              {s.reviewPct}%
                            </div>
                          </td>

                          <td className="p-3">
                            <div
                              className="rounded-lg border px-2 py-1 text-center"
                              style={{ backgroundColor: pctColor(s.nonePct) }}
                              title="未着手%"
                            >
                              {s.nonePct}%
                            </div>
                          </td>
                        </tr>
                      );
                    })}

                    {sortedProblemStats.length === 0 && (
                      <tr className="border-t">
                        <td className="p-3 text-gray-600" colSpan={6}>
                          表示できるデータがありません（しきい値/フィルタを調整してください）。
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="text-xs text-gray-500">
                ※ 「要復習%」は △+× の割合です。未着手%も合わせて見ると、指導（解説）と提出促しの優先度が分かります。
              </div>
            </>
          )}

          {!busyProb && probAssignments.length === 0 && (
            <div className="text-sm text-gray-600">「課題を読み込む」を押してください。</div>
          )}
        </div>
      )}
    </main>
  );
}