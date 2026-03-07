"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { getUserFromToken, logout, type JwtUser } from "@/lib/auth";

function roleFromPath(pathname: string): "teacher" | "student" | null {
  if (pathname.startsWith("/teacher")) return "teacher";
  if (pathname.startsWith("/student")) return "student";
  return null;
}

type NoticeItem = {
  thread_id: string;
  title?: string | null;
  class_id?: string | null;
  student_uid?: string | null;
  body?: string | null;
  image_path?: string | null;
  created_at: string;
};

type NoticeResponse = { notifications: NoticeItem[] };

function fmtDateTime(d: string | null | undefined) {
  if (!d) return "";
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return "";
  return t.toLocaleString("ja-JP");
}

function safeId(v: any): string {
  const s = String(v ?? "").trim();
  if (!s || s === "undefined" || s === "null") return "";
  return s;
}

export default function AppHeader() {
  const router = useRouter();
  const pathname = usePathname() || "/";

  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<JwtUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);

  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [noticeErr, setNoticeErr] = useState<string | null>(null);

  const role = useMemo(() => roleFromPath(pathname), [pathname]);

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
          { href: "/teacher/questions", label: "質問（Q&A）" },
          { href: "/teacher/materials", label: "教材置き場" },
          { href: "/teacher/books", label: "問題集管理" },
        ]
      : role === "student"
        ? [
            { href: "/student", label: "生徒ホーム" },
            { href: "/student/assignments", label: "課題一覧" },
            { href: "/student/questions", label: "質問" },
            { href: "/student/materials", label: "教材置き場" },
          ]
        : [{ href: "/", label: "ホーム" }];

  // --------
  // お知らせ（質問メッセージ）
  // --------
  const seenKey = useMemo(() => {
    if (!user?.uid || !role) return "";
    return `notice_seen_${role}_${user.uid}`;
  }, [role, user?.uid]);

  const fetchingRef = useRef(false);

  const fetchNotices = async () => {
    if (!role || !user) return;
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      setNoticeErr(null);
      const since = seenKey ? localStorage.getItem(seenKey) ?? "" : "";
      const q = since ? `?since=${encodeURIComponent(since)}` : "";
      const path = role === "teacher" ? `/teacher/notifications${q}` : `/student/notifications${q}`;
      const r = await apiGet<NoticeResponse>(path);
      const list = Array.isArray(r?.notifications) ? r.notifications : [];
      // thread_id が無い行は除外
      const cleaned = list
        .map((x) => ({ ...x, thread_id: safeId((x as any).thread_id ?? (x as any).threadId ?? (x as any).id) }))
        .filter((x) => x.thread_id);
      setNotices(cleaned);
    } catch (e: any) {
      const msg = String(e?.message ?? "お知らせの取得に失敗しました。");
      // 401はログアウト
      if (msg.includes("401")) {
        logout(role);
        router.replace("/login");
        return;
      }
      setNoticeErr(msg);
    } finally {
      fetchingRef.current = false;
    }
  };

  // 定期ポーリング（軽量）
  useEffect(() => {
    if (!role || !user) return;
    fetchNotices();
    const id = window.setInterval(fetchNotices, 15000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, user?.uid]);


  const noticeCount = notices.length;

  const threadHref = (threadId: string) => {
    const tid = encodeURIComponent(threadId);
    return role === "teacher" ? `/teacher/questions/${tid}` : `/student/questions/${tid}`;
  };



  const markSeen = (iso: string) => {
    if (!seenKey) return;
    try {
      // 既読時刻は「クリック時点」を採用（まとめて既読）
      localStorage.setItem(seenKey, iso || new Date().toISOString());
    } catch {
      // ignore
    }
  };
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
              <div className="absolute left-0 mt-2 w-72 rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden text-gray-900">
                <div className="px-3 py-2 text-xs text-gray-500 border-b">メニュー</div>
                <div className="py-1">
                  {menuItems.map((it) => (
                    <Link
                      key={it.href}
                      href={it.href}
                      className="block px-4 py-3 text-sm hover:bg-slate-50 transition"
                      onClick={() => setMenuOpen(false)}
                    >
                      <div className="font-medium horizontal-label">{it.label}</div>
                      {it.desc && <div className="text-xs text-gray-500">{it.desc}</div>}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Link href={homeHref} className="font-semibold rounded-lg px-3 py-1.5 hover:bg-white/10 transition horizontal-label" title="ホーム">
            学習進捗管理アプリ
          </Link>
          {ready && user && (
            <div className="hidden sm:flex items-center gap-2 text-xs text-white/95">
              <span className="rounded-full border border-white/25 bg-white/10 px-2.5 py-1 text-white">{user.role === "teacher" ? "教師" : "生徒"}</span>
              <span className="rounded-full border border-white/25 bg-white/10 px-2.5 py-1 text-white">ID: {user.uid}</span>
              {user.role === "student" && <span className="rounded-full border border-white/25 bg-white/10 px-2.5 py-1 text-white">クラス: {classText}</span>}
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
              className="rounded-lg border px-3 py-2 text-sm bg-white/10 border-white/20 text-white hover:bg-white/20 transition active:scale-[0.99] relative"
              aria-label="お知らせ"
              aria-expanded={noticeOpen}
            >
              🔔
              {noticeCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[11px] flex items-center justify-center">
                  {noticeCount > 99 ? "99+" : noticeCount}
                </span>
              )}
            </button>

            {noticeOpen && (
              <div className="absolute right-0 mt-2 w-96 rounded-xl border bg-white shadow-lg overflow-hidden text-gray-900">
                <div className="px-3 py-2 text-xs text-gray-500 border-b flex items-center justify-between">
                  <span>お知らせ</span>
                  <button
                    className="text-xs text-emerald-700 hover:underline"
                    onClick={() => fetchNotices()}
                    type="button"
                  >
                    更新
                  </button>
                </div>

                {noticeErr && <div className="p-3 text-sm text-red-700 bg-red-50 border-b">{noticeErr}</div>}

                <div className="max-h-[420px] overflow-auto">
                  {notices.length === 0 ? (
                    <div className="p-3 text-sm text-gray-700">新しいお知らせはありません。</div>
                  ) : (
                    <div className="divide-y">
                      {notices.map((n, i) => (
                        <Link
                          key={`${n.thread_id}_${n.created_at}_${i}`}
                          href={threadHref(n.thread_id)}
                          className="block p-3 hover:bg-gray-50"
                          onClick={() => { markSeen(new Date().toISOString()); setNoticeOpen(false); }}
                        >
                          
                          <div className="text-xs text-gray-500 flex items-center justify-between gap-2">
                            <span className="truncate">{fmtDateTime(n.created_at)}</span>
                            <span className="shrink-0">{n.class_id ? `クラス:${n.class_id}` : ""}</span>
                          </div>

                          {role === "teacher" ? (
                            <div className="text-sm text-gray-900 mt-1">
                              （{n.student_uid ?? "生徒"}）から質問が届きました
                            </div>
                          ) : (
                            <div className="text-sm text-gray-900 mt-1">先生から返信が届きました</div>
                          )}

                          <div className="text-[11px] text-gray-600 mt-1 truncate">{n.title ?? "(無題)"}</div>
                          <div className="text-sm text-gray-800 mt-1 line-clamp-2">{(n.body ?? "").trim() || (n.image_path ? "（画像）" : "")}</div>

                        </Link>
                      ))}
                    </div>
                  )}
                </div>
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
