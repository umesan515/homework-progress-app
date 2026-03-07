"use client";

import { useMemo, useState } from "react";
import { API_BASE } from "@/lib/api";
import type { MaterialRow } from "@/lib/types";

function resolveAsset(url: string | null | undefined) {
  if (!url) return "";
  if (/^https?:\/\//.test(url)) return url;
  return `${API_BASE}${url}`;
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function gridLines() {
  return (
    <>
      {Array.from({ length: 9 }).map((_, i) => {
        const p = 40 * i;
        return <line key={`v-${i}`} x1={p} y1="0" x2={p} y2="320" stroke="#e2e8f0" strokeWidth="1" />;
      })}
      {Array.from({ length: 9 }).map((_, i) => {
        const p = 40 * i;
        return <line key={`h-${i}`} x1="0" y1={p} x2="320" y2={p} stroke="#e2e8f0" strokeWidth="1" />;
      })}
      <line x1="0" y1="160" x2="320" y2="160" stroke="#94a3b8" strokeWidth="1.5" />
      <line x1="160" y1="0" x2="160" y2="320" stroke="#94a3b8" strokeWidth="1.5" />
    </>
  );
}

function LinearGraph({ config }: { config: Record<string, any> | null }) {
  const min = Number(config?.min ?? -5);
  const max = Number(config?.max ?? 5);
  const [a, setA] = useState(Number(config?.a ?? 1));
  const [b, setB] = useState(Number(config?.b ?? 0));

  const pathD = useMemo(() => {
    const pts: string[] = [];
    for (let px = 0; px <= 320; px += 4) {
      const x = (px - 160) / 20;
      const y = a * x + b;
      const py = 160 - y * 20;
      pts.push(`${px},${py}`);
    }
    return pts.join(" ");
  }, [a, b]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-2 text-sm text-slate-700">
          <div className="font-medium">a: {a}</div>
          <input type="range" min={min} max={max} step="0.1" value={a} onChange={(e) => setA(Number(e.target.value))} className="w-full" />
        </label>
        <label className="space-y-2 text-sm text-slate-700">
          <div className="font-medium">b: {b}</div>
          <input type="range" min={min} max={max} step="0.1" value={b} onChange={(e) => setB(Number(e.target.value))} className="w-full" />
        </label>
      </div>
      <div className="overflow-auto rounded-2xl border border-slate-200 bg-white p-3">
        <svg viewBox="0 0 320 320" className="mx-auto w-full max-w-[420px]">
          {gridLines()}
          <polyline fill="none" stroke="#0f766e" strokeWidth="3" points={pathD} />
        </svg>
      </div>
      <div className="text-sm text-slate-600">y = {a}x + {b}</div>
    </div>
  );
}

function ParabolaGraph({ config }: { config: Record<string, any> | null }) {
  const min = Number(config?.min ?? -5);
  const max = Number(config?.max ?? 5);
  const [a, setA] = useState(Number(config?.a ?? 1));
  const [b, setB] = useState(Number(config?.b ?? 0));
  const [c, setC] = useState(Number(config?.c ?? 0));

  const pathD = useMemo(() => {
    const pts: string[] = [];
    for (let px = 0; px <= 320; px += 4) {
      const x = (px - 160) / 20;
      const y = a * x * x + b * x + c;
      const py = 160 - y * 20;
      pts.push(`${px},${py}`);
    }
    return pts.join(" ");
  }, [a, b, c]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <label className="space-y-2 text-sm text-slate-700">
          <div className="font-medium">a: {a}</div>
          <input type="range" min={min} max={max} step="0.1" value={a} onChange={(e) => setA(Number(e.target.value))} className="w-full" />
        </label>
        <label className="space-y-2 text-sm text-slate-700">
          <div className="font-medium">b: {b}</div>
          <input type="range" min={min} max={max} step="0.1" value={b} onChange={(e) => setB(Number(e.target.value))} className="w-full" />
        </label>
        <label className="space-y-2 text-sm text-slate-700">
          <div className="font-medium">c: {c}</div>
          <input type="range" min={min} max={max} step="0.1" value={c} onChange={(e) => setC(Number(e.target.value))} className="w-full" />
        </label>
      </div>
      <div className="overflow-auto rounded-2xl border border-slate-200 bg-white p-3">
        <svg viewBox="0 0 320 320" className="mx-auto w-full max-w-[420px]">
          {gridLines()}
          <polyline fill="none" stroke="#dc2626" strokeWidth="3" points={pathD} />
        </svg>
      </div>
      <div className="text-sm text-slate-600">y = {a}x² + {b}x + {c}</div>
    </div>
  );
}

function BarsGraph({ config }: { config: Record<string, any> | null }) {
  const labels = Array.isArray(config?.labels) && config.labels.length > 0 ? config.labels.map(String) : ["A", "B", "C", "D"];
  const initialValues = Array.isArray(config?.values) && config.values.length > 0 ? config.values.map((v: any) => Number(v || 0)) : [3, 5, 2, 4];
  const [values, setValues] = useState(initialValues);
  const max = Math.max(10, ...values.map((v) => Number(v || 0)));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        {labels.map((label, idx) => (
          <label key={label + idx} className="space-y-2 text-sm text-slate-700">
            <div className="font-medium">{label}: {values[idx] ?? 0}</div>
            <input
              type="range"
              min={0}
              max={10}
              step={1}
              value={values[idx] ?? 0}
              onChange={(e) => {
                const next = [...values];
                next[idx] = clamp(Number(e.target.value), 0, 10);
                setValues(next);
              }}
              className="w-full"
            />
          </label>
        ))}
      </div>
      <div className="overflow-auto rounded-2xl border border-slate-200 bg-white p-3">
        <svg viewBox="0 0 320 220" className="mx-auto w-full max-w-[420px]">
          <line x1="28" y1="190" x2="300" y2="190" stroke="#9ca3af" strokeWidth="1.5" />
          <line x1="28" y1="24" x2="28" y2="190" stroke="#9ca3af" strokeWidth="1.5" />
          {values.map((value, idx) => {
            const width = 44;
            const gap = 18;
            const x = 44 + idx * (width + gap);
            const h = ((value || 0) / max) * 140;
            const y = 190 - h;
            return (
              <g key={idx}>
                <rect x={x} y={y} width={width} height={h} rx={8} fill="#0f766e" opacity="0.85" />
                <text x={x + width / 2} y={206} textAnchor="middle" fontSize="12" fill="#374151">{labels[idx]}</text>
                <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize="12" fill="#374151">{value}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

export default function MaterialPreview({ material, compact = false }: { material: MaterialRow; compact?: boolean }) {
  const contentUrl = resolveAsset(material.content_url);
  const thumbUrl = resolveAsset(material.thumbnail_url);

  if (material.material_type === "image") {
    return (
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-50">
        {contentUrl ? (
          <img src={contentUrl} alt={material.title} className={`w-full object-contain ${compact ? "max-h-56" : "max-h-[70vh]"}`} />
        ) : (
          <div className="p-6 text-sm text-slate-500">画像URLが未設定です。</div>
        )}
      </div>
    );
  }

  if (material.material_type === "video") {
    return (
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-950">
        {contentUrl ? (
          <video controls preload="metadata" className="max-h-[70vh] w-full bg-black">
            <source src={contentUrl} />
          </video>
        ) : (
          <div className="p-6 text-sm text-slate-400">動画URLが未設定です。</div>
        )}
      </div>
    );
  }

  if (material.material_type === "app") {
    return (
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
        {contentUrl ? (
          <iframe src={contentUrl} title={material.title} className={`w-full bg-white ${compact ? "h-72" : "h-[70vh]"}`} />
        ) : (
          <div className="p-6 text-sm text-slate-500">アプリURLが未設定です。</div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
      {thumbUrl && compact && <img src={thumbUrl} alt={material.title} className="mb-4 max-h-40 w-full rounded-2xl border border-slate-200 object-cover" />}
      {material.interactive_kind === "parabola" ? (
        <ParabolaGraph config={material.interactive_config} />
      ) : material.interactive_kind === "bars" ? (
        <BarsGraph config={material.interactive_config} />
      ) : (
        <LinearGraph config={material.interactive_config} />
      )}
    </div>
  );
}
