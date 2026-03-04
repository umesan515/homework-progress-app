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

  // ====== ローカル追加/削除 ======
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
    <main className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">教師ホーム</h1>
      </div>

      {err && <p className="text-sm text-red-600 whitespace-pre-wrap">{err}</p>}
      {busy && <p className="text-sm text-gray-600">処理中...</p>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Link className="rounded-xl border p-4 hover:bg-gray-100 hover:shadow-sm transition" href="/teacher/templates">
          <div className="font-semibold">課題配布（テンプレ）</div>
          <div className="text-sm text-gray-600">テンプレ作成・編集・配布</div>
        </Link>

        <Link className="rounded-xl border p-4 hover:bg-gray-100 hover:shadow-sm transition" href="/teacher/assignments">
          <div className="font-semibold">進捗確認（配布済み課題）</div>
          <div className="text-sm text-gray-600">配布済み課題一覧・停止・削除</div>
        </Link>

        <Link className="rounded-xl border p-4 hover:bg-gray-100 hover:shadow-sm transition" href="/teacher/classes">
          <div className="font-semibold">クラス別進捗（ダッシュボード）</div>
          <div className="text-sm text-gray-600">クラスごとに配布課題と生徒進捗を確認</div>
        </Link>

        <Link className="rounded-xl border p-4 hover:bg-gray-100 hover:shadow-sm transition" href="/teacher/books">
          <div className="font-semibold">問題集管理（問題一覧）</div>
          <div className="text-sm text-gray-600">問題集→章→大問の登録・過去出題の把握</div>
        </Link>
      </div>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-1">
          <div className="text-lg font-semibold text-gray-700">カレンダー（課題期限・テスト）</div>
          <MonthCalendar headingOutside events={calendarEvents} />
        </div>

        <div className="space-y-4">
          <div className="space-y-1">
            <div className="text-lg font-semibold text-gray-700">共有テスト予定（生徒へ配信）</div>
            <div className="rounded-2xl bg-gray-50 p-4 space-y-3">
              <div className="text-xs text-gray-500">
                ※ ここで登録したテストは、生徒側カレンダーにも表示されます（クラス指定／ALL可）。
              </div>

              <div className="space-y-2">
                <div className="text-sm">テスト名</div>
                <input
                  className="w-full rounded-lg border px-3 py-2"
                  value={sharedTitle}
                  onChange={(e) => setSharedTitle(e.target.value)}
                />

                <div className="text-sm">日付</div>
                <input
                  className="rounded-lg border px-3 py-2"
                  type="date"
                  value={sharedDate}
                  onChange={(e) => setSharedDate(e.target.value)}
                />

                <div className="text-sm">配信クラス（複数選択）</div>
                <div className="flex flex-wrap gap-3">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={sharedSelected.has("ALL")} onChange={() => toggleSharedClass("ALL")} />
                    ALL（全クラス）
                  </label>
                  {classIds.map((c) => (
                    <label key={c} className="flex items-center gap-2">
                      <input type="checkbox" checked={sharedSelected.has(c)} onChange={() => toggleSharedClass(c)} />
                      {c}
                    </label>
                  ))}
                </div>

                <button
                  className="rounded-lg border px-3 py-2 hover:bg-gray-100 hover:shadow-sm transition disabled:opacity-50"
                  onClick={addSharedTest}
                  disabled={busy}
                >
                  共有テストを追加
                </button>
              </div>

              {sharedTests.length === 0 ? (
                <div className="text-sm text-gray-600">共有テスト予定は未登録です。</div>
              ) : (
                <div className="space-y-2">
                  {sharedTests.map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-2 rounded-xl border p-3">
                      <div className="text-sm">
                        <div className="font-semibold">{t.title}</div>
                        <div className="text-gray-600">
                          {t.event_date} / 配信: {(t.class_ids ?? []).join(", ")}
                        </div>
                      </div>
                      <button
                        className="rounded-lg border px-3 py-2 hover:bg-gray-100 hover:shadow-sm transition text-sm text-red-600"
                        onClick={() => deleteSharedTest(t.id)}
                        disabled={busy}
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
            <div className="text-lg font-semibold text-gray-700">ローカルテスト予定（この端末のみ）</div>
            <div className="rounded-2xl bg-gray-50 p-4 space-y-3">
              <div className="text-xs text-gray-500">※ 個人メモ用途（共有されません）。</div>

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
            <div className="text-lg font-semibold text-gray-700">直近14日（今日〜）</div>
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
    </main>
  );
}
