"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { getUserFromToken, logout, type JwtUser } from "@/lib/auth";
import { MonthCalendar, type CalendarEvent, toYMDLocal } from "@/lib/month-calendar";

type AssignmentRow = {
  id: string;
  title: string;
  status: string;
  due_at: string | null;
  created_at: string;
};

type SharedTestRow = {
  id: string;
  title: string;
  event_date: string; // YYYY-MM-DD
  class_ids: string[];
  created_at: string;
  created_by: string | null;
};

const formatDue = (dueAt: string | null) => {
  if (!dueAt) return "無期限";
  const d = new Date(dueAt);
  return `${d.toLocaleDateString("ja-JP")} まで`;
};

// ローカル（端末内）も残す
const LS_KEY_LOCAL = "hw_calendar_events_student_local";
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

export default function StudentHomePage() {
  const router = useRouter();

  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<JwtUser | null>(null);

  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [sharedTests, setSharedTests] = useState<SharedTestRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [localTests, setLocalTests] = useState<LocalEvent[]>([]);
  const [localTitle, setLocalTitle] = useState("定期テスト");
  const [localDate, setLocalDate] = useState("");

  useEffect(() => {
    const u = getUserFromToken();
    setUser(u);
    setAuthChecked(true);
    setLocalTests(readLocalEvents());
  }, []);

  useEffect(() => {
    if (!authChecked) return;

    if (!user) {
      router.replace("/login?role=student");
      return;
    }
    if (user.role !== "student") {
      router.replace("/teacher");
      return;
    }
  }, [authChecked, user, router]);

  const load = async () => {
    setErr(null);
    setRows([]);
    setSharedTests([]);

    if (!authChecked) return;
    if (!user) return;
    if (user.role !== "student") return;

    const qs = user.classId ? `?classId=${encodeURIComponent(user.classId)}` : "";
    const [list, tests] = await Promise.all([
      apiGet<AssignmentRow[]>(`/assignments${qs}`),
      apiGet<SharedTestRow[]>(`/calendar/tests`),
    ]);
    setRows(list ?? []);
    setSharedTests(tests ?? []);
  };

  useEffect(() => {
    load().catch((e: any) => {
      const msg = String(e?.message ?? "読み込みエラー");
      if (msg.includes("401")) {
        logout();
        router.replace("/login?role=student");
        return;
      }
      setErr(msg);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, user?.uid, user?.classId, user?.role]);

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

  const classText = useMemo(() => (user?.classId ? user.classId : "未設定"), [user?.classId]);

  const calendarEvents: CalendarEvent[] = useMemo(() => {
    const dueEvents: CalendarEvent[] = (rows ?? [])
      .filter((r) => !!r.due_at)
      .map((r) => ({
        id: `due-${r.id}`,
        date: toYMDLocal(r.due_at!),
        title: `【課題】${r.title}`,
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
  }, [rows, sharedTests, localTests]);

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

  if (!authChecked) return <main className="p-6">確認中...</main>;
  if (!user) return <main className="p-6">ログインへ遷移中...</main>;

  return (
    <main className="page-shell">
      <div className="page-title-block">
        <h1 className="page-title">生徒ホーム</h1>
        <p className="page-subtitle">
          今日の課題や予定を見渡しながら、学習の流れを整えるページです。
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="inline-chip">クラス：{classText}</span>
          {!user.classId && <span className="inline-chip">共有予定の表示にはクラス設定が必要です</span>}
        </div>
        {err && <p className="text-sm text-rose-600 whitespace-pre-wrap">{err}</p>}
      </div>

      <section className="section-stack">
        <div>
          <h2 className="section-heading">よく使う機能</h2>
          <p className="section-caption">押したい枠をそのまま選ぶだけで、各ページへ移動できます。</p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Link href="/student/assignments" className="home-action-card theme-blue">
            <div className="home-action-card-title">課題一覧</div>
            <div className="home-action-card-desc">届いた課題をまとめて確認し、詳細ページから進捗を入力します。</div>
            <span className="home-action-card-arrow">開く</span>
          </Link>
          <Link href="/student/questions" className="home-action-card theme-violet">
            <div className="home-action-card-title">質問</div>
            <div className="home-action-card-desc">先生へ質問を送り、スレッド形式でやり取りできます。</div>
            <span className="home-action-card-arrow">開く</span>
          </Link>
          <Link href="/student/materials" className="home-action-card theme-emerald">
            <div className="home-action-card-title">教材置き場</div>
            <div className="home-action-card-desc">図・動画・補助教材を自由に見て、理解を深められます。</div>
            <span className="home-action-card-arrow">開く</span>
          </Link>
          <div className="summary-card">
            <div className="summary-card-title">小テスト</div>
            <div className="summary-card-text">準備中です。利用を始める段階になったら、ここから案内します。</div>
          </div>
        </div>
      </section>

      <section className="section-stack">
        <div>
          <h2 className="section-heading">学習の見通し</h2>
          <p className="section-caption">配布中の課題や予定をまとめて確認できます。</p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="info-card">
            <div className="info-card-label">配布中の課題</div>
            <div className="info-card-value">{rows.length}</div>
            <div className="info-card-sub">いま取り組める課題の数です。</div>
          </div>
          <div className="info-card">
            <div className="info-card-label">共有テスト予定</div>
            <div className="info-card-value">{sharedTests.length}</div>
            <div className="info-card-sub">先生から共有されている予定です。</div>
          </div>
          <div className="info-card">
            <div className="info-card-label">ローカル予定</div>
            <div className="info-card-value">{localTests.length}</div>
            <div className="info-card-sub">この端末だけで管理している予定です。</div>
          </div>
          <div className="info-card">
            <div className="info-card-label">直近14日</div>
            <div className="info-card-value">{upcoming.length}</div>
            <div className="info-card-sub">今日から2週間の予定件数です。</div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="section-stack">
          <div>
            <h2 className="section-heading">カレンダー</h2>
            <p className="section-caption">課題期限とテスト予定をまとめて確認します。</p>
          </div>
          <div className="soft-panel">
            <MonthCalendar headingOutside events={calendarEvents} />
          </div>
        </div>

        <div className="section-stack">
          <div>
            <h2 className="section-heading">テスト予定</h2>
            <p className="section-caption">自分用メモも一緒に管理できます。</p>
          </div>
          <div className="soft-panel space-y-4">
            <div className="soft-panel-muted">
              <div className="text-sm font-bold text-slate-800">ローカルテスト予定（この端末のみ）</div>
              <div className="mt-1 text-xs text-slate-500">自分用のメモです。ほかの端末や先生には共有されません。</div>
              <div className="mt-4 space-y-2">
                <label className="text-sm text-slate-700">テスト名</label>
                <input className="form-input" value={localTitle} onChange={(e) => setLocalTitle(e.target.value)} />
                <label className="text-sm text-slate-700">日付</label>
                <div className="flex flex-wrap items-center gap-2">
                  <input className="form-input w-auto min-w-[180px]" type="date" value={localDate} onChange={(e) => setLocalDate(e.target.value)} />
                  <button className="subtle-button" onClick={addLocalTest}>追加</button>
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
                      <button className="subtle-button" onClick={() => removeLocalTest(t.id)}>削除</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="soft-panel-muted">
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

      <section className="section-stack">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="section-heading">配布中の課題</h2>
            <p className="section-caption">枠のどこを押しても課題詳細へ移動できます。</p>
          </div>
          <Link className="subtle-button self-start" href="/student/assignments">一覧を開く</Link>
        </div>
        <div className="soft-panel space-y-3">
          {rows.length === 0 ? (
            <div className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
              配布中の課題はありません。先生が課題を配布するとここに表示されます。
            </div>
          ) : (
            rows.map((r, i) => (
              <Link
                key={r.id}
                href={`/student/assignments/${r.id}`}
                className={`assignment-list-card ${i % 3 === 0 ? "theme-blue" : i % 3 === 1 ? "theme-emerald" : "theme-violet"}`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-lg font-bold text-slate-900 truncate">{r.title}</div>
                    <div className="mt-1 text-sm text-slate-600">提出期限：{formatDue(r.due_at)}</div>
                  </div>
                  <span className="home-action-card-arrow self-start sm:self-center">進捗を入力する</span>
                </div>
              </Link>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
