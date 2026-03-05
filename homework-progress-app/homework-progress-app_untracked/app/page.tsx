"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getUserFromToken, type JwtUser } from "@/lib/auth";

export default function RootPage() {
  const router = useRouter();

  // ✅ Hydration対策：初回レンダーで localStorage を読まない
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<JwtUser | null>(null);

  useEffect(() => {
    const u = getUserFromToken();
    setUser(u);
    setReady(true);

    if (!u) {
      router.replace("/login");
      return;
    }

    if (u.role === "teacher") {
      router.replace("/teacher");
      return;
    }

    router.replace("/student");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready) return <main className="p-6">読み込み中...</main>;
  if (!user) return <main className="p-6">ログインへ遷移中...</main>;
  return <main className="p-6">移動中...</main>;
}
