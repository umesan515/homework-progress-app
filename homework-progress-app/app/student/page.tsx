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
      router.replace("/login");
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
        router.replace("/login");
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
      { id: crypto.randomUUID(), date: localDate, title, kind: "test" },
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
    <main className="p-6 space-y-6">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">生徒ホーム</h1>
        <div className="text-sm text-gray-700">
          {!user.classId && (
            <div className="text-xs text-gray-500">※ クラス未設定の場合，共有テスト予定が表示されません。</div>
          )}
          <div className="text-xs text-gray-500">クラス：{classText}</div>
          {err && <p className="text-sm text-red-600 mt-2 whitespace-pre-wrap">{err}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Link
          href="/student/assignments"
          className="block rounded-2xl border p-4 hover:bg-gray-100 hover:shadow-sm transition"
        >
          <div className="font-semibold">課題一覧</div>
          <div className="text-sm text-gray-600 mt-1">届いた課題をまとめて確認</div>
        </Link>

        <div className="space-y-1">
          <div className="text-lg font-semibold text-gray-700">質問（準備中）</div>
          <div className="rounded-2xl bg-gray-50 p-4 opacity-60">
            <div className="text-sm text-gray-600">匿名質問・画像送信</div>
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-lg font-semibold text-gray-700">小テスト（準備中）</div>
          <div className="rounded-2xl bg-gray-50 p-4 opacity-60">
            <div className="text-sm text-gray-600">実施・採点</div>
          </div>
        </div>
      </div>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-1">
          <div className="text-lg font-semibold text-gray-700">カレンダー（課題期限・テスト）</div>
          <MonthCalendar headingOutside events={calendarEvents} />
        </div>

        <div className="space-y-4">
          <div className="space-y-1">
            <div className="text-lg font-semibold text-gray-700">ローカルテスト予定（この端末のみ）</div>
            <div className="rounded-2xl bg-gray-50 p-4 space-y-3">
              <div className="text-xs text-gray-500">※ 自分用のメモ（共有されません）。</div>

              <div className="space-y-2">
                <div className="text-sm">テスト名</div>
                <input
                  className="w-full rounded-lg border px-3 py-2"
                  value={localTitle}
                  onChange={(e) => setLocalTitle(e.target.value)}
                />
                <div className="text-sm">日付</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    className="rounded-lg border px-3 py-2"
                    type="date"
                    value={localDate}
                    onChange={(e) => setLocalDate(e.target.value)}
                  />
                  <button
                    className="rounded-lg border px-3 py-2 hover:bg-gray-100 hover:shadow-sm transition"
                    onClick={addLocalTest}
                  >
                    追加
                  </button>
                </div>
              </div>

              {localTests.length === 0 ? (
                <div className="text-sm text-gray-600">ローカル予定は未登録です。</div>
              ) : (
                <div className="space-y-2">
                  {localTests.map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-2 rounded-xl border p-3">
                      <div className="text-sm">
                        <div className="font-semibold">{t.title}</div>
                        <div className="text-gray-600">{t.date}</div>
                      </div>
                      <button
                        className="rounded-lg border px-3 py-2 hover:bg-gray-100 hover:shadow-sm transition text-sm"
                        onClick={() => removeLocalTest(t.id)}
                      >
                        削除
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-sm font-semibold text-gray-700">直近14日（今日〜）</div>
            <div className="rounded-2xl bg-gray-50 p-4 space-y-2">
              {upcoming.length === 0 ? (
                <div className="text-sm text-gray-600">直近の予定はありません。</div>
              ) : (
                <ul className="text-sm space-y-1">
                  {upcoming.map((e) => (
                    <li key={e.id} className="flex items-start gap-2">
                      <span className="text-gray-600 w-24 shrink-0">{e.date}</span>
                      <span>{e.title}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold">配布中の課題</h2>
            <p className="text-sm text-gray-600 mt-1">詳細ページで自己採点を入力します。</p>
          </div>
          <Link
            className="text-sm rounded-lg border px-3 py-2 hover:bg-gray-100 hover:shadow-sm transition"
            href="/student/assignments"
          >
            一覧を開く
          </Link>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-xl border p-4 text-sm text-gray-700">
            <div className="font-semibold">配布中の課題はありません。</div>
            <div className="text-gray-600 mt-1">先生が課題を配布するとここに表示されます。</div>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => (
              <div key={r.id} className="rounded-xl border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{r.title}</div>
                    <div className="text-sm text-gray-600">期限：{formatDue(r.due_at)}</div>
                  </div>
                  <Link
                    className="shrink-0 rounded-lg border px-3 py-2 hover:bg-gray-100 hover:shadow-sm transition text-sm"
                    href={`/student/assignments/${r.id}`}
                  >
                    進捗を入力する
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
