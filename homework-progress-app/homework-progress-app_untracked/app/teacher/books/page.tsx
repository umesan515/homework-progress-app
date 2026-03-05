"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { getUserFromToken, logout, type JwtUser } from "@/lib/auth";

type BookRow = { id: string; name: string; created_at: string; collection_id?: string | null; subject?: string | null };
type CollectionRow = { id: string; name: string; created_at: string; subject?: string | null };

type ClassListResp = { classIds: string[] };

const ALL_CLASS_VALUE = "__ALL__";
const ALL_SUBJECT_VALUE = "ALL";
const ALL_SERIES_VALUE = "ALL";

const SUBJECT_OPTIONS = [
  { value: "math", label: "数学" },
  { value: "english", label: "英語" },
  { value: "japanese", label: "国語" },
  { value: "science", label: "理科" },
  { value: "social", label: "社会" },
  { value: "informatics", label: "情報" },
  { value: "other", label: "その他" },
] as const;

type SubjectValue = (typeof SUBJECT_OPTIONS)[number]["value"];

function romanToNum(s: string): number | null {
  const t = s.replace(/\s+/g, "");
  const map: Record<string, number> = { "Ⅰ": 1, "Ⅱ": 2, "Ⅲ": 3, "Ⅳ": 4, "Ⅴ": 5, "I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5 };
  return map[t] ?? null;
}

function parseBookName(name: string): { series: string; major: number; minor: number; tail: string } {
  const n = name.trim();
  const parts = n.split("数学");
  const series = (parts[0] ?? n).trim() || "その他";
  let major = 99;
  let minor = 99;
  let tail = n;

  // "数学ⅠA", "数学ⅡB", "数学I A" など
  const m = n.match(/数学\s*([ⅠⅡⅢⅣⅤIVX12345]+)\s*([A-E])?/i);
  if (m) {
    const maj = romanToNum(m[1]);
    if (maj != null) major = maj;
    const suf = (m[2] ?? "").toUpperCase();
    const order = ["A", "B", "C", "D", "E"];
    if (suf) minor = order.indexOf(suf) >= 0 ? order.indexOf(suf) : 98;
  }

  return { series, major, minor, tail };
}

function getGroupName(book: BookRow, collectionsMap: Map<string, string>): string {
  const cid = (book as any).collection_id as string | undefined | null;
  if (cid && collectionsMap.has(cid)) return collectionsMap.get(cid)!;
  return parseBookName(book.name).series;
}

function groupBySeries(list: BookRow[], collectionsMap: Map<string, string>) {
  const m = new Map<string, BookRow[]>();
  for (const b of list) {
    const k = getGroupName(b, collectionsMap);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(b);
  }
  return m;
}

function displayCollectionName(c: any): string {
  if (!c) return "";
  const id = String(c.id ?? "");
  const name = String(c.name ?? "");
  if (id === "legacy" || name.toUpperCase() === "LEGACY") return "シリーズなし（単体）";
  return name;
}

function subjectLabel(v: any): string {
  const s = String(v ?? "").trim();
  const byVal = SUBJECT_OPTIONS.find((o) => o.value === s);
  if (byVal) return byVal.label;
  const byLabel = SUBJECT_OPTIONS.find((o) => o.label === s);
  return byLabel ? byLabel.label : "その他";
}

function normalizeSubject(x: any): SubjectValue {
  const s = String(x ?? "").trim();
  if (!s) return "other";
  const byVal = SUBJECT_OPTIONS.find((o) => o.value === s);
  if (byVal) return byVal.value;
  const byLabel = SUBJECT_OPTIONS.find((o) => o.label === s);
  return byLabel ? byLabel.value : "other";
}

function getBookSubjectValue(book: BookRow, collectionsById: Map<string, any>): SubjectValue {
  // book に subject があれば最優先（シリーズ未設定でも確実に分類できる）
  const raw = String((book as any)?.subject ?? "").trim();
  if (raw) return normalizeSubject(raw);

  const cid = (book as any).collection_id as string | undefined | null;
  if (cid && collectionsById.has(cid)) {
    const c = collectionsById.get(cid);
    const subj = normalizeSubject(c?.subject);
    return subj;
  }
  // フォールバック（シリーズ未設定など）
  const n = String(book.name ?? "");
  if (n.includes("数学")) return "math";
  if (n.includes("英")) return "english";
  if (n.includes("国")) return "japanese";
  if (n.includes("理")) return "science";
  if (n.includes("社")) return "social";
  if (n.includes("情")) return "informatics";
  return "other";
}

export default function TeacherBooksPage() {
  const router = useRouter();

  // ✅ Hydration対策：初回レンダーで localStorage を読まない
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<JwtUser | null>(null);

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [collections, setCollections] = useState<any[]>([]);
  const [books, setBooks] = useState<BookRow[]>([]);
  const [allBooks, setAllBooks] = useState<BookRow[]>([]);
  const [classIds, setClassIds] = useState<string[]>([]);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [newCollectionSubject, setNewCollectionSubject] = useState<SubjectValue>("math");
  const [newBookCollectionId, setNewBookCollectionId] = useState<string>("legacy");
  const [newBookSubject, setNewBookSubject] = useState<SubjectValue>("math");
  const [newName, setNewName] = useState("");
  const [q, setQ] = useState("");

  // シリーズ編集/削除
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
  const [editingCollectionName, setEditingCollectionName] = useState<string>("");
  const [editingCollectionSubject, setEditingCollectionSubject] = useState<SubjectValue>("math");

  // filters
  const [seriesFilter, setSeriesFilter] = useState<string>(ALL_SERIES_VALUE);
  const [subjectFilter, setSubjectFilter] = useState<string>(ALL_SUBJECT_VALUE);
  const [classFilter, setClassFilter] = useState<string>(ALL_CLASS_VALUE);

  // 一覧での編集/削除
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>("");
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const u = getUserFromToken();
    setUser(u);
    setReady(true);

    if (!u) return router.replace("/login");
    if (u.role !== "teacher") return router.replace("/student");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
setErr(null);

// collections: APIが配列 or { collections: [...] } の両方に対応
let raw: any = null;
try {
  raw = await apiGet<any>("/teacher/collections");
} catch {
  raw = null;
}
let list: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.collections) ? raw.collections : [];
if (list.length === 0) {
  list = [{ id: "legacy", name: "LEGACY", subject: "other", created_at: new Date().toISOString() }];
}
setCollections(list);

// classes（存在しない環境もあるので失敗は無視）
try {
  const cls = await apiGet<ClassListResp>("/teacher/classes");
  const c = (cls?.classIds ?? []).filter(Boolean).slice().sort((a, b) => a.localeCompare(b, "ja"));
  setClassIds(c);
} catch {
  setClassIds([]);
}

const r = await apiGet<BookRow[]>("/teacher/books");
setAllBooks(r ?? []);
setBooks(r ?? []);

// 新規作成の選択中シリーズが消えていたら先頭へ
if (!list.some((c) => c?.id === newBookCollectionId)) {
  setNewBookCollectionId(list[0].id);
}
};

  useEffect(() => {
    (async () => {
      if (!ready) return;
      if (!user) return;
      await load();
    })().catch((e: any) => {
      const msg = String(e?.message ?? "読み込みに失敗しました。");
      if (msg.includes("401")) {
        logout();
        router.replace("/login");
        return;
      }
      setErr(msg);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?.uid]);


const collectionsList = Array.isArray(collections)
  ? collections
  : Array.isArray((collections as any)?.collections)
    ? (collections as any).collections
    : [];
const collectionsMap = new Map(collectionsList.map((c: any) => [c.id, displayCollectionName(c)] as const));
const collectionsById = new Map(collectionsList.map((c: any) => [c.id, c] as const));

const legacyCollection = collectionsList.find((c) => String(c?.id ?? "") === "legacy") ?? { id: "legacy", name: "LEGACY", subject: "other" };

// 問題集作成：教科で絞ったシリーズ選択肢（最後に「シリーズなし」）
const collectionsForBookCreate = useMemo(() => {
  const list = collectionsList.filter((c: any) => String(c?.id ?? "") !== "legacy");
  const filtered = list.filter((c: any) => normalizeSubject(c?.subject) === newBookSubject);
  filtered.sort((a: any, b: any) => String(a?.name ?? "").localeCompare(String(b?.name ?? ""), "ja"));
  return [...filtered, legacyCollection];
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [collections, newBookSubject]);

// 問題集作成時：教科を変えたら、その教科の先頭シリーズ（なければシリーズなし）へ
useEffect(() => {
  const options = collectionsForBookCreate;
  const ok = options.some((c: any) => String(c?.id ?? "") === String(newBookCollectionId));
  if (!ok) {
    setNewBookCollectionId(String(options[0]?.id ?? "legacy"));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [newBookSubject, collectionsForBookCreate]);

// シリーズを直接選んだ場合（別教科のシリーズは選べない想定だが）教科を同期
useEffect(() => {
  const cid = String(newBookCollectionId ?? "");
  if (!cid || cid === "legacy") return;
  const c = collectionsById.get(cid);
  const subj = normalizeSubject((c as any)?.subject);
  if (subj && subj !== newBookSubject) setNewBookSubject(subj);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [newBookCollectionId]);

const bookNamePlaceholder = useMemo(() => {
  const cid = String(newBookCollectionId ?? "legacy");
  const c = cid && collectionsById.has(cid) ? collectionsById.get(cid) : legacyCollection;
  const seriesLabel = displayCollectionName(c);
  // 例：4STEP 数学 ⅠA
  const subjLabel = subjectLabel(newBookSubject);
  if (cid === "legacy") {
    // シリーズなし（単体）の場合は、シリーズ名を自分で入力する想定
    return `例：〇〇 ${subjLabel} ⅠA`;
  }
  // 例：4STEP 数学 ⅠA
  return `例：${seriesLabel} ${subjLabel} ⅠA`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [newBookCollectionId, newBookSubject, collections]);

const seriesOptions = useMemo(() => {
  const s = new Set<string>([ALL_SERIES_VALUE]);
  for (const b of allBooks) s.add(getGroupName(b, collectionsMap));
  return Array.from(s).sort((a, b) => (a === ALL_SERIES_VALUE ? -1 : b === ALL_SERIES_VALUE ? 1 : a.localeCompare(b, "ja")));
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [allBooks, collections]);

const subjectOptions = useMemo(() => {
  const s = new Set<string>([ALL_SUBJECT_VALUE]);
  for (const c of collectionsList) {
    const subj = normalizeSubject((c as any)?.subject);
    s.add(subj);
  }
  // 既存データのフォールバック（シリーズ未設定でも数学などを拾う）
  const tmpById = new Map(collectionsList.map((c: any) => [c.id, c] as const));
  for (const b of allBooks) s.add(getBookSubjectValue(b, tmpById));

  const arr = Array.from(s);
  const order = new Map<string, number>([[ALL_SUBJECT_VALUE, -1], ...SUBJECT_OPTIONS.map((o, i) => [o.value, i])]);
  arr.sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
  return arr;
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [allBooks, collections]);

// クラスで使用中の教材フィルタ：APIが対応していれば /teacher/books?classId=... を使用
useEffect(() => {
  (async () => {
    if (!ready || !user) return;
    if (classFilter === ALL_CLASS_VALUE) {
      setBooks(allBooks);
      return;
    }
    try {
      const r = await apiGet<BookRow[]>(`/teacher/books?classId=${encodeURIComponent(classFilter)}`);
      if (Array.isArray(r)) {
        setBooks(r);
        return;
      }
    } catch {
      // API未対応の場合はフォールバック
    }
    setBooks(allBooks);
  })().catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [classFilter, allBooks, ready, user?.uid]);

const filteredBooks = useMemo(() => {
  const text = q.trim().toLowerCase();
  let arr = [...books];
  if (seriesFilter !== ALL_SERIES_VALUE) {
    arr = arr.filter((b) => getGroupName(b, collectionsMap) === seriesFilter);
  }
  if (subjectFilter !== ALL_SUBJECT_VALUE) {
    arr = arr.filter((b) => getBookSubjectValue(b, collectionsById) === subjectFilter);
  }
  if (text) {
    arr = arr.filter((b) => (b.name ?? "").toLowerCase().includes(text));
  }
  return arr;
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [books, q, seriesFilter, subjectFilter, collections]);



  const createCollection = async () => {
  setErr(null);
  setBusy(true);
  try {
    if (!newCollectionName.trim()) throw new Error("シリーズ名を入力してください。");
    const r = await apiPost<{ ok: boolean; id: string }>("/teacher/collections", {
      name: newCollectionName.trim(),
      subject: newCollectionSubject,
    });
    setNewCollectionName("");
    setNewCollectionSubject("math");
    setNewBookCollectionId(r.id);
    await load();
  } catch (e: any) {
    const msg = String(e?.message ?? "作成に失敗しました。");
    setErr(msg);
  } finally {
    setBusy(false);
  }
};

const startEditCollection = (c: any) => {
  const id = String(c?.id ?? "");
  if (!id || id === "legacy") return;
  setEditingCollectionId(id);
  setEditingCollectionName(String(c?.name ?? ""));
  setEditingCollectionSubject(normalizeSubject(c?.subject));
};

const cancelEditCollection = () => {
  setEditingCollectionId(null);
  setEditingCollectionName("");
  setEditingCollectionSubject("数学");
};

const saveEditCollection = async (id: string) => {
  setErr(null);
  const name = editingCollectionName.trim();
  if (!name) {
    setErr("シリーズ名を入力してください。");
    return;
  }
  setBusy(true);
  try {
    await apiPut(`/teacher/collections/${id}`, { name, subject: editingCollectionSubject });
    cancelEditCollection();
    await load();
  } catch (e: any) {
    const msg = String(e?.message ?? "更新に失敗しました。");
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

const deleteCollection = async (c: any) => {
  const id = String(c?.id ?? "");
  if (!id || id === "legacy") return;
  setErr(null);
  const ok = window.confirm(
    `「${displayCollectionName(c)}」を削除します。\n\n削除すると、このシリーズに紐づく問題集の管理に影響する可能性があります。\nこの操作は取り消せません。\n\n本当に削除しますか？`
  );
  if (!ok) return;
  setBusy(true);
  try {
    await apiDelete(`/teacher/collections/${id}`);
    if (editingCollectionId === id) cancelEditCollection();
    // そのシリーズを選択中なら「シリーズなし」に戻す
    if (String(newBookCollectionId) === id) setNewBookCollectionId("legacy");
    await load();
  } catch (e: any) {
    const msg = String(e?.message ?? "削除に失敗しました。");
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

const createBook = async () => {
    setErr(null);
    setBusy(true);
    try {
      if (!newName.trim()) throw new Error("問題集名を入力してください。");
      let r: { ok: boolean; id: string };
      try {
        r = await apiPost<{ ok: boolean; id: string }>("/teacher/books", {
          name: newName.trim(),
          collection_id: newBookCollectionId,
          subject: newBookSubject,
        });
      } catch {
        r = await apiPost<{ ok: boolean; id: string }>("/teacher/books", { name: newName.trim(), subject: newBookSubject });
      }
      setNewName("");
      router.push(`/teacher/books/${r.id}`);
    } catch (e: any) {
      const msg = String(e?.message ?? "作成に失敗しました。");
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

  const startEdit = (b: BookRow) => {
    setErr(null);
    setEditingId(b.id);
    setEditingName(b.name);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingName("");
  };

  const saveEdit = async (bookId: string) => {
    setErr(null);
    const nextName = editingName.trim();
    if (!nextName) {
      setErr("問題集名を入力してください。");
      return;
    }
    setRowBusy((p) => ({ ...p, [bookId]: true }));
    try {
      await apiPut(`/teacher/books/${bookId}`, { name: nextName });
      setBooks((prev) => prev.map((b) => (b.id === bookId ? { ...b, name: nextName } : b)));
      cancelEdit();
    } catch (e: any) {
      const msg = String(e?.message ?? "更新に失敗しました。");
      if (msg.includes("401")) {
        logout();
        router.replace("/login");
        return;
      }
      setErr(msg);
    } finally {
      setRowBusy((p) => ({ ...p, [bookId]: false }));
    }
  };

  const deleteBook = async (b: BookRow) => {
    setErr(null);
    const ok = window.confirm(
      `「${b.name}」を削除します。\n\n削除すると関連する章・小問・提出状況などのデータが消える可能性があります。\nこの操作は取り消せません。\n\n本当に削除しますか？`
    );
    if (!ok) return;

    setRowBusy((p) => ({ ...p, [b.id]: true }));
    try {
      await apiDelete(`/teacher/books/${b.id}`);
      setBooks((prev) => prev.filter((x) => x.id !== b.id));
      if (editingId === b.id) cancelEdit();
    } catch (e: any) {
      const msg = String(e?.message ?? "削除に失敗しました。");
      if (msg.includes("401")) {
        logout();
        router.replace("/login");
        return;
      }
      setErr(msg);
    } finally {
      setRowBusy((p) => ({ ...p, [b.id]: false }));
    }
  };

  if (!ready) return <main className="p-6">読み込み中...</main>;
  if (!user) return <main className="p-6">ログインへ遷移中...</main>;

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">問題集</h1>
          <div className="text-xs text-gray-600">問題集を作成し、章や問題番号（全問表）を追加します。</div>
        </div>
        <Link className="rounded-lg border px-3 py-2 hover:bg-gray-50" href="/teacher">
          ホーム
        </Link>
      </div>

      {err && <p className="text-sm text-red-600 whitespace-pre-wrap">{err}</p>}

      <div className="rounded-2xl bg-gray-50 p-4 space-y-3">
  <div className="text-lg font-semibold text-gray-700">シリーズ / 問題集を作成</div>

  <div className="grid grid-collections-1 lg:grid-collections-2 gap-3">
    <div className="rounded-xl bg-white border p-3 space-y-2">
      <div className="font-semibold text-sm text-gray-700">シリーズを作成</div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <div className="text-xs text-gray-500">教科</div>
          <select
            className="rounded-lg border px-3 py-2 w-[200px]"
            value={newCollectionSubject}
            onChange={(e) => setNewCollectionSubject(e.target.value as SubjectValue)}
          >
            {SUBJECT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-gray-500">シリーズ名</div>
          <input
            className="rounded-lg border px-3 py-2 w-[360px] max-w-full"
            placeholder="例：4STEP / FocusGold / サクシード"
            value={newCollectionName}
            onChange={(e) => setNewCollectionName(e.target.value)}
          />
        </div>
        <button
          className="rounded-lg border px-4 py-2 bg-white shadow-sm hover:bg-gray-100 hover:shadow transition disabled:opacity-50"
          disabled={busy}
          onClick={createCollection}
          type="button"
        >
          {busy ? "作成中..." : "作成"}
        </button>
      </div>
      <div className="text-xs text-gray-500">※APIが未対応の場合は作成できません（一覧閲覧は可能）。</div>

      {/* 既存シリーズの編集/削除 */}
      <div className="pt-2 border-t">
        <div className="text-xs text-gray-500 mb-2">既存シリーズ</div>
        <div className="space-y-2">
          {collectionsList
            .filter((c: any) => String(c?.id ?? "") !== "legacy")
            .slice()
            .sort((a: any, b: any) => {
              const sa = normalizeSubject(a?.subject);
              const sb = normalizeSubject(b?.subject);
              const order = new Map<string, number>(SUBJECT_OPTIONS.map((o, i) => [o.value, i]));
              const d = (order.get(sa) ?? 99) - (order.get(sb) ?? 99);
              if (d !== 0) return d;
              return String(a?.name ?? "").localeCompare(String(b?.name ?? ""), "ja");
            })
            .map((c: any) => {
              const id = String(c?.id ?? "");
              const isEditing = editingCollectionId === id;
              return (
                <div key={id} className="rounded-lg bg-gray-50 p-3">
                  {isEditing ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="space-y-1">
                        <div className="text-xs text-gray-500">教科</div>
                        <select
                          className="rounded-lg border px-3 py-2 w-[180px] bg-white"
                          value={editingCollectionSubject}
                          onChange={(e) => setEditingCollectionSubject(e.target.value as SubjectValue)}
                        >
                          {SUBJECT_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <div className="text-xs text-gray-500">シリーズ名</div>
                        <input
                          className="rounded-lg border px-3 py-2 w-[320px] max-w-full bg-white"
                          value={editingCollectionName}
                          onChange={(e) => setEditingCollectionName(e.target.value)}
                          autoFocus
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="rounded-lg border px-3 py-2 bg-white shadow-sm hover:bg-gray-100 hover:shadow transition disabled:opacity-50"
                          type="button"
                          disabled={busy}
                          onClick={() => saveEditCollection(id)}
                        >
                          保存
                        </button>
                        <button
                          className="rounded-lg border px-3 py-2 bg-white hover:bg-gray-100 transition disabled:opacity-50"
                          type="button"
                          disabled={busy}
                          onClick={cancelEditCollection}
                        >
                          キャンセル
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-gray-800 truncate">{displayCollectionName(c)}</div>
                        <div className="text-xs text-gray-500">{subjectLabel(c?.subject)}</div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <button
                          className="rounded-lg border px-3 py-2 bg-white hover:bg-gray-100 transition disabled:opacity-50"
                          type="button"
                          disabled={busy}
                          onClick={() => startEditCollection(c)}
                        >
                          編集
                        </button>
                        <button
                          className="rounded-lg border px-3 py-2 bg-white hover:bg-gray-100 transition disabled:opacity-50"
                          type="button"
                          disabled={busy}
                          onClick={() => deleteCollection(c)}
                        >
                          削除
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          {collectionsList.filter((c: any) => String(c?.id ?? "") !== "legacy").length === 0 && (
            <div className="text-sm text-gray-600">まだシリーズがありません。</div>
          )}
        </div>
      </div>
    </div>

    <div className="rounded-xl bg-white border p-3 space-y-2">
      <div className="font-semibold text-sm text-gray-700">問題集を作成</div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <div className="text-xs text-gray-500">教科</div>
          <select
            className="rounded-lg border px-3 py-2 w-[200px]"
            value={newBookSubject}
            onChange={(e) => setNewBookSubject(e.target.value as SubjectValue)}
          >
            {SUBJECT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-gray-500">シリーズ</div>
          <select className="rounded-lg border px-3 py-2 w-[240px]" value={newBookCollectionId} onChange={(e) => setNewBookCollectionId(e.target.value)}>
            {collectionsForBookCreate.map((c: any) => (
              <option key={String(c.id)} value={String(c.id)}>
                {displayCollectionName(c)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-gray-500">問題集名</div>
          <input
            className="rounded-lg border px-3 py-2 w-[360px] max-w-full"
            placeholder={bookNamePlaceholder}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
        </div>
        <button
          className="rounded-lg border px-4 py-2 bg-white shadow-sm hover:bg-gray-100 hover:shadow transition disabled:opacity-50"
          disabled={busy}
          onClick={createBook}
          type="button"
        >
          {busy ? "作成中..." : "作成"}
        </button>
      </div>
      <div className="text-xs text-gray-500">※問題集名は「シリーズ名 + 冊子名」（例：4STEP 数学 ⅠA）を推奨。</div>
    </div>
  </div>
</div>

      {/* 一覧（デフォルト：教科ごと） */}
      <div className="space-y-3">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <div className="text-lg font-semibold text-gray-700">一覧</div>
            <div className="text-xs text-gray-500">教科ごとにまとめて表示します（フィルタで絞り込み可能）。</div>
          </div>

          {/* フィルタ/検索（まとめてデザイン） */}
          <div className="rounded-2xl bg-gray-50 p-3">
            <div className="rounded-xl bg-white p-3 shadow-sm">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <div className="text-xs text-gray-500">教科</div>
                  <select className="rounded-lg border px-3 py-2 w-[200px]" value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}>
                    {subjectOptions.map((s) => (
                      <option key={s} value={s}>
                        {s === ALL_SUBJECT_VALUE ? "すべて" : subjectLabel(s)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <div className="text-xs text-gray-500">教材</div>
                  <select className="rounded-lg border px-3 py-2 w-[220px]" value={seriesFilter} onChange={(e) => setSeriesFilter(e.target.value)}>
                    {seriesOptions.map((s) => (
                      <option key={s} value={s}>
                        {s === ALL_SERIES_VALUE ? "すべて" : s}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <div className="text-xs text-gray-500">クラス</div>
                  <select className="rounded-lg border px-3 py-2 w-[180px]" value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
                    <option value={ALL_CLASS_VALUE}>すべて</option>
                    {classIds.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="w-[360px] max-w-full">
                  <div className="text-xs text-gray-500 mb-1">検索</div>
                  <input
                    className="w-full rounded-lg border px-3 py-2"
                    placeholder="検索（例：4STEP / FocusGold / 数学ⅠA）"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {(() => {
          if (filteredBooks.length === 0) {
            return <div className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-600">該当する問題集がありません。</div>;
          }

          const bySubject = new Map<SubjectValue, BookRow[]>();
          for (const b of filteredBooks) {
            const subj = getBookSubjectValue(b, collectionsById);
            if (!bySubject.has(subj)) bySubject.set(subj, []);
            bySubject.get(subj)!.push(b);
          }

          const subjects = SUBJECT_OPTIONS.map((o) => o.value).filter((s) => (subjectFilter === ALL_SUBJECT_VALUE ? bySubject.has(s) : s === subjectFilter));

          return (
            <div className="space-y-6">
              {subjects.map((subj) => {
                const list = (bySubject.get(subj) ?? []).slice();
                const g = groupBySeries(list, collectionsMap);
                const keys = Array.from(g.keys()).sort((a, b) => a.localeCompare(b, "ja"));

                return (
                  <div key={subj} className="space-y-2">
                    {/* 見出しは枠外 */}
                    <div className="text-sm font-semibold text-gray-700">{subjectLabel(subj)}</div>

                    {/* 教科ごとに灰色背景の四角 */}
                    <div className="rounded-2xl bg-gray-50 p-4">
                      <div className="space-y-4">
                        {keys.map((series) => {
                          const arr = (g.get(series) ?? []).slice();
                          arr.sort((a, b) => {
                            const pa = parseBookName(a.name);
                            const pb = parseBookName(b.name);
                            if (pa.major !== pb.major) return pa.major - pb.major;
                            if (pa.minor !== pb.minor) return pa.minor - pb.minor;
                            return pa.tail.localeCompare(pb.tail, "ja");
                          });

                          return (
                            <div key={series} className="space-y-2">
                              <div className="text-sm font-semibold text-gray-700">{series}</div>
                              <div className="grid grid-collections-1 md:grid-collections-2 gap-2">
                                {arr.map((b) => (
                                  <div
                                    key={b.id}
                                    className={`rounded-xl border bg-white px-4 py-3 shadow-sm ${editingId === b.id ? "" : "cursor-pointer hover:bg-gray-50"}`}
                                    role={editingId === b.id ? undefined : "button"}
                                    tabIndex={editingId === b.id ? -1 : 0}
                                    onClick={() => {
                                      if (editingId === b.id) return;
                                      router.push(`/teacher/books/${b.id}`);
                                    }}
                                    onKeyDown={(e) => {
                                      if (editingId === b.id) return;
                                      if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        router.push(`/teacher/books/${b.id}`);
                                      }
                                    }}
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        {editingId === b.id ? (
                                          <div className="space-y-2">
                                            <div className="text-xs text-gray-500">問題集名</div>
                                            <input className="w-full rounded-lg border px-3 py-2" value={editingName} onChange={(e) => setEditingName(e.target.value)} autoFocus />
                                            <div className="flex flex-wrap gap-2">
                                              <button
                                                className="rounded-lg border px-3 py-2 bg-white shadow-sm hover:bg-gray-100 hover:shadow transition disabled:opacity-50"
                                                type="button"
                                                disabled={!!rowBusy[b.id]}
                                                onClick={() => saveEdit(b.id)}
                                              >
                                                保存
                                              </button>
                                              <button
                                                className="rounded-lg border px-3 py-2 bg-white hover:bg-gray-100 transition disabled:opacity-50"
                                                type="button"
                                                disabled={!!rowBusy[b.id]}
                                                onClick={cancelEdit}
                                              >
                                                キャンセル
                                              </button>
                                            </div>
                                          </div>
                                        ) : (
                                          <>
                                            <div className="font-semibold truncate">{b.name}</div>
                                            <div className="text-xs text-gray-500 truncate">{b.id}</div>
                                          </>
                                        )}
                                      </div>

                                      {editingId !== b.id && (
                                        <div className="flex shrink-0 flex-wrap gap-2">
                                          <Link className="rounded-lg border px-3 py-2 bg-white hover:bg-gray-100 transition" href={`/teacher/books/${b.id}`} onClick={(e) => e.stopPropagation()}>
                                            開く
                                          </Link>
                                          <button
                                            className="rounded-lg border px-3 py-2 bg-white hover:bg-gray-100 transition disabled:opacity-50"
                                            type="button"
                                            disabled={!!rowBusy[b.id]}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              startEdit(b);
                                            }}
                                          >
                                            名前を編集
                                          </button>
                                          <button
                                            className="rounded-lg border px-3 py-2 bg-white hover:bg-gray-100 transition disabled:opacity-50"
                                            type="button"
                                            disabled={!!rowBusy[b.id]}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              deleteBook(b);
                                            }}
                                          >
                                            削除
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    </main>
  );
}