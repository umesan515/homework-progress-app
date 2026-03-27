"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { getUserFromToken, logout, type JwtUser } from "@/lib/auth";
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

function SectionTitle({ title, desc }: { title: string; desc: string }) {
  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight text-gray-900">{title}</h2>
      <p className="mt-2 text-sm text-gray-600">{desc}</p>
    </div>
  );
}

function WhiteCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-3xl border border-gray-200 bg-white p-5 shadow-sm ${className}`}>{children}</div>;
}

function TintedCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-3xl border p-5 shadow-sm ${className}`}>{children}</div>;
}

function SoftPanel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-3xl border p-5 shadow-[0_10px_28px_rgba(15,23,42,0.06)] ${className}`}>{children}</div>;
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

function SoftInfoCard({
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
    <SoftPanel className={className}>
      <div className="text-sm text-gray-500">{title}</div>
      <div className={`mt-3 text-4xl font-bold ${valueClass}`}>{value}</div>
      <p className="mt-2 text-sm text-gray-600">{desc}</p>
    </SoftPanel>
  );
}

export default function TeacherHomePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<JwtUser | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [classIds, setClassIds] = useState<string[]>([]);
  const [sharedTests, setSharedTests] = useState<SharedTestRow[]>([]);
  const [localTests, setLocalTests] = useState<LocalEvent[]>([]);
  const [sharedTitle, setSharedTitle] = useState("定期テスト");
  const [sharedDate, setSharedDate] = useState("");
  const [sharedSelected, setSharedSelected] = useState<Set<string>>(new Set(["ALL"]));
  const [localTitle, setLocalTitle] = useState("定期テスト");
  const [localDate, setLocalDate] = useState("");

  useEffect(() => {
    setUser(getUserFromToken() as JwtUser | null);
    setLocalTests(readLocalEvents());
    setReady(true);
  }, []);

  const isTeacherLike = user?.role === "teacher" || user?.role === "admin";
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      router.replace("/login?role=teacher");
      return;
    }
    if (!isTeacherLike) {
      router.replace("/student");
      return;
    }
  }, [ready, user, isTeacherLike, router]);

  const load = async () => {
    if (!ready || !isTeacherLike) return;
    setBusy(true);
    setErr(null);
    try {
      const [a, cls, tests] = await Promise.all([
        apiGet<AssignmentRow[]>(`/teacher/assignments?status=all`),
        apiGet<ClassListResp>(`/teacher/classes`),
        apiGet<SharedTestRow[]>(`/calendar/tests`),
      ]);
      setAssignments(Array.isArray(a) ? a : []);
      setClassIds(Array.isArray(cls?.classIds) ? cls.classIds : []);
      setSharedTests(Array.isArray(tests) ? tests : []);
    } catch (e: any) {
      const msg = String(e?.message ?? "読み込みエラー");
      if (msg.includes("401") || msg.includes("403")) {
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

  const addLocalTest = () => {
    const title = localTitle.trim();
    if (!title) return setErr("（ローカル）テスト名を入力してください。");
    if (!localDate) return setErr("（ローカル）日付を選択してください。");
    setErr(null);
    const next = [...localTests, { id: crypto.randomUUID(), date: localDate, title, kind: "test" as const }].sort((a, b) =>
      a.date === b.date ? a.title.localeCompare(b.title, "ja") : a.date.localeCompare(b.date),
    );
    setLocalTests(next);
    writeLocalEvents(next);
    setLocalDate("");
  };

  const removeLocalTest = (id: string) => {
    const next = localTests.filter((row) => row.id !== id);
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
    if (!window.confirm("この共有テスト予定を削除します。よろしいですか？")) return;
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
      id: `shared-${t.id}`,
      date: t.event_date,
      title: `【テスト（共有）】${t.title}`,
      kind: "test" as const,
    }));
    const local: CalendarEvent[] = localTests.map((t) => ({
      id: `local-${t.id}`,
      date: t.date,
      title: `【テスト（ローカル）】${t.title}`,
      kind: "test" as const,
    }));
    return [...dueEvents, ...shared, ...local];
  }, [assignments, sharedTests, localTests]);

  const upcoming = useMemo(() => {
    const today = new Date();
    const start = toYMDLocal(today);
    const end = toYMDLocal(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 14));
    return calendarEvents
      .filter((row) => row.date >= start && row.date <= end)
      .slice()
      .sort((a, b) => (a.date === b.date ? a.title.localeCompare(b.title, "ja") : a.date.localeCompare(b.date)));
  }, [calendarEvents]);

  if (!ready) return <div className="p-6">確認中...</div>;
  if (!user) return <div className="p-6">ログインへ遷移中...</div>;

  return (
    <div className="space-y-8 p-4 md:p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">教師ホーム</h1>
        <p className="mt-3 text-sm text-gray-600">配布、確認、分析、教材管理までを一画面で見渡せるよう整理した教師用ホームです。</p>
        <p className="mt-2 text-sm text-gray-600">
          ログイン中: {user.uid}
          {isAdmin ? <span className="ml-2 text-emerald-700">（管理者モード有効）</span> : null}
        </p>
      </div>

      {err ? <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 whitespace-pre-wrap">{err}</div> : null}
      {busy ? <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">処理中...</div> : null}

      {isAdmin ? (
        <div>
          <SectionTitle title="管理者機能" desc="教師ホームの中で管理者だけが使える機能です。準備中のものは順次拡張します。" />
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <TeacherHomeActionCard href="/teacher/students" title="生徒管理" desc="生徒登録、編集、一括追加の運用入口です。" theme="theme-slate" />
            <TeacherHomeActionCard href="/teacher/classes" title="クラス管理" desc="クラス作成、所属整理、配布対象の基盤を整えます。" theme="theme-emerald" />
            <TeacherHomeActionCard href="/teacher/admin/passwords" title="パスワード管理" desc="各アカウントのログイン用パスワード管理機能です。準備中です。" theme="theme-rose" />
            <TeacherHomeActionCard href="/teacher/admin/teachers" title="教師管理" desc="教師アカウントの追加や編集に向けた入口です。現在は準備中です。" theme="theme-indigo" />
          </div>
        </div>
      ) : null}

      <SectionTitle title="よく使う機能" desc="生徒ホームと同系統のグラデーションカードで、教師の日常動線をそろえています。" />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <TeacherHomeActionCard href="/teacher/templates" title="課題配布" desc="テンプレートを作成し、複数クラスへ配布できます。" theme="theme-blue" />
        <TeacherHomeActionCard href="/teacher/assignments" title="提出状況" desc="配布済み課題の一覧確認、停止、編集、削除を行います。" theme="theme-violet" />
        <TeacherHomeActionCard href="/teacher/classes" title="分析" desc="クラス別の進捗や理解度を見て、指導の優先度を整理します。" theme="theme-emerald" />
        <TeacherHomeActionCard href="/teacher/books" title="問題集管理" desc="教材データの登録、章や大問の整理、出題の確認を行います。" theme="theme-amber" />
        <TeacherHomeActionCard href="/teacher/questions" title="質問対応" desc="生徒から届いた質問に返信し、解決済みの管理も行えます。" theme="theme-rose" />
        <TeacherHomeActionCard href="/teacher/materials" title="教材置き場" desc="図、動画、補助教材を登録し、授業用ライブラリを整えます。" theme="theme-indigo" />
      </div>

      <div>
        <SectionTitle title="運用の見通し" desc="今すぐ把握したい数を、色付きの数値カードで見やすくまとめています。" />
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SoftInfoCard title="配布中の課題" value={assignments.filter((a) => a.status === "open").length} desc="現在生徒が取り組んでいる課題数です。" className="border-emerald-200/90 bg-gradient-to-br from-emerald-100 via-white to-teal-100" valueClass="text-emerald-700" />
          <SoftInfoCard title="停止中の課題" value={assignments.filter((a) => a.status === "closed").length} desc="一時停止している課題です。" className="border-cyan-200/90 bg-gradient-to-br from-cyan-100 via-white to-blue-100" valueClass="text-sky-700" />
          <SoftInfoCard title="共有テスト予定" value={sharedTests.length} desc="生徒へ配信される予定件数です。" className="border-pink-200/90 bg-gradient-to-br from-pink-100 via-white to-fuchsia-100" valueClass="text-pink-700" />
          <SoftInfoCard title="登録クラス数" value={classIds.length} desc="現在配布対象として扱えるクラス数です。" className="border-amber-200/90 bg-gradient-to-br from-amber-100 via-white to-orange-100" valueClass="text-amber-700" />
        </div>
      </div>

      <SectionTitle title="カレンダー" desc="課題期限とテスト予定をまとめて確認します。" />
      <WhiteCard className="border-emerald-200/90 bg-gradient-to-br from-emerald-100 via-white to-teal-100">
        <MonthCalendar events={calendarEvents} />
      </WhiteCard>

      <SectionTitle title="予定の管理" desc="共有予定と個人用メモを、生徒ホームと同系統の淡いグラデーション枠で整理しています。" />
      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <SoftPanel className="border-sky-200/90 bg-gradient-to-br from-sky-100 via-white to-cyan-100">
          <div className="text-lg font-semibold text-gray-900">共有テスト予定（生徒へ配信）</div>
          <p className="mt-2 text-sm text-gray-600">ここで登録した予定は、生徒側カレンダーにも表示されます。</p>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">テスト名</label>
              <input className="w-full rounded-xl border border-white/90 bg-white/90 px-3 py-2" value={sharedTitle} onChange={(e) => setSharedTitle(e.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">日付</label>
                <input className="w-full rounded-xl border border-white/90 bg-white/90 px-3 py-2" type="date" value={sharedDate} onChange={(e) => setSharedDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">配信クラス（複数選択）</label>
                <div className="flex flex-wrap gap-2">
                  <label className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/90 px-3 py-1.5 text-sm text-gray-700">
                    <input type="checkbox" checked={sharedSelected.has("ALL")} onChange={() => toggleSharedClass("ALL")} />
                    ALL
                  </label>
                  {classIds.map((cid) => (
                    <label key={cid} className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/90 px-3 py-1.5 text-sm text-gray-700">
                      <input type="checkbox" checked={sharedSelected.has(cid)} onChange={() => toggleSharedClass(cid)} />
                      {cid}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <button className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50" onClick={addSharedTest} disabled={busy}>
                共有テストを追加
              </button>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {sharedTests.length === 0 ? (
              <div className="rounded-xl bg-white/80 p-4 text-sm text-gray-600 ring-1 ring-black/5">共有テスト予定は未登録です。</div>
            ) : (
              sharedTests.map((row) => (
                <div key={row.id} className="rounded-2xl bg-white/85 p-4 ring-1 ring-black/5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-gray-900">{row.title}</div>
                      <div className="mt-1 text-sm text-gray-600">{row.event_date} / 配信: {(row.class_ids ?? []).join(", ")}</div>
                    </div>
                    <button className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50" onClick={() => deleteSharedTest(row.id)} disabled={busy}>
                      削除
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </SoftPanel>

        <div className="space-y-4">
          <SoftPanel className="border-amber-200/90 bg-gradient-to-br from-amber-100 via-white to-orange-100">
            <div className="text-lg font-semibold text-gray-900">ローカルテスト予定（この端末のみ）</div>
            <p className="mt-2 text-sm text-gray-600">個人メモ用です。共有はされません。</p>
            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">テスト名</label>
                <input className="w-full rounded-xl border border-white/90 bg-white/90 px-3 py-2" value={localTitle} onChange={(e) => setLocalTitle(e.target.value)} />
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">日付</label>
                  <input className="rounded-xl border border-white/90 bg-white/90 px-3 py-2" type="date" value={localDate} onChange={(e) => setLocalDate(e.target.value)} />
                </div>
                <button className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700" onClick={addLocalTest}>
                  追加
                </button>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {localTests.length === 0 ? (
                <div className="rounded-xl bg-white/80 p-4 text-sm text-gray-600 ring-1 ring-black/5">ローカル予定は未登録です。</div>
              ) : (
                localTests.map((row) => (
                  <div key={row.id} className="flex items-center justify-between gap-3 rounded-2xl bg-white/85 p-4 ring-1 ring-black/5">
                    <div>
                      <div className="font-semibold text-gray-900">{row.title}</div>
                      <div className="mt-1 text-sm text-gray-600">{row.date}</div>
                    </div>
                    <button className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm hover:bg-gray-50" onClick={() => removeLocalTest(row.id)}>
                      削除
                    </button>
                  </div>
                ))
              )}
            </div>
          </SoftPanel>

          <SoftPanel className="border-violet-200/90 bg-gradient-to-br from-violet-100 via-white to-fuchsia-100">
            <div className="text-lg font-semibold text-gray-900">直近14日</div>
            <p className="mt-2 text-sm text-gray-600">今日から2週間の課題期限とテスト予定です。</p>
            <div className="mt-4 space-y-3">
              {upcoming.length === 0 ? (
                <div className="rounded-xl bg-white/80 p-4 text-sm text-gray-600 ring-1 ring-black/5">直近の予定はありません。</div>
              ) : (
                upcoming.map((row) => (
                  <div key={row.id} className="flex items-start gap-3 rounded-2xl bg-white/85 p-4 ring-1 ring-black/5">
                    <span className="w-24 shrink-0 font-semibold text-gray-500">{row.date}</span>
                    <span className="min-w-0 text-sm text-gray-700">{row.title}</span>
                  </div>
                ))
              )}
            </div>
          </SoftPanel>
        </div>
      </div>
    </div>
  );
}
