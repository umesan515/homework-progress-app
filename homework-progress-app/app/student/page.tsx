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

type SubmissionPayload = {
  submission: unknown | null;
  marksByAttempt?: Record<number, Record<string, string | null>>;
  markedAtByAttempt?: Record<number, Record<string, string | null>>;
  firstMarkedAtByLabel?: Record<string, string | null>;
  statusByLabel?: Record<string, string | null>;
  timeByLabel?: Record<string, number | null>;
};

const LS_KEY_LOCAL = "hw_calendar_events_student_local";
const LS_KEY_SELF_STUDY = "hw_student_self_study_books_v1";
const LS_KEY_SELF_STUDY_DAILY = "hw_student_self_study_daily_unique_v1";

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


const todayKey = () => toYMDLocal(new Date());

const range = (start: number, end: number) => {
  if (end < start) return [] as number[];
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
};

const readDailyUniqueMap = (): Record<string, string[]> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LS_KEY_SELF_STUDY_DAILY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => String(x)) : []]),
    );
  } catch {
    return {};
  }
};

const writeDailyUniqueMap = (value: Record<string, string[]>) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LS_KEY_SELF_STUDY_DAILY, JSON.stringify(value));
};

const recordSelfStudyPractice = (bookId: string, units: number[]) => {
  if (typeof window === "undefined" || units.length === 0) return 0;
  const dateKey = todayKey();
  const current = readDailyUniqueMap();
  const todaySet = new Set(current[dateKey] ?? []);
  const before = todaySet.size;
  for (const unit of units) {
    if (unit > 0) todaySet.add(`${bookId}:${unit}`);
  }
  current[dateKey] = Array.from(todaySet);
  writeDailyUniqueMap(current);
  return todaySet.size - before;
};

const readTodaySelfStudyPracticeCount = () => {
  const current = readDailyUniqueMap();
  return (current[todayKey()] ?? []).length;
};

const collectTodayAssignmentProblemKeys = (assignmentId: string, payload: SubmissionPayload | null | undefined) => {
  const out = new Set<string>();
  if (!payload) return out;
  const day = todayKey();
  const first = payload.firstMarkedAtByLabel ?? {};
  for (const [label, iso] of Object.entries(first)) {
    if (iso && toYMDLocal(new Date(iso)) === day) out.add(`${assignmentId}:${label}`);
  }
  const stamped = payload.markedAtByAttempt ?? {};
  for (const byLabel of Object.values(stamped)) {
    if (!byLabel) continue;
    for (const [label, iso] of Object.entries(byLabel)) {
      if (iso && toYMDLocal(new Date(iso)) === day) out.add(`${assignmentId}:${label}`);
    }
  }
  return out;
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
  items: Array<{ label: string; value: number; colorClass: string; textClass: string; note: string; emptyText?: string }>;
}) {
  const numericValues = items.filter((item) => item.value > 0).map((item) => item.value);
  const maxValue = Math.max(1, ...numericValues);
  return (
    <div className="space-y-4">
      {items.map((item) => {
        const width = item.value <= 0 ? 0 : Math.max(14, Math.round((item.value / maxValue) * 100));
        return (
          <div key={item.label} className="space-y-2">
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-gray-700">{item.label}</div>
                <div className="mt-1 text-xs text-gray-500">{item.note}</div>
              </div>
              <div className={`text-right text-3xl font-bold ${item.textClass}`}>
                {item.value > 0 ? item.value : <span className="text-lg font-semibold">{item.emptyText ?? "0"}</span>}
              </div>
            </div>
            <div className="h-4 overflow-hidden rounded-full bg-white/80 ring-1 ring-black/5">
              <div className={`h-full rounded-full transition-all ${item.colorClass}`} style={{ width: `${width}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TeacherHomeActionCard({
  href,
  title,
  desc,
  theme,
}: {
  href: string;
  title: string;
  desc: string;
  theme: "theme-blue" | "theme-violet" | "theme-emerald" | "theme-amber" | "theme-rose" | "theme-indigo" | "theme-slate";
}) {
  return (
    <Link href={href} className={`home-action-card ${theme}`}>
      <div className="home-action-card-title">{title}</div>
      <div className="home-action-card-desc">{desc}</div>
      <span className="home-action-card-arrow">開く</span>
    </Link>
  );
}

function GradientInfoCard({
  title,
  desc,
  value,
  className,
  valueClass,
}: {
  title: string;
  desc: string;
  value: React.ReactNode;
  className: string;
  valueClass: string;
}) {
  return (
    <div className={`rounded-3xl border p-5 shadow-[0_10px_28px_rgba(15,23,42,0.06)] ${className}`}>
      <div className="text-sm text-gray-500">{title}</div>
      <div className={`mt-3 text-4xl font-bold ${valueClass}`}>{value}</div>
      <p className="mt-2 text-sm text-gray-600">{desc}</p>
    </div>
  );
}

function GradientNoteCard({
  title,
  desc,
  actionText,
  className,
  actionClass,
}: {
  title: string;
  desc: string;
  actionText: string;
  className: string;
  actionClass: string;
}) {
  return (
    <div className={`rounded-3xl border p-5 shadow-[0_10px_28px_rgba(15,23,42,0.06)] ${className}`}>
      <div className="text-lg font-semibold text-gray-900">{title}</div>
      <p className="mt-2 text-sm leading-6 text-gray-600">{desc}</p>
      <div className={`mt-5 text-sm font-medium ${actionClass}`}>{actionText}</div>
    </div>
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
  const [submissionMap, setSubmissionMap] = useState<Record<string, SubmissionPayload | null>>({});
  const [todaySelfStudyCount, setTodaySelfStudyCount] = useState(0);
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
    setTodaySelfStudyCount(readTodaySelfStudyPracticeCount());
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
    setSubmissionMap({});
    if (!authChecked || !user || user.role !== "student") return;
    const [list, tests] = await Promise.all([apiGet("/student/assignments"), apiGet("/calendar/tests")]);
    const nextRows = Array.isArray(list) ? (list as AssignmentRow[]) : [];
    setRows(nextRows);
    setSharedTests(Array.isArray(tests) ? (tests as SharedTestRow[]) : []);

    const submissionEntries = await Promise.all(
      nextRows.map(async (row) => {
        try {
          const payload = (await apiGet(`/submissions?assignmentId=${encodeURIComponent(row.id)}`)) as SubmissionPayload;
          return [row.id, payload ?? null] as const;
        } catch {
          return [row.id, null] as const;
        }
      }),
    );
    setSubmissionMap(Object.fromEntries(submissionEntries));
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
    const id = crypto.randomUUID();
    const next: SelfStudyBook[] = [
      {
        id,
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
    if (currentUnit > 0) {
      recordSelfStudyPractice(id, range(1, currentUnit));
      setTodaySelfStudyCount(readTodaySelfStudyPracticeCount());
    }
    setSelfStudyTitle("");
    setSelfStudyTotal("");
    setSelfStudyCurrent("");
    setSelfStudyNote("");
  };

  const updateSelfStudyBook = (id: string, nextCurrent: number) => {
    const currentRow = selfStudyBooks.find((row) => row.id === id);
    const nextValue = currentRow ? Math.max(0, Math.min(currentRow.totalUnits, nextCurrent)) : 0;
    const next = selfStudyBooks.map((row) =>
      row.id === id
        ? {
            ...row,
            currentUnit: nextValue,
            updatedAt: new Date().toISOString(),
          }
        : row,
    );
    setSelfStudyBooks(next);
    writeSelfStudyBooks(next);
    if (currentRow && nextValue > currentRow.currentUnit) {
      recordSelfStudyPractice(id, range(currentRow.currentUnit + 1, nextValue));
      setTodaySelfStudyCount(readTodaySelfStudyPracticeCount());
    }
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
    const assignmentPracticeKeys = new Set<string>();
    for (const row of assignmentSummary) {
      const payload = submissionMap[row.id] ?? null;
      for (const key of collectTodayAssignmentProblemKeys(row.id, payload)) {
        assignmentPracticeKeys.add(key);
      }
    }
    const dueRows = assignmentSummary.filter((row) => !!row.due_at);
    const remainingDueCount = dueRows.reduce((sum, row) => sum + row.remaining, 0);
    return {
      todayPracticeCount: assignmentPracticeKeys.size + todaySelfStudyCount,
      remainingDueCount,
      hasDueAssignments: dueRows.length > 0,
    };
  }, [assignmentSummary, submissionMap, todaySelfStudyCount]);

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

      <div className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-100 via-white to-teal-100 p-5 shadow-[0_10px_28px_rgba(15,23,42,0.06)]">
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
                  colorClass: "bg-gradient-to-r from-emerald-300 via-green-300 to-teal-300",
                  textClass: "text-emerald-700",
                  note: "課題内外を問わず、今日入力した問題を累積します。同じ問題を繰り返し入力しても、その日中は1題として数えます。",
                },
                {
                  label: "期限のある課題の残り題数",
                  value: learningOverview.hasDueAssignments ? learningOverview.remainingDueCount : 0,
                  colorClass: "bg-gradient-to-r from-amber-300 via-yellow-300 to-orange-300",
                  textClass: "text-amber-700",
                  note: learningOverview.hasDueAssignments
                    ? "期限付き課題の未完了分です。演習が進むと残り題数が減っていきます。"
                    : "現在、期限が設定された課題はありません。",
                  emptyText: "課題なし",
                },
              ]}
            />
          </div>
        </div>
      </div>

      <SectionTitle title="よく使う機能" desc="教師ホームと同じカードデザインで、日常的に使う入口をそろえています。対応する機能どうしは同系色で統一しています。" />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <TeacherHomeActionCard
          href="/student/assignments"
          title="課題一覧"
          desc="先生から届いた課題の一覧です。詳細ページから進捗を入力し、提出状況を確認できます。"
          theme="theme-blue"
        />
        <TeacherHomeActionCard
          href="/student/self-study"
          title="自主学習"
          desc="自分で進める問題集を登録し、現在地を記録します。課題とは別に学習の蓄積を残せます。"
          theme="theme-violet"
        />
        <TeacherHomeActionCard
          href="/student/questions"
          title="質問"
          desc="先生への質問と返信をスレッド形式で確認できます。学習中の疑問をそのまま残せます。"
          theme="theme-rose"
        />
        <TeacherHomeActionCard
          href="/student/books"
          title="教材置き場"
          desc="図、動画、補助資料を見直せます。授業や課題の復習にも使える教材の入口です。"
          theme="theme-indigo"
        />
        <GradientNoteCard
          title="予定カレンダー"
          desc={`共有テスト予定と自分用テスト予定をまとめて見返せます。直近14日の件数は ${upcoming.length} 件です。`}
          actionText="下へスクロールして確認"
          className="border-violet-200/90 bg-gradient-to-br from-violet-100 via-white to-fuchsia-100"
          actionClass="text-violet-700"
        />
        <GradientNoteCard
          title="現在のクラス"
          desc={`現在の所属クラスは ${classText} です。共有予定や配布内容の表示対象として使われます。`}
          actionText="現在の表示対象を確認"
          className="border-slate-200/90 bg-gradient-to-br from-slate-100 via-white to-gray-100"
          actionClass="text-slate-700"
        />
      </div>

      <SectionTitle title="現在の見通し" desc="課題、自主学習、予定を四つのカードでまとめて確認できます。" />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <GradientInfoCard
          title="配布中の課題"
          value={assignmentSummary.length}
          desc="いま取り組める課題の数です。"
          className="border-emerald-200/90 bg-gradient-to-br from-emerald-100 via-white to-teal-100"
          valueClass="text-emerald-700"
        />
        <GradientInfoCard
          title="自主学習の問題集"
          value={selfStudySummary.totalBooks}
          desc="この端末で登録している冊数です。"
          className="border-cyan-200/90 bg-gradient-to-br from-cyan-100 via-white to-blue-100"
          valueClass="text-sky-700"
        />
        <GradientInfoCard
          title="共有テスト予定"
          value={sharedTests.length}
          desc="先生から共有されている予定です。"
          className="border-pink-200/90 bg-gradient-to-br from-pink-100 via-white to-fuchsia-100"
          valueClass="text-pink-700"
        />
        <GradientInfoCard
          title="直近14日"
          value={upcoming.length}
          desc="今日から2週間の予定件数です。"
          className="border-amber-200/90 bg-gradient-to-br from-amber-100 via-white to-orange-100"
          valueClass="text-amber-700"
        />
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
