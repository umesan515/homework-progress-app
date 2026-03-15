"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, apiPostForm } from "@/lib/api";
import { getUserFromToken, logout } from "@/lib/auth";
import MaterialPreview from "@/components/MaterialPreview";
import type { InteractiveKind, MaterialRow, MaterialType, MaterialUploadResponse } from "@/lib/types";

type ClassRow = { class_id?: string; id?: string; classId?: string };

type FormState = {
  title: string;
  description: string;
  subject: string;
  unit_name: string;
  grade_level: string;
  material_type: MaterialType;
  content_url: string;
  thumbnail_url: string;
  interactive_kind: InteractiveKind;
  interactive_config_text: string;
  is_published: boolean;
  class_ids: string[];
};

const defaultConfigByKind: Record<InteractiveKind, string> = {
  linear: JSON.stringify({ a: 1, b: 0, sliderMin: -5, sliderMax: 5 }, null, 2),
  parabola: JSON.stringify({ a: 1, b: 0, c: 0, sliderMin: -5, sliderMax: 5 }, null, 2),
  bars: JSON.stringify({ labels: ["A", "B", "C", "D"], values: [3, 5, 2, 4] }, null, 2),
};

const subjectOptions = [
  { value: "math", label: "数学" },
  { value: "english", label: "英語" },
  { value: "japanese", label: "国語" },
  { value: "science", label: "理科" },
  { value: "social", label: "社会" },
  { value: "informatics", label: "情報" },
  { value: "other", label: "その他" },
] as const;

const materialTypeOptions: Array<{ value: MaterialType; label: string; desc: string }> = [
  { value: "image", label: "画像", desc: "図や板書資料、説明画像向け" },
  { value: "video", label: "動画", desc: "授業動画や解説クリップ向け" },
  { value: "interactive", label: "インタラクティブ", desc: "値を変えて理解する教材向け" },
  { value: "app", label: "アプリ", desc: "単独HTML教材をそのまま公開" },
];

function normalizeClasses(list: ClassRow[] | any): string[] {
  const arr = Array.isArray(list) ? list : Array.isArray(list?.classIds) ? list.classIds : [];
  return arr
    .map((x: any) => String(x?.class_id ?? x?.classId ?? x?.id ?? x ?? "").trim())
    .filter(Boolean)
    .sort();
}

async function uploadSingle(path: string, file: File) {
  const fd = new FormData();
  fd.append("file", file);
  return apiPostForm<MaterialUploadResponse>(path, fd);
}

function FileUploadBox({
  title,
  description,
  accept,
  onChange,
}: {
  title: string;
  description: string;
  accept: string;
  onChange: (file: File | null) => void;
}) {
  return (
    <label className="panel-muted block p-4">
      <div className="space-y-1">
        <div className="text-sm font-semibold text-slate-800">{title}</div>
        <div className="text-xs leading-5 text-slate-500">{description}</div>
      </div>
      <input
        type="file"
        accept={accept}
        className="mt-4 block w-full text-sm text-slate-600 file:mr-3 file:rounded-xl file:border-0 file:bg-emerald-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-emerald-700"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}

export default function TeacherMaterialNewPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [classIds, setClassIds] = useState<string[]>([]);
  const [form, setForm] = useState<FormState>({
    title: "",
    description: "",
    subject: "math",
    unit_name: "",
    grade_level: "",
    material_type: "image",
    content_url: "",
    thumbnail_url: "",
    interactive_kind: "linear",
    interactive_config_text: defaultConfigByKind.linear,
    is_published: true,
    class_ids: [],
  });

  useEffect(() => {
    const user = getUserFromToken();
    setReady(true);
    if (!user) {
      router.replace("/login");
      return;
    }
    if (user.role !== "teacher") router.replace("/student");
  }, [router]);

  useEffect(() => {
    if (!ready) return;
    apiGet<any>("/teacher/classes")
      .then((r) => setClassIds(normalizeClasses(r)))
      .catch((e: any) => setErr(String(e?.message ?? "クラス一覧の取得に失敗しました。")));
  }, [ready]);

  const previewRow = useMemo<MaterialRow>(() => {
    let parsed: Record<string, any> | null = null;
    try {
      parsed = form.material_type === "interactive" ? JSON.parse(form.interactive_config_text || "{}") : null;
    } catch {
      parsed = null;
    }
    return {
      id: "preview",
      title: form.title || "プレビュー教材",
      description: form.description || null,
      subject: form.subject,
      unit_name: form.unit_name || null,
      grade_level: form.grade_level || null,
      material_type: form.material_type,
      content_url: form.content_url || null,
      thumbnail_url: form.thumbnail_url || null,
      interactive_kind: form.material_type === "interactive" ? form.interactive_kind : null,
      interactive_config: parsed,
      is_published: form.is_published,
      created_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      class_ids: form.class_ids,
    };
  }, [form]);

  const selectedTypeMeta = materialTypeOptions.find((item) => item.value === form.material_type);
  const selectedSubjectLabel = subjectOptions.find((item) => item.value === form.subject)?.label ?? form.subject;

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const toggleClass = (classId: string) => {
    setForm((prev) => ({
      ...prev,
      class_ids: prev.class_ids.includes(classId) ? prev.class_ids.filter((x) => x !== classId) : [...prev.class_ids, classId],
    }));
  };

  const onUpload = async (kind: "image" | "video" | "thumb" | "app", file: File | null) => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const endpoint = kind === "thumb" ? "/teacher/materials/upload/thumb" : `/teacher/materials/upload/${kind}`;
      const res = await uploadSingle(endpoint, file);
      if (kind === "thumb") setField("thumbnail_url", res.url);
      else setField("content_url", res.url);
    } catch (e: any) {
      setErr(String(e?.message ?? "アップロードに失敗しました。"));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = async () => {
    if (!form.title.trim()) return setErr("タイトルを入力してください。");
    if (form.material_type !== "interactive" && !form.content_url.trim()) return setErr("教材ファイルまたはURLを設定してください。");
    if (form.material_type === "interactive") {
      try {
        JSON.parse(form.interactive_config_text || "{}");
      } catch {
        return setErr("インタラクティブ設定JSONが不正です。");
      }
    }

    setBusy(true);
    setErr(null);
    try {
      await apiPost("/teacher/materials", {
        title: form.title,
        description: form.description,
        subject: form.subject,
        unit_name: form.unit_name,
        grade_level: form.grade_level,
        material_type: form.material_type,
        content_url: form.content_url,
        thumbnail_url: form.thumbnail_url,
        interactive_kind: form.material_type === "interactive" ? form.interactive_kind : null,
        interactive_config: form.material_type === "interactive" ? JSON.parse(form.interactive_config_text || "{}") : null,
        is_published: form.is_published,
        class_ids: form.class_ids,
      });
      router.replace("/teacher/materials");
    } catch (e: any) {
      const msg = String(e?.message ?? "保存に失敗しました。");
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

  return (
    <main className="page-shell space-y-6">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="chip">教師ページ</span>
          <span className="chip">教材置き場</span>
          <span className="chip">新規作成</span>
        </div>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <h1 className="page-title">教材を追加</h1>
            <p className="page-subtitle">
              画像・動画・単独HTML教材をそのまま登録できます。スマホやタブレットでも見やすい教材になるよう、説明や対象クラスも合わせて整えておくと便利です。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/teacher/materials" className="btn-secondary">
              一覧へ戻る
            </Link>
            <button type="button" className="btn-primary" disabled={busy} onClick={onSubmit}>
              {busy ? "保存中..." : "教材を保存"}
            </button>
          </div>
        </div>
      </div>

      {err && <div className="surface-card border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.15fr)_380px]">
        <div className="space-y-6">
          <section className="surface-card p-5 sm:p-6">
            <div className="mb-5 space-y-1">
              <h2 className="text-lg font-semibold text-slate-900">基本情報</h2>
              <p className="text-sm text-slate-500">タイトル、教科、単元など教材を探しやすくする情報です。</p>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label>
                <span className="field-label">タイトル</span>
                <input className="field-input" value={form.title} onChange={(e) => setField("title", e.target.value)} placeholder="例：二次関数のグラフの変化" />
              </label>
              <label>
                <span className="field-label">教科</span>
                <select className="field-input" value={form.subject} onChange={(e) => setField("subject", e.target.value)}>
                  {subjectOptions.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="field-label">単元</span>
                <input className="field-input" value={form.unit_name} onChange={(e) => setField("unit_name", e.target.value)} placeholder="例：関数 / データの分析" />
              </label>
              <label>
                <span className="field-label">学年</span>
                <input className="field-input" value={form.grade_level} onChange={(e) => setField("grade_level", e.target.value)} placeholder="例：高1・中3" />
              </label>
            </div>
            <label className="mt-4 block">
              <span className="field-label">説明</span>
              <textarea
                className="field-input field-textarea"
                value={form.description}
                onChange={(e) => setField("description", e.target.value)}
                placeholder="授業のどこで使う教材か、何を理解してほしいかを書いておくと便利です。"
              />
            </label>
          </section>

          <section className="surface-card p-5 sm:p-6">
            <div className="mb-5 space-y-1">
              <h2 className="text-lg font-semibold text-slate-900">公開設定</h2>
              <p className="text-sm text-slate-500">表示方法と公開対象を選びます。</p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {materialTypeOptions.map((item) => {
                const selected = form.material_type === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setField("material_type", item.value)}
                    className={`rounded-3xl border px-4 py-4 text-left transition ${
                      selected ? "border-emerald-300 bg-emerald-50 shadow-sm" : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <div className="text-sm font-semibold text-slate-900">{item.label}</div>
                    <div className="mt-1 text-xs leading-5 text-slate-500">{item.desc}</div>
                  </button>
                );
              })}
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3">
              <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                  checked={form.is_published}
                  onChange={(e) => setField("is_published", e.target.checked)}
                />
                すぐに公開する
              </label>
              <span className="text-xs text-slate-500">未公開のまま保存して、あとで内容を整えてから公開することもできます。</span>
            </div>

            <div className="mt-5 space-y-3">
              <div className="field-label mb-0">公開対象クラス</div>
              <div className="flex flex-wrap gap-2">
                {classIds.length === 0 ? (
                  <div className="text-sm text-slate-500">クラス情報がまだありません。未選択のままなら全体公開になります。</div>
                ) : (
                  classIds.map((classId) => {
                    const selected = form.class_ids.includes(classId);
                    return (
                      <button
                        key={classId}
                        type="button"
                        onClick={() => toggleClass(classId)}
                        className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                          selected ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        {classId}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </section>

          <section className="surface-card p-5 sm:p-6">
            <div className="mb-5 space-y-1">
              <h2 className="text-lg font-semibold text-slate-900">教材データ</h2>
              <p className="text-sm text-slate-500">ファイルを直接アップロードするか、URLを入力してください。</p>
            </div>

            {form.material_type === "image" && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <FileUploadBox title="画像ファイルをアップロード" description="PNG / JPG / WebP などに対応" accept="image/*" onChange={(file) => onUpload("image", file)} />
                <FileUploadBox title="サムネイル画像" description="一覧で見やすくする小さな画像" accept="image/*" onChange={(file) => onUpload("thumb", file)} />
              </div>
            )}

            {form.material_type === "video" && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <FileUploadBox title="動画ファイルをアップロード" description="mp4 / webm / ogg を想定" accept="video/mp4,video/webm,video/ogg" onChange={(file) => onUpload("video", file)} />
                <FileUploadBox title="サムネイル画像" description="動画一覧で見やすくする表紙画像" accept="image/*" onChange={(file) => onUpload("thumb", file)} />
              </div>
            )}

            {form.material_type === "app" && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <FileUploadBox title="単独HTML教材" description="JS/CSS を1つにまとめたHTMLファイル" accept=".html,.htm,text/html" onChange={(file) => onUpload("app", file)} />
                <FileUploadBox title="サムネイル画像" description="教材カードに表示する表紙画像" accept="image/*" onChange={(file) => onUpload("thumb", file)} />
              </div>
            )}

            {form.material_type !== "interactive" && (
              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                <label>
                  <span className="field-label">教材URL</span>
                  <input className="field-input" value={form.content_url} onChange={(e) => setField("content_url", e.target.value)} placeholder="アップロード後は自動入力されます" />
                </label>
                <label>
                  <span className="field-label">サムネイルURL</span>
                  <input className="field-input" value={form.thumbnail_url} onChange={(e) => setField("thumbnail_url", e.target.value)} placeholder="必要な場合のみ設定" />
                </label>
              </div>
            )}

            {form.material_type === "interactive" && (
              <div className="space-y-4">
                <label>
                  <span className="field-label">インタラクティブ種別</span>
                  <select
                    className="field-input"
                    value={form.interactive_kind}
                    onChange={(e) => {
                      const next = e.target.value as InteractiveKind;
                      setForm((prev) => ({ ...prev, interactive_kind: next, interactive_config_text: defaultConfigByKind[next] }));
                    }}
                  >
                    <option value="linear">一次関数</option>
                    <option value="parabola">二次関数</option>
                    <option value="bars">棒グラフ</option>
                  </select>
                </label>
                <label>
                  <span className="field-label">設定JSON</span>
                  <textarea
                    className="field-input min-h-64 font-mono text-xs"
                    value={form.interactive_config_text}
                    onChange={(e) => setField("interactive_config_text", e.target.value)}
                  />
                </label>
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <div className="space-y-3">
            <h2 className="page-title text-xl sm:text-2xl">プレビュー</h2>
            <p className="page-subtitle">生徒に見える見た目を確認しながら調整できます。</p>
          </div>
          <div className="surface-card overflow-hidden">
            <div className="border-b border-slate-200 bg-slate-50/80 px-5 py-4">
              <div className="flex flex-wrap gap-2">
                <span className="chip">{selectedSubjectLabel}</span>
                {form.grade_level ? <span className="chip">{form.grade_level}</span> : null}
                {selectedTypeMeta ? <span className="chip">{selectedTypeMeta.label}</span> : null}
                <span className={`chip ${form.is_published ? "border-emerald-200 bg-emerald-50 text-emerald-700" : ""}`}>{form.is_published ? "公開中" : "非公開"}</span>
              </div>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <div className="text-xl font-semibold text-slate-900">{previewRow.title}</div>
                <div className="mt-2 text-sm leading-6 text-slate-600">{previewRow.description || "説明はまだ入力されていません。"}</div>
              </div>
              <MaterialPreview material={previewRow} />
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-6 text-slate-600">
                <div>単元: {form.unit_name || "未設定"}</div>
                <div>対象クラス: {form.class_ids.length ? form.class_ids.join(" / ") : "全体公開"}</div>
              </div>
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
