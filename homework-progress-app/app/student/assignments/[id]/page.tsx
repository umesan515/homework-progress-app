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

type SubmissionPayload = {
  submission: any | null;
  marksByAttempt?: Record<AttemptNo, Record<string, Mark>>;
  markedAtByAttempt?: Record<AttemptNo, Record<string, string | null>>;
  firstMarkedAtByLabel?: Record<string, string>;
  minutesByAttempt?: Record<AttemptNo, Record<string, number>>;
  statusByLabel: Record<string, Mark>;
  timeByLabel: Record<string, any>;
};

function splitProblemLabel(label: string): { attr: string | null; num: string } {
  const s = label.trim();
  const m = s.match(/^([A-Za-zぁ-んァ-ヶ一-龠]+)\s*[-‐ー]?\s*(\d.*)$/);
  if (m) return { attr: m[1], num: m[2] };
  return { attr: null, num: s };
}

const formatDue = (dueAt: string | null) => {
  if (!dueAt) return "無期限";
  const d = new Date(dueAt);
  return `${d.toLocaleDateString("ja-JP")} まで`;
};

const pct = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

const latestMarkForLabel = (sub: SubmissionPayload | null, label: string): Mark | null => {
  if (!sub) return null;
  for (const attemptNo of [3, 2, 1] as AttemptNo[]) {
    const mark = sub.marksByAttempt?.[attemptNo]?.[label] ?? null;
    if (mark) return mark;
  }
  return sub.statusByLabel?.[label] ?? null;
};

const markLabel = (mark: Mark | null) => {
  if (mark === "maru") return "○ 理解できた";
  if (mark === "sankaku") return "△ あと少し";
  if (mark === "batsu") return "× 要復習";
  return "未記録";
};

const markClass = (mark: Mark | null) => {
  if (mark === "maru") return "ui-status-chip ui-status-maru";
  if (mark === "sankaku") return "ui-status-chip ui-status-sankaku";
  if (mark === "batsu") return "ui-status-chip ui-status-batsu";
  return "ui-status-chip ui-status-empty";
};

export default function StudentAssignmentPage() {
  const params = useParams<{ id?: string }>();
  const assignmentId = params?.id;
  const router = useRouter();

  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<JwtUser | null>(null);
  const [a, setA] = useState<AssignmentRow | null>(null);
  const [problems, setProblems] = useState<ProblemRow[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [sub, setSub] = useState<SubmissionPayload | null>(null);
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
    const ps = Array.isArray(detail.problems) ? detail.problems : [];
    setProblems(ps);
    setLabels(ps.map((p) => p.label));

    const s = await apiGet<SubmissionPayload>(`/submissions?assignmentId=${encodeURIComponent(assignmentId)}`);
    setSub(s);
  };

  useEffect(() => {
    (async () => {
      if (!ready || !user) return;
      await load();
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
  }, [ready, assignmentId, user?.uid]);

  const setMark = async (label: string, attemptNo: AttemptNo, mark: Mark) => {
    if (!assignmentId || assignmentId === "undefined" || !sub) return;
    const cur = (sub.marksByAttempt?.[attemptNo] ?? sub.statusByLabel ?? {})[label] ?? null;
    if (cur === mark) return;

    setSavingKey(label);
    setErr(null);
    try {
      await apiPost(`/submissions/mark`, { assignmentId, label, mark, attemptNo });
      await load();
    } catch (e: any) {
      const msg = String(e?.message ?? "保存に失敗しました。");
      if (msg.includes("401")) {
        logout();
        router.replace("/login");
        return;
      }
      setErr(msg);
    } finally {
      setSavingKey(null);
    }
  };

  const clearMark = async (label: string, attemptNo: AttemptNo) => {
    if (!assignmentId || assignmentId === "undefined" || !sub) return;
    const cur = (sub.marksByAttempt?.[attemptNo] ?? sub.statusByLabel ?? {})[label] ?? null;
    if (cur === null) return;

    setSavingKey(label);
    setErr(null);
    setActiveCell(null);
    try {
      const targets: AttemptNo[] = attemptNo === 1 ? [1, 2, 3] : attemptNo === 2 ? [2, 3] : [3];
      for (const t of targets) {
        await apiPost(`/submissions/clear`, { assignmentId, label, attemptNo: t });
      }
      await load();
    } catch (e: any) {
      const msg = String(e?.message ?? "保存に失敗しました。");
      if (msg.includes("401")) {
        logout();
        router.replace("/login");
        return;
      }
      setErr(msg);
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

  const dueText = useMemo(() => (a ? formatDue(a.due_at) : ""), [a]);

  const summary = useMemo(() => {
    const total = labels.length;
    if (!sub || total === 0) {
      return { total, done: 0, donePct: 0, understandingPct: 0, latest: { maru: 0, sankaku: 0, batsu: 0, empty: total } };
    }

    let done = 0;
    let maru = 0;
    let sankaku = 0;
    let batsu = 0;
    let empty = 0;

    for (const label of labels) {
      const latest = latestMarkForLabel(sub, label);
      if (latest) done += 1;
      if (latest === "maru") maru += 1;
      else if (latest === "sankaku") sankaku += 1;
      else if (latest === "batsu") batsu += 1;
      else empty += 1;
    }

    const score = maru + sankaku * 0.5;
    return {
      total,
      done,
      donePct: total ? pct((done / total) * 100) : 0,
      understandingPct: total ? pct((score / total) * 100) : 0,
      latest: { maru, sankaku, batsu, empty },
    };
  }, [labels, sub]);

  if (!ready) return <main className="ui-page">読み込み中...</main>;
  if (!user) return <main className="ui-page">ログインへ遷移中...</main>;

  return (
    <main className="ui-page space-y-6">
      <section className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="ui-page-title">課題の提出状況</h1>
            <p className="ui-page-subtitle">{a?.title ?? "読み込み中..."}</p>
          </div>
          <Link className="ui-soft-button" href="/student/assignments">一覧へ</Link>
        </div>
        {err && <p className="text-sm text-red-600 whitespace-pre-wrap">{err}</p>}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="ui-section-title">課題の概要</h2>
          <p className="ui-section-note">提出期限や進捗は文章だけでなく，枠と横棒でも確認できます。</p>
        </div>
        <div className="ui-frame space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="ui-stat-card">
              <div className="ui-stat-label">提出期限</div>
              <div className="mt-2 text-lg font-extrabold text-slate-900">{dueText || "—"}</div>
              <div className="ui-stat-sub">期限に合わせて記録を更新します。</div>
            </div>
            <div className="ui-stat-card">
              <div className="ui-stat-label">問題数</div>
              <div className="ui-stat-value">{summary.total}</div>
              <div className="ui-stat-sub">この課題に含まれる問題数</div>
            </div>
            <div className="ui-stat-card">
              <div className="ui-stat-label">記録済み</div>
              <div className="ui-stat-value">{summary.done}</div>
              <div className="ui-stat-sub">最新理解度が入っている問題数</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="ui-info-card space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold text-slate-900">進捗</div>
                <div className="text-sm font-bold text-slate-700">{summary.donePct}%</div>
              </div>
              <div className="ui-meter"><div className="ui-meter-fill" style={{ width: `${summary.donePct}%` }} /></div>
              <div className="text-xs text-slate-500">{summary.done} / {summary.total} 問題を記録済み</div>
            </div>

            <div className="ui-info-card space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold text-slate-900">理解度</div>
                <div className="text-sm font-bold text-slate-700">{summary.understandingPct}%</div>
              </div>
              <div className="ui-meter">
                <div className="ui-meter-stack">
                  <div className="ui-meter-seg bg-green-400" style={{ width: `${summary.total ? (summary.latest.maru / summary.total) * 100 : 0}%` }} />
                  <div className="ui-meter-seg bg-amber-300" style={{ width: `${summary.total ? (summary.latest.sankaku / summary.total) * 100 : 0}%` }} />
                  <div className="ui-meter-seg bg-rose-400" style={{ width: `${summary.total ? (summary.latest.batsu / summary.total) * 100 : 0}%` }} />
                  <div className="ui-meter-seg bg-gray-300" style={{ width: `${summary.total ? (summary.latest.empty / summary.total) * 100 : 0}%` }} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-[11px] text-slate-600">
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-green-400" />○ {summary.latest.maru}</span>
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-amber-300" />△ {summary.latest.sankaku}</span>
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-rose-400" />× {summary.latest.batsu}</span>
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-gray-300" />未 {summary.latest.empty}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="ui-section-title">提出状況の一覧</h2>
          <p className="ui-section-note">質問ボタンを含めて1行に収め，縦幅を抑えています。</p>
        </div>
        <div className="ui-frame">
          {!sub ? (
            <div className="ui-info-card text-sm text-slate-600">読み込み中...</div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="ui-assignment-table min-w-[860px]">
                <thead>
                  <tr>
                    <th className="w-[320px] text-left">問題番号</th>
                    <th className="w-[72px] text-center">1回目</th>
                    <th className="w-[72px] text-center">2回目</th>
                    <th className="w-[72px] text-center">3回目</th>
                    <th className="w-[170px] text-left">学習時刻（初回）</th>
                  </tr>
                </thead>
                <tbody>
                  {(problems.length ? problems : labels.map((label) => ({ label, block_id: null, sort_order: 0 } as ProblemRow))).map((p) => {
                    const label = p.label;
                    const blockId = p.block_id;
                    const saving = savingKey === label;
                    const anySub: any = sub as any;
                    const firstIso: string | undefined =
                      sub.firstMarkedAtByLabel?.[label] ??
                      anySub.first_marked_at_by_label?.[label] ??
                      sub.markedAtByAttempt?.[1]?.[label] ??
                      anySub.marked_at_by_attempt?.[1]?.[label] ??
                      undefined;
                    const firstStamp = formatFirstStamp(firstIso);
                    const latest = latestMarkForLabel(sub, label);
                    const split = splitProblemLabel(label);

                    const renderCell = (n: AttemptNo) => {
                      const mark = (sub.marksByAttempt?.[n] ?? {})[label] ?? null;
                      const prevMark = n === 1 ? null : (sub.marksByAttempt?.[(n - 1) as AttemptNo] ?? {})[label] ?? null;
                      const enabled = n === 1 || mark !== null || prevMark !== null;
                      const isActive = !!activeCell && activeCell.label === label && activeCell.attemptNo === n;
                      const symbol = mark === "maru" ? "○" : mark === "sankaku" ? "△" : mark === "batsu" ? "×" : "";
                      const cellBg = mark === "maru" ? "bg-green-100" : mark === "sankaku" ? "bg-yellow-100" : mark === "batsu" ? "bg-red-100" : enabled ? "bg-white" : "bg-gray-50";

                      return (
                        <td
                          key={`${label}-${n}`}
                          className={`ui-compact-cell ${cellBg} ${enabled ? "cursor-pointer hover:bg-slate-50" : "cursor-default text-gray-400"}`}
                          onClick={() => {
                            if (!enabled) return;
                            setActiveCell((prev) => (prev && prev.label === label && prev.attemptNo === n ? null : { label, attemptNo: n }));
                          }}
                          data-cell
                        >
                          <span className="ui-compact-mark">{symbol}</span>
                          {isActive && enabled && !saving && (
                            <div className="absolute z-20 left-1/2 top-full mt-1 -translate-x-1/2" data-cell-pop>
                              <div className="rounded-xl border bg-white shadow-lg p-1.5 flex flex-col gap-1 min-w-[64px]" data-cell-editor>
                                <button className="rounded-lg px-3 py-2 text-sm border hover:bg-green-100" onClick={(e) => { e.stopPropagation(); setMark(label, n, "maru"); setActiveCell(null); }} type="button">○</button>
                                <button className="rounded-lg px-3 py-2 text-sm border hover:bg-yellow-100" onClick={(e) => { e.stopPropagation(); setMark(label, n, "sankaku"); setActiveCell(null); }} type="button">△</button>
                                <button className="rounded-lg px-3 py-2 text-sm border hover:bg-red-100" onClick={(e) => { e.stopPropagation(); setMark(label, n, "batsu"); setActiveCell(null); }} type="button">×</button>
                                <button className="rounded-lg px-3 py-2 text-sm border hover:bg-gray-100" onClick={(e) => { e.stopPropagation(); clearMark(label, n); setActiveCell(null); }} type="button">未</button>
                              </div>
                            </div>
                          )}
                        </td>
                      );
                    };

                    return (
                      <tr key={label}>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-2 min-w-0">
                            {split.attr ? <span className="ui-status-chip ui-status-empty">{split.attr}</span> : null}
                            <span className="ui-kbd-badge">{split.num}</span>
                            <span className={markClass(latest)}>{markLabel(latest)}</span>
                            <Link className="ui-row-link ml-auto" href={`/student/questions?blockId=${encodeURIComponent(blockId ?? "")}&title=${encodeURIComponent(`【課題】${label}`)}`}>質問する</Link>
                          </div>
                        </td>
                        {renderCell(1)}
                        {renderCell(2)}
                        {renderCell(3)}
                        <td className="px-2 py-1.5 text-xs text-gray-700">{firstStamp || <span className="text-gray-400">—</span>}</td>
                      </tr>
                    );
                  })}
                  {labels.length === 0 && (
                    <tr>
                      <td className="px-3 py-4 text-gray-600" colSpan={5}>問題がありません。</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <StickyActionBar>
        <div className="flex justify-end gap-2"><Link className="ui-soft-button" href="/student/assignments">戻る</Link></div>
      </StickyActionBar>
    </main>
  );
}
