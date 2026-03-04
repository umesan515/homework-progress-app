"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { getUserFromToken, logout, type JwtUser } from "@/lib/auth";
import StickyActionBar from "@/components/StickyActionBar";

type AssignmentRow = {
  id: string;
  title: string;
  status: string;
  due_at: string | null;
  created_at: string;
};

type ProblemRow = {
  label: string;
  block_id: string | null;
  sort_order: number;
};

type AssignmentDetail = {
  assignment: AssignmentRow;
  problems: ProblemRow[];
};

type Mark = "maru" | "sankaku" | "batsu";

type AttemptNo = 1 | 2 | 3;
function splitProblemLabel(label: string): { attr: string | null; num: string } {
  const s = label.trim();
  // 例: "STEPA 12", "STEPA-12", "例題 3", "StepUp-5" など
  const m = s.match(/^([A-Za-zぁ-んァ-ヶ一-龠]+)\s*[-‐ー]?\s*(\d.*)$/);
  if (m) return { attr: m[1], num: m[2] };
  return { attr: null, num: s };
}


type SubmissionPayload = {
  submission: any | null;
  // new (3 attempts)
  marksByAttempt?: Record<AttemptNo, Record<string, Mark>>;
  markedAtByAttempt?: Record<AttemptNo, Record<string, string | null>>;
  firstMarkedAtByLabel?: Record<string, string>;
  minutesByAttempt?: Record<AttemptNo, Record<string, number>>;
  // legacy
  statusByLabel: Record<string, Mark>;
  timeByLabel: Record<string, any>;
};

const formatDue = (dueAt: string | null) => {
  if (!dueAt) return "無期限";
  const d = new Date(dueAt);
  return `${d.toLocaleDateString("ja-JP")} まで`;
};

export default function StudentAssignmentPage() {
  const params = useParams<{ id?: string }>();
  const assignmentId = params?.id;
  const router = useRouter();

  // ✅ Hydration対策：初回レンダーで localStorage を読まない
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<JwtUser | null>(null);

  const [a, setA] = useState<AssignmentRow | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [sub, setSub] = useState<SubmissionPayload | null>(null);

  // クリックしたセル（label×attempt）だけに入力ボタンを出す
  const [activeCell, setActiveCell] = useState<{ label: string; attemptNo: AttemptNo } | null>(null);

  const [err, setErr] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    const u = getUserFromToken();
    setUser(u);
    setReady(true);

    if (!u) {
      router.replace("/login");
      return;
    }
    if (u.role !== "student") {
      router.replace("/teacher");
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    if (!assignmentId || assignmentId === "undefined") {
      setErr("課題IDが取得できませんでした（URLを確認してください）。");
      return;
    }

    setErr(null);

    const detail = await apiGet<AssignmentDetail>(`/assignments/${encodeURIComponent(assignmentId)}`);
    setA(detail.assignment);
    setLabels((detail.problems ?? []).map((p) => p.label));

    const s = await apiGet<SubmissionPayload>(`/submissions?assignmentId=${encodeURIComponent(assignmentId)}`);
    setSub(s);
  };

  useEffect(() => {
    (async () => {
      if (!ready) return;
      if (!user) return;
      await load();
    })().catch((e: any) => {
      const msg = e?.message ?? "";
      if (String(msg).includes("401")) {
        logout();
        router.replace("/login");
        return;
      }
      setErr(msg || "読み込みエラー");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, assignmentId, user?.uid]);

  const setMark = async (label: string, attemptNo: AttemptNo, mark: Mark) => {
    if (!assignmentId || assignmentId === "undefined") return;
    if (!sub) return;

    const cur = (sub.marksByAttempt?.[attemptNo] ?? sub.statusByLabel ?? {})[label] ?? null;
    if (cur === mark) return;

    setSavingKey(label);
    setErr(null);
    try {
      await apiPost(`/submissions/mark`, { assignmentId, label, mark, attemptNo });
      await load();
    } catch (e: any) {
      const msg = e?.message ?? "保存に失敗しました。";
      if (String(msg).includes("401")) {
        logout();
        router.replace("/login");
        return;
      }
      setErr(String(msg));
    } finally {
      setSavingKey(null);
    }
  };

  const clearMark = async (label: string, attemptNo: AttemptNo) => {
    if (!assignmentId || assignmentId === "undefined") return;
    if (!sub) return;

    const cur = (sub.marksByAttempt?.[attemptNo] ?? sub.statusByLabel ?? {})[label] ?? null;
    if (cur === null) return; // 既に未着手（記録なし）

    setSavingKey(label);
    setErr(null);
    setActiveCell(null);
    try {
      // 連続回は「前の回が埋まっている時だけ」入力する運用。
      // そのため、前の回を未（クリア）にしたら後続回も消す。
      const targets: AttemptNo[] = attemptNo === 1 ? [1, 2, 3] : attemptNo === 2 ? [2, 3] : [3];
      for (const t of targets) {
        await apiPost(`/submissions/clear`, { assignmentId, label, attemptNo: t });
      }
      await load();
    } catch (e: any) {
      const msg = e?.message ?? "保存に失敗しました。";
      if (String(msg).includes("401")) {
        logout();
        router.replace("/login");
        return;
      }
      setErr(String(msg));
    } finally {
      setSavingKey(null);
    }
  };

  const formatFirstStamp = (iso?: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    const date = d.toLocaleDateString("ja-JP");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${date} ${hh}:${mm}`;
  };

  // outside click でセル編集を閉じる
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest("[data-cell-editor]") || t.closest("[data-cell]") || t.closest("[data-cell-pop]")) return;
      setActiveCell(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const dueText = useMemo(() => {
    if (!a) return "";
    return formatDue(a.due_at);
  }, [a]);

  if (!ready) return <main className="p-6">読み込み中...</main>;
  if (!user) return <main className="p-6">ログインへ遷移中...</main>;

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">課題</h1>
          <div className="text-xs text-gray-600">{a?.title ?? "..."}</div>
        </div>
        <Link
          className="rounded-lg border px-2 py-1 bg-white shadow-sm hover:bg-gray-100 hover:shadow transition active:scale-[0.99]"
          href="/student/assignments"
        >
          一覧へ
        </Link>
      </div>

      {err && <p className="text-xs text-red-600 whitespace-pre-wrap">{err}</p>}

      {a && (
        <div className="rounded-xl border p-4 space-y-2">
          <div className="text-xs text-gray-700">
            <b>提出期限：</b> {dueText}
          </div>
          <div className="text-xs text-gray-700">
            <b>問題数：</b> {labels.length}
          </div>
        </div>
      )}

      <div className="space-y-1">
        <div className="text-base font-semibold text-gray-700">提出状況</div>
        <div className="rounded-2xl bg-gray-50 p-4">
          {!sub ? (
            <div className="text-xs text-gray-600">読み込み中...</div>
          ) : (
            <div className="max-h-[520px] overflow-auto rounded-xl bg-white">
              <table className="w-full text-xs border-collapse">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="p-1 text-left w-32 border-b border-gray-200">問題番号</th>
                    <th className="p-1 text-center w-24 border-b border-gray-200">1回目</th>
                    <th className="p-1 text-center w-24 border-b border-gray-200">2回目</th>
                    <th className="p-1 text-center w-24 border-b border-gray-200">3回目</th>
                    <th className="p-1 text-left w-44 border-b border-gray-200">学習時刻（初回）</th>
                  </tr>
                </thead>
                <tbody>
                  {labels.map((label) => {
                    const saving = savingKey === label;
                    // 学習時刻（初回）はAPIのキー名が snake_case / camelCase どちらの場合もあるためフォールバックする
                    const anySub: any = sub as any;
                    const firstIso: string | undefined =
                      sub.firstMarkedAtByLabel?.[label] ??
                      anySub.first_marked_at_by_label?.[label] ??
                      sub.markedAtByAttempt?.[1]?.[label] ??
                      anySub.marked_at_by_attempt?.[1]?.[label] ??
                      undefined;
                    const firstStamp = formatFirstStamp(firstIso);

                    const renderCell = (n: AttemptNo) => {
                      const mark = (sub.marksByAttempt?.[n] ?? {})[label] ?? null;
                      const prevMark = n === 1 ? "_" : (sub.marksByAttempt?.[(n - 1) as AttemptNo] ?? {})[label] ?? null;
                      // 2回目/3回目は「前の回が埋まっている」時だけ入力できる。
                      // ただし、既に値が入っている場合は編集できる（過去データ互換）。
                      const enabled = n === 1 || mark !== null || prevMark !== null;
                      const isActive = !!activeCell && activeCell.label === label && activeCell.attemptNo === n;
                      const symbol = mark === "maru" ? "○" : mark === "sankaku" ? "△" : mark === "batsu" ? "×" : "";

                      const cellBg =
                        mark === "maru"
                          ? "bg-green-100"
                          : mark === "sankaku"
                            ? "bg-yellow-100"
                            : mark === "batsu"
                              ? "bg-red-100"
                              : enabled
                                ? "bg-white"
                                : "bg-gray-50";

                      return (
                        <td
                          key={`${label}-${n}`}
                          className={`relative text-center align-middle border-b border-gray-200 border-l border-gray-200 h-9 ${cellBg} ${
                            enabled ? "cursor-pointer hover:bg-gray-100" : "cursor-default text-gray-400"
                          } transition`}
                          onClick={() => {
                            if (!enabled) return;
                            // 同じセルを再クリックしたら閉じる
                            setActiveCell((prev) => (prev && prev.label === label && prev.attemptNo === n ? null : { label, attemptNo: n }));
                          }}
                          data-cell
                        >
                          <span className="text-base font-semibold select-none">{symbol}</span>

                          {isActive && enabled && !saving && (
                            <div className="absolute z-20 left-1/2 top-full mt-1 -translate-x-1/2 translate-x-2" data-cell-pop>
                              <div className="rounded-xl border bg-white shadow-lg p-2 flex flex-col gap-2 min-w-[56px]" data-cell-editor>
                                <button
                                  className="rounded-lg px-3 py-2 text-sm border hover:bg-green-100"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setMark(label, n, "maru");
                                    setActiveCell(null);
                                  }}
                                  title="理解できた"
                                  type="button"
                                >
                                  ○
                                </button>
                                <button
                                  className="rounded-lg px-3 py-2 text-sm border hover:bg-yellow-100"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setMark(label, n, "sankaku");
                                    setActiveCell(null);
                                  }}
                                  title="あと少し"
                                  type="button"
                                >
                                  △
                                </button>
                                <button
                                  className="rounded-lg px-3 py-2 text-sm border hover:bg-red-100"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setMark(label, n, "batsu");
                                    setActiveCell(null);
                                  }}
                                  title="要復習"
                                  type="button"
                                >
                                  ×
                                </button>
                                <button
                                  className="rounded-lg px-3 py-2 text-sm border hover:bg-gray-100"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    clearMark(label, n);
                                    setActiveCell(null);
                                  }}
                                  title="未（空白に戻す）"
                                  type="button"
                                >
                                  未
                                </button>
                              </div>
                            </div>
                          )}
                        </td>
                      );
                    };

                    return (
                      <tr key={label}>
                        <td className="p-1 border-b border-gray-200">
  {(() => {
    const s = splitProblemLabel(label);
    return (
      <div className="flex items-center gap-2">
        {s.attr ? (
          <span className="inline-block text-[11px] rounded-md bg-gray-200 text-gray-700 px-2 py-1">
            {s.attr}
          </span>
        ) : null}
        <span className="inline-block font-mono text-xs rounded-md border bg-gray-50 px-2 py-1">{s.num}</span>
      </div>
    );
  })()}
</td>
                        {renderCell(1)}
                        {renderCell(2)}
                        {renderCell(3)}
                        <td className="p-1 border-b border-gray-200 border-l border-gray-200 text-xs text-gray-700">
                          {firstStamp || <span className="text-gray-400">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {labels.length === 0 && (
                    <tr>
                      <td className="p-3 text-gray-600" colSpan={5}>
                        問題がありません。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <StickyActionBar>
        <div className="flex justify-end gap-2">
          <Link
            className="rounded-lg border px-4 py-2 bg-white shadow-sm hover:bg-gray-100 hover:shadow transition active:scale-[0.99]"
            href="/student/assignments"
          >
            戻る
          </Link>
        </div>
      </StickyActionBar>
    </main>
  );
}
