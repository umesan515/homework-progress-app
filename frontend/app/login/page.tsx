"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { apiPost } from "@/lib/api";
import { getUserFromRoleToken, getUserFromToken, setTokenForRole } from "@/lib/auth";

function LoginPageInner() {
  const r = useRouter();
  const sp = useSearchParams();

  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const requestedRole =
    sp.get("role") === "teacher" || sp.get("role") === "student"
      ? (sp.get("role") as "teacher" | "student")
      : null;

  useEffect(() => {
    const force = sp.get("force") === "1";
    if (force) return;

    const u = requestedRole ? getUserFromRoleToken(requestedRole) : getUserFromToken();
    if (!u) return;

    const actualRole = String(u.role ?? "");
    if (actualRole === "teacher" || actualRole === "admin") r.replace("/teacher");
    else r.replace("/student");
  }, [r, sp, requestedRole]);

  const onLogin = async () => {
    setErr(null);
    setBusy(true);

    try {
      const res = await apiPost<{ ok: boolean; token: string; user: { role?: string } }>("/auth/login", {
        loginId,
        password,
      });

      const actualRole = String(res.user?.role ?? "student");
      const storageRole = actualRole === "teacher" || actualRole === "admin" ? "teacher" : "student";

      setTokenForRole(storageRole, res.token);

      if (storageRole === "teacher") r.replace("/teacher");
      else r.replace("/student");
    } catch (e: any) {
      setErr(e?.message ?? "ログイン失敗");
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    await onLogin();
  };

  return (
    <main className="p-6 max-w-md mx-auto space-y-4">
      <h1 className="text-xl font-semibold">ログイン</h1>

      {err && <p className="text-sm text-red-600 whitespace-pre-wrap">{err}</p>}

      <form className="space-y-4" onSubmit={onSubmit}>
        <div className="space-y-2">
          <label className="block text-sm">ID</label>
          <input
            className="w-full rounded-lg border px-3 py-2"
            value={loginId}
            onChange={(e) => setLoginId(e.target.value)}
            placeholder="umehara / teacher1 / student01"
            autoComplete="username"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm">パスワード</label>
          <div className="flex gap-2">
            <input
              className="w-full rounded-lg border px-3 py-2"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="******"
              autoComplete="current-password"
            />
            <button
              type="button"
              className="shrink-0 rounded-lg border px-3 py-2 hover:bg-gray-50"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? "パスワードを隠す" : "パスワードを表示する"}
            >
              {showPassword ? "隠す" : "表示"}
            </button>
          </div>
        </div>

        <button
          type="submit"
          className="rounded-lg border px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
          disabled={busy}
        >
          {busy ? "ログイン中..." : "ログイン"}
        </button>
      </form>

      <div className="text-xs text-gray-500 space-y-1">
        {requestedRole && (
          <div>現在は{requestedRole === "teacher" ? "教師" : "生徒"}としてログインします。</div>
        )}
        <div>正式運用アカウント: 管理者 umehara / yuki0515</div>
        <div>開発用デコイ: 教師 teacher1 / teachpass, 生徒 student01 / studpass</div>
        <div>
          ※別タブでログイン画面を開く場合は <b>/login?force=1</b>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LoginPageInner />
    </Suspense>
  );
}
