"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { getUserFromToken, logout, type JwtUser } from "@/lib/auth";
import StickyActionBar from "@/components/StickyActionBar";

type BookRow = { id: string; name: string; created_at: string };
type ChapterRow = {
  id: string;
  book_id: string;
  name: string;
  part: string | null;
  chapter_no: number | null;
  sort_order: number;
  created_at: string;
};
type BookDetailResp = { book: { id: string; name: string }; chapters: ChapterRow[] };

type BlocksResp = {
  chapter: { id: string; book_id: string; name: string; part: string | null; chapter_no: number | null };
  blocks: Array<{ id: string; series: string; zone: string; no: number; label: string; sort_order: number }>;
};

const SERIES_LABEL: Record<string, string> = {
  problem: "問題",
  exercise: "演習",
  comprehensive: "総合",
};
const displayZone = (z: string) => (z === "発展" ? "発展問題" : z);

export default function TeacherTemplateNewPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<JwtUser | null>(null);
const [err, setErr] = useState<string | null>(null);

  const [mode, setMode] = useState<"book" | "manual">("book");
  const [name, setName] = useState("");

  // manual
  const [problemCount, setProblemCount] = useState<number>(30);

  // book
  const [books, setBooks] = useState<BookRow[]>([]);
  const [selectedBookId, setSelectedBookId] = useState("");
  const [chapters, setChapters] = useState<ChapterRow[]>([]);
  const [selectedChapterId, setSelectedChapterId] = useState("");

  const [blocks, setBlocks] = useState<BlocksResp["blocks"]>([]);
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(new Set());

  // filters
  const [filterSeries, setFilterSeries] = useState<"ALL" | "problem" | "exercise" | "comprehensive">("ALL");
  const [filterZone, setFilterZone] = useState<string>("ALL");
  const [filterText, setFilterText] = useState<string>("");

  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const u = getUserFromToken();
    setUser(u);
    setReady(true);
    if (!u) return router.replace("/login");
    if (u.role !== "teacher") return router.replace("/student");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadBooks = async () => {
    const r = await apiGet<BookRow[]>("/teacher/books");
    setBooks(r ?? []);
  };

  useEffect(() => {
    if (!user || user.role !== "teacher") return;
    loadBooks().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  useEffect(() => {
    (async () => {
      setErr(null);
      setChapters([]);
      setSelectedChapterId("");
      setBlocks([]);
      setSelectedBlockIds(new Set());
      if (!selectedBookId) return;

      const r = await apiGet<BookDetailResp>(`/teacher/books/${encodeURIComponent(selectedBookId)}`);
      setChapters(r.chapters ?? []);
    })().catch((e: any) => {
      const msg = String(e?.message ?? "章の読み込みに失敗しました。");
      if (msg.includes("401")) {
        logout();
        router.replace("/login");
        return;
      }
      setErr(msg);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBookId]);

  useEffect(() => {
    (async () => {
      setErr(null);
      setBlocks([]);
      setSelectedBlockIds(new Set());
      if (!selectedChapterId) return;

      const r = await apiGet<BlocksResp>(`/teacher/chapters/${encodeURIComponent(selectedChapterId)}/blocks`);
      setBlocks(r.blocks ?? []);
    })().catch((e: any) => {
      const msg = String(e?.message ?? "問題一覧の読み込みに失敗しました。");
      if (msg.includes("401")) {
        logout();
        router.replace("/login");
        return;
      }
      setErr(msg);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChapterId]);

  const zoneCandidates = useMemo(() => {
    const s = new Set<string>(["ALL"]);
    for (const b of blocks) s.add(b.zone);
    return Array.from(s);
  }, [blocks]);

  const filteredBlocks = useMemo(() => {
    let arr = [...blocks];
    if (filterSeries !== "ALL") arr = arr.filter((b) => b.series === filterSeries);
    if (filterZone !== "ALL") arr = arr.filter((b) => b.zone === filterZone);
    if (filterText.trim()) {
      const q = filterText.trim();
      arr = arr.filter((b) => String(b.no).includes(q) || String(b.label).includes(q));
    }
    return arr;
  }, [blocks, filterSeries, filterZone, filterText]);

  const toggle = (id: string) => {
    setSelectedBlockIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => setSelectedBlockIds(new Set(filteredBlocks.map((b) => b.id)));
  const clearSelection = () => setSelectedBlockIds(new Set());

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (!name.trim()) throw new Error("テンプレ名を入力してください。");

      if (mode === "manual") {
        const n = Number(problemCount);
        if (!Number.isFinite(n) || n <= 0 || n > 500) throw new Error("問題数は 1〜500 で入力してください。");
        const r = await apiPost<{ ok: boolean; id: string }>("/teacher/templates", {
          name: name.trim(),
          mode: "manual",
          problemCount: n,
        });
        router.push(`/teacher/templates/${r.id}`);
        return;
      }

      // book
      if (!selectedBookId) throw new Error("問題集を選択してください。");
      if (!selectedChapterId) throw new Error("章を選択してください。");
      if (selectedBlockIds.size === 0) throw new Error("ブロックを選択してください。");

      const r = await apiPost<{ ok: boolean; id: string }>("/teacher/templates", {
        name: name.trim(),
        mode: "book",
        bookId: selectedBookId,
        chapterId: selectedChapterId,
        blockIds: Array.from(selectedBlockIds),
      });

      router.push(`/teacher/templates/${r.id}`);
    } catch (e: any) {
      setErr(String(e?.message ?? "作成に失敗しました。"));
    } finally {
      setBusy(false);
    }
  };

  if (!ready) return <main className="p-6">読み込み中...</main>;
  if (!user) return <main className="p-6">ログインへ遷移中...</main>;

  return (
    <>
      <StickyActionBar>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-base font-semibold">テンプレ新規作成</div>
            <div className="text-xs text-gray-600">
              bookテンプレは問題一覧のブロック集合、manualテンプレは問題数で作成します。
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-lg border px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
              onClick={submit}
              disabled={busy}
              type="button"
            >
              {busy ? "作成中..." : "作成"}
            </button>
            <Link className="rounded-lg border px-3 py-2 hover:bg-gray-50" href="/teacher/templates">
              戻る
            </Link>
          </div>
        </div>
      </StickyActionBar>

      <main className="mx-auto max-w-6xl px-4 py-6 space-y-4">
        {err && <p className="text-sm text-red-600 whitespace-pre-wrap">{err}</p>}

        <div className="rounded-xl border p-4 space-y-3">
          <div className="flex gap-2 items-center flex-wrap">
            <div className="text-sm">種類：</div>
            <select className="rounded-lg border px-3 py-2" value={mode} onChange={(e) => setMode(e.target.value as any)}>
              <option value="book">book（教材ベース）</option>
              <option value="manual">manual（問題数）</option>
            </select>

            <div className="text-sm ml-3">テンプレ名：</div>
            <input
              className="rounded-lg border px-3 py-2 w-80 max-w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：4STEP 数学I A章 STEPA"
            />
          </div>

          {mode === "manual" ? (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-sm">問題数：</div>
              <input
                className="rounded-lg border px-3 py-2 w-24"
                type="number"
                min={1}
                max={500}
                value={problemCount}
                onChange={(e) => setProblemCount(Number(e.target.value || 1))}
              />
              <div className="text-xs text-gray-500">※ 1..N のラベルで配布します。</div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="text-sm">問題集：</div>
                <select
                  className="rounded-lg border px-3 py-2 min-w-[280px]"
                  value={selectedBookId}
                  onChange={(e) => setSelectedBookId(e.target.value)}
                >
                  <option value="">（選択してください）</option>
                  {books.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>

                <div className="text-sm ml-3">章：</div>
                <select
                  className="rounded-lg border px-3 py-2 min-w-[280px]"
                  value={selectedChapterId}
                  onChange={(e) => setSelectedChapterId(e.target.value)}
                  disabled={!selectedBookId}
                >
                  <option value="">（選択してください）</option>
                  {chapters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {(c.part ?? "未設定")}
                      {c.chapter_no ?? ""} {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-xl border p-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="text-sm font-semibold">ブロック選択</div>
                  <button
                    className="rounded-lg border px-3 py-2 hover:bg-gray-50 text-sm"
                    onClick={selectAllVisible}
                    type="button"
                  >
                    表示中を全選択
                  </button>
                  <button
                    className="rounded-lg border px-3 py-2 hover:bg-gray-50 text-sm"
                    onClick={clearSelection}
                    type="button"
                  >
                    解除
                  </button>

                  <div className="ml-2 text-xs text-gray-600">選択数：{selectedBlockIds.size}</div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <select className="rounded-lg border px-3 py-2" value={filterSeries} onChange={(e) => setFilterSeries(e.target.value as any)}>
                    <option value="ALL">系列：すべて</option>
                    <option value="problem">問題</option>
                    <option value="exercise">演習</option>
                    <option value="comprehensive">総合</option>
                  </select>

                  <select className="rounded-lg border px-3 py-2" value={filterZone} onChange={(e) => setFilterZone(e.target.value)}>
                    {zoneCandidates.map((z) => (
                      <option key={z} value={z}>
                        {z === "ALL" ? "ゾーン：すべて" : `ゾーン：${displayZone(z)}`}
                      </option>
                    ))}
                  </select>

                  <input
                    className="rounded-lg border px-3 py-2 w-48"
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    placeholder="番号検索（例：12）"
                  />
                </div>

                <div className="max-h-[360px] overflow-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="p-2 w-12"></th>
                        <th className="p-2 text-left w-24">系列</th>
                        <th className="p-2 text-left w-40">ゾーン</th>
                        <th className="p-2 text-left w-24">番号</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredBlocks.map((b) => (
                        <tr key={b.id} className="border-t">
                          <td className="p-2">
                            <input type="checkbox" checked={selectedBlockIds.has(b.id)} onChange={() => toggle(b.id)} />
                          </td>
                          <td className="p-2">{SERIES_LABEL[b.series] ?? b.series}</td>
                          <td className="p-2">{displayZone(b.zone)}</td>
                          <td className="p-2">{b.label}</td>
                        </tr>
                      ))}
                      {filteredBlocks.length === 0 && (
                        <tr className="border-t">
                          <td className="p-3 text-gray-600" colSpan={4}>
                            ブロックがありません（章の問題一覧を先に作成してください）。
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 下部にも作成ボタンを残す（長いページで便利） */}
          <button className="rounded-lg border px-3 py-2 hover:bg-gray-50 disabled:opacity-50" onClick={submit} disabled={busy} type="button">
            {busy ? "作成中..." : "作成"}
          </button>
        </div>
      </main>
    </>
  );
}