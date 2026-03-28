"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { apiGet } from "@/lib/api";
import { getPrimaryUserFromStoredTokens, getUserFromToken, isAdminLikeUser, logout, type JwtUser } from "@/lib/auth";

type RouteRole = "teacher" | "student" | null;

type NoticeItem = {
  thread_id: string;
  title?: string | null;
  class_id?: string | null;
  student_uid?: string | null;
  body?: string | null;
  image_path?: string | null;
  created_at: string;
};

type NoticeResponse = {
  notifications: NoticeItem[];
};

function roleFromPath(pathname: string): RouteRole {
  if (pathname.startsWith("/teacher")) return "teacher";
  if (pathname.startsWith("/student")) return "student";
  return null;
}

function fmtDateTime(d: string | null | undefined): string {
  if (!d) return "";
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return "";
  return t.toLocaleString("ja-JP");
}

function safeId(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s || s === "undefined" || s === "null") return "";
  return s;
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-white/30 bg-white/20 px-3 py-1 text-sm font-medium text-white">
      {children}
    </span>
  );
}

export default function AppHeader() {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<JwtUser | null>(null);
  const [rawUser, setRawUser] = useState<JwtUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [noticeErr, setNoticeErr] = useState<string | null>(null);
  const role = useMemo(() => roleFromPath(pathname), [pathname]);
  const fetchingRef = useRef(false);

  useEffect(() => {
    const u = getUserFromToken();
    const raw = getPrimaryUserFromStoredTokens();
    setUser(u);
    setRawUser(raw);
    setReady(true);
  }, []);

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

  const isAdminHeader = isAdminLikeUser(rawUser) || isAdminLikeUser(user);

  const onLogout = () => {
    logout(role ?? undefined);
    router.replace("/login?force=1");
  };

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
          { href: "/teacher/students", label: "生徒管理" },
        ]
      : role === "student"
        ? [
            { href: "/student", label: "生徒ホーム" },
            { href: "/student/assignments", label: "課題一覧" },
            { href: "/student/questions", label: "質問" },
            { href: "/student/materials", label: "教材置き場" },
          ]
        : [{ href: "/", label: "ホーム" }];

  const seenKey = useMemo(() => {
    if (!user?.uid || !role) return "";
    return `notice_seen_${role}_${user.uid}`;
  }, [role, user?.uid]);

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
      const cleaned = list
        .map((x) => ({ ...x, thread_id: safeId((x as any).thread_id ?? (x as any).threadId ?? (x as any).id) }))
        .filter((x) => x.thread_id);
      setNotices(cleaned);
    } catch (e: any) {
      const msg = String(e?.message ?? "お知らせの取得に失敗しました。");
      if (msg.includes("401")) {
        logout(role);
        router.replace("/login?force=1");
        return;
      }
      setNoticeErr(msg);
    } finally {
      fetchingRef.current = false;
    }
  };

  useEffect(() => {
    if (!role || !user) return;
    fetchNotices();
    const id = window.setInterval(fetchNotices, 15000);
    return () => window.clearInterval(id);
  }, [role, user?.uid]);

  const noticeCount = notices.length;
  const threadHref = (threadId: string) => {
    const tid = encodeURIComponent(threadId);
    return role === "teacher" ? `/teacher/questions/${tid}` : `/student/questions/${tid}`;
  };

  const markSeen = (iso: string) => {
    if (!seenKey) return;
    try {
      localStorage.setItem(seenKey, iso || new Date().toISOString());
    } catch {
      // ignore
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b border-emerald-700 bg-emerald-600 text-white shadow-sm">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 md:px-6">
        <div className="relative">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
              setNoticeOpen(false);
            }}
            className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white transition hover:bg-white/20 active:scale-[0.99]"
            aria-label="メニュー"
            aria-expanded={menuOpen}
          >
            ☰
          </button>
          {menuOpen ? (
            <div
              className="absolute left-0 top-12 w-72 rounded-2xl border border-emerald-100 bg-white p-3 text-slate-800 shadow-xl"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="px-2 pb-2 text-sm font-semibold text-slate-700">メニュー</div>
              <div className="space-y-1">
                {menuItems.map((it) => (
                  <Link
                    key={it.href}
                    href={it.href}
                    className="block rounded-xl px-3 py-2 hover:bg-emerald-50"
                    onClick={() => setMenuOpen(false)}
                  >
                    <div className="text-sm font-medium">{it.label}</div>
                    {it.desc ? <div className="mt-1 text-xs text-slate-500">{it.desc}</div> : null}
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <Link href={homeHref} className="min-w-0 text-base font-semibold md:text-lg">
          学習進捗管理アプリ
        </Link>

        <div className="hidden min-w-0 flex-1 items-center gap-2 md:flex">
          {ready && user ? (
            <>
              {isAdminHeader ? (
                <>
                  <Badge>管理者</Badge>
                  <Badge>教師</Badge>
                </>
              ) : user.role === "teacher" ? (
                <Badge>教師</Badge>
              ) : (
                <Badge>生徒</Badge>
              )}
              <Badge>ID: {user.uid}</Badge>
              {user.role === "student" ? <Badge>クラス: {classText}</Badge> : null}
            </>
          ) : null}
        </div>

        <div className="relative ml-auto">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setNoticeOpen((v) => !v);
              setMenuOpen(false);
            }}
            className="relative rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white transition hover:bg-white/20 active:scale-[0.99]"
            aria-label="お知らせ"
            aria-expanded={noticeOpen}
          >
            🔔
            {noticeCount > 0 ? (
              <span className="absolute -right-2 -top-2 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {noticeCount > 99 ? "99+" : noticeCount}
              </span>
            ) : null}
          </button>
          {noticeOpen ? (
            <div
              className="absolute right-0 top-12 w-80 rounded-2xl border border-emerald-100 bg-white p-3 text-slate-800 shadow-xl"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-700">お知らせ</div>
                <button type="button" onClick={fetchNotices} className="text-xs text-emerald-700 hover:underline">
                  更新
                </button>
              </div>
              {noticeErr ? <div className="mb-2 rounded-lg bg-rose-50 p-2 text-xs text-rose-700">{noticeErr}</div> : null}
              {notices.length === 0 ? (
                <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">新しいお知らせはありません。</div>
              ) : (
                <div className="space-y-2">
                  {notices.map((n) => (
                    <Link
                      key={n.thread_id}
                      href={threadHref(n.thread_id)}
                      className="block rounded-xl border border-slate-100 p-3 hover:bg-emerald-50"
                      onClick={() => {
                        markSeen(new Date().toISOString());
                        setNoticeOpen(false);
                      }}
                    >
                      <div className="text-xs text-slate-500">
                        {fmtDateTime(n.created_at)} {n.class_id ? `クラス:${n.class_id}` : ""}
                      </div>
                      <div className="mt-1 text-sm text-slate-700">
                        {role === "teacher" ? `（${n.student_uid ?? "生徒"}）から質問が届きました` : "先生から返信が届きました"}
                      </div>
                      <div className="mt-1 text-sm font-medium text-slate-900">{n.title ?? "(無題)"}</div>
                      <div className="mt-1 line-clamp-2 text-xs text-slate-500">{(n.body ?? "").trim() || (n.image_path ? "（画像）" : "")}</div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {ready && user ? (
          <button
            type="button"
            onClick={onLogout}
            className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white transition hover:bg-white/20"
          >
            ログアウト
          </button>
        ) : (
          <div className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white/80">...</div>
        )}
      </div>

      {ready && user ? (
        <div className="border-t border-white/10 px-4 py-2 md:hidden">
          <div className="flex flex-wrap gap-2">
            {isAdminHeader ? (
              <>
                <Badge>管理者</Badge>
                <Badge>教師</Badge>
              </>
            ) : user.role === "teacher" ? (
              <Badge>教師</Badge>
            ) : (
              <Badge>生徒</Badge>
            )}
            <Badge>ID: {user.uid}</Badge>
            {user.role === "student" ? <Badge>クラス: {classText}</Badge> : null}
          </div>
        </div>
      ) : null}
    </header>
  );
}
