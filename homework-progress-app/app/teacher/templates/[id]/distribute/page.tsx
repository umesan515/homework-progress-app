"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { getUserFromToken, logout, type JwtUser } from "@/lib/auth";
import StickyActionBar from "@/components/StickyActionBar";

type TemplateDetailResp = {
  template: {
    id: string;
    name: string;
    mode: "book" | "manual";
    problem_count: number | null;
  };
  blocks: Array<{ id: string; label: string }>;
};

type ClassRow = { class_id: string; name?: string };

function normalizeClassList(payload: any): ClassRow[] {
  if (Array.isArray(payload)) return payload as ClassRow[];
  if (payload && typeof payload === "object") {
    const cand = payload.classes ?? payload.items ?? payload.data ?? payload.rows ?? payload.result ?? payload.list;
    if (Array.isArray(cand)) return cand as ClassRow[];
  }
  return [];
}

export default function TeacherTemplateDistributePage() {
  const params = useParams<{ id?: string }>();
  const id = params?.id;
  const router = useRouter();

  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<JwtUser | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [tpl, setTpl] = useState<TemplateDetailResp["template"] | null>(null);
  const [blocks, setBlocks] = useState<TemplateDetailResp["blocks"]>([]);

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [selectedClassIds, setSelectedClassIds] = useState<Set<string>>(new Set());

  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState<string>(""); // yyyy-mm-dd
  const [classQuery, setClassQuery] = useState("");

  const [classesDebug, setClassesDebug] = useState<string>("");

  useEffect(() => {
    const u = getUserFromToken();
    setUser(u);
    setReady(true);
    if (!u) return router.replace("/login");
    if (u.role !== "teacher") return router.replace("/student");
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
    setClassesDebug("");

    try {
      const [t, clsRaw] = await Promise.all([
        apiGet<TemplateDetailResp>(`/teacher/templates/${encodeURIComponent(id)}`),
        apiGet<any>(`/teacher/classes`),
      ]);

      setTpl(t.template);
      setBlocks(t.blocks ?? []);

      const normalized = normalizeClassList(clsRaw)
        .filter((c) => c && typeof c.class_id === "string" && c.class_id.trim() !== "" && c.class_id !== "undefined")
        .map((c) => ({ class_id: String(c.class_id), name: c.name ? String(c.name) : undefined }));

      setClasses(normalized);

      if (normalized.length === 0) {
        const kind = Array.isArray(clsRaw) ? "array" : typeof clsRaw;
        const keys = clsRaw && typeof clsRaw === "object" ? Object.keys(clsRaw).slice(0, 20).join(", ") : "-";
        setClassesDebug(`classes=0 (raw=${kind}, keys=${keys})`);
      }

      setTitle(t.template.name ?? "");
      setSelectedClassIds(new Set());
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

  const toggleClass = (classId: string) => {
    setSelectedClassIds((prev) => {
      const next = new Set(prev);
      if (next.has(classId)) next.delete(classId);
      else next.add(classId);
      return next;
    });
  };

  const selectAllClasses = () => {
    setSelectedClassIds(new Set(classes.map((c) => c.class_id)));
  };

  const clearClassSelection = () => {
    setSelectedClassIds(new Set());
  };

  const filteredClasses = useMemo(() => {
    const q = classQuery.trim().toLowerCase();
    if (!q) return classes;
    return classes.filter((c) => {
      const label = String(c.name ?? c.class_id).toLowerCase();
      return label.includes(q) || String(c.class_id).toLowerCase().includes(q);
    });
  }, [classes, classQuery]);

  const selectedClassList = useMemo(
    () => classes.filter((c) => selectedClassIds.has(c.class_id)).map((c) => c.name ?? c.class_id),
    [classes, selectedClassIds]
  );

  const problemLabelsPreview = useMemo(() => {
    if (!tpl) return "-";
    if (tpl.mode === "manual") {
      const n = tpl.problem_count ?? 0;
      return n > 0 ? `1..${n}` : "-";
    }
    return blocks.map((b) => b.label).slice(0, 20).join(" ") + (blocks.length > 20 ? " ..." : "");
  }, [tpl, blocks]);

  const distribute = async () => {
    if (!id || id === "undefined") return;
    if (!tpl) return;

    setBusy(true);
    setErr(null);

    try {
      if (!title.trim()) throw new Error("課題タイトルを入力してください。");
      if (selectedClassIds.size === 0) throw new Error("配布先クラスを選択してください。");

      await apiPost(`/teacher/templates/${encodeURIComponent(id)}/distribute`, {
        title: title.trim(),
        classIds: Array.from(selectedClassIds),
        dueAt: dueDate ? dueDate : null,
      });

      router.push("/teacher/assignments");
    } catch (e: any) {
      setErr(String(e?.message ?? "配布に失敗しました。"));
    } finally {
      setBusy(false);
    }
  };

  if (!ready) return <main className="p-6">読み込み中...</main>;
  if (!user) return <main className="p-6">ログインへ遷移中...</main>;
  if (!id || id === "undefined") return <main className="p-6">一覧へ戻ります...</main>;

  return (
    <>
      <StickyActionBar>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-base font-semibold">テンプレ配布</div>
            <div className="text-xs text-gray-600">
              {tpl ? `${tpl.name}（${tpl.mode}）` : "読み込み中..."}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-lg border px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
              onClick={distribute}
              disabled={busy || !tpl}
              type="button"
            >
              {busy ? "配布中..." : "配布"}
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

        {tpl && (
          <div className="rounded-xl border p-4 space-y-3">
            <div className="text-sm text-gray-700">
              <b>テンプレ：</b> {tpl.name}（{tpl.mode}）
            </div>

            <div className="space-y-1">
              <div className="text-sm font-semibold">課題タイトル</div>
              <input className="rounded-lg border px-3 py-2 w-[520px] max-w-full" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>

            <div className="space-y-1">
              <div className="text-sm font-semibold">提出期限（任意）</div>
              <input className="rounded-lg border px-3 py-2 w-56" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>

            <div className="text-xs text-gray-500">
              <b>問題ラベル：</b> {problemLabelsPreview}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-sm font-semibold">配布先クラス</div>
                <div className="flex gap-2 flex-wrap">
                  <button className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50" onClick={selectAllClasses} type="button" disabled={classes.length === 0}>
                    全クラス選択
                  </button>
                  <button className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50" onClick={clearClassSelection} type="button" disabled={selectedClassIds.size === 0}>
                    選択解除
                  </button>
                </div>
              </div>

              {classes.length === 0 ? (
                <div className="rounded-lg border p-3 text-sm text-gray-700">
                  クラス一覧が取得できません（0件）。
                  {classesDebug ? <div className="text-xs text-gray-500 mt-1">{classesDebug}</div> : null}
                  <div className="text-xs text-gray-500 mt-2">
                    対策：API <code>/teacher/classes</code> が配列（<code>[]</code>）を返しているか確認してください。
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 flex-wrap">
                    <input
                      className="rounded-lg border px-3 py-2 w-72 max-w-full"
                      placeholder="クラス名で絞り込み"
                      value={classQuery}
                      onChange={(e) => setClassQuery(e.target.value)}
                    />
                    <div className="text-sm text-gray-600">選択中：{selectedClassIds.size} / {classes.length}</div>
                  </div>

                  {selectedClassList.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {selectedClassList.map((name) => (
                        <span key={name} className="rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs text-green-700">
                          {name}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {filteredClasses.map((c) => (
                      <label key={c.class_id} className="flex items-center gap-2 rounded-lg border p-2">
                        <input
                          type="checkbox"
                          checked={selectedClassIds.has(c.class_id)}
                          onChange={() => toggleClass(c.class_id)}
                        />
                        <span className="text-sm">{c.name ?? c.class_id}</span>
                      </label>
                    ))}
                  </div>

                  {filteredClasses.length === 0 && (
                    <div className="rounded-lg border p-3 text-sm text-gray-600">該当するクラスがありません。</div>
                  )}
                </>
              )}
            </div>

            {/* 下部にも配布ボタンを残す */}
            <button className="rounded-lg border px-3 py-2 hover:bg-gray-50 disabled:opacity-50" onClick={distribute} disabled={busy} type="button">
              {busy ? "配布中..." : "配布"}
            </button>
          </div>
        )}
      </main>
    </>
  );
}