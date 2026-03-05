"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import { getUserFromToken, logout } from "@/lib/auth";

type AssignmentRow = {
  id: string;
  title: string;
  status: "open" | "closed" | "archived";
  due_at: string | null;
  created_at: string;
};

type BaseResp = {
  assignment: AssignmentRow;
  classIds: string[];
  labels: string[];
};

type Mark = "maru" | "sankaku" | "batsu";

type StudentRowRaw = {
  uid: string;
  name: string;
  classId: string;
  updatedAt: string | null;
  statusByLabel: Record<string, Mark>;
  timeByLabel: Record<string, string>;
};

type ByProblemResp = {
  classId: string; // "ALL" or classId
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

const countMarks = (statusByLabel: Record<string, unknown>) => {
  let maru = 0,
    sankaku = 0,
    batsu = 0;
  for (const v of Object.values(statusByLabel ?? {})) {
    if (v === "maru") maru++;
    else if (v === "sankaku") sankaku++;
    else if (v === "batsu") batsu++;
  }
  const done = maru + sankaku + batsu;
  return { maru, sankaku, batsu, done };
};

const formatDue = (dueAt: string | null) => {
  if (!dueAt) return "無期限";
  const d = new Date(dueAt);
  return `${d.toLocaleDateString("ja-JP")} まで`;
};

function parseLabels(text: string): string[] {
  const parts = text
    .replaceAll("，", ",")
    .split(/[\n,\s]+/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const normalizeLabel = (raw: string) => {
    let s = raw.trim();

    s = s
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[Ａ-Ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[ａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

    s = s.replace(/[‐-‒–—−ーｰ]/g, "-");
    s = s.replace(/\s+/g, " ");
    s = s.replace(/[A-Z]/g, (c) => c.toLowerCase());

    if (/^\d+$/.test(s)) s = String(parseInt(s, 10));

    const m = s.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const a = String(parseInt(m[1], 10));
      const b = String(parseInt(m[2], 10));
      s = `${a}-${b}`;
    }
    return s;
  };

  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const norm = normalizeLabel(p);
    if (!norm) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

const ALL_CLASS_VALUE = "__ALL__";

const statusLabel = (s: AssignmentRow["status"]) => {
  if (s === "open") return "配布中";
  if (s === "closed") return "停止";
  return "アーカイブ";
};

const statusBadgeClass = (s: AssignmentRow["status"]) => {
  if (s === "open") return "border-green-500 bg-green-50 text-green-700";
  if (s === "closed") return "border-yellow-500 bg-yellow-50 text-yellow-700";
  return "border-gray-400 bg-gray-50 text-gray-700";
};

export default function TeacherAssignmentDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const assignmentId = String(params?.id ?? "");

  // auth（hydration対策）
  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<any | null>(null);

  // base
  const [err, setErr] = useState<string | null>(null);
  const [base, setBase] = useState<BaseResp | null>(null);
  const [selectedClass, setSelectedClass] = useState<string>("");

  // tabs（URL ?tab=students|problems|manage）
  const initialTab = (() => {
    const t = String(searchParams?.get("tab") ?? "");
    if (t === "problems") return "problems" as const;
    if (t === "manage") return "manage" as const;
    return "students" as const;
  })();
  const [tab, setTab] = useState<"students" | "problems" | "manage">(initialTab);

  // students
  const [rows, setRows] = useState<
    Array<{
      uid: string;
      name: string;
      classId: string;
      updatedAtText: string;
      total: number;
      maru: number;
      sankaku: number;
      batsu: number;
      done: number;
      pct: number;
      wMaru: number;
      wSankaku: number;
      wBatsu: number;
      statusByLabel: Record<string, Mark>;
      timeByLabel: Record<string, string>;
    }>
  >([]);
  const [openUid, setOpenUid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // problem stats
  const [byProblem, setByProblem] = useState<ByProblemResp | null>(null);
  const [busyProblem, setBusyProblem] = useState(false);

  // manage labels UI
  const [labelText, setLabelText] = useState("");
  const [genN, setGenN] = useState<number>(20);
  const [savingLabels, setSavingLabels] = useState(false);

  // manage status/delete
  const [busyManage, setBusyManage] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(""); // ★安全：DELETE入力
  const deleteEnabled = useMemo(() => deleteConfirm.trim().toUpperCase() === "DELETE", [deleteConfirm]);

  const parsedLabels = useMemo(() => parseLabels(labelText), [labelText]);

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

  const loadBase = async () => {
    setErr(null);
    const b = await apiGet<BaseResp>(`/teacher/assignments/${encodeURIComponent(assignmentId)}/base`);
    setBase(b);

    const cls = (b.classIds ?? []).filter((c) => c && c !== "ALL");
    const fromUrl = searchParams?.get("class") ?? "";
    const init = (fromUrl && cls.includes(fromUrl) ? fromUrl : "") || cls[0] || ALL_CLASS_VALUE;
    setSelectedClass((prev) => prev || init);

    setLabelText((prev) => (prev.trim() ? prev : (b.labels ?? []).join("\n")));

    // 削除入力は毎回初期化
    setDeleteConfirm("");
  };

  useEffect(() => {
    if (!mounted) return;
    if (!user || user.role !== "teacher") return;

    loadBase().catch((e: unknown) => {
      const msg = String((e as any)?.message ?? "読み込みエラー");
      if (msg.includes("401")) {
        logout();
        router.replace("/login");
        return;
      }
      setErr(msg);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, user?.uid, assignmentId]);

  const labels = base?.labels ?? [];
  const total = labels.length;

  const loadStudents = async (classId: string) => {
    if (!base) return;
    if (!classId || classId === ALL_CLASS_VALUE) {
      setRows([]);
      return;
    }
    setBusy(true);
    setErr(null);
    setRows([]);
    setOpenUid(null);

    try {
      const r = await apiGet<{ students: StudentRowRaw[] }>(
        `/teacher/assignments/${encodeURIComponent(assignmentId)}/students?classId=${encodeURIComponent(classId)}`
      );

      const studs = (r.students ?? []).map((s) => {
        const { maru, sankaku, batsu, done } = countMarks(s.statusByLabel ?? {});
        const doneC = total > 0 ? Math.min(done, total) : 0;

        const maruC = total > 0 ? Math.min(maru, total) : 0;
        const sankakuC = total > 0 ? Math.min(sankaku, Math.max(0, total - maruC)) : 0;
        const batsuC = total > 0 ? Math.min(batsu, Math.max(0, total - maruC - sankakuC)) : 0;

        const pct = total > 0 ? Math.round((doneC / total) * 100) : 0;

        const wMaru = total > 0 ? (maruC / total) * 100 : 0;
        const wSankaku = total > 0 ? (sankakuC / total) * 100 : 0;
        const wBatsu = total > 0 ? (batsuC / total) * 100 : 0;

        const updatedAtText = s.updatedAt ? new Date(s.updatedAt).toLocaleString("ja-JP") : "-";

        return {
          uid: s.uid,
          name: s.name,
          classId: s.classId,
          updatedAtText,
          total,
          maru: maruC,
          sankaku: sankakuC,
          batsu: batsuC,
          done: doneC,
          pct: clamp(pct, 0, 100),
          wMaru: clamp(wMaru, 0, 100),
          wSankaku: clamp(wSankaku, 0, 100),
          wBatsu: clamp(wBatsu, 0, 100),
          statusByLabel: s.statusByLabel ?? {},
          timeByLabel: s.timeByLabel ?? {},
        };
      });

      studs.sort((a, b) => a.name.localeCompare(b.name, "ja"));
      setRows(studs);
    } catch (e: unknown) {
      const msg = String((e as any)?.message ?? "読み込みに失敗しました。");
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

  const loadByProblem = async (classValue: string) => {
    if (!base) return;
    setBusyProblem(true);
    setErr(null);
    setByProblem(null);
    try {
      const classId = classValue === ALL_CLASS_VALUE ? "ALL" : classValue;
      const r = await apiGet<ByProblemResp>(
        `/teacher/assignments/${encodeURIComponent(assignmentId)}/by-problem?classId=${encodeURIComponent(classId)}`
      );
      setByProblem(r);
    } catch (e: unknown) {
      const msg = String((e as any)?.message ?? "読み込みに失敗しました。");
      if (msg.includes("401")) {
        logout();
        router.replace("/login");
        return;
      }
      setErr(msg);
    } finally {
      setBusyProblem(false);
    }
  };

  const classOptions = useMemo(() => {
    const cls = Array.from(new Set((base?.classIds ?? []).filter((c) => c && c !== "ALL")));
    cls.sort((a, b) => a.localeCompare(b, "ja"));
    return cls;
  }, [base]);

  const sortedProblemStats = useMemo(() => {
    if (!byProblem) return [];
    return [...(byProblem.stats ?? [])].sort((a, b) => b.none - a.none || b.review - a.review);
  }, [byProblem]);

  const saveLabels = async () => {
    setSavingLabels(true);
    setErr(null);
    try {
      await apiPut(`/teacher/assignments/${encodeURIComponent(assignmentId)}/problems`, {
        labels: parsedLabels,
      });
      await loadBase();
      setTab("problems");
    } catch (e: unknown) {
      const msg = String((e as any)?.message ?? "保存に失敗しました。");
      if (msg.includes("401")) {
        logout();
        router.replace("/login");
        return;
      }
      setErr(msg);
    } finally {
      setSavingLabels(false);
    }
  };

  const setAssignmentStatus = async (status: AssignmentRow["status"]) => {
    if (!base) return;
    if (base.assignment.status === status) return;

    const label = statusLabel(status);
    const ok = window.confirm(`課題の状態を「${label}」に変更します。よろしいですか？`);
    if (!ok) return;

    setBusyManage(true);
    setErr(null);
    try {
      await apiPost(`/assignments/${encodeURIComponent(assignmentId)}/status`, { status });
      await loadBase();
    } catch (e: unknown) {
      const msg = String((e as any)?.message ?? "状態変更に失敗しました。");
      if (msg.includes("401")) {
        logout();
        router.replace("/login");
        return;
      }
      setErr(msg);
    } finally {
      setBusyManage(false);
    }
  };

  const deleteAssignment = async () => {
    if (!base) return;

    if (!deleteEnabled) {
      setErr("削除するには確認欄に DELETE と入力してください。");
      return;
    }

    const ok = window.confirm(
      "この課題を削除します。\n\n注意：課題・提出状況などが削除され、元に戻せません。\n本当に削除しますか？"
    );
    if (!ok) return;

    setBusyManage(true);
    setErr(null);
    try {
      await apiPost(`/assignments/${encodeURIComponent(assignmentId)}/delete`, {});
      router.replace("/teacher/assignments");
    } catch (e: unknown) {
      const msg = String((e as any)?.message ?? "削除に失敗しました。");
      if (msg.includes("401")) {
        logout();
        router.replace("/login");
        return;
      }
      setErr(msg);
    } finally {
      setBusyManage(false);
    }
  };

  // auto-load on tab
  useEffect(() => {
    if (!base) return;
    if (!selectedClass) return;

    if (tab === "students") {
      if (labels.length === 0) return;
      loadStudents(selectedClass).catch(() => {});
    } else if (tab === "problems") {
      loadByProblem(selectedClass).catch(() => {});
    } else if (tab === "manage") {
      // manageはbaseで十分（自動ロード不要）
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selectedClass, base?.assignment?.id, labels.length]);

  if (!mounted) return <main className="p-6">認証確認中...</main>;
  if (!user) return <main className="p-6">ログインへ遷移中...</main>;
  if (!base) return <main className="p-6">読み込み中...</main>;

  const a = base.assignment;

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">進捗確認</h1>
          <div className="text-sm text-gray-600">{a.title}</div>
          <div className="text-sm text-gray-600 flex items-center gap-2 flex-wrap">
            <span>期限：{formatDue(a.due_at)}</span>
            <span>/ 問題数：{labels.length}</span>
            <span className={`inline-block rounded-full border px-3 py-1 text-xs ${statusBadgeClass(a.status)}`}>
              {statusLabel(a.status)}
            </span>
          </div>
        </div>

        <div className="flex gap-2">
          <Link className="rounded-lg border px-3 py-2 hover:bg-gray-50" href="/teacher">
            教師ホームへ
          </Link>
          <Link className="rounded-lg border px-3 py-2 hover:bg-gray-50" href="/teacher/assignments">
            一覧へ戻る
          </Link>
        </div>
      </div>

      {err && <p className="text-sm text-red-600 whitespace-pre-wrap">{err}</p>}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-sm">対象：</div>
        <select
          className="rounded-lg border px-3 py-2"
          value={selectedClass}
          onChange={(e) => setSelectedClass(e.target.value)}
        >
          <option value={ALL_CLASS_VALUE}>全クラス（合算）</option>
          {classOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <button
          className="rounded-lg border px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
          onClick={() => {
            if (tab === "students") loadStudents(selectedClass);
            else if (tab === "problems") loadByProblem(selectedClass);
            else loadBase();
          }}
          disabled={busy || busyProblem || savingLabels || busyManage}
        >
          {busy || busyProblem || savingLabels || busyManage ? "更新中..." : "更新"}
        </button>

        <div className="ml-3 flex gap-2">
          <button
            className={`rounded-lg border px-3 py-2 text-sm ${tab === "students" ? "bg-gray-100" : "hover:bg-gray-50"}`}
            onClick={() => setTab("students")}
          >
            生徒別
          </button>
          <button
            className={`rounded-lg border px-3 py-2 text-sm ${tab === "problems" ? "bg-gray-100" : "hover:bg-gray-50"}`}
            onClick={() => setTab("problems")}
          >
            問題別分析
          </button>
          <button
            className={`rounded-lg border px-3 py-2 text-sm ${tab === "manage" ? "bg-gray-100" : "hover:bg-gray-50"}`}
            onClick={() => setTab("manage")}
          >
            管理
          </button>
        </div>

        <div className="text-xs text-gray-500">※「生徒別」は単一クラスのみ（全クラスは表示しません）。</div>
      </div>

      {/* ======================== MANAGE ======================== */}
      {tab === "manage" && (
        <div className="space-y-4">
          {/* 状態変更 */}
          <div className="rounded-xl border p-4 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="font-semibold">課題の状態（停止/再開/アーカイブ）</div>
                <div className="text-sm text-gray-600">
                  現在：<b>{statusLabel(a.status)}</b>
                </div>
                <div className="text-sm text-gray-600">
                  配布先：{(base.classIds ?? []).filter((c) => c && c !== "ALL").length
                    ? (base.classIds ?? []).filter((c) => c && c !== "ALL").join(", ")
                    : "-"}
                </div>
              </div>

              <div className="flex gap-2 flex-wrap">
                <button
                  className="rounded-lg border px-3 py-2 hover:bg-gray-50 disabled:opacity-50 text-sm"
                  disabled={busyManage || a.status === "open"}
                  onClick={() => setAssignmentStatus("open")}
                  title="停止/アーカイブから配布中へ戻します"
                >
                  再開（open）
                </button>
                <button
                  className="rounded-lg border px-3 py-2 hover:bg-gray-50 disabled:opacity-50 text-sm"
                  disabled={busyManage || a.status === "closed"}
                  onClick={() => setAssignmentStatus("closed")}
                  title="配布をいったん止めたい時"
                >
                  停止（closed）
                </button>
                <button
                  className="rounded-lg border px-3 py-2 hover:bg-gray-50 disabled:opacity-50 text-sm"
                  disabled={busyManage || a.status === "archived"}
                  onClick={() => setAssignmentStatus("archived")}
                  title="基本的に一覧から外したい時"
                >
                  アーカイブ
                </button>
              </div>
            </div>

            <div className="text-xs text-gray-500">
              ※ 「停止」は運用上の取り下げ（閲覧は残す）として使えます。
            </div>
          </div>

          {/* 問題ラベル */}
          <div className="rounded-xl border p-4 space-y-3">
            <div className="font-semibold">問題ラベル（分析用）登録</div>
            <div className="text-sm text-gray-700">
              改行・カンマ・空白で区切って入力できます（表記ゆれに注意）。
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-sm text-gray-700">1〜N を生成：</div>
              <input
                className="w-24 rounded-lg border px-3 py-2"
                type="number"
                min={1}
                max={500}
                value={genN}
                onChange={(e) => setGenN(Number(e.target.value))}
              />
              <button
                className="rounded-lg border px-3 py-2 hover:bg-gray-50"
                onClick={() => {
                  const n = Math.max(1, Math.min(500, Number.isFinite(genN) ? genN : 20));
                  setLabelText(Array.from({ length: n }, (_, i) => String(i + 1)).join("\n"));
                }}
              >
                生成して上書き
              </button>

              <button
                className="rounded-lg border px-3 py-2 hover:bg-gray-50"
                onClick={() => setLabelText((base.labels ?? []).join("\n"))}
              >
                現在のラベルを読み込み
              </button>
            </div>

            <textarea
              className="w-full min-h-[220px] rounded-xl border p-3 font-mono text-sm"
              value={labelText}
              onChange={(e) => setLabelText(e.target.value)}
              placeholder={"例）\n1\n2\n3\n4\n5\n\nまたは\nA-1, A-2, A-3\n"}
            />

            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-sm text-gray-600">
                登録予定：<b>{parsedLabels.length}</b> 件
                {parsedLabels.length === 0 && <span className="ml-2 text-red-600">（0件だと分析は出ません）</span>}
              </div>

              <button
                className="rounded-lg border px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
                onClick={saveLabels}
                disabled={savingLabels || busyManage}
                title={parsedLabels.length === 0 ? "空でも保存は可能ですが、分析は表示されません" : "保存"}
              >
                {savingLabels ? "保存中..." : "保存"}
              </button>
            </div>

            <div className="text-xs text-gray-500">
              ※ 保存後、「問題別分析」タブで集計が表示されます。
            </div>
          </div>

          {/* 危険操作（削除） */}
          <div className="rounded-xl border border-red-400 p-4 space-y-3 bg-red-50">
            <div className="font-semibold text-red-800">危険操作（復元不可）</div>
            <div className="text-sm text-red-800">
              課題を削除すると <b>課題・提出状況などが完全に削除</b>され、元に戻せません。
            </div>

            <div className="space-y-2">
              <div className="text-sm text-red-800">
                削除する場合は、下に <b>DELETE</b> と入力してください：
              </div>
              <input
                className="w-[260px] max-w-full rounded-lg border border-red-300 px-3 py-2"
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder="DELETE"
              />
            </div>

            <button
              className="rounded-lg border border-red-500 px-3 py-2 hover:bg-red-100 text-red-800 disabled:opacity-50 text-sm"
              disabled={busyManage || !deleteEnabled}
              onClick={deleteAssignment}
              title="完全削除（復元不可）"
            >
              削除（復元不可）
            </button>
          </div>
        </div>
      )}

      {/* ======================== STUDENTS ======================== */}
      {tab === "students" && (
        <>
          {labels.length === 0 ? (
            <div className="rounded-xl border p-4 text-sm text-gray-700">
              この課題は問題ラベルが未登録です。先に「管理」タブで問題を登録してください。
            </div>
          ) : selectedClass === ALL_CLASS_VALUE ? (
            <div className="rounded-xl border p-4 text-sm text-gray-700">
              「生徒別」はクラス単位で閲覧します。上の対象をクラスに切り替えてください。
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="min-w-[980px] w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left p-3 w-56">生徒</th>
                    <th className="text-left p-3 w-56">最終更新</th>
                    <th className="text-left p-3 w-72">進捗（積み上げ）</th>
                    <th className="text-left p-3">数</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <>
                      <tr key={r.uid} className="border-t align-top">
                        <td className="p-3">
                          <button className="hover:underline" onClick={() => setOpenUid(openUid === r.uid ? null : r.uid)}>
                            {r.name}
                          </button>
                          <div className="text-xs text-gray-500">{r.classId}</div>
                        </td>
                        <td className="p-3 text-gray-600">{r.updatedAtText}</td>
                        <td className="p-3">
                          <div className="h-3 rounded-full border overflow-hidden flex">
                            <div className="h-3 bg-green-500" style={{ width: `${r.wMaru}%` }} />
                            <div className="h-3 bg-yellow-400" style={{ width: `${r.wSankaku}%` }} />
                            <div className="h-3 bg-red-500" style={{ width: `${r.wBatsu}%` }} />
                          </div>
                          <div className="text-xs text-gray-500 text-right mt-1">{r.pct}%</div>
                        </td>
                        <td className="p-3 text-gray-700">
                          {r.done}/{r.total}（○{r.maru} / △{r.sankaku} / ×{r.batsu}）
                        </td>
                      </tr>

                      {openUid === r.uid && (
                        <tr className="border-t bg-gray-50">
                          <td className="p-3" colSpan={4}>
                            <div className="text-sm font-semibold mb-2">実施ログ（初回入力時刻）</div>
                            {Object.keys(r.statusByLabel ?? {}).length === 0 ? (
                              <div className="text-sm text-gray-600">まだ入力がありません。</div>
                            ) : (
                              <div className="overflow-x-auto">
                                <table className="min-w-[900px] w-full text-xs">
                                  <thead>
                                    <tr>
                                      <th className="text-left p-2 w-56">問題</th>
                                      <th className="text-left p-2 w-16">記号</th>
                                      <th className="text-left p-2">時刻（初回）</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {labels.map((lb) => {
                                      const mk = r.statusByLabel?.[lb];
                                      const at = r.timeByLabel?.[lb];
                                      const atText = at ? new Date(at).toLocaleString("ja-JP") : "-";
                                      return (
                                        <tr key={lb} className="border-t">
                                          <td className="p-2 font-mono">{lb}</td>
                                          <td className="p-2">{mk === "maru" ? "○" : mk === "sankaku" ? "△" : mk === "batsu" ? "×" : "-"}</td>
                                          <td className="p-2 text-gray-600">{atText}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  ))}

                  {rows.length === 0 && (
                    <tr className="border-t">
                      <td className="p-3 text-gray-600" colSpan={4}>
                        生徒がいません（クラス選択が正しいか確認してください）。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ======================== PROBLEMS ======================== */}
      {tab === "problems" && (
        <div className="rounded-xl border p-4 space-y-3">
          {labels.length === 0 ? (
            <div className="text-sm text-gray-700">
              この課題は問題ラベルが未登録です。先に「管理」タブで問題を登録してください。
            </div>
          ) : (
            <>
              <div className="text-sm text-gray-700">
                <b>並び順：</b> 未着手が多い順 → 同率なら要復習率（△+×）が高い順
              </div>

              <div className="text-sm text-gray-600">
                対象生徒数：{byProblem?.n ?? 0}（{selectedClass === ALL_CLASS_VALUE ? "全クラス合算" : selectedClass}）
              </div>

              {busyProblem && <div className="text-sm text-gray-600">読み込み中...</div>}

              {!busyProblem && (
                <div className="overflow-x-auto rounded-xl border">
                  <table className="min-w-[980px] w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left p-3 w-40">問題</th>
                        <th className="text-left p-3 w-56">割合（積み上げ）</th>
                        <th className="text-left p-3">内訳</th>
                        <th className="text-left p-3 w-40">要復習率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedProblemStats.map((p) => {
                        const n = byProblem?.n || 1;
                        const wMaru = (p.maru / n) * 100;
                        const wSan = (p.sankaku / n) * 100;
                        const wBat = (p.batsu / n) * 100;
                        const wNone = (p.none / n) * 100;

                        return (
                          <tr key={p.label} className="border-t">
                            <td className="p-3 font-mono">{p.label}</td>
                            <td className="p-3">
                              <div className="h-3 rounded-full border overflow-hidden flex">
                                <div className="h-3 bg-green-500" style={{ width: `${wMaru}%` }} />
                                <div className="h-3 bg-yellow-400" style={{ width: `${wSan}%` }} />
                                <div className="h-3 bg-red-500" style={{ width: `${wBat}%` }} />
                                <div className="h-3 bg-gray-300" style={{ width: `${wNone}%` }} />
                              </div>
                            </td>
                            <td className="p-3 text-gray-700">
                              ○{p.maru}（{p.maruPct}%） / △{p.sankaku}（{p.sankakuPct}%） / ×{p.batsu}（{p.batsuPct}%） / 未
                              {p.none}（{p.nonePct}%）
                            </td>
                            <td className="p-3 text-gray-700">
                              △+× = {p.review}（{p.reviewPct}%）
                            </td>
                          </tr>
                        );
                      })}

                      {(byProblem?.labels?.length ?? 0) === 0 && (
                        <tr className="border-t">
                          <td className="p-3 text-gray-600" colSpan={4}>
                            問題ラベルがありません（assignment_problems を確認してください）。
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="text-xs text-gray-500">
                ※ 未着手が多い問題は「授業で触れていない/配布が伝わっていない/難易度が高い」可能性があります。
                <br />
                ※ 要復習率（△+×）が高い問題は、クラス指導の重点候補です。
              </div>
            </>
          )}
        </div>
      )}
    </main>
  );
}