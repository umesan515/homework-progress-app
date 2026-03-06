"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { getUserFromToken, logout, type JwtUser } from "@/lib/auth";

type BlocksResp = {
  chapter: { id: string; book_id: string; name: string; part: string | null; chapter_no: number | null };
  blocks: Array<{ id: string; series: "problem" | "exercise" | "comprehensive"; zone: string; scope?: string | null; no: number; label: string; sort_order: number }>;
};

type BlockRow = BlocksResp["blocks"][number];

type BlockDraft = {
  series: BlockRow["series"];
  zone: string;
  scope: string;
  no: number;
  label: string;
};

type ChapterRow = { id: string; book_id: string; name: string; chapter_no: number | null; part: string | null };

type ChaptersResp = { chapters: ChapterRow[] } | ChapterRow[];


const SERIES_LABEL: Record<string, string> = {
  problem: "問題",
  exercise: "演習",
  comprehensive: "総合",
};
const displayZone = (z: string) => (z === "発展" ? "発展問題" : z);

export default function ChapterBlocksPage() {
  const params = useParams<{ bookId: string; chapterId: string }>();
  const bookId = params.bookId;
  const chapterId = params.chapterId;
  const router = useRouter();

  // ✅ Hydration対策：初回レンダーで localStorage を読まない
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<JwtUser | null>(null);

  const [err, setErr] = useState<string | null>(null);

  const [chapter, setChapter] = useState<BlocksResp["chapter"] | null>(null);
  const [blocks, setBlocks] = useState<BlocksResp["blocks"]>([]);
  // block に紐付いた未解決質問数（教師が拾いやすいように表示）
  const [openQuestionCounts, setOpenQuestionCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  // inline edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, BlockDraft>>({});

  // bulk create
  const [createSeries, setCreateSeries] = useState<"problem" | "exercise" | "comprehensive">("problem");
  const [createZone, setCreateZone] = useState<string>("未設定");
  const [createScope, setCreateScope] = useState<string>("");
  const [createFrom, setCreateFrom] = useState<number>(1);
  const [createTo, setCreateTo] = useState<number>(50);

  // selection / bulk update
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSeries, setBulkSeries] = useState<"problem" | "exercise" | "comprehensive">("problem");
  const [bulkZone, setBulkZone] = useState<string>("STEPA");
  const [bulkScope, setBulkScope] = useState<string>("");

  // move blocks to another folder(chapter)
  const [bookChapters, setBookChapters] = useState<ChapterRow[]>([]);
  const [moveTargetChapterId, setMoveTargetChapterId] = useState<string>("");

  // renumber
  const [renSeries, setRenSeries] = useState<"problem" | "exercise" | "comprehensive">("problem");
  const [renScope, setRenScope] = useState<string>("");
  const [renStartAt, setRenStartAt] = useState<number>(1);

  // filters (search / scope / zone)
  const [q, setQ] = useState<string>("");
  const [scopeFilter, setScopeFilter] = useState<string>("ALL");
  const [zoneFilter, setZoneFilter] = useState<string>("ALL");


  useEffect(() => {
    const u = getUserFromToken();
    setUser(u);
    setReady(true);

    if (!u) return router.replace("/login");
    if (u.role !== "teacher") return router.replace("/student");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await apiGet<BlocksResp>(`/teacher/chapters/${encodeURIComponent(chapterId)}/blocks`);
      setChapter(r.chapter);
      setBlocks(r.blocks ?? []);
      // 未解決質問数（章内）を取得（存在しない環境でも一覧表示は維持）
      try {
        const c = await apiGet<any>(`/teacher/questions/counts?chapterId=${encodeURIComponent(chapterId)}&status=open`);
        setOpenQuestionCounts((c && typeof c === "object" && c.counts) ? (c.counts as Record<string, number>) : {});
      } catch {
        setOpenQuestionCounts({});
      }
      setSelectedIds(new Set());
      setEditingId(null);
      setDrafts({});
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

  const loadBookChapters = async () => {
    try {
      const ch = await apiGet<ChaptersResp>(`/teacher/books/${encodeURIComponent(bookId)}/chapters`);
      const arr = Array.isArray(ch) ? ch : (ch as any).chapters;
      const norm = Array.isArray(arr) ? arr : [];
      const sorted = [...norm].sort((a, b) => (a.chapter_no ?? 0) - (b.chapter_no ?? 0));
      setBookChapters(sorted);

      if (!moveTargetChapterId) {
        const cand = sorted.find((c) => c.id !== chapterId);
        if (cand) setMoveTargetChapterId(cand.id);
      }
    } catch {
      setBookChapters([]);
    }
  };


  useEffect(() => {
    if (!ready) return;
    if (!user || user.role !== "teacher") return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?.uid, chapterId]);

  useEffect(() => {
    if (!ready) return;
    if (!user || user.role !== 'teacher') return;
    loadBookChapters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?.uid, bookId]);

  const zoneCandidates = useMemo(() => {
    const s = new Set<string>(["未設定", "STEPA", "STEPB", "発展", "A", "B", "総合"]);
    for (const b of blocks) s.add(b.zone);
    return Array.from(s);
  }, [blocks]);

  const zones = useMemo(() => {
    const s = new Set<string>();
    for (const b of blocks) s.add(b.zone);
    return Array.from(s).sort();
  }, [blocks]);

  const scopes = useMemo(() => {
    const s = new Set<string>();
    for (const b of blocks) s.add((b.scope ?? b.zone) as string);
    return Array.from(s).sort();
  }, [blocks]);

  const filteredBlocks = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return blocks
      .filter((b) => (zoneFilter === "ALL" ? true : b.zone === zoneFilter))
      .filter((b) => (scopeFilter === "ALL" ? true : ((b.scope ?? b.zone) as string) === scopeFilter))
      .filter((b) => {
        if (!qq) return true;
        const hay = [
          String(b.no),
          b.label ?? "",
          b.zone ?? "",
          String((b.scope ?? b.zone) as string),
          SERIES_LABEL[b.series] ?? b.series,
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(qq);
      })
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }, [blocks, q, scopeFilter, zoneFilter]);

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startEdit = (b: BlockRow) => {
    setEditingId(b.id);
    setDrafts((prev) => ({
      ...prev,
      [b.id]: {
        series: b.series,
        zone: b.zone ?? "未設定",
        scope: String((b.scope ?? b.zone) as string) || "未設定",
        no: Number(b.no ?? 0) || 0,
        label: b.label ?? String(b.no ?? ""),
      },
    }));
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const updateDraft = (id: string, patch: Partial<BlockDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] ?? {
          series: "problem",
          zone: "未設定",
          scope: "未設定",
          no: 1,
          label: "1",
        }),
        ...patch,
      },
    }));
  };

  const saveEdit = async (id: string) => {
    const d = drafts[id];
    if (!d) return;

    setBusy(true);
    setErr(null);
    try {
      const noNum = Number(d.no);
      if (!Number.isFinite(noNum) || noNum <= 0) throw new Error("番号(no)は1以上の数値にしてください。");
      const zone = String(d.zone ?? "").trim() || "未設定";
      const scope = String(d.scope ?? "").trim() || zone;
      const label = String(d.label ?? "").trim() || String(noNum);

      await apiPut(`/teacher/blocks/${encodeURIComponent(id)}`, {
        series: d.series,
        zone,
        scope,
        no: noNum,
        label,
      });

      await load();
    } catch (e: any) {
      setErr(String(e?.message ?? "保存に失敗しました。"));
    } finally {
      setBusy(false);
    }
  };

  const selectAll = () => setSelectedIds(new Set(blocks.map((b) => b.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const bulkCreate = async () => {
    setBusy(true);
    setErr(null);
    try {
      await apiPost(`/teacher/chapters/${encodeURIComponent(chapterId)}/blocks/bulk`, {
        series: createSeries,
        zone: createZone.trim() || "未設定",
        scope: createScope.trim() || (createZone.trim() || "未設定"),
        from: createFrom,
        to: createTo,
      });
      await load();
    } catch (e: any) {
      setErr(String(e?.message ?? "一括作成に失敗しました。"));
    } finally {
      setBusy(false);
    }
  };

  const applyBulkEdit = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (selectedIds.size === 0) throw new Error("変更する行を選択してください。");

      await apiPost(`/teacher/blocks/bulk-update`, {
        ids: Array.from(selectedIds),
        series: bulkSeries,
        zone: bulkZone.trim() || "未設定",
        scope: bulkScope.trim() || bulkZone.trim() || "未設定",
      });
      await load();
    } catch (e: any) {
      setErr(String(e?.message ?? "一括変更に失敗しました。"));
    } finally {
      setBusy(false);
    }
  };

  const deleteSelected = async () => {
    if (selectedIds.size === 0) return;
    const ok = window.confirm(`選択中の ${selectedIds.size} 件を削除します。よろしいですか？`);
    if (!ok) return;

    setBusy(true);
    setErr(null);
    try {
      await apiPost(`/teacher/blocks/bulk-delete`, { ids: Array.from(selectedIds) });
      await load();
    } catch (e: any) {
      setErr(String(e?.message ?? "削除に失敗しました。"));
    } finally {
      setBusy(false);
    }
  };



  const moveSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!moveTargetChapterId) {
      setErr("移動先フォルダを選択してください。");
      return;
    }
    const ok = window.confirm(`選択中の ${selectedIds.size} 件を別フォルダへ移動します。よろしいですか？`);
    if (!ok) return;

    setBusy(true);
    setErr(null);
    try {
      await apiPost(`/teacher/blocks/move`, { ids: Array.from(selectedIds), targetChapterId: moveTargetChapterId });
      await load();
    } catch (e: any) {
      setErr(String(e?.message ?? "移動に失敗しました。"));
    } finally {
      setBusy(false);
    }
  };

  const renumber = async () => {
    if (!renScope.trim()) {
      setErr("通し番号グループを選択してください。");
      return;
    }
    const ok = window.confirm(`「${SERIES_LABEL[renSeries]} / ${renScope}」の番号を ${renStartAt} から振り直します。よろしいですか？`);
    if (!ok) return;

    setBusy(true);
    setErr(null);
    try {
      await apiPost(`/teacher/chapters/${encodeURIComponent(chapterId)}/blocks/renumber`, {
        series: renSeries,
        scope: renScope.trim(),
        startAt: renStartAt,
      });
      await load();
    } catch (e: any) {
      setErr(String(e?.message ?? "番号の振り直しに失敗しました。"));
    } finally {
      setBusy(false);
    }
  };
  const deleteOne = async (id: string) => {
    const ok = window.confirm("この行を削除します。よろしいですか？");
    if (!ok) return;

    setBusy(true);
    setErr(null);
    try {
      await apiDelete(`/teacher/blocks/${encodeURIComponent(id)}`);
      await load();
    } catch (e: any) {
      setErr(String(e?.message ?? "削除に失敗しました。"));
    } finally {
      setBusy(false);
    }
  };

  if (!ready) return <main className="p-6">読み込み中...</main>;
  if (!user) return <main className="p-6">ログインへ遷移中...</main>;

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">問題一覧</h1>
          <div className="text-sm text-gray-600">{chapter?.name ?? "..."}</div>
        </div>
        <Link className="rounded-lg border px-3 py-2 hover:bg-gray-50" href={`/teacher/books/${encodeURIComponent(bookId)}`}>
          戻る
        </Link>
      </div>

      {err && <p className="text-sm text-red-600 whitespace-pre-wrap">{err}</p>}
      {busy && <p className="text-sm text-gray-600">処理中...</p>}

      <div className="rounded-xl border p-4 space-y-3">
        <div className="font-semibold">一括作成</div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <div className="text-xs text-gray-500">系列</div>
            <select className="rounded-lg border px-3 py-2" value={createSeries} onChange={(e) => setCreateSeries(e.target.value as any)}>
              <option value="problem">問題</option>
              <option value="exercise">演習</option>
              <option value="comprehensive">総合</option>
            </select>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-gray-500">ゾーン</div>
            <input className="rounded-lg border px-3 py-2 w-40" value={createZone} onChange={(e) => {
              const v = e.target.value;
              setCreateZone(v);
              if (!createScope) setCreateScope(v);
            }} />
          </div>

          <div className="space-y-1">
            <div className="text-xs text-gray-500">通し番号グループ</div>
            <input
              className="rounded-lg border px-3 py-2 w-56"
              value={createScope}
              onChange={(e) => setCreateScope(e.target.value)}
              placeholder="例: 問題 / 演習"
            />
          </div>

          <div className="space-y-1">
            <div className="text-xs text-gray-500">from</div>
            <input className="rounded-lg border px-3 py-2 w-24" type="number" value={createFrom} onChange={(e) => setCreateFrom(Number(e.target.value))} />
          </div>

          <div className="space-y-1">
            <div className="text-xs text-gray-500">to</div>
            <input className="rounded-lg border px-3 py-2 w-24" type="number" value={createTo} onChange={(e) => setCreateTo(Number(e.target.value))} />
          </div>

          <button className="rounded-lg bg-black text-white px-4 py-2 disabled:opacity-50" disabled={busy} onClick={bulkCreate}>
            作成
          </button>
        </div>
      </div>

      <div className="rounded-xl border p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold">一括変更</div>
          <div className="text-xs text-gray-500">選択中: {selectedIds.size} 件</div>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <div className="text-xs text-gray-500">系列</div>
            <select className="rounded-lg border px-3 py-2" value={bulkSeries} onChange={(e) => setBulkSeries(e.target.value as any)}>
              <option value="problem">問題</option>
              <option value="exercise">演習</option>
              <option value="comprehensive">総合</option>
            </select>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-gray-500">ゾーン</div>
            <select className="rounded-lg border px-3 py-2" value={bulkZone} onChange={(e) => setBulkZone(e.target.value)}>
              {zoneCandidates.map((z) => (
                <option key={z} value={z}>
                  {displayZone(z)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-gray-500">通し番号グループ</div>
            <input
              className="rounded-lg border px-3 py-2 w-56"
              list="scopeCandidates"
              value={bulkScope}
              onChange={(e) => setBulkScope(e.target.value)}
              placeholder="未入力ならゾーンと同じ"
            />
            <datalist id="scopeCandidates">
              {scopes.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>

          <button className="rounded-lg bg-black text-white px-4 py-2 disabled:opacity-50" disabled={busy} onClick={applyBulkEdit}>
            適用
          </button>

          <button className="rounded-lg border px-4 py-2 hover:bg-gray-50 disabled:opacity-50" disabled={busy} onClick={deleteSelected}>
            選択を削除
          </button>

          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <div className="text-xs text-gray-500">フォルダへ移動</div>
              <select
                className="rounded-lg border px-3 py-2"
                value={moveTargetChapterId}
                onChange={(e) => setMoveTargetChapterId(e.target.value)}
              >
                {bookChapters
                  .filter((c) => c.id !== chapterId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
            <button
              className="rounded-lg border px-4 py-2 hover:bg-gray-50 disabled:opacity-50"
              disabled={busy || selectedIds.size === 0 || !moveTargetChapterId}
              onClick={moveSelected}
            >
              移動
            </button>
          </div>

          <button className="rounded-lg border px-4 py-2 hover:bg-gray-50" onClick={selectAll}>
            全選択
          </button>
          <button className="rounded-lg border px-4 py-2 hover:bg-gray-50" onClick={clearSelection}>
            解除
          </button>
        </div>
      </div>

      <div className="rounded-xl border p-4 space-y-3">
        <div className="font-semibold">番号の振り直し</div>
        <div className="text-xs text-gray-500">同じ「系列 / 通し番号グループ」内で、番号を連番に揃えます。</div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <div className="text-xs text-gray-500">系列</div>
            <select className="rounded-lg border px-3 py-2" value={renSeries} onChange={(e) => setRenSeries(e.target.value as any)}>
              <option value="problem">問題</option>
              <option value="exercise">演習</option>
              <option value="comprehensive">総合</option>
            </select>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-gray-500">通し番号グループ</div>
            <select className="rounded-lg border px-3 py-2" value={renScope} onChange={(e) => setRenScope(e.target.value)}>
              <option value="">選択してください</option>
              {scopes.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-gray-500">開始番号</div>
            <input className="rounded-lg border px-3 py-2 w-24" type="number" value={renStartAt} onChange={(e) => setRenStartAt(Number(e.target.value))} />
          </div>

          <button className="rounded-lg bg-black text-white px-4 py-2 disabled:opacity-50" disabled={busy} onClick={renumber}>
            振り直す
          </button>
        </div>
      </div>

      <div className="rounded-xl border p-4">
        <div className="font-semibold mb-2">一覧</div>
        <div className="max-h-[520px] overflow-auto rounded-lg border">
          <div className="flex flex-wrap items-end gap-2 mb-2">
  <div className="space-y-1">
    <div className="text-xs text-gray-500">ゾーン</div>
    <select className="rounded-lg border px-3 py-2" value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)}>
      <option value="ALL">すべて</option>
      {zones.map((z) => (
        <option key={z} value={z}>
          {displayZone(z)}
        </option>
      ))}
    </select>
  </div>
  <div className="space-y-1">
    <div className="text-xs text-gray-500">通し番号グループ</div>
    <select className="rounded-lg border px-3 py-2" value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value)}>
      <option value="ALL">すべて</option>
      {scopes.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  </div>
  <div className="space-y-1">
    <div className="text-xs text-gray-500">検索</div>
    <input className="rounded-lg border px-3 py-2 w-[280px]" placeholder="番号/ラベル/ゾーン/グループ" value={q} onChange={(e) => setQ(e.target.value)} />
  </div>
</div>

<table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-2 text-left w-14">選択</th>
                <th className="p-2 text-left w-24">系列</th>
                <th className="p-2 text-left w-36">ゾーン</th>
                <th className="p-2 text-left w-36">通し番号グループ</th>
                <th className="p-2 text-left w-20">番号</th>
                <th className="p-2 text-left">ラベル</th>
                <th className="p-2 text-left w-28">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredBlocks.map((b) => {
                const isEditing = editingId === b.id;
                const d = drafts[b.id];
                return (
                  <tr key={b.id} className="border-t">
                    <td className="p-2">
                      <input type="checkbox" checked={selectedIds.has(b.id)} onChange={() => toggleSelected(b.id)} />
                    </td>

                    <td className="p-2">
                      {!isEditing ? (
                        <span>{SERIES_LABEL[b.series] ?? b.series}</span>
                      ) : (
                        <select
                          className="rounded-lg border px-2 py-1"
                          value={d?.series ?? b.series}
                          onChange={(e) => updateDraft(b.id, { series: e.target.value as any })}
                        >
                          <option value="problem">問題</option>
                          <option value="exercise">演習</option>
                          <option value="comprehensive">総合</option>
                        </select>
                      )}
                    </td>

                    <td className="p-2">
                      {!isEditing ? (
                        <span>{displayZone(b.zone)}</span>
                      ) : (
                        <input
                          className="rounded-lg border px-2 py-1 w-32"
                          value={d?.zone ?? b.zone}
                          onChange={(e) => updateDraft(b.id, { zone: e.target.value })}
                        />
                      )}
                    </td>

                    <td className="p-2">
                      {!isEditing ? (
                        <span>{(b.scope ?? b.zone) as string}</span>
                      ) : (
                        <input
                          className="rounded-lg border px-2 py-1 w-32"
                          value={d?.scope ?? ((b.scope ?? b.zone) as string)}
                          onChange={(e) => updateDraft(b.id, { scope: e.target.value })}
                        />
                      )}
                    </td>

                    <td className="p-2">
                      {!isEditing ? (
                        <span>{b.no}</span>
                      ) : (
                        <input
                          className="rounded-lg border px-2 py-1 w-20"
                          type="number"
                          value={d?.no ?? b.no}
                          onChange={(e) => updateDraft(b.id, { no: Number(e.target.value) })}
                        />
                      )}
                    </td>

                    <td className="p-2">
                      {!isEditing ? (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs break-words">{b.label}</span>
                          {Number(openQuestionCounts[b.id] ?? 0) > 0 && (
                            <Link
                              href={`/teacher/questions?blockId=${encodeURIComponent(b.id)}`}
                              className="rounded-full border bg-emerald-50 text-emerald-800 border-emerald-200 px-2 py-0.5 text-xs"
                              title="この問題に紐付いた未解決の質問を表示"
                            >
                              質問 {Number(openQuestionCounts[b.id] ?? 0)}
                            </Link>
                          )}
                        </div>
                      ) : (
                        <input
                          className="rounded-lg border px-2 py-1 w-full"
                          value={d?.label ?? b.label}
                          onChange={(e) => updateDraft(b.id, { label: e.target.value })}
                        />
                      )}
                    </td>

                    <td className="p-2">
                      {!isEditing ? (
                        <div className="flex items-center gap-2">
                          <button
                            className="rounded-lg border px-3 py-1 hover:bg-gray-50 disabled:opacity-50"
                            disabled={busy || (editingId != null && editingId !== b.id)}
                            onClick={() => startEdit(b)}
                          >
                            編集
                          </button>
                          <button
                            className="rounded-lg border px-3 py-1 hover:bg-gray-50 disabled:opacity-50"
                            disabled={busy}
                            onClick={() => deleteOne(b.id)}
                          >
                            削除
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            className="rounded-lg bg-black text-white px-3 py-1 disabled:opacity-50"
                            disabled={busy}
                            onClick={() => saveEdit(b.id)}
                          >
                            保存
                          </button>
                          <button
                            className="rounded-lg border px-3 py-1 hover:bg-gray-50 disabled:opacity-50"
                            disabled={busy}
                            onClick={cancelEdit}
                          >
                            キャンセル
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {blocks.length === 0 && (
                <tr className="border-t">
                  <td className="p-3 text-gray-600" colSpan={7}>
                    まだ行がありません。上で一括作成してください。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
