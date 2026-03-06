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

function normalizeClasses(list: ClassRow[] | any): string[] {
  const arr = Array.isArray(list) ? list : Array.isArray(list?.classIds) ? list.classIds : [];
  return arr.map((x: any) => String(x?.class_id ?? x?.classId ?? x?.id ?? x ?? "").trim()).filter(Boolean).sort();
}

async function uploadSingle(path: string, file: File) {
  const fd = new FormData();
  fd.append("file", file);
  return apiPostForm<MaterialUploadResponse>(path, fd);
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
      title: form.title || "プレビュー",
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

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((prev) => ({ ...prev, [key]: value }));
  const toggleClass = (classId: string) => setForm((prev) => ({ ...prev, class_ids: prev.class_ids.includes(classId) ? prev.class_ids.filter((x) => x !== classId) : [...prev.class_ids, classId] }));

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
      try { JSON.parse(form.interactive_config_text || "{}"); } catch { return setErr("インタラクティブ設定JSONが不正です。"); }
    }
    setBusy(true);
    setErr(null);
    try {
      const body = {
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
      };
      await apiPost("/teacher/materials", body);
      router.replace("/teacher/materials");
    } catch (e: any) {
      const msg = String(e?.message ?? "保存に失敗しました。");
      if (msg.includes("401")) { logout(); router.replace("/login"); return; }
      setErr(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="p-6 space-y-6">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">教材を追加</h1>
        <div className="text-sm text-gray-600">画像・動画はこの画面から直接アップロードできます。アプリ教材は単独HTMLファイルをアップロードしてください。</div>
      </div>
      <section className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-6">
        <div className="rounded-2xl border bg-gray-50 p-4 space-y-4">
          {err && <div className="text-sm text-red-600 whitespace-pre-wrap">{err}</div>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-1 text-sm"><div>タイトル</div><input className="w-full rounded-lg border px-3 py-2" value={form.title} onChange={(e) => setField("title", e.target.value)} /></label>
            <label className="space-y-1 text-sm"><div>教科</div><select className="w-full rounded-lg border px-3 py-2" value={form.subject} onChange={(e) => setField("subject", e.target.value)}><option value="math">数学</option><option value="english">英語</option><option value="japanese">国語</option><option value="science">理科</option><option value="social">社会</option><option value="informatics">情報</option><option value="other">その他</option></select></label>
            <label className="space-y-1 text-sm"><div>単元</div><input className="w-full rounded-lg border px-3 py-2" value={form.unit_name} onChange={(e) => setField("unit_name", e.target.value)} /></label>
            <label className="space-y-1 text-sm"><div>学年</div><input className="w-full rounded-lg border px-3 py-2" value={form.grade_level} onChange={(e) => setField("grade_level", e.target.value)} placeholder="例: 高1" /></label>
          </div>
          <label className="space-y-1 text-sm block"><div>説明</div><textarea className="w-full rounded-lg border px-3 py-2 min-h-28" value={form.description} onChange={(e) => setField("description", e.target.value)} /></label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-1 text-sm"><div>教材種別</div><select className="w-full rounded-lg border px-3 py-2" value={form.material_type} onChange={(e) => setField("material_type", e.target.value as MaterialType)}><option value="image">画像</option><option value="video">動画</option><option value="interactive">インタラクティブ</option><option value="app">アプリ（単独HTML）</option></select></label>
            <label className="flex items-center gap-2 text-sm pt-7"><input type="checkbox" checked={form.is_published} onChange={(e) => setField("is_published", e.target.checked)} />公開する</label>
          </div>
          {form.material_type === "image" && <div className="grid grid-cols-1 md:grid-cols-2 gap-4"><label className="space-y-2 text-sm"><div>画像ファイルをアップロード</div><input type="file" accept="image/*" onChange={(e) => onUpload("image", e.target.files?.[0] ?? null)} /></label><label className="space-y-2 text-sm"><div>サムネイルをアップロード</div><input type="file" accept="image/*" onChange={(e) => onUpload("thumb", e.target.files?.[0] ?? null)} /></label></div>}
          {form.material_type === "video" && <div className="grid grid-cols-1 md:grid-cols-2 gap-4"><label className="space-y-2 text-sm"><div>動画ファイルをアップロード</div><input type="file" accept="video/mp4,video/webm,video/ogg" onChange={(e) => onUpload("video", e.target.files?.[0] ?? null)} /></label><label className="space-y-2 text-sm"><div>サムネイルをアップロード</div><input type="file" accept="image/*" onChange={(e) => onUpload("thumb", e.target.files?.[0] ?? null)} /></label></div>}
          {form.material_type === "app" && <div className="grid grid-cols-1 md:grid-cols-2 gap-4"><label className="space-y-2 text-sm"><div>単独HTMLファイルをアップロード</div><input type="file" accept=".html,.htm,text/html" onChange={(e) => onUpload("app", e.target.files?.[0] ?? null)} /><div className="text-xs text-gray-500">JS/CSS を1ファイルにまとめた教材を想定しています。</div></label><label className="space-y-2 text-sm"><div>サムネイルをアップロード</div><input type="file" accept="image/*" onChange={(e) => onUpload("thumb", e.target.files?.[0] ?? null)} /></label></div>}
          {form.material_type !== "interactive" && <div className="grid grid-cols-1 md:grid-cols-2 gap-4"><label className="space-y-1 text-sm"><div>教材URL</div><input className="w-full rounded-lg border px-3 py-2" value={form.content_url} onChange={(e) => setField("content_url", e.target.value)} /></label><label className="space-y-1 text-sm"><div>サムネイルURL</div><input className="w-full rounded-lg border px-3 py-2" value={form.thumbnail_url} onChange={(e) => setField("thumbnail_url", e.target.value)} /></label></div>}
          {form.material_type === "interactive" && <div className="space-y-4"><label className="space-y-1 text-sm block"><div>インタラクティブ種別</div><select className="w-full rounded-lg border px-3 py-2" value={form.interactive_kind} onChange={(e) => { const next = e.target.value as InteractiveKind; setForm((prev) => ({ ...prev, interactive_kind: next, interactive_config_text: defaultConfigByKind[next] })); }}><option value="linear">一次関数</option><option value="parabola">二次関数</option><option value="bars">棒グラフ</option></select></label><label className="space-y-1 text-sm block"><div>設定JSON</div><textarea className="w-full rounded-lg border px-3 py-2 min-h-52 font-mono text-xs" value={form.interactive_config_text} onChange={(e) => setField("interactive_config_text", e.target.value)} /></label></div>}
          <div className="space-y-2"><div className="text-sm font-medium">公開対象クラス（未選択なら全体公開）</div><div className="flex flex-wrap gap-2">{classIds.map((classId) => <label key={classId} className={`rounded-full border px-3 py-2 text-sm ${form.class_ids.includes(classId) ? "bg-emerald-50 border-emerald-300" : "bg-white"}`}><input type="checkbox" className="mr-2" checked={form.class_ids.includes(classId)} onChange={() => toggleClass(classId)} />{classId}</label>)}{classIds.length === 0 && <div className="text-sm text-gray-500">クラス情報がまだありません。</div>}</div></div>
          <div className="flex flex-wrap gap-3"><button disabled={busy} className="rounded-lg border px-4 py-2 bg-white hover:bg-gray-100 hover:shadow-sm transition disabled:opacity-60" onClick={onSubmit}>{busy ? "保存中..." : "保存"}</button><Link href="/teacher/materials" className="rounded-lg border px-4 py-2 hover:bg-gray-100 hover:shadow-sm transition">一覧へ戻る</Link></div>
        </div>
        <div className="space-y-2"><div className="text-lg font-semibold text-gray-700">プレビュー</div><div className="rounded-2xl border bg-white p-4 space-y-3"><div className="text-lg font-semibold">{previewRow.title}</div><div className="text-sm text-gray-600">{previewRow.description || "説明なし"}</div><MaterialPreview material={previewRow} /></div></div>
      </section>
    </main>
  );
}
