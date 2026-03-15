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
  event_date: string; // YYYY-MM-DD
  class_ids: string[];
  created_at: string;
  created_by: string | null;
};

const LS_KEY_LOCAL = "hw_calendar_events_teacher_local";
type LocalEvent = { id: string; date: string; title: string; kind: "test" };

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

export default function TeacherHomePage() {
  const router = useRouter();

  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);

  // ローカル（端末内）
  const [localTests, setLocalTests] = useState<LocalEvent[]>([]);
  const [localTitle, setLocalTitle] = useState("定期テスト");
  const [localDate, setLocalDate] = useState("");

  // 共有（DB）
  const [classIds, setClassIds] = useState<string[]>([]);
  const [sharedTests, setSharedTests] = useState<SharedTestRow[]>([]);
  const [sharedTitle, setSharedTitle] = useState("定期テスト");
  const [sharedDate, setSharedDate] = useState("");
  const [sharedSelected, setSharedSelected] = useState<Set<string>>(new Set(["ALL"]));

  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setUser(getUserFromToken());
    setLocalTests(readLocalEvents());
    setReady(true);
  }, []);

  // 認証＆ロール
  useEffect(() => {
    if (!ready) return;

    if (!user) {
      router.replace("/login?role=teacher");
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
    if (!ready) return;
    if (!user || user.role !== "teacher") return;

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
        logout("teacher");
        router.replace("/login?role=teacher");
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

  // ====== ローカル追加/削除 ======
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

  // ====== 共有追加/削除 ======
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
    const dueEvents: CalendarEvent[] = (assignments ?? [])
      .filter((a) => !!a.due_at)
      .map((a) => ({
        id: `due-${a.id}`,
        date: toYMDLocal(a.due_at!),
        title: `【課題期限】${a.title}`,
        kind: "due" as const,
      }));

    const shared: CalendarEvent[] = (sharedTests ?? []).map((t) => ({
      id: `shared-test-${t.id}`,
      date: t.event_date,
      title: `【テスト（共有）】${t.title}`,
      kind: "test" as const,
    }));

    const local: CalendarEvent[] = (localTests ?? []).map((t) => ({
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

  if (!ready) return <main className="p-6">認証確認中...</main>;
  if (!user) return <main className="p-6">ログインへ遷移中...</main>;

  return (
    <main className="page-shell">
      <div className="page-title-block">
        <h1 className="page-title">教師ホーム</h1>
        <p className="page-subtitle">配布、確認、分析、教材管理までを一画面で見渡せるよう整理しました。</p>
        {err && <p className="text-sm text-rose-600 whitespace-pre-wrap">{err}</p>}
        {busy && <p className="text-sm text-slate-500">処理中...</p>}
      </div>

      <section className="section-stack">
        <div>
          <h2 className="section-heading">よく使う機能</h2>
          <p className="section-caption">主要な遷移は、色付きのカードをそのまま押して開けます。</p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Link className="ui-action-card theme-blue" href="/teacher/templates">
            <div className="ui-action-card-title">課題配布</div>
            <div className="ui-action-card-desc">テンプレートを作成し、複数クラスへ配布できます。</div>
            <span className="ui-action-card-arrow">開く</span>
          </Link>
          <Link className="ui-action-card theme-violet" href="/teacher/assignments">
            <div className="ui-action-card-title">提出状況</div>
            <div className="ui-action-card-desc">配布済み課題の一覧確認、停止、編集、削除を行います。</div>
            <span className="ui-action-card-arrow">開く</span>
          </Link>
          <Link className="ui-action-card theme-emerald" href="/teacher/classes">
            <div className="ui-action-card-title">分析</div>
            <div className="ui-action-card-desc">クラス別の進捗や理解度を見て、指導の優先度を整理します。</div>
            <span className="ui-action-card-arrow">開く</span>
          </Link>
          <Link className="ui-action-card theme-amber" href="/teacher/books">
            <div className="ui-action-card-title">問題集管理</div>
            <div className="ui-action-card-desc">教材データの登録、章や大問の整理、出題の確認を行います。</div>
            <span className="ui-action-card-arrow">開く</span>
          </Link>
          <Link className="ui-action-card theme-rose" href="/teacher/questions">
            <div className="ui-action-card-title">質問対応</div>
            <div className="ui-action-card-desc">生徒から届いた質問に返信し、解決済みの管理も行えます。</div>
            <span className="ui-action-card-arrow">開く</span>
          </Link>
          <Link className="ui-action-card theme-indigo" href="/teacher/materials">
            <div className="ui-action-card-title">教材置き場</div>
            <div className="ui-action-card-desc">図、動画、補助教材を登録し、授業用ライブラリを整えます。</div>
            <span className="ui-action-card-arrow">開く</span>
          </Link>
          <Link className="ui-action-card theme-slate" href="/teacher/students">
            <div className="ui-action-card-title">生徒管理</div>
            <div className="ui-action-card-desc">クラスごとの生徒登録、編集、一括追加をここで行います。</div>
            <span className="ui-action-card-arrow">開く</span>
          </Link>
        </div>
      </section>

      <section className="section-stack">
        <div>
          <h2 className="section-heading">運用の見通し</h2>
          <p className="section-caption">今すぐ把握したい数を、数値カードで見やすくまとめています。</p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="ui-stat-card">
            <div className="ui-stat-card-label">配布中の課題</div>
            <div className="ui-stat-card-value">{assignments.filter((a) => a.status === "open").length}</div>
            <div className="ui-stat-card-sub">現在生徒が取り組んでいる課題数です。</div>
          </div>
          <div className="ui-stat-card">
            <div className="ui-stat-card-label">停止中の課題</div>
            <div className="ui-stat-card-value">{assignments.filter((a) => a.status === "closed").length}</div>
            <div className="ui-stat-card-sub">一時停止している課題です。</div>
          </div>
          <div className="ui-stat-card">
            <div className="ui-stat-card-label">共有テスト予定</div>
            <div className="ui-stat-card-value">{sharedTests.length}</div>
            <div className="ui-stat-card-sub">生徒へ配信される予定件数です。</div>
          </div>
          <div className="ui-stat-card">
            <div className="ui-stat-card-label">登録クラス数</div>
            <div className="ui-stat-card-value">{classIds.length}</div>
            <div className="ui-stat-card-sub">現在配布対象として扱えるクラス数です。</div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="section-stack">
          <div>
            <h2 className="section-heading">カレンダー</h2>
            <p className="section-caption">課題期限とテスト予定をひとつの月表示で確認します。</p>
          </div>
          <div className="ui-panel">
            <MonthCalendar headingOutside events={calendarEvents} />
          </div>
        </div>

        <div className="section-stack">
          <div>
            <h2 className="section-heading">予定の管理</h2>
            <p className="section-caption">共有予定と個人用メモをこの場で整えられます。</p>
          </div>
          <div className="ui-panel space-y-4">
            <div className="ui-panel-muted">
              <div className="text-sm font-bold text-slate-800">共有テスト予定（生徒へ配信）</div>
              <div className="mt-1 text-xs text-slate-500">ここで登録した予定は、生徒側カレンダーにも表示されます。</div>
              <div className="mt-4 space-y-2">
                <label className="text-sm text-slate-700">テスト名</label>
                <input className="form-input" value={sharedTitle} onChange={(e) => setSharedTitle(e.target.value)} />
                <label className="text-sm text-slate-700">日付</label>
                <input className="form-input max-w-[220px]" type="date" value={sharedDate} onChange={(e) => setSharedDate(e.target.value)} />
                <div className="text-sm text-slate-700">配信クラス（複数選択）</div>
                <div className="flex flex-wrap gap-2">
                  <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700">
                    <input type="checkbox" checked={sharedSelected.has("ALL")} onChange={() => toggleSharedClass("ALL")} />
                    ALL
                  </label>
                  {classIds.map((c) => (
                    <label key={c} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700">
                      <input type="checkbox" checked={sharedSelected.has(c)} onChange={() => toggleSharedClass(c)} />
                      {c}
                    </label>
                  ))}
                </div>
                <button className="ui-btn-secondary" onClick={addSharedTest} disabled={busy}>共有テストを追加</button>
              </div>
              {sharedTests.length === 0 ? (
                <div className="mt-4 text-sm text-slate-600">共有テスト予定は未登録です。</div>
              ) : (
                <div className="mt-4 space-y-2">
                  {sharedTests.map((t) => (
                    <div key={t.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 text-sm">
                        <div className="font-semibold text-slate-900">{t.title}</div>
                        <div className="text-slate-600">{t.event_date} / 配信: {(t.class_ids ?? []).join(", ")}</div>
                      </div>
                      <button className="ui-btn-danger" onClick={() => deleteSharedTest(t.id)} disabled={busy}>削除</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="ui-panel-muted">
              <div className="text-sm font-bold text-slate-800">ローカルテスト予定（この端末のみ）</div>
              <div className="mt-1 text-xs text-slate-500">個人メモ用です。共有はされません。</div>
              <div className="mt-4 space-y-2">
                <label className="text-sm text-slate-700">テスト名</label>
                <input className="form-input" value={localTitle} onChange={(e) => setLocalTitle(e.target.value)} />
                <label className="text-sm text-slate-700">日付</label>
                <div className="flex flex-wrap items-center gap-2">
                  <input className="form-input w-auto min-w-[180px]" type="date" value={localDate} onChange={(e) => setLocalDate(e.target.value)} />
                  <button className="ui-btn-secondary" onClick={addLocalTest}>追加</button>
                </div>
              </div>
              {localTests.length === 0 ? (
                <div className="mt-4 text-sm text-slate-600">ローカル予定は未登録です。</div>
              ) : (
                <div className="mt-4 space-y-2">
                  {localTests.map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <div className="min-w-0 text-sm">
                        <div className="font-semibold text-slate-900">{t.title}</div>
                        <div className="text-slate-600">{t.date}</div>
                      </div>
                      <button className="ui-btn-secondary" onClick={() => removeLocalTest(t.id)}>削除</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="ui-panel-muted">
              <div className="text-sm font-bold text-slate-800">直近14日（今日〜）</div>
              <div className="mt-3">
                {upcoming.length === 0 ? (
                  <div className="text-sm text-slate-600">直近の予定はありません。</div>
                ) : (
                  <ul className="space-y-2 text-sm text-slate-700">
                    {upcoming.map((e) => (
                      <li key={e.id} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                        <span className="w-24 shrink-0 font-semibold text-slate-500">{e.date}</span>
                        <span className="min-w-0">{e.title}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
