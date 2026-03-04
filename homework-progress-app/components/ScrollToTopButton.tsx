"use client";

import { useEffect, useState } from "react";

export default function ScrollToTopButton() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      // これ以上スクロールしたら表示（好みで調整OK）
      setShow(window.scrollY > 500);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!show) return null;

  return (
    <button
      type="button"
      aria-label="ページ上部へ戻る"
      title="上へ"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className={[
        "fixed z-50",
        "right-6 bottom-6",
        "rounded-full border shadow-sm",
        "px-4 py-3",
        "bg-white/70 backdrop-blur",
        "hover:bg-white/90",
        "text-gray-800",
        "transition",
      ].join(" ")}
    >
      ↑
    </button>
  );
}