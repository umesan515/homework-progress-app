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
  total?: number;
  maru?: number;
  sankaku?: number;
  batsu?: number;
  done?: number;
  pct?: number;
  tag?: string | null;
};

type SharedTestRow = {
  id: string;
  title: string;
  event_date: string;
  class_ids: string[];
  created_at: string;
  created_by: string | null;
};

type LocalEvent = {
  id: string;
  date: string;
  title: string;
  kind: "test";
};

type SelfStudyBook = {
  id: string;
  title: string;
  totalUnits: number;
  currentUnit: number;
  note: string;
  updatedAt: string;
};

const LS_KEY_LOCAL = "hw_calendar_events_student_local";
const LS_KEY_SELF_STUDY = "hw_student_self_study_books_v1";

const formatDue = (dueAt: string | null) => {
  if (!dueAt) return "無期限";
  const d = new Date(dueAt);
  return `${d.toLocaleDateString("ja-JP")} まで`;
};

const pct = (done: number, total: number) => {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
};

const safeNum = (v: unknown, fallback = 0) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const readLocalEvents = (): LocalEvent[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LS_KEY_LOCAL);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x.date === "string" && typeof x.title === "string")
      .map((x) => ({
        id: String(x.id ?? crypto.randomUUID()),
        date: x.date,
        title: x.title,
        kind: "test" as const,
      }));
  } catch {
    return [];
  }
};

const writeLocalEvents = (events: LocalEvent[]) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LS_KEY_LOCAL, JSON.stringify(events));
};

const readSelfStudyBooks = (): SelfStudyBook[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LS_KEY_SELF_STUDY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x) => ({
        id: String(x?.id ?? crypto.randomUUID()),
        title: String(x?.title ?? ""),
        totalUnits: Math.max(1, safeNum(x?.totalUnits, 1)),
        currentUnit: Math.max(0, safeNum(x?.currentUnit, 0)),
        note: String(x?.note ?? ""),
        updatedAt: String(x?.updatedAt ?? new Date().toISOString()),
      }))
      .filter((x) => x.title.trim());
  } catch {
    return [];
  }
};

const writeSelfStudyBooks = (rows: SelfStudyBook[]) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LS_KEY_SELF_STUDY, JSON.stringify(rows));
};

function WhiteCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-3xl border border-gray-200 bg-white p-5 shadow-sm ${className}`}>{children}</div>;
}

function TintedCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-3xl border p-5 shadow-sm ${className}`}>{children}</div>;
}

function SectionTitle({ title, desc }: { title: string; desc: string }) {
  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight text-gray-900">{title}</h2>
      <p className="mt-2 text-sm text-gray-600">{desc}</p>
    </div>
  );
}

function ProgressBar({ value, colorClass = "bg-emerald-500" }: { value: number; colorClass?: string }) {
  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-white/70 ring-1 ring-black/5">
      <div className={`h-full rounded-full transition-all ${colorClass}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

function AssignmentRangeBar({ total, done }: { total: number; done: number }) {
  const donePct = pct(done, total);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-gray-600">
        <span>課題範囲</span>
        <span>
          {done} / {total} 問
        </span>
      </div>
      <div className="relative h-4 overflow-hidden rounded-full bg-slate-100 ring-1 ring-black/5">
        <div className="absolute inset-y-0 left-0 right-0 bg-amber-200/80" />
        <div className="absolute inset-y-0 left-0 rounded-full bg-emerald-500" style={{ width: `${donePct}%` }} />
      </div>
      <div className="flex items-center justify-between text-[11px] text-gray-500">
        <span>課題の先頭</span>
        <span>課題の終わり</span>
      </div>
    </div>
  );
}

function MiniBarChart({
  items,
}: {
  items: Array<{ label: string; value: number; colorClass: string; textClass: string; note: string }>;
}) {
  const maxValue = Math.max(1, ...items.map((item) => item.value));
  return (
    <div className="space-y-4">
      {items.map((item) => {
        const width = Math.max(10, Math.round((item.value / maxValue) * 100));
        return (
          <div key={item.label} className="space-y-2">
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-gray-700">{item.label}</div>
                <div className="mt-1 text-xs text-gray-500">{item.note}</div>
              </div>
              <div className={`text-3xl font-bold ${item.textClass}`}>{item.value}</div>
            </div>
            <div className="h-4 overflow-hidden rounded-full bg-white/80 ring-1 ring-black/5">
              <div className={`h-full rounded-full ${item.colorClass}`} style={{ width: `${width}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function GradientLinkCard({
  href,
  title,
  desc,
  action,
  className,
  actionClass,
}: {
  href: string;
  title: string;
  desc: string;
  action: string;
  className: string;
  actionClass: string;
}) {
  return (
    <Link href={href} className={`rounded-3xl border p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${className}`}>
      <div className="text-lg font-semibold text-gray-900">{title}</div>
      <p className="mt-2 text-sm leading-6 text-gray-600">{desc}</p>
      <div className={`mt-5 text-sm font-medium ${actionClass}`}>{action}</div>
    </Link>
  );
}

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
  const [selfStudyBooks, setSelfStudyBooks] = useState<SelfStudyBook[]>([]);
  const [selfStudyTitle, setSelfStudyTitle] = useState("");
  const [selfStudyTotal, setSelfStudyTotal] = useState("");
  const [selfStudyCurrent, setSelfStudyCurrent] = useState("");
  const [selfStudyNote, setSelfStudyNote] = useState("");

  useEffect(() => {
    const u = getUserFromToken();
    setUser(u as JwtUser | null);
    setAuthChecked(true);
    setLocalTests(readLocalEvents());
    setSelfStudyBooks(readSelfStudyBooks());
  }, []);

  useEffect(() => {
    if (!authChecked) return;
    if (!user) {
      router.replace("/login?role=student");
      return;
    }
    if (user.role !== "student") {
      router.replace("/teacher");
    }
  }, [authChecked, user, router]);

  const load = async () => {
    setErr(null);
    setRows([]);
    setSharedTests([]);
    if (!authChecked || !user || user.role !== "student") return;
    const [list, tests] = await Promise.all([apiGet("/student/assignments"), apiGet("/calendar/tests")]);
    setRows(Array.isArray(list) ? (list as AssignmentRow[]) : []);
    setSharedTests(Array.isArray(tests) ? (tests as SharedTestRow[]) : []);
  };

  useEffect(() => {
    load().catch((e: any) => {
      const msg = String(e?.message ?? "読み込みエラー");
      if (msg.includes("401")) {
        logout("student");
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

  const addSelfStudyBook = () => {
    const title = selfStudyTitle.trim();
    const totalUnits = Math.max(1, safeNum(selfStudyTotal, 0));
    const currentUnit = Math.max(0, Math.min(totalUnits, safeNum(selfStudyCurrent, 0)));
    if (!title) return setErr("自主学習用の問題集名を入力してください。");
    if (!selfStudyTotal.trim()) return setErr("問題集全体の量（ページ数や問題数）を入力してください。");
    setErr(null);
    const next: SelfStudyBook[] = [
      {
        id: crypto.randomUUID(),
        title,
        totalUnits,
        currentUnit,
        note: selfStudyNote.trim(),
        updatedAt: new Date().toISOString(),
      },
      ...selfStudyBooks,
    ];
    setSelfStudyBooks(next);
    writeSelfStudyBooks(next);
    setSelfStudyTitle("");
    setSelfStudyTotal("");
    setSelfStudyCurrent("");
    setSelfStudyNote("");
  };

  const updateSelfStudyBook = (id: string, nextCurrent: number) => {
    const next = selfStudyBooks.map((row) =>
      row.id === id
        ? {
            ...row,
            currentUnit: Math.max(0, Math.min(row.totalUnits, nextCurrent)),
            updatedAt: new Date().toISOString(),
          }
        : row,
    );
    setSelfStudyBooks(next);
    writeSelfStudyBooks(next);
  };

  const removeSelfStudyBook = (id: string) => {
    const next = selfStudyBooks.filter((row) => row.id !== id);
    setSelfStudyBooks(next);
    writeSelfStudyBooks(next);
  };

  const classText = useMemo(() => (user?.classId ? user.classId : "未設定"), [user?.classId]);

  const calendarEvents: CalendarEvent[] = useMemo(() => {
    const dueEvents: CalendarEvent[] = rows
      .filter((r) => !!r.due_at)
      .map((r) => ({
        id: `due-${r.id}`,
        date: toYMDLocal(r.due_at!),
        title: `〖課題〗${r.title}`,
        kind: "due" as const,
      }));

    const shared: CalendarEvent[] = sharedTests.map((t) => ({
      id: `shared-test-${t.id}`,
      date: t.event_date,
      title: `〖テスト（共有）〗${t.title}`,
      kind: "test" as const,
    }));

    const local: CalendarEvent[] = localTests.map((t) => ({
      id: `local-test-${t.id}`,
      date: t.date,
      title: `〖テスト（ローカル）〗${t.title}`,
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

  const assignmentSummary = useMemo(() => {
    return rows.map((r) => {
      const total = Math.max(0, safeNum(r.total, 0));
      const done = Math.max(0, Math.min(total || 0, safeNum(r.done, 0)));
      const understanding = Math.max(0, Math.min(100, safeNum(r.pct, pct(done, total || 1))));
      const dueDate = r.due_at ? toYMDLocal(r.due_at) : null;
      return {
        ...r,
        total,
        done,
        remaining: Math.max(0, total - done),
        understanding,
        dueText: formatDue(r.due_at),
        dueDate,
      };
    });
  }, [rows]);

  const selfStudySummary = useMemo(() => {
    const totalBooks = selfStudyBooks.length;
    const activeBooks = selfStudyBooks.filter((row) => row.currentUnit > 0).length;
    return { totalBooks, activeBooks };
  }, [selfStudyBooks]);

  const learningOverview = useMemo(() => {
    const today = toYMDLocal(new Date());
    const dueToday = assignmentSummary.filter((row) => row.dueDate === today);
    const baseRows = dueToday.length > 0 ? dueToday : assignmentSummary;
    const todayPracticeCount = baseRows.reduce((sum, row) => sum + row.total, 0);
    const remainingDueCount = assignmentSummary
      .filter((row) => !!row.due_at)
      .reduce((sum, row) => sum + row.remaining, 0);
    return { todayPracticeCount, remainingDueCount };
  }, [assignmentSummary]);

  if (!authChecked) return <div className="p-6">確認中...</div>;
  if (!user) return <div className="p-6">ログインへ遷移中...</div>;

  return (
    <div className="space-y-8 p-4 md:p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">生徒ホーム</h1>
        <p className="mt-3 text-sm text-gray-600">今日の課題と自主学習の両方を見渡しながら、学習の流れを整えるページです。</p>
        <p className="mt-2 text-sm text-gray-600">
          クラス：{classText}
          {!user.classId && <span className="ml-2 text-amber-700">共有予定の表示にはクラス設定が必要です。</span>}
        </p>
      </div>

      {err && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}

      <TintedCard className="border-emerald-200 bg-gradient-to-br from-emerald-50 via-green-50 to-white">
        <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr] xl:items-center">
          <div>
            <div className="inline-flex rounded-full border border-emerald-200 bg-white/90 px-3 py-1 text-xs font-medium text-emerald-700">今日の学習の見通し</div>
            <div className="mt-4 text-2xl font-bold text-gray-900">今日の問題演習数と期限のある課題を同じ欄で確認</div>
            <p className="mt-3 text-sm leading-6 text-gray-600">課題一覧と自主学習への入口は下のカードに残しつつ、この欄では今見るべき数を棒グラフで大きく表示します。</p>
          </div>
          <div className="rounded-3xl bg-white/85 p-5 shadow-sm ring-1 ring-emerald-100">
            <MiniBarChart
              items={[
                {
                  label: "今日の問題演習数",
                  value: learningOverview.todayPracticeCount,
                  colorClass: "bg-gradient-to-r from-emerald-400 to-green-500",
                  textClass: "text-emerald-700",
                  note: "今日が期限の課題があればその合計、なければ配布中課題の合計です。",
                },
                {
                  label: "期限のある課題の残り題数",
                  value: learningOverview.remainingDueCount,
                  colorClass: "bg-gradient-to-r from-amber-400 to-orange-500",
                  textClass: "text-amber-700",
                  note: "期限が設定されている課題のうち、まだ残っている問題数です。",
                },
              ]}
            />
          </div>
        </div>
      </TintedCard>

      <SectionTitle title="よく使う機能" desc="教師ホームと同じように、各カードをグラデーション付きの色でそろえました。対応する機能は同系色で合わせています。" />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <GradientLinkCard
          href="/student/assignments"
          title="課題一覧"
          desc="先生から届いた課題の一覧です。詳細ページから進捗を入力し、提出状況を確認できます。"
          action="開く"
          className="border-emerald-200 bg-gradient-to-br from-emerald-50 via-green-50 to-teal-50"
          actionClass="text-emerald-700"
        />
        <GradientLinkCard
          href="/student/self-study"
          title="自主学習"
          desc="自分で進める問題集を登録し、現在地を記録します。課題とは別に学習の蓄積を残せます。"
          action="開く"
          className="border-cyan-200 bg-gradient-to-br from-cyan-50 via-sky-50 to-blue-50"
          actionClass="text-sky-700"
        />
        <GradientLinkCard
          href="/student/questions"
          title="質問"
          desc="先生への質問と返信をスレッド形式で確認できます。学習中の疑問をそのまま残せます。"
          action="開く"
          className="border-pink-200 bg-gradient-to-br from-pink-50 via-rose-50 to-fuchsia-50"
          actionClass="text-pink-700"
        />
        <GradientLinkCard
          href="/student/books"
          title="教材置き場"
          desc="図、動画、補助資料を見直せます。授業や課題の復習にも使える教材の入口です。"
          action="開く"
          className="border-amber-200 bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-50"
          actionClass="text-amber-700"
        />
        <TintedCard className="border-violet-200 bg-gradient-to-br from-violet-50 via-purple-50 to-fuchsia-50">
          <div className="text-lg font-semibold text-gray-900">予定カレンダー</div>
          <p className="mt-2 text-sm leading-6 text-gray-600">共有テスト予定と自分用テスト予定をまとめて見返せます。直近14日の件数は {upcoming.length} 件です。</p>
          <div className="mt-5 text-sm font-medium text-violet-700">下へスクロールして確認</div>
        </TintedCard>
        <TintedCard className="border-slate-200 bg-gradient-to-br from-slate-50 via-gray-50 to-white">
          <div className="text-lg font-semibold text-gray-900">現在のクラス</div>
          <p className="mt-2 text-sm leading-6 text-gray-600">現在の所属クラスは {classText} です。共有予定や配布内容の表示対象として使われます。</p>
          <div className="mt-5 text-sm font-medium text-slate-700">現在の表示対象を確認</div>
        </TintedCard>
      </div>

      <SectionTitle title="現在の見通し" desc="課題、自主学習、予定を四つのカードでまとめて確認できます。" />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <TintedCard className="border-emerald-200 bg-emerald-50">
          <div className="text-sm text-gray-500">配布中の課題</div>
          <div className="mt-3 text-4xl font-bold text-gray-900">{assignmentSummary.length}</div>
          <p className="mt-2 text-sm text-gray-600">いま取り組める課題の数です。</p>
        </TintedCard>
        <TintedCard className="border-cyan-200 bg-cyan-50">
          <div className="text-sm text-gray-500">自主学習の問題集</div>
          <div className="mt-3 text-4xl font-bold text-gray-900">{selfStudySummary.totalBooks}</div>
          <p className="mt-2 text-sm text-gray-600">この端末で登録している冊数です。</p>
        </TintedCard>
        <TintedCard className="border-pink-200 bg-pink-50">
          <div className="text-sm text-gray-500">共有テスト予定</div>
          <div className="mt-3 text-4xl font-bold text-gray-900">{sharedTests.length}</div>
          <p className="mt-2 text-sm text-gray-600">先生から共有されている予定です。</p>
        </TintedCard>
        <TintedCard className="border-amber-200 bg-amber-50">
          <div className="text-sm text-gray-500">直近14日</div>
          <div className="mt-3 text-4xl font-bold text-gray-900">{upcoming.length}</div>
          <p className="mt-2 text-sm text-gray-600">今日から2週間の予定件数です。</p>
        </TintedCard>
      </div>

      <SectionTitle title="課題の進み具合" desc="課題範囲の帯を残したまま、自分がどこまで進んだかを同じバーで見られる形にしています。" />

      <div className="space-y-4">
        {assignmentSummary.length === 0 ? (
          <WhiteCard>
            <p className="text-sm text-gray-600">配布中の課題はありません。先生が課題を配布するとここに表示されます。</p>
          </WhiteCard>
        ) : (
          assignmentSummary.slice(0, 6).map((r, index) => (
            <TintedCard
              key={r.id}
              className={
                index % 3 === 0
                  ? "border-emerald-200 bg-emerald-50/80"
                  : index % 3 === 1
                    ? "border-cyan-200 bg-cyan-50/80"
                    : "border-pink-200 bg-pink-50/80"
              }
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-gray-900">{r.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <span>{r.dueText}</span>
                    {r.tag ? <span className="rounded-full border border-white/70 bg-white/70 px-2 py-0.5">{r.tag}</span> : null}
                  </div>
                </div>
                <Link href={`/student/assignments/${encodeURIComponent(r.id)}`} className="rounded-xl border border-white/80 bg-white/90 px-4 py-2 text-sm font-medium hover:bg-white">
                  進捗を入力する
                </Link>
              </div>
              <div className="mt-5 grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
                <div className="rounded-2xl bg-white/75 p-4 ring-1 ring-black/5">
                  <AssignmentRangeBar total={Math.max(1, r.total)} done={r.done} />
                </div>
                <div className="rounded-2xl bg-white/75 p-4 ring-1 ring-black/5">
                  <div className="text-sm font-semibold text-gray-800">理解度の目安</div>
                  <div className="mt-3 text-3xl font-bold text-gray-900">{r.understanding}%</div>
                  <div className="mt-2 text-sm text-gray-600">
                    {r.done} / {r.total} 問題を記録済みです。
                  </div>
                </div>
              </div>
            </TintedCard>
          ))
        )}
      </div>

      <SectionTitle title="自主学習できる問題集" desc="教師ホームと同じく、明るい色のカードで登録欄と一覧欄を分けて見やすくしました。" />

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <TintedCard className="border-cyan-200 bg-cyan-50">
          <div className="text-lg font-semibold text-gray-900">自主学習の問題集を登録</div>
          <p className="mt-2 text-sm text-gray-600">ページ数でも問題数でもよいので、全体量と現在地を入力します。</p>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">問題集名</label>
              <input className="w-full rounded-xl border border-white/90 bg-white/90 px-3 py-2" value={selfStudyTitle} onChange={(e) => setSelfStudyTitle(e.target.value)} placeholder="例: 青チャート 数学I" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">全体量</label>
                <input className="w-full rounded-xl border border-white/90 bg-white/90 px-3 py-2" inputMode="numeric" value={selfStudyTotal} onChange={(e) => setSelfStudyTotal(e.target.value)} placeholder="例: 180" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">現在地</label>
                <input className="w-full rounded-xl border border-white/90 bg-white/90 px-3 py-2" inputMode="numeric" value={selfStudyCurrent} onChange={(e) => setSelfStudyCurrent(e.target.value)} placeholder="例: 36" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">メモ</label>
              <textarea className="min-h-[88px] w-full rounded-xl border border-white/90 bg-white/90 px-3 py-2" value={selfStudyNote} onChange={(e) => setSelfStudyNote(e.target.value)} placeholder="例: 週末は例題を中心に進める" />
            </div>
            <div className="flex justify-end">
              <button className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700" onClick={addSelfStudyBook}>
                登録する
              </button>
            </div>
          </div>
        </TintedCard>

        <TintedCard className="border-sky-200 bg-sky-50">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-lg font-semibold text-gray-900">登録中の自主学習</div>
              <p className="mt-1 text-sm text-gray-600">課題とは別の、自分用の進捗欄です。</p>
            </div>
            <Link href="/student/self-study" className="rounded-xl border border-white/80 bg-white/90 px-4 py-2 text-sm font-medium hover:bg-white">
              一覧で開く
            </Link>
          </div>
          <div className="mt-4 space-y-4">
            {selfStudyBooks.length === 0 ? (
              <div className="rounded-xl bg-white/80 p-4 text-sm text-gray-600 ring-1 ring-black/5">まだ問題集は登録されていません。</div>
            ) : (
              selfStudyBooks.slice(0, 4).map((row) => {
                const progress = pct(row.currentUnit, row.totalUnits);
                return (
                  <div key={row.id} className="rounded-2xl bg-white/85 p-4 ring-1 ring-black/5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-gray-900">{row.title}</div>
                        <div className="mt-1 text-xs text-gray-500">
                          {row.currentUnit} / {row.totalUnits}
                        </div>
                      </div>
                      <button className="text-xs text-gray-500 underline" onClick={() => removeSelfStudyBook(row.id)}>
                        削除
                      </button>
                    </div>
                    <div className="mt-3">
                      <ProgressBar value={progress} colorClass="bg-sky-500" />
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <button className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50" onClick={() => updateSelfStudyBook(row.id, row.currentUnit - 1)}>
                        -1
                      </button>
                      <button className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50" onClick={() => updateSelfStudyBook(row.id, row.currentUnit + 1)}>
                        +1
                      </button>
                      <div className="ml-auto text-sm font-medium text-sky-700">{progress}%</div>
                    </div>
                    {row.note ? <p className="mt-3 text-sm text-gray-600">{row.note}</p> : null}
                  </div>
                );
              })
            )}
          </div>
        </TintedCard>
      </div>

      <SectionTitle title="カレンダー" desc="課題期限とテスト予定をまとめて確認します。" />
      <WhiteCard>
        <MonthCalendar events={calendarEvents} />
      </WhiteCard>

      <SectionTitle title="テスト予定" desc="共有予定と自分用メモを一緒に管理できます。" />

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <TintedCard className="border-amber-200 bg-amber-50">
          <div className="text-lg font-semibold text-gray-900">ローカルテスト予定（この端末のみ）</div>
          <p className="mt-2 text-sm text-gray-600">自分用のメモです。ほかの端末や先生には共有されません。</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_180px_auto]">
            <input className="rounded-xl border border-white/90 bg-white/90 px-3 py-2" value={localTitle} onChange={(e) => setLocalTitle(e.target.value)} placeholder="テスト名" />
            <input className="rounded-xl border border-white/90 bg-white/90 px-3 py-2" type="date" value={localDate} onChange={(e) => setLocalDate(e.target.value)} />
            <button className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700" onClick={addLocalTest}>
              追加
            </button>
          </div>
          <div className="mt-4 space-y-3">
            {localTests.length === 0 ? (
              <div className="rounded-xl bg-white/80 p-4 text-sm text-gray-600 ring-1 ring-black/5">ローカル予定は未登録です。</div>
            ) : (
              localTests.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 rounded-2xl bg-white/85 p-4 ring-1 ring-black/5">
                  <div>
                    <div className="font-semibold text-gray-900">{t.title}</div>
                    <div className="mt-1 text-sm text-gray-600">{t.date}</div>
                  </div>
                  <button className="text-sm text-gray-500 underline" onClick={() => removeLocalTest(t.id)}>
                    削除
                  </button>
                </div>
              ))
            )}
          </div>
        </TintedCard>

        <TintedCard className="border-pink-200 bg-pink-50">
          <div className="text-lg font-semibold text-gray-900">直近14日（今日〜）</div>
          <p className="mt-2 text-sm text-gray-600">近い予定を日付順で見直せます。</p>
          <div className="mt-4 space-y-3">
            {upcoming.length === 0 ? (
              <div className="rounded-xl bg-white/80 p-4 text-sm text-gray-600 ring-1 ring-black/5">直近の予定はありません。</div>
            ) : (
              upcoming.map((e) => (
                <div key={e.id} className="rounded-2xl bg-white/85 p-4 ring-1 ring-black/5">
                  <div className="font-semibold text-gray-900">{e.title}</div>
                  <div className="mt-1 text-sm text-gray-600">{e.date}</div>
                </div>
              ))
            )}
          </div>
        </TintedCard>
      </div>
    </div>
  );
}
