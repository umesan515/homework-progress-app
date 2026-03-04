"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getUserFromToken, logout, type JwtUser } from "@/lib/auth";

function roleFromPath(pathname: string): "teacher" | "student" | null {
  if (pathname.startsWith("/teacher")) return "teacher";
  if (pathname.startsWith("/student")) return "student";
  return null;
}

export default function AppHeader() {
  const router = useRouter();
  const pathname = usePathname() || "/";

  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<JwtUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);

  useEffect(() => {
    const u = getUserFromToken();
    setUser(u);
    setReady(true);
  }, []);

  // メニュー/お知らせを開いたときの ESC / 外側クリック対応
  useEffect(() => {
    if (!menuOpen && !noticeOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setNoticeOpen(false);
      }
    };
    const onMouseDown = () => {
      setMenuOpen(false);
      setNoticeOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [menuOpen, noticeOpen]);

  const role = useMemo(() => roleFromPath(pathname), [pathname]);

  const homeHref = useMemo(() => {
    if (role === "teacher") return "/teacher";
    if (role === "student") return "/student";
    return "/";
  }, [role]);

  const classText = useMemo(() => {
    if (!user?.classId) return "—";
    return user.classId;
  }, [user?.classId]);

  const onLogout = () => {
    logout(role ?? undefined);
    router.replace("/login?force=1");
  };

  // ログイン画面などではヘッダーを出さない
  if (pathname.startsWith("/login")) return null;

  const menuItems: Array<{ href: string; label: string; desc?: string }> =
    role === "teacher"
      ? [
          { href: "/teacher", label: "教師ホーム" },
          { href: "/teacher/templates", label: "課題配布（テンプレ）" },
          { href: "/teacher/assignments", label: "進捗確認（配布済み課題）" },
          { href: "/teacher/classes", label: "クラス別進捗" },
          { href: "/teacher/books", label: "問題集管理" },
        ]
      : role === "student"
        ? [
            { href: "/student", label: "生徒ホーム" },
            { href: "/student/assignments", label: "課題一覧" },
          ]
        : [{ href: "/", label: "ホーム" }];

  return (
    <header className="fixed top-0 inset-x-0 z-50 bg-emerald-600 text-white border-b border-emerald-700">
      <div className="w-full px-4 py-2 flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-center gap-3">
          <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => {
                setMenuOpen((v) => !v);
                setNoticeOpen(false);
              }}
              className="rounded-lg border px-3 py-2 text-sm bg-white/10 border-white/20 text-white hover:bg-white/20 transition active:scale-[0.99]"
              aria-label="メニュー"
              aria-expanded={menuOpen}
            >
              ☰
            </button>

            {menuOpen && (
              <div className="absolute left-0 mt-2 w-64 rounded-xl border bg-white shadow-lg overflow-hidden text-gray-900">
                <div className="px-3 py-2 text-xs text-gray-500 border-b">メニュー</div>
                <div className="py-1">
                  {menuItems.map((it) => (
                    <Link
                      key={it.href}
                      href={it.href}
                      className="block px-3 py-2 text-sm hover:bg-white/10"
                      onClick={() => setMenuOpen(false)}
                    >
                      <div className="font-medium">{it.label}</div>
                      {it.desc && <div className="text-xs text-gray-500">{it.desc}</div>}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Link
            href={homeHref}
            className="font-semibold rounded-lg px-2 py-1 hover:bg-white/10 transition"
            title="ホーム"
          >
            学習進捗管理アプリ
          </Link>
          {ready && user && (
            <div className="hidden sm:flex items-center gap-2 text-xs text-gray-700">
              <span className="rounded-full border px-2 py-1 bg-gray-50">{user.role === "teacher" ? "教師" : "生徒"}</span>
              <span className="rounded-full border px-2 py-1 bg-gray-50">ID: {user.uid}</span>
              {user.role === "student" && <span className="rounded-full border px-2 py-1 bg-gray-50">クラス: {classText}</span>}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => {
                setNoticeOpen((v) => !v);
                setMenuOpen(false);
              }}
              className="rounded-lg border px-3 py-2 text-sm bg-white/10 border-white/20 text-white hover:bg-white/20 transition active:scale-[0.99]"
              aria-label="お知らせ"
              aria-expanded={noticeOpen}
            >
              🔔
            </button>

            {noticeOpen && (
              <div className="absolute right-0 mt-2 w-80 rounded-xl border bg-white shadow-lg overflow-hidden text-gray-900">
                <div className="px-3 py-2 text-xs text-gray-500 border-b">お知らせ</div>
                <div className="p-3 text-sm text-gray-700">現在お知らせは準備中です。</div>
              </div>
            )}
          </div>

          {ready && user ? (
            <button
              type="button"
              onClick={onLogout}
              className="rounded-lg border px-3 py-2 text-sm bg-white/10 border-white/20 text-white hover:bg-white/20 transition active:scale-[0.99]"
            >
              ログアウト
            </button>
          ) : (
            <div className="text-xs text-gray-500">...</div>
          )}
        </div>
      </div>
    </header>
  );
}
