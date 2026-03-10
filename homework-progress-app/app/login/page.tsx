"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiPost } from "@/lib/api";
import { getUserFromToken, setTokenForRole } from "@/lib/auth";

function LoginPageInner() {
  const r = useRouter();
  const sp = useSearchParams();

  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 既にログイン済みなら通常はホームへ（force=1 なら留まる）
  useEffect(() => {
    const force = sp.get("force") === "1";
    if (force) return;

    const u = getUserFromToken();
    if (!u) return;
    if (u.role === "teacher") r.replace("/teacher");
    else r.replace("/student");
  }, [r, sp]);

  const onLogin = async () => {
    setErr(null);
    setBusy(true);
    try {
      const res = await apiPost<{ ok: boolean; token: string; user: any }>(
        "/auth/login",
        { loginId, password }
      );

      const role = res.user?.role === "teacher" ? "teacher" : "student";
      setTokenForRole(role, res.token);

      if (role === "teacher") r.replace("/teacher");
      else r.replace("/student");
    } catch (e: any) {
      setErr(e?.message ?? "ログイン失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="p-6 max-w-md mx-auto space-y-4">
      <h1 className="text-xl font-semibold">ログイン</h1>
      {err && <p className="text-sm text-red-600">{err}</p>}

      <div className="space-y-2">
        <label className="block text-sm">ID</label>
        <input
          className="w-full rounded-lg border px-3 py-2"
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
          placeholder="teacher1 / student01"
        />
      </div>

      <div className="space-y-2">
        <label className="block text-sm">パスワード</label>
        <input
          className="w-full rounded-lg border px-3 py-2"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="******"
        />
      </div>

      <button
        className="rounded-lg border px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
        onClick={onLogin}
        disabled={busy}
      >
        {busy ? "ログイン中..." : "ログイン"}
      </button>

      <div className="text-xs text-gray-500">
        ※別タブでログイン画面を開く場合は <b>/login?force=1</b>
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
