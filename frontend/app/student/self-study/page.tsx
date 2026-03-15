"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getUserFromToken, logout, type JwtUser } from "@/lib/auth";

type SelfStudyBook = {
  id: string;
  title: string;
  totalUnits: number;
  currentUnit: number;
  note: string;
  updatedAt: string;
};

const LS_KEY_SELF_STUDY = "hw_student_self_study_books_v1";
const LS_KEY_SELF_STUDY_DAILY = "hw_student_self_study_daily_unique_v1";

const safeNum = (v: unknown, fallback = 0) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const pct = (done: number, total: number) => {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
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


const todayKey = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

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
  if (typeof window === "undefined" || units.length === 0) return;
  const current = readDailyUniqueMap();
  const key = todayKey();
  const set = new Set(current[key] ?? []);
  for (const unit of units) {
    if (unit > 0) set.add(`${bookId}:${unit}`);
  }
  current[key] = Array.from(set);
  writeDailyUniqueMap(current);
};

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

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-white/75 ring-1 ring-black/5">
      <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export default function StudentSelfStudyPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<JwtUser | null>(null);
  const [rows, setRows] = useState<SelfStudyBook[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [totalUnits, setTotalUnits] = useState("");
  const [currentUnit, setCurrentUnit] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    const u = getUserFromToken();
    setUser(u as JwtUser | null);
    setReady(true);
    setRows(readSelfStudyBooks());
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      router.replace("/login?role=student");
      return;
    }
    if (user.role !== "student") {
      logout("student");
      router.replace("/teacher");
    }
  }, [ready, user, router]);

  const addBook = () => {
    const trimmed = title.trim();
    if (!trimmed) return setErr("問題集名を入力してください。");
    if (!totalUnits.trim()) return setErr("全体量を入力してください。");
    const total = Math.max(1, safeNum(totalUnits, 1));
    const current = Math.max(0, Math.min(total, safeNum(currentUnit, 0)));
    const id = crypto.randomUUID();
    const next: SelfStudyBook[] = [
      {
        id,
        title: trimmed,
        totalUnits: total,
        currentUnit: current,
        note: note.trim(),
        updatedAt: new Date().toISOString(),
      },
      ...rows,
    ];
    setRows(next);
    writeSelfStudyBooks(next);
    if (current > 0) recordSelfStudyPractice(id, range(1, current));
    setErr(null);
    setTitle("");
    setTotalUnits("");
    setCurrentUnit("");
    setNote("");
  };

  const updateRow = (id: string, patch: Partial<SelfStudyBook>) => {
    const before = rows.find((row) => row.id === id);
    let afterCurrent = before?.currentUnit ?? 0;
    const next = rows.map((row) => {
      if (row.id !== id) return row;
      const merged = { ...row, ...patch, updatedAt: new Date().toISOString() };
      const normalized = {
        ...merged,
        totalUnits: Math.max(1, safeNum(merged.totalUnits, 1)),
        currentUnit: Math.max(0, Math.min(Math.max(1, safeNum(merged.totalUnits, 1)), safeNum(merged.currentUnit, 0))),
      };
      afterCurrent = normalized.currentUnit;
      return normalized;
    });
    setRows(next);
    writeSelfStudyBooks(next);
    if (before && afterCurrent > before.currentUnit) {
      recordSelfStudyPractice(id, range(before.currentUnit + 1, afterCurrent));
    }
  };

  const removeRow = (id: string) => {
    const next = rows.filter((row) => row.id !== id);
    setRows(next);
    writeSelfStudyBooks(next);
  };

  const totalProgress = useMemo(() => {
    const total = rows.reduce((acc, row) => acc + row.totalUnits, 0);
    const done = rows.reduce((acc, row) => acc + Math.min(row.currentUnit, row.totalUnits), 0);
    return { total, done, percent: pct(done, total) };
  }, [rows]);

  if (!ready) return <div className="p-6">読み込み中...</div>;
  if (!user) return <div className="p-6">ログインへ遷移中...</div>;

  return (
    <div className="space-y-8 p-4 md:p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">自主学習</h1>
        <p className="mt-3 text-sm text-gray-600">課題とは別に、自分のペースで進める問題集の記録を残します。</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link href="/student" className="rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50">
          生徒ホームへ
        </Link>
        <Link href="/student/assignments" className="rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50">
          課題一覧へ
        </Link>
      </div>

      {err && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}

      <TintedCard className="border-sky-200 bg-gradient-to-br from-sky-50 via-cyan-50 to-white">
        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr] xl:items-center">
          <div>
            <div className="inline-flex rounded-full border border-sky-200 bg-white/90 px-3 py-1 text-xs font-medium text-sky-700">自分のペースを残す欄</div>
            <div className="mt-4 text-2xl font-bold text-gray-900">課題とは別の進捗を、見やすいカードで整理</div>
            <p className="mt-3 text-sm leading-6 text-gray-600">登録した問題集はこの端末に保存されます。ページ数でも問題数でもよいので、全体量と現在地をそろえて入れてください。</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <div className="rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-sky-100">
              <div className="text-xs text-gray-500">登録冊数</div>
              <div className="mt-2 text-3xl font-bold text-gray-900">{rows.length}</div>
            </div>
            <div className="rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-sky-100">
              <div className="text-xs text-gray-500">合計進捗</div>
              <div className="mt-2 text-3xl font-bold text-gray-900">{totalProgress.percent}%</div>
            </div>
          </div>
        </div>
      </TintedCard>

      <SectionTitle title="全体の見通し" desc="登録した問題集全体の中で、どこまで進めたかをひと目で確認できます。" />
      <TintedCard className="border-cyan-200 bg-cyan-50">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-sm text-gray-500">自主学習の合計進捗</div>
            <div className="mt-2 text-4xl font-bold text-gray-900">{totalProgress.percent}%</div>
          </div>
          <div className="text-sm text-gray-600">
            {totalProgress.done} / {totalProgress.total || 0}
          </div>
        </div>
        <div className="mt-4">
          <ProgressBar value={totalProgress.percent} />
        </div>
      </TintedCard>

      <SectionTitle title="問題集を追加" desc="教師ページの雰囲気に合わせ、教師ホームに寄せた淡いグラデーションの入力カードにしています。" />
      <TintedCard className="border-amber-200 bg-amber-50">
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">問題集名</label>
            <input className="w-full rounded-xl border border-white/90 bg-white/90 px-3 py-2" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: 青チャート 数学I" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">メモ</label>
            <input className="w-full rounded-xl border border-white/90 bg-white/90 px-3 py-2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例: 例題を優先する" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">全体量</label>
            <input className="w-full rounded-xl border border-white/90 bg-white/90 px-3 py-2" inputMode="numeric" value={totalUnits} onChange={(e) => setTotalUnits(e.target.value)} placeholder="例: 180" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">現在地</label>
            <input className="w-full rounded-xl border border-white/90 bg-white/90 px-3 py-2" inputMode="numeric" value={currentUnit} onChange={(e) => setCurrentUnit(e.target.value)} placeholder="例: 36" />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700" onClick={addBook}>
            追加する
          </button>
        </div>
      </TintedCard>

      <SectionTitle title="登録中の問題集" desc="各冊子ごとに、現在地を直接更新できます。" />
      <div className="space-y-4">
        {rows.length === 0 ? (
          <TintedCard className="border-gray-200 bg-white text-sm text-gray-600">まだ問題集は登録されていません。</TintedCard>
        ) : (
          rows.map((row, index) => {
            const progress = pct(row.currentUnit, row.totalUnits);
            const cardClass = index % 3 === 0 ? "border-sky-200 bg-sky-50" : index % 3 === 1 ? "border-cyan-200 bg-cyan-50" : "border-violet-200 bg-violet-50";
            return (
              <TintedCard key={row.id} className={cardClass}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold text-gray-900">{row.title}</div>
                    <div className="mt-1 text-xs text-gray-500">最終更新: {new Date(row.updatedAt).toLocaleString("ja-JP")}</div>
                  </div>
                  <button className="text-sm text-gray-500 underline" onClick={() => removeRow(row.id)}>
                    削除
                  </button>
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_260px]">
                  <div className="rounded-2xl bg-white/85 p-4 ring-1 ring-black/5">
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>進捗</span>
                      <span>
                        {row.currentUnit} / {row.totalUnits}
                      </span>
                    </div>
                    <div className="mt-2">
                      <ProgressBar value={progress} />
                    </div>
                    {row.note ? <div className="mt-3 text-sm text-gray-600">{row.note}</div> : null}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] lg:grid-cols-1">
                    <input
                      className="w-full rounded-xl border border-white/90 bg-white/90 px-3 py-2"
                      inputMode="numeric"
                      value={row.currentUnit}
                      onChange={(e) => updateRow(row.id, { currentUnit: safeNum(e.target.value, row.currentUnit) })}
                    />
                    <div className="flex gap-2">
                      <button className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm hover:bg-gray-50" onClick={() => updateRow(row.id, { currentUnit: row.currentUnit - 1 })}>
                        -1
                      </button>
                      <button className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm hover:bg-gray-50" onClick={() => updateRow(row.id, { currentUnit: row.currentUnit + 1 })}>
                        +1
                      </button>
                    </div>
                    <div className="text-sm font-medium text-sky-700">{progress}%</div>
                  </div>
                </div>
              </TintedCard>
            );
          })
        )}
      </div>
    </div>
  );
}
