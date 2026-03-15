"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { getUserFromToken, logout } from "@/lib/auth";

type BookSummaryRow = {
  id: string;
  name: string;
  created_at: string;
  collection_id?: string | null;
  subject?: string | null;
  collection_name?: string | null;
  collection_subject?: string | null;
  chapter_count?: number | string | null;
  block_count?: number | string | null;
  problem_count?: number | string | null;
  exercise_count?: number | string | null;
  comprehensive_count?: number | string | null;
  scope_counts?: any;
  zone_counts?: any;
  last_block_at?: string | null;
  last_chapter_at?: string | null;
};

type SummaryResponse = { classId: string; books: BookSummaryRow[] };

function toInt(x: unknown) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "";
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return "";
  return t.toLocaleDateString("ja-JP");
}

function normalizeCountList(list: any, key: "scope" | "zone") {
  if (!Array.isArray(list)) return [] as { key: string; count: number }[];
  return list
    .map((x) => {
      const k = String((x ?? {})[key] ?? "").trim();
      const c = Number((x ?? {}).count ?? (x ?? {}).cnt ?? 0);
      return { key: k, count: Number.isFinite(c) ? c : 0 };
    })
    .filter((x) => x.key !== "" && x.count > 0)
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function dominantInfo(items: { key: string; count: number }[], total: number) {
  if (!items.length || total <= 0) return null;
  const top = items[0];
  const share = top.count / total;
  return { key: top.key, count: top.count, share };
}

function WarnBadge({ label, info }: { label: string; info: { key: string; count: number; share: number } | null }) {
  if (!info) return null;
  // 偏り警告：上位が全体の70%以上（かつ件数が一定以上）
  if (info.count < 10) return null;
  if (info.share < 0.7) return null;
  const pct = Math.round(info.share * 100);
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 text-xs">
      偏り注意: {label}「{info.key}」{pct}%
    </span>
  );
}

function Chips({ label, items }: { label: string; items: { key: string; count: number }[] }) {
  if (!items.length) return null;
  const shown = items.slice(0, 6);
  const rest = items.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-gray-500">{label}</span>
      {shown.map((it) => (
        <span key={`${label}-${it.key}`} className="rounded-full border px-2 py-0.5 bg-white text-xs">
          {it.key}: {it.count}
        </span>
      ))}
      {rest > 0 && <span className="text-xs text-gray-500">+{rest}</span>}
    </div>
  );
}

export default function TeacherClassBooksPage({ params }: { params: { classId: string } }) {
  const router = useRouter();
  const classId = decodeURIComponent(params.classId);

  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<any | null>(null);

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<BookSummaryRow[]>([]);

  useEffect(() => {
    setMounted(true);
    const u = getUserFromToken();
    setUser(u);
    if (!u) {
      router.replace("/login");
      return;
    }
    if (u.role !== "teacher") {
      router.replace("/student");
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canLoad = useMemo(() => !!user && user.role === "teacher", [user]);

  const load = async () => {
    if (!canLoad) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await apiGet<SummaryResponse>(`/teacher/classes/${encodeURIComponent(classId)}/books/summary`);
      const list = Array.isArray(r?.books) ? r.books : [];
      setRows(list);
    } catch (e: unknown) {
      const msg = String((e as { message?: unknown })?.message ?? "読み込みに失敗しました。");
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
    if (!canLoad) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canLoad, classId]);

  if (!mounted) return null;

  return (
    <div className="p-6 space-y-4">
      {/* 見出しは bg-gray-50 枠外 */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">使用問題集</h1>
          <div className="text-sm text-gray-600">クラス：{classId}</div>
        </div>

        <div className="flex gap-2">
          <button className="rounded-lg border px-3 py-2 hover:bg-gray-50 disabled:opacity-50" onClick={load} disabled={busy}>
            {busy ? "更新中..." : "更新"}
          </button>
          <Link className="rounded-lg border px-3 py-2 bg-white hover:bg-gray-50" href="/teacher/classes">
            戻る
          </Link>
        </div>
      </div>

      {err && <div className="rounded-xl border bg-red-50 p-3 text-sm text-red-800">{err}</div>}

      <div className="rounded-xl border bg-gray-50 p-4 space-y-3">
        <div className="text-sm text-gray-700">※ 問題集詳細の「使用クラス」チェックで登録した問題集が表示されます。</div>

        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="min-w-[1180px] w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 w-44">シリーズ</th>
                <th className="text-left p-3">問題集</th>
                <th className="text-right p-3 w-28">章数</th>
                <th className="text-right p-3 w-28">問題数</th>
                <th className="text-left p-3 w-[520px]">内訳・偏り</th>
                <th className="text-left p-3 w-32">最終更新</th>
                <th className="text-left p-3 w-28">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const chapterCount = toInt(b.chapter_count);
                const total = toInt(b.block_count);
                const p = toInt(b.problem_count);
                const e = toInt(b.exercise_count);
                const c = toInt(b.comprehensive_count);

                const scopes = normalizeCountList(b.scope_counts, "scope");
                const zones = normalizeCountList(b.zone_counts, "zone");

                const last = b.last_block_at || b.last_chapter_at || b.created_at;

                return (
                  <tr key={b.id} className="border-t">
                    <td className="p-3 text-gray-700">{(b.collection_name ?? "").trim() || "その他"}</td>
                    <td className="p-3">
                      <div className="font-semibold">{b.name}</div>
                      <div className="text-xs text-gray-500">ID: {b.id}</div>
                    </td>
                    <td className="p-3 text-right tabular-nums">{chapterCount}</td>
                    <td className="p-3 text-right tabular-nums">{total}</td>
                    <td className="p-3 text-gray-700">
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full border px-2 py-0.5 bg-white">例題: {p}</span>
                          <span className="rounded-full border px-2 py-0.5 bg-white">演習: {e}</span>
                          <span className="rounded-full border px-2 py-0.5 bg-white">総合: {c}</span>
                        </div>
                        <Chips label="scope" items={scopes} />
                        <Chips label="zone" items={zones} />
                      </div>
                    </td>
                    <td className="p-3 text-gray-700">{fmtDate(last)}</td>
                    <td className="p-3">
                      <Link className="rounded-lg border px-3 py-2 bg-white hover:bg-gray-50" href={`/teacher/books/${b.id}`}>
                        詳細
                      </Link>
                    </td>
                  </tr>
                );
              })}

              {!busy && rows.length === 0 && (
                <tr className="border-t">
                  <td className="p-3 text-gray-600" colSpan={7}>
                    このクラスで使用中の問題集がありません。問題集詳細から「使用クラス」を登録してください。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
