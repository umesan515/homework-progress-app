"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { apiPost } from "@/lib/api";
import { getUserFromRoleToken, getUserFromToken, logout, setTokenForRole } from "@/lib/auth";

type LoginResponse = {
  ok: boolean;
  token: string;
  user?: { uid?: string; role?: string };
};

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const requestedRole = useMemo(() => {
    const role = searchParams.get("role");
    return role === "teacher" || role === "student" ? role : null;
  }, [searchParams]);

  useEffect(() => {
    const force = searchParams.get("force") === "1";
    if (force) return;

    const user = requestedRole ? getUserFromRoleToken(requestedRole) : getUserFromToken();
    if (!user) return;

    if (user.role === "admin" || user.uid === "umehara") {
      window.location.replace("/teacher?admin=1");
      return;
    }
    if (user.role === "teacher") {
      router.replace("/teacher");
      return;
    }
    router.replace("/student");
  }, [requestedRole, router, searchParams]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setErrorMessage(null);

    try {
      logout();

      const response = await apiPost<LoginResponse>("/auth/login", {
        loginId: loginId.trim(),
        password,
      });

      const uid = String(response.user?.uid ?? loginId.trim());
      const actualRole = String(response.user?.role ?? "student");

      if (actualRole === "admin") {
        setTokenForRole("admin", response.token);
        window.location.replace("/teacher?admin=1");
        return;
      }
      if (uid === "umehara") {
        setTokenForRole("teacher", response.token);
        window.location.replace("/teacher?admin=1");
        return;
      }
      if (actualRole === "teacher") {
        setTokenForRole("teacher", response.token);
        window.location.replace("/teacher");
        return;
      }

      setTokenForRole("student", response.token);
      window.location.replace("/student");
    } catch (error: any) {
      const raw = String(error?.message ?? "ログインに失敗しました。");
      if (raw.includes("invalid_credentials")) {
        setErrorMessage("IDまたはパスワードが正しくありません。");
      } else if (raw.includes("password_not_set")) {
        setErrorMessage("このアカウントにはパスワードが設定されていません。");
      } else {
        setErrorMessage(raw);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page-shell">
      <section className="page-title-block">
        <h1 className="page-title">ログイン</h1>
        <p className="page-subtitle">
          管理者・教師・生徒の各アカウントでログインします。
          既存のUIルールは維持し、見た目の大きな変更は行っていません。
        </p>
      </section>

      <section className="soft-panel mx-auto w-full max-w-2xl">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
          <form className="space-y-4" onSubmit={handleSubmit}>
            {errorMessage ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {errorMessage}
              </div>
            ) : null}

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700" htmlFor="login-id">
                ID
              </label>
              <input
                id="login-id"
                className="form-input"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                placeholder="umehara / teacher1 / student01"
                autoComplete="username"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700" htmlFor="password">
                パスワード
              </label>
              <div className="flex gap-2">
                <input
                  id="password"
                  className="form-input flex-1"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="******"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="subtle-button whitespace-nowrap"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "パスワードを隠す" : "パスワードを表示する"}
                >
                  {showPassword ? "隠す" : "表示"}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center justify-center rounded-xl border border-emerald-300 bg-gradient-to-r from-emerald-500 via-green-500 to-teal-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_16px_36px_-24px_rgba(16,185,129,0.7)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "ログイン中..." : "ログイン"}
              </button>
              {requestedRole ? (
                <span className="inline-chip">
                  現在は{requestedRole === "teacher" ? "教師" : "生徒"}としてログインします。
                </span>
              ) : null}
            </div>
          </form>

          <aside className="soft-panel-muted space-y-3">
            <div>
              <div className="info-card-label">アカウント</div>
              <div className="mt-2 text-base font-semibold text-slate-900">開発確認用</div>
            </div>
            <div className="space-y-2 text-sm leading-6 text-slate-600">
              <p>管理者: umehara / yuki0515</p>
              <p>教師: teacher1 / teachpass</p>
              <p>生徒: student01 / studpass</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-600">
              <p>別タブでログイン画面を開き直す場合は /login?force=1 を使います。</p>
              <p>管理者アカウントは管理者ホームへ遷移し、教師機能も利用できます。</p>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="page-shell text-sm text-slate-500">読み込み中...</main>}>
      <LoginPageInner />
    </Suspense>
  );
}
