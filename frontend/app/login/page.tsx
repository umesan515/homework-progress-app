"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiPost } from "@/lib/api";
import {
  getUserFromRoleToken,
  getUserFromToken,
  logout,
  setTokenForRole,
} from "@/lib/auth";

type LoginResponse = {
  ok: boolean;
  token: string;
  user?: {
    uid?: string;
    role?: string;
  };
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

      const response = (await apiPost("/auth/login", {
        loginId: loginId.trim(),
        password,
      })) as LoginResponse;

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

  const roleLabel = requestedRole === "teacher" ? "教師" : requestedRole === "student" ? "生徒" : null;

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-sky-50 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 text-center">
          <p className="text-sm font-semibold tracking-[0.18em] text-sky-700">UMENOTE</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            ログイン
          </h1>
          <p className="mt-3 text-sm text-slate-600 sm:text-base">
            教師・生徒アカウントでログインして利用します。
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur sm:p-8">
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
                サインイン
              </span>
              {roleLabel ? (
                <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                  現在は{roleLabel}としてログインします
                </span>
              ) : null}
            </div>

            <form className="space-y-5" onSubmit={handleSubmit}>
              {errorMessage ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {errorMessage}
                </div>
              ) : null}

              <div>
                <label htmlFor="login-id" className="mb-2 block text-sm font-semibold text-slate-800">
                  ID
                </label>
                <input
                  id="login-id"
                  type="text"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  placeholder="teacher1 / student01"
                  autoComplete="username"
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                />
              </div>

              <div>
                <label htmlFor="password" className="mb-2 block text-sm font-semibold text-slate-800">
                  パスワード
                </label>
                <div className="flex overflow-hidden rounded-2xl border border-slate-300 bg-white focus-within:border-sky-500 focus-within:ring-4 focus-within:ring-sky-100">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="******"
                    autoComplete="current-password"
                    className="min-w-0 flex-1 px-4 py-3 text-base text-slate-900 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? "パスワードを隠す" : "パスワードを表示する"}
                    className="border-l border-slate-200 px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
                  >
                    {showPassword ? "隠す" : "表示"}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="inline-flex w-full items-center justify-center rounded-2xl bg-sky-600 px-5 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-sky-300"
              >
                {busy ? "ログイン中..." : "ログイン"}
              </button>
            </form>
          </section>

          <aside className="space-y-6">
            <section className="rounded-3xl border border-slate-200 bg-gray-50 p-6 shadow-sm sm:p-7">
              <h2 className="text-lg font-bold text-slate-900">開発確認用アカウント</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                公開表示は教師・生徒のみとし、管理者アカウントは画面上では案内しません。
              </p>

              <div className="mt-5 space-y-3">
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-xs font-semibold tracking-wide text-slate-500">教師</p>
                  <p className="mt-1 text-sm text-slate-800">ID: teacher1</p>
                  <p className="mt-1 text-sm text-slate-800">PW: teachpass</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-xs font-semibold tracking-wide text-slate-500">生徒</p>
                  <p className="mt-1 text-sm text-slate-800">ID: student01</p>
                  <p className="mt-1 text-sm text-slate-800">PW: studpass</p>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
              <h2 className="text-lg font-bold text-slate-900">案内</h2>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                <li>・ログイン状態を切り替えたい場合は、/login?force=1 で開き直します。</li>
                <li>・入力したIDに応じて、教師または生徒の画面へ遷移します。</li>
                <li>・管理者権限は内部で維持しつつ、公開画面では秘匿しています。</li>
              </ul>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-600">
          読み込み中...
        </main>
      }
    >
      <LoginPageInner />
    </Suspense>
  );
}
