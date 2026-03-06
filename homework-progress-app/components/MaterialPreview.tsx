"use client";

import { useMemo, useState } from "react";
import { API_BASE } from "@/lib/api";
import type { MaterialRow } from "@/lib/types";

function resolveAsset(url: string | null | undefined) {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${API_BASE}${url}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function gridLines() {
  const lines = [];
  for (let i = 0; i <= 10; i += 1) {
    const p = i * 32;
    lines.push(<line key={`v-${i}`} x1={p} y1={0} x2={p} y2={320} stroke="#e5e7eb" strokeWidth="1" />);
    lines.push(<line key={`h-${i}`} x1={0} y1={p} x2={320} y2={p} stroke="#e5e7eb" strokeWidth="1" />);
  }
  lines.push(<line key="x" x1={0} y1={160} x2={320} y2={160} stroke="#9ca3af" strokeWidth="1.5" />);
  lines.push(<line key="y" x1={160} y1={0} x2={160} y2={320} stroke="#9ca3af" strokeWidth="1.5" />);
  return lines;
}

function LinearGraph({ config }: { config: Record<string, any> | null }) {
  const min = Number(config?.sliderMin ?? -5);
  const max = Number(config?.sliderMax ?? 5);
  const [a, setA] = useState(Number(config?.a ?? 1));
  const [b, setB] = useState(Number(config?.b ?? 0));

  const pathD = useMemo(() => {
    const points: string[] = [];
    for (let px = 0; px <= 320; px += 4) {
      const x = (px - 160) / 16;
      const y = a * x + b;
      const py = 160 - y * 16;
      points.push(`${px},${py}`);
    }
    return points.join(" ");
  }, [a, b]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-sm space-y-1">
          <div className="font-medium">傾き a: {a}</div>
          <input type="range" min={min} max={max} step="0.1" value={a} onChange={(e) => setA(Number(e.target.value))} className="w-full" />
        </label>
        <label className="text-sm space-y-1">
          <div className="font-medium">切片 b: {b}</div>
          <input type="range" min={min} max={max} step="0.1" value={b} onChange={(e) => setB(Number(e.target.value))} className="w-full" />
        </label>
      </div>
      <div className="rounded-2xl border bg-white p-3 overflow-auto">
        <svg viewBox="0 0 320 320" className="w-full max-w-[420px] mx-auto">
          {gridLines()}
          <polyline fill="none" stroke="#2563eb" strokeWidth="3" points={pathD} />
        </svg>
      </div>
      <div className="text-sm text-gray-600">y = {a}x + {b}</div>
    </div>
  );
}

function ParabolaGraph({ config }: { config: Record<string, any> | null }) {
  const min = Number(config?.sliderMin ?? -5);
  const max = Number(config?.sliderMax ?? 5);
  const [a, setA] = useState(Number(config?.a ?? 1));
  const [b, setB] = useState(Number(config?.b ?? 0));
  const [c, setC] = useState(Number(config?.c ?? 0));

  const pathD = useMemo(() => {
    const points: string[] = [];
    for (let px = 0; px <= 320; px += 4) {
      const x = (px - 160) / 16;
      const y = a * x * x + b * x + c;
      const py = 160 - y * 8;
      points.push(`${px},${py}`);
    }
    return points.join(" ");
  }, [a, b, c]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="text-sm space-y-1">
          <div className="font-medium">a: {a}</div>
          <input type="range" min={min} max={max} step="0.1" value={a} onChange={(e) => setA(Number(e.target.value))} className="w-full" />
        </label>
        <label className="text-sm space-y-1">
          <div className="font-medium">b: {b}</div>
          <input type="range" min={min} max={max} step="0.1" value={b} onChange={(e) => setB(Number(e.target.value))} className="w-full" />
        </label>
        <label className="text-sm space-y-1">
          <div className="font-medium">c: {c}</div>
          <input type="range" min={min} max={max} step="0.1" value={c} onChange={(e) => setC(Number(e.target.value))} className="w-full" />
        </label>
      </div>
      <div className="rounded-2xl border bg-white p-3 overflow-auto">
        <svg viewBox="0 0 320 320" className="w-full max-w-[420px] mx-auto">
          {gridLines()}
          <polyline fill="none" stroke="#dc2626" strokeWidth="3" points={pathD} />
        </svg>
      </div>
      <div className="text-sm text-gray-600">y = {a}x² + {b}x + {c}</div>
    </div>
  );
}

function BarsGraph({ config }: { config: Record<string, any> | null }) {
  const labels = Array.isArray(config?.labels) && config.labels.length > 0 ? config.labels.map(String) : ["A", "B", "C", "D"];
  const initialValues = Array.isArray(config?.values) && config.values.length > 0 ? config.values.map((v: any) => Number(v || 0)) : [3, 5, 2, 4];
  const [values, setValues] = useState(initialValues);
  const max = Math.max(10, ...values.map((v) => Number(v || 0)));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {labels.map((label, idx) => (
          <label key={label + idx} className="text-sm space-y-1">
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
      <div className="rounded-2xl border bg-white p-3 overflow-auto">
        <svg viewBox="0 0 320 220" className="w-full max-w-[420px] mx-auto">
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
                <rect x={x} y={y} width={width} height={h} rx={8} fill="#2563eb" opacity="0.85" />
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
      <div className="rounded-2xl bg-gray-50 border overflow-hidden">
        {contentUrl ? (
          <img src={contentUrl} alt={material.title} className={`w-full object-contain ${compact ? "max-h-56" : "max-h-[70vh]"}`} />
        ) : (
          <div className="p-6 text-sm text-gray-500">画像URLが未設定です。</div>
        )}
      </div>
    );
  }

  if (material.material_type === "video") {
    return (
      <div className="rounded-2xl bg-gray-50 border overflow-hidden">
        {contentUrl ? (
          <video controls preload="metadata" className="w-full max-h-[70vh] bg-black">
            <source src={contentUrl} />
          </video>
        ) : (
          <div className="p-6 text-sm text-gray-500">動画URLが未設定です。</div>
        )}
      </div>
    );
  }

  if (material.material_type === "app") {
    return (
      <div className="rounded-2xl bg-gray-50 border overflow-hidden">
        {contentUrl ? (
          <iframe src={contentUrl} title={material.title} className={`w-full bg-white ${compact ? "h-72" : "h-[70vh]"}`} />
        ) : (
          <div className="p-6 text-sm text-gray-500">アプリURLが未設定です。</div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-gray-50 border p-4 space-y-3">
      {thumbUrl && compact && <img src={thumbUrl} alt={material.title} className="w-full max-h-40 object-cover rounded-xl border" />}
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
