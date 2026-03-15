import React from "react";

export default function StickyActionBar({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        "sticky top-0 z-40",
        // 背景（透明 + blur）と境界線
        "bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60",
        "border-b",
        // 余白
        "py-2",
        // iOS等で少し浮かせる
        "shadow-sm",
        className,
      ].join(" ")}
    >
      <div className="mx-auto max-w-6xl px-4">{children}</div>
    </div>
  );
}