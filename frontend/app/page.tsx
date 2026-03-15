"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { getUserFromToken, logout } from "@/lib/auth";
import { MonthCalendar, type CalendarEvent, toYMDLocal } from "@/lib/month-calendar";

type AssignmentRow = {
  id: string;
  title: string;
  status: "open" | "closed" | "archived";
  due_at: string | null;
  created_at: string;
  class_ids?: string[];
};

type ClassListResp = { classIds: string[] };

type SharedTestRow = {
  id: string;
  title: string;
  event_date: string;
  class_ids: string[];
  created_at: string;
  created_by: string | null;
};

type LocalEvent = { id: string; date: string; title: string; kind: "test" };

const LS_KEY_LOCAL = "hw_calendar_events_teacher_local";

const readLocalEvents = (): LocalEvent[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LS_KEY_LOCAL);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x.date === "string" && typeof x.title === "string")
      .map((x) => ({ id: String(x.id ?? crypto.randomUUID()), date: x.date, title: x.title, kind: "test" as const }));
  } catch {
    return [];
  }
};

const writeLocalEvents = (events: LocalEvent[]) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LS_KEY_LOCAL, JSON.stringify(events));
};

function MetricCard({ label, value, note }: { label: string; value: string | number; note: string }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-note">{note}</div>
    </div>
  );
}

export default function TeacherHomePage() {
  const router = useRouter();

  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [classIds, setClassIds] = useState<string[]>([]);
  const [sharedTests, setSharedTests] = useState<SharedTestRow[]>([]);
  const [localTests, setLocalTests] = useState<LocalEvent[]>([]);

  const [localTitle, setLocalTitle] = useState("定期テスト");
  const [localDate, setLocalDate] = useState("");
  const [sharedTitle, setSharedTitle] = useState("定期テスト");
  const [sharedDate, setSharedDate] = useState("");
  const [sharedSelected, setSharedSelected] = useState<Set<string>>(new Set(["ALL"]));

  useEffect(() => {
    setUser(getUserFromToken());
    setLocalTests(readLocalEvents());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (user.role !== "teacher") {
      setErr("教師アカウントではありません。");
      router.replace("/student");
      return;
    }
    setErr(null);
  }, [ready, user, router]);

  const load = async () => {
    if (!ready || !user || user.role !== "teacher") return;

    setBusy(true);
    setErr(null);
    try {
      const [a, cls, tests] = await Promise.all([
        apiGet<AssignmentRow[]>(`/teacher/assignments?status=all`),
        apiGet<ClassListResp>(`/teacher/classes`),
        apiGet<SharedTestRow[]>(`/calendar/tests`),
      ]);
      setAssignments(a ?? []);
      setClassIds(cls.classIds ?? []);
      setSharedTests(tests ?? []);
    } catch (e: any) {
      const msg = String(e?.message ?? "読み込みエラー");
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
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?.uid, user?.role]);

  const addLocalTest = () => {
    const title = localTitle.trim();
    if (!title) return setErr("（ローカル）テスト名を入力してください。");
    if (!localDate) return setErr("（ローカル）日付を選択してください。");
    setErr(null);

    const next: LocalEvent[] = [
      ...localTests,
      { id: crypto.randomUUID(), date: localDate, title, kind: "test" as const },
    ].sort((a, b) => (a.date === b.date ? a.title.localeCompare(b.title, "ja") : a.date.localeCompare(b.date)));

    setLocalTests(next);
    writeLocalEvents(next);
    setLocalDate("");
  };

  const removeLocalTest = (id: string) => {
    const next = localTests.filter((t) => t.id !== id);
    setLocalTests(next);
    writeLocalEvents(next);
  };

  const toggleSharedClass = (cid: string) => {
    setSharedSelected((prev) => {
      const next = new Set(prev);
      if (cid === "ALL") {
        if (next.has("ALL")) next.delete("ALL");
        else {
          next.clear();
          next.add("ALL");
        }
        return next;
      }
      if (next.has("ALL")) next.delete("ALL");
      if (next.has(cid)) next.delete(cid);
      else next.add(cid);
      return next;
    });
  };

  const addSharedTest = async () => {
    const title = sharedTitle.trim();
    if (!title) return setErr("（共有）テスト名を入力してください。");
    if (!sharedDate) return setErr("（共有）日付を選択してください。");
    if (sharedSelected.size === 0) return setErr("（共有）配信クラスを選択してください。");

    setBusy(true);
    setErr(null);
    try {
      await apiPost(`/teacher/test-events`, {
        title,
        date: sharedDate,
        classIds: Array.from(sharedSelected),
      });
      setSharedDate("");
      setSharedSelected(new Set(["ALL"]));
      await load();
    } catch (e: any) {
      setErr(String(e?.message ?? "（共有）登録に失敗しました。"));
    } finally {
      setBusy(false);
    }
  };

  const deleteSharedTest = async (id: string) => {
    const ok = window.confirm("この共有テスト予定を削除します。よろしいですか？");
    if (!ok) return;

    setBusy(true);
    setErr(null);
    try {
      await apiDelete(`/teacher/test-events/${encodeURIComponent(id)}`);
      await load();
    } catch (e: any) {
      setErr(String(e?.message ?? "（共有）削除に失敗しました。"));
    } finally {
      setBusy(false);
    }
  };

  const calendarEvents: CalendarEvent[] = useMemo(() => {
    const dueEvents: CalendarEvent[] = assignments
      .filter((a) => !!a.due_at)
      .map((a) => ({
        id: `due-${a.id}`,
        date: toYMDLocal(a.due_at!),
        title: `【課題期限】${a.title}`,
        kind: "due" as const,
      }));

    const shared: CalendarEvent[] = sharedTests.map((t) => ({
      id: `shared-test-${t.id}`,
      date: t.event_date,
      title: `【テスト（共有）】${t.title}`,
      kind: "test" as const,
    }));

    const local: CalendarEvent[] = localTests.map((t) => ({
      id: `local-test-${t.id}`,
      date: t.date,
      title: `【テスト（ローカル）】${t.title}`,
      kind: "test" as const,
    }));

    return [...dueEvents, ...shared, ...local];
  }, [assignments, sharedTests, localTests]);

  const upcoming = useMemo(() => {
    const today = new Date();
    const start = toYMDLocal(today);
    const endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 14);
    const end = toYMDLocal(endDate);
    return calendarEvents
      .filter((e) => e.date >= start && e.date <= end)
      .slice()
      .sort((a, b) => (a.date === b.date ? a.title.localeCompare(b.title, "ja") : a.date.localeCompare(b.date)));
  }, [calendarEvents]);

  const openAssignments = useMemo(() => assignments.filter((a) => a.status === "open").length, [assignments]);
  const closedAssignments = useMemo(() => assignments.filter((a) => a.status === "closed").length, [assignments]);

  if (!ready) return <main className="app-shell">認証確認中...</main>;
  if (!user) return <main className="app-shell">ログインへ遷移中...</main>;

  return (
    <main className="app-shell page-stack">
      <section className="page-heading">
        <h1 className="page-title">教師ホーム</h1>
        <div className="page-subtitle space-y-1">
          <div>課題・教材・質問をここから管理します。</div>
          {busy && <div>処理中...</div>}
          {err && <p className="text-sm text-red-600 whitespace-pre-wrap">{err}</p>}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="section-title">よく使う機能</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Link className="feature-card" href="/teacher/templates">
            <div className="feature-card-title">課題配布（テンプレ）</div>
            <div className="feature-card-text">テンプレートの作成・編集・クラス配布を行います。</div>
          </Link>
          <Link className="feature-card" href="/teacher/assignments">
            <div className="feature-card-title">進捗確認（配布済み課題）</div>
            <div className="feature-card-text">配布済み課題の一覧、停止、削除をまとめて管理します。</div>
          </Link>
          <Link className="feature-card" href="/teacher/classes">
            <div className="feature-card-title">クラス別進捗</div>
            <div className="feature-card-text">クラス単位の進捗や問題ごとの傾向を確認します。</div>
          </Link>
          <Link className="feature-card" href="/teacher/questions">
            <div className="feature-card-title">質問（Q&amp;A）</div>
            <div className="feature-card-text">生徒からの質問を確認し、返信や解決管理を行います。</div>
          </Link>
          <Link className="feature-card" href="/teacher/materials">
            <div className="feature-card-title">教材置き場</div>
            <div className="feature-card-text">授業で使う図・動画・アプリ教材を登録します。</div>
          </Link>
          <Link className="feature-card" href="/teacher/books">
            <div className="feature-card-title">問題集管理</div>
            <div className="feature-card-text">問題集、章、大問を登録し、出題履歴も確認します。</div>
          </Link>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="section-title">運用状況</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="配布中の課題" value={openAssignments} note="現在生徒に見えている課題" />
          <MetricCard label="停止済み課題" value={closedAssignments} note="配布停止中の課題" />
          <MetricCard label="共有テスト予定" value={sharedTests.length} note="生徒へ配信される予定" />
          <MetricCard label="登録クラス数" value={classIds.length} note="管理対象クラスの数" />
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-3">
          <h2 className="section-title">カレンダー（課題期限・テスト）</h2>
          <div className="section-panel">
            <MonthCalendar headingOutside events={calendarEvents} />
          </div>
        </div>

        <div className="space-y-6">
          <div className="space-y-3">
            <h2 className="section-title">共有テスト予定</h2>
            <div className="section-panel space-y-4">
              <p className="text-xs text-slate-500">※ ここで登録した予定は生徒側カレンダーにも表示されます。</p>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">テスト名</label>
                <input className="ui-input" value={sharedTitle} onChange={(e) => setSharedTitle(e.target.value)} />
              </div>

              <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-start">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">日付</label>
                  <input className="ui-input min-w-[180px]" type="date" value={sharedDate} onChange={(e) => setSharedDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium text-slate-700">配信クラス</div>
                  <div className="flex flex-wrap gap-2">
                    <label className="status-badge status-empty gap-2 cursor-pointer">
                      <input type="checkbox" checked={sharedSelected.has("ALL")} onChange={() => toggleSharedClass("ALL")} />
                      ALL
                    </label>
                    {classIds.map((c) => (
                      <label key={c} className="status-badge status-empty gap-2 cursor-pointer">
                        <input type="checkbox" checked={sharedSelected.has(c)} onChange={() => toggleSharedClass(c)} />
                        {c}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <button className="ui-button-primary disabled:opacity-50" onClick={addSharedTest} disabled={busy}>共有テストを追加</button>
              </div>

              {sharedTests.length === 0 ? (
                <div className="soft-panel text-sm text-slate-600">共有テスト予定は未登録です。</div>
              ) : (
                <div className="space-y-2">
                  {sharedTests.map((t) => (
                    <div key={t.id} className="soft-panel flex items-center justify-between gap-3 py-3">
                      <div className="text-sm">
                        <div className="font-semibold text-slate-900">{t.title}</div>
                        <div className="mt-1 text-slate-500">{t.event_date} / 配信: {(t.class_ids ?? []).join(", ")}</div>
                      </div>
                      <button className="ui-button text-red-600" onClick={() => deleteSharedTest(t.id)} disabled={busy}>削除</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="section-title">ローカルテスト予定（この端末のみ）</h2>
            <div className="section-panel space-y-4">
              <p className="text-xs text-slate-500">※ 個人メモ用途です。共有されません。</p>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">テスト名</label>
                  <input className="ui-input" value={localTitle} onChange={(e) => setLocalTitle(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">日付</label>
                  <input className="ui-input min-w-[180px]" type="date" value={localDate} onChange={(e) => setLocalDate(e.target.value)} />
                </div>
              </div>
              <div>
                <button className="ui-button-primary" onClick={addLocalTest}>追加する</button>
              </div>
              {localTests.length === 0 ? (
                <div className="soft-panel text-sm text-slate-600">ローカル予定は未登録です。</div>
              ) : (
                <div className="space-y-2">
                  {localTests.map((t) => (
                    <div key={t.id} className="soft-panel flex items-center justify-between gap-3 py-3">
                      <div className="text-sm">
                        <div className="font-semibold text-slate-900">{t.title}</div>
                        <div className="mt-1 text-slate-500">{t.date}</div>
                      </div>
                      <button className="ui-button" onClick={() => removeLocalTest(t.id)}>削除</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="section-title">直近14日（今日〜）</h2>
            <div className="section-panel">
              {upcoming.length === 0 ? (
                <div className="soft-panel text-sm text-slate-600">直近の予定はありません。</div>
              ) : (
                <ul className="space-y-2">
                  {upcoming.map((e) => (
                    <li key={e.id} className="soft-panel flex items-start gap-3 py-3 text-sm">
                      <span className="w-24 shrink-0 font-medium text-slate-500">{e.date}</span>
                      <span className="text-slate-800">{e.title}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
