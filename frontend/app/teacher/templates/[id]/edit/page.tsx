"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet, apiPut } from "@/lib/api";
import { getUserFromToken, logout } from "@/lib/auth";
import StickyActionBar from "@/components/StickyActionBar";

type TemplateRow = {
  id: string;
  name: string;
  mode: "book" | "manual";
  book_id: string | null;
  chapter_id: string | null;
  problem_count: number | null;
};

type BookRow = { id: string; name: string; created_at: string };
type ChapterRow = { id: string; book_id: string; name: string; part: string | null; chapter_no: number | null; sort_order: number; created_at: string };
type BlockRow = { id: string; chapter_id: string; series: "problem" | "exercise" | "comprehensive"; zone: string; no: number; label: string; sort_order: number };

type TemplateDetailResp = {
  template: TemplateRow;
  blocks: Array<{ id: string; label: string; series?: string; zone?: string; no?: number }>;
};

export default function TeacherTemplateEditPage() {
  const params = useParams<{ id?: string }>();
  const id = params?.id;
  const router = useRouter();

  const [user, setUser] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [tpl, setTpl] = useState<TemplateRow | null>(null);
  const [tplBlocks, setTplBlocks] = useState<TemplateDetailResp["blocks"]>([]);

  // book mode 用（現状は「読み込み」はしているがUIはblocks表示のみ）
  const [books, setBooks] = useState<BookRow[]>([]);
  const [chapters, setChapters] = useState<ChapterRow[]>([]);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(new Set());

  // manual mode 用
  const [manualCount, setManualCount] = useState<number>(10);

  // 共通
  const [name, setName] = useState("");

  useEffect(() => {
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

  useEffect(() => {
    if (!id || id === "undefined") {
      setErr(null);
      router.replace("/teacher/templates");
    }
  }, [id, router]);

  const load = async () => {
    if (!id || id === "undefined") return;

    setBusy(true);
    setErr(null);

    try {
      const detail = await apiGet<TemplateDetailResp>(`/teacher/templates/${encodeURIComponent(id)}`);
      setTpl(detail.template);
      setTplBlocks(detail.blocks ?? []);
      setName(detail.template.name ?? "");

      if (detail.template.mode === "manual") {
        setManualCount(detail.template.problem_count ?? 10);
        setSelectedBlockIds(new Set());
        setBooks([]);
        setChapters([]);
        setBlocks([]);
        return;
      }

      const b = await apiGet<BookRow[]>(`/teacher/books`);
      setBooks(b ?? []);

      const selected = new Set<string>((detail.blocks ?? []).map((x: any) => String(x.id)).filter(Boolean));
      setSelectedBlockIds(selected);

      const bookId = detail.template.book_id;
      const chapterId = detail.template.chapter_id;

      if (bookId) {
        const ch = await apiGet<ChapterRow[]>(`/teacher/books/${encodeURIComponent(bookId)}/chapters`);
        setChapters(ch ?? []);
      } else {
        setChapters([]);
      }

      if (chapterId) {
        const bl = await apiGet<BlockRow[]>(`/teacher/chapters/${encodeURIComponent(chapterId)}/blocks`);
        setBlocks(bl ?? []);
      } else {
        setBlocks([]);
      }
    } catch (e: any) {
      const msg = String(e?.message ?? "読み込みに失敗しました。");
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
    if (!user || user.role !== "teacher") return;
    if (!id || id === "undefined") return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, id]);

  const selectedCount = useMemo(() => selectedBlockIds.size, [selectedBlockIds]);

  const toggleBlock = (blockId: string) => {
    setSelectedBlockIds((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
  };

  const save = async () => {
    if (!id || id === "undefined") return;
    if (!tpl) return;

    setBusy(true);
    setErr(null);

    try {
      if (!name.trim()) throw new Error("テンプレ名を入力してください。");

      if (tpl.mode === "manual") {
        const n = Number(manualCount);
        if (!Number.isFinite(n) || n <= 0) throw new Error("問題数は正の数にしてください。");

        await apiPut(`/teacher/templates/${encodeURIComponent(id)}`, {
          name: name.trim(),
          problemCount: n,
        });

        router.push(`/teacher/templates/${id}`);
        return;
      }

      if (selectedBlockIds.size === 0) throw new Error("少なくとも1問は選択してください。");

      await apiPut(`/teacher/templates/${encodeURIComponent(id)}`, {
        name: name.trim(),
        blockIds: Array.from(selectedBlockIds),
      });

      router.push(`/teacher/templates/${id}`);
    } catch (e: any) {
      setErr(String(e?.message ?? "保存に失敗しました。"));
    } finally {
      setBusy(false);
    }
  };

  if (!user) return <main className="p-6">ログインへ遷移中...</main>;
  if (!id || id === "undefined") return <main className="p-6">一覧へ戻ります...</main>;

  return (
    <>
      <StickyActionBar>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-base font-semibold">テンプレ編集</div>
            <div className="text-xs text-gray-600">
              {tpl ? `mode: ${tpl.mode}` : "読み込み中..."} {tpl?.mode === "book" ? ` / 選択中 ${selectedCount}問` : ""}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-lg border px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
              onClick={save}
              disabled={busy || !tpl}
              type="button"
            >
              {busy ? "保存中..." : "保存"}
            </button>
            <Link className="rounded-lg border px-3 py-2 hover:bg-gray-50" href={`/teacher/templates/${id}`}>
              戻る
            </Link>
          </div>
        </div>
      </StickyActionBar>

      <main className="mx-auto max-w-6xl px-4 py-6 space-y-4">
        {err && <p className="text-sm text-red-600 whitespace-pre-wrap">{err}</p>}
        {busy && <p className="text-sm text-gray-600">処理中...</p>}

        {!tpl ? (
          <div className="text-sm text-gray-600">読み込み中...</div>
        ) : (
          <div className="rounded-xl border p-4 space-y-4">
            <div className="space-y-1">
              <div className="text-sm font-semibold">テンプレ名</div>
              <input className="rounded-lg border px-3 py-2 w-[520px] max-w-full" value={name} onChange={(e) => setName(e.target.value)} />
              <div className="text-xs text-gray-500">mode: {tpl.mode}</div>
            </div>

            {tpl.mode === "manual" ? (
              <div className="space-y-1">
                <div className="text-sm font-semibold">問題数</div>
                <input
                  className="rounded-lg border px-3 py-2 w-32"
                  type="number"
                  value={manualCount}
                  onChange={(e) => setManualCount(Number(e.target.value))}
                />
                <div className="text-xs text-gray-500">※ 手動テンプレは「1〜N」を自動生成します。</div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-sm font-semibold">問題選択</div>
                <div className="text-xs text-gray-500">
                  選択中：{selectedCount}問 / 既存：{tplBlocks.length}問
                </div>

                {blocks.length === 0 ? (
                  <div className="text-sm text-gray-600">
                    ※ 章のblocksが未ロードです（テンプレに章が紐付いているか確認）。
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {blocks
                      .slice()
                      .sort((a, b) => (a.no === b.no ? a.label.localeCompare(b.label, "ja") : a.no - b.no))
                      .map((b) => (
                        <label key={b.id} className="flex items-center gap-2 rounded-lg border p-2">
                          <input type="checkbox" checked={selectedBlockIds.has(b.id)} onChange={() => toggleBlock(b.id)} />
                          <span className="text-sm">
                            {b.series}/{b.zone} #{b.no}（{b.label}）
                          </span>
                        </label>
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* 下部にも保存ボタンを残す（下まで来たとき便利） */}
            <button className="rounded-lg border px-3 py-2 hover:bg-gray-50 disabled:opacity-50" onClick={save} disabled={busy} type="button">
              {busy ? "保存中..." : "保存"}
            </button>
          </div>
        )}
      </main>
    </>
  );
}