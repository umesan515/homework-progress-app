"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { getUserFromToken, logout, type JwtUser } from "@/lib/auth";

type ClassListResp = { classIds: string[] };

type ChapterRow = {
  id: string;
  book_id: string;
  name: string;
  chapter_no?: number | null;
  created_at?: string;
};

type BookRow = {
  id: string;
  name: string;
  collection_id?: string | null;
  subject?: string | null;
  created_at?: string;
};

type CollectionRow = {
  id: string;
  name: string;
  subject?: string | null;
};

type ChaptersResp =
  | { chapters: ChapterRow[] }
  | ChapterRow[];

type BookResp =
  | { book: BookRow; collection?: CollectionRow | null }
  | BookRow;

const SUBJECT_LABEL: Record<string, string> = {
  math: "数学",
  english: "英語",
  japanese: "国語",
  science: "理科",
  social: "社会",
  info: "情報",
  other: "その他",
  informatics: "情報", // 混在対策
};

const subjectLabel = (v?: string | null) => SUBJECT_LABEL[v ?? "other"] ?? "その他";

export default function TeacherBookDetailPage() {
  const router = useRouter();
  const params = useParams<{ bookId: string }>();
  const bookId = params.bookId;

  const [user, setUser] = useState<JwtUser | null>(null);

  const [book, setBook] = useState<BookRow | null>(null);
  const [collection, setCollection] = useState<CollectionRow | null>(null);

  const [chapters, setChapters] = useState<ChapterRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // class assignment
  const [allClasses, setAllClasses] = useState<string[]>([]);
  const [assignedClasses, setAssignedClasses] = useState<string[]>([]);
  const [busyClasses, setBusyClasses] = useState(false);

  // folder mode
  const [useFolders, setUseFolders] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [busyDeleteId, setBusyDeleteId] = useState<string | null>(null);

  const folderlessChapter = useMemo(() => {
    // 「（フォルダなし）」があればそれを優先（無ければ最初の章をフォールバック）
    const found =
      chapters.find((c) => c.name === "（フォルダなし）") ??
      chapters.find((c) => c.name === "(フォルダなし)") ??
      null;
    return found;
  }, [chapters]);

  const folders = useMemo(() => {
    // フォルダ無し章は除外してフォルダとして扱う章のみ
    return chapters.filter((c) => c.name !== "（フォルダなし）" && c.name !== "(フォルダなし)");
  }, [chapters]);

  const load = async () => {
    setErr(null);
    setBusy(true);
    try {
      // auth
      const u = getUserFromToken();
      if (!u || u.role !== "teacher") {
        router.replace("/login");
        return;
      }
      setUser(u);

      // book
      const b = (await apiGet(`/teacher/books/${encodeURIComponent(bookId as string)}`)) as BookResp;
      if ((b as any)?.book) {
        setBook((b as any).book);
        setCollection((b as any).collection ?? null);
      } else {
        setBook(b as BookRow);
        setCollection(null);
      }

      // chapters
      const ch = (await apiGet(
        `/teacher/books/${encodeURIComponent(bookId as string)}/chapters`
      )) as ChaptersResp;
      const arr = Array.isArray(ch) ? ch : (ch as any).chapters;
      const norm = Array.isArray(arr) ? arr : [];
      const sorted = [...norm].sort((a, b) => (a.chapter_no ?? 0) - (b.chapter_no ?? 0));
      setChapters(sorted);

      // ensure folderless exists (best-effort)
      if (!sorted.some((c) => c.name === "（フォルダなし）" || c.name === "(フォルダなし)")) {
        try {
          await apiPost(`/teacher/books/${encodeURIComponent(bookId as string)}/chapters`, {
            name: "（フォルダなし）",
            chapter_no: null,
          });
          // reload chapters
          const ch2 = (await apiGet(
            `/teacher/books/${encodeURIComponent(bookId as string)}/chapters`
          )) as ChaptersResp;
          const arr2 = Array.isArray(ch2) ? ch2 : (ch2 as any).chapters;
          const norm2 = Array.isArray(arr2) ? arr2 : [];
          setChapters([...norm2].sort((a, b) => (a.chapter_no ?? 0) - (b.chapter_no ?? 0)));
        } catch {
          // ignore
        }
      }

      // class list (best-effort)
      try {
        const cls = (await apiGet(`/teacher/classes`)) as ClassListResp | string[] | { classes: string[] };
        const list = Array.isArray(cls) ? cls : ((cls as any).classIds ?? (cls as any).classes ?? []);
        setAllClasses(Array.isArray(list) ? list : []);
      } catch {
        setAllClasses([]);
      }

      // assigned classes (best-effort)
      try {
        const res = (await apiGet(`/teacher/books/${encodeURIComponent(bookId as string)}/classes`)) as
          | { classIds: string[] }
          | string[];
        const ids = Array.isArray(res) ? res : (res as any).classIds;
        setAssignedClasses(Array.isArray(ids) ? ids : []);
      } catch {
        setAssignedClasses([]);
      }
    } catch (e: any) {
      setErr(e?.message ?? "読み込みに失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  const toggleClass = async (cid: string) => {
    setBusyClasses(true);
    setErr(null);
    try {
      const next = assignedClasses.includes(cid)
        ? assignedClasses.filter((x) => x !== cid)
        : [...assignedClasses, cid];

      setAssignedClasses(next);

      await apiPut(`/teacher/books/${encodeURIComponent(bookId as string)}/classes`, { classIds: next });
    } catch (e: any) {
      setErr(e?.message ?? "クラスの保存に失敗しました。");
    } finally {
      setBusyClasses(false);
    }
  };

  const addFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setBusy(true);
    setErr(null);
    try {
      await apiPost(`/teacher/books/${encodeURIComponent(bookId as string)}/chapters`, {
        name,
        chapter_no: null,
      });
      setNewFolderName("");
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "フォルダの追加に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  const deleteChapter = async (chapterId: string) => {
    if (!confirm("このフォルダを削除します。中の問題も削除される可能性があります。よろしいですか？")) return;
    setBusyDeleteId(chapterId);
    setErr(null);
    try {
      await apiDelete(`/teacher/chapters/${encodeURIComponent(chapterId)}`);
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "削除に失敗しました。");
    } finally {
      setBusyDeleteId(null);
    }
  };

  const onLogout = () => {
    logout();
    router.replace("/login");
  };

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="text-sm text-gray-500">
            <Link className="hover:underline" href="/teacher/books">
              問題集管理
            </Link>
            <span className="mx-2">/</span>
            <span>問題集詳細</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{book?.name ?? "問題集"}</h1>
          <div className="text-sm text-gray-600">
            教科: {subjectLabel(collection?.subject ?? book?.subject)} / シリーズ:{" "}
            {collection?.name ?? "シリーズなし（単体）"}
          </div>
        </div>

        <button
          type="button"
          className="rounded-lg bg-gray-50 px-4 py-2 text-sm hover:bg-gray-100"
          onClick={onLogout}
        >
          ログアウト
        </button>
      </div>

      {err && <p className="text-sm text-red-600 whitespace-pre-wrap">{err}</p>}
      {busy && <p className="text-sm text-gray-600">読み込み中...</p>}

      <div className="space-y-2">
        <div className="text-lg font-semibold text-gray-700">使用クラス</div>
        <div className="rounded-2xl bg-gray-50 p-4">
          {allClasses.length === 0 ? (
            <div className="text-sm text-gray-600">クラス一覧がありません（API未対応/未設定の可能性があります）。</div>
          ) : (
            <>
              <div className="text-xs text-gray-500 mb-2">チェックしたクラスでこの問題集を使用します。</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {allClasses.map((cid) => {
                  const checked = assignedClasses.includes(cid);
                  return (
                    <label
                      key={cid}
                      className="rounded-xl bg-white shadow-sm px-3 py-2 flex items-center gap-2 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={busyClasses}
                        onChange={() => toggleClass(cid)}
                      />
                      <span className="text-sm text-gray-700">{cid}</span>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* フォルダ管理：見出しは灰色枠の外 */}
      <div className="space-y-2">
        <div className="text-lg font-semibold text-gray-700">フォルダ管理</div>

        <div className="rounded-xl border p-4 space-y-4">
          <div className="text-sm text-gray-600">
            デフォルトはフォルダを使わずに管理します。通し番号が複数（例: 問題 / 演習）になる場合のみ、フォルダで分けて管理できます。
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`rounded-lg px-3 py-2 text-sm ${
                !useFolders ? "bg-emerald-600 text-white" : "bg-gray-50 hover:bg-gray-100"
              }`}
              onClick={() => setUseFolders(false)}
            >
              フォルダなし
            </button>
            <button
              type="button"
              className={`rounded-lg px-3 py-2 text-sm ${
                useFolders ? "bg-emerald-600 text-white" : "bg-gray-50 hover:bg-gray-100"
              }`}
              onClick={() => setUseFolders(true)}
            >
              フォルダで分ける
            </button>
          </div>

          {!useFolders ? (
            <div className="rounded-lg bg-gray-50 p-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-gray-700">フォルダを使わずに問題を管理します。</div>
              {folderlessChapter ? (
                <Link
                  className="rounded-lg bg-white px-3 py-2 text-sm hover:bg-gray-100"
                  href={`/teacher/books/${encodeURIComponent(bookId as string)}/chapters/${encodeURIComponent(
                    folderlessChapter.id
                  )}`}
                >
                  問題一覧を開く
                </Link>
              ) : (
                <div className="text-sm text-gray-500">準備中...</div>
              )}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <div className="text-xs text-gray-500">フォルダ名（例: 問題 / 演習）</div>
                  <input
                    className="rounded-lg border px-3 py-2 w-72"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="例: 問題"
                  />
                </div>

                <button
                  type="button"
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700 disabled:opacity-50"
                  disabled={busy}
                  onClick={addFolder}
                >
                  追加
                </button>
              </div>

              <div className="space-y-2">
                {folders.length === 0 ? (
                  <div className="text-sm text-gray-500">フォルダがありません。</div>
                ) : (
                  folders.map((c) => (
                    <div
                      key={c.id}
                      className="rounded-lg bg-gray-50 p-3 flex flex-wrap items-center justify-between gap-2 cursor-pointer hover:bg-gray-100"
                      onClick={() =>
                        router.push(
                          `/teacher/books/${encodeURIComponent(bookId as string)}/chapters/${encodeURIComponent(c.id)}`
                        )
                      }
                    >
                      <div className="font-medium">{c.name}</div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="rounded-lg bg-white px-3 py-2 text-sm hover:bg-gray-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(
                              `/teacher/books/${encodeURIComponent(bookId as string)}/chapters/${encodeURIComponent(c.id)}`
                            );
                          }}
                        >
                          問題一覧
                        </button>
                        <button
                          type="button"
                          className="rounded-lg bg-white px-3 py-2 text-sm hover:bg-gray-100 disabled:opacity-50"
                          disabled={busyDeleteId === c.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteChapter(c.id);
                          }}
                        >
                          削除
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {chapters.length === 0 && (
          <div className="rounded-xl border p-4 text-sm text-gray-600">まだ章がありません。上で追加してください。</div>
        )}
      </div>
    </main>
  );
}