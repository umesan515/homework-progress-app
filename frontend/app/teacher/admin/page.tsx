"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getUserFromToken, logout } from "@/lib/auth";

type UserLike = {
  uid?: string;
  role?: string;
};

export default function TeacherAdminPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<UserLike | null>(null);

  useEffect(() => {
    setUser(getUserFromToken() as UserLike | null);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      router.replace("/login?role=teacher");
      return;
    }
    if (user.role !== "admin") {
      logout("teacher");
      router.replace("/teacher");
    }
  }, [ready, user, router]);

  if (!ready) return <div className="p-6">認証確認中...</div>;
  if (!user) return <div className="p-6">ログインへ遷移中...</div>;

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-slate-900">管理者設定</h1>
        <p className="text-sm text-slate-600">
          管理者は教師ホームと分離せず、同じ導線の中で管理機能も使う方針です。
          このページでは、今後の実装対象と運用上の基準を整理します。
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold">正式アカウント</h2>
          <p className="mt-3 text-sm text-slate-700">ID: umehara</p>
          <p className="mt-1 text-sm text-slate-700">権限: admin / teacher</p>
          <p className="mt-1 text-sm text-slate-700">現在の役割: 管理者兼教師</p>
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold">開発用デコイ</h2>
          <p className="mt-3 text-sm text-slate-700">教師: teacher1 / teachpass</p>
          <p className="mt-1 text-sm text-slate-700">生徒: student01 / studpass</p>
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold">今回の優先範囲</h2>
          <p className="mt-3 text-sm text-slate-700">管理者アカウントの正式化、生徒管理、クラス管理、管理者導線の追加までを先に固めます。</p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-slate-900">次に進む入口</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Link href="/teacher/students" className="rounded-2xl border bg-slate-50 p-4 shadow-sm hover:shadow">
            <div className="font-semibold text-slate-900">生徒・クラス管理</div>
            <p className="mt-2 text-sm text-slate-600">現時点で実運用に直結する操作はこちらを使います。</p>
          </Link>
          <Link href="/teacher/admin/teachers" className="rounded-2xl border bg-cyan-50 p-4 shadow-sm hover:shadow">
            <div className="font-semibold text-slate-900">教師管理</div>
            <p className="mt-2 text-sm text-slate-600">複数教師運用に向けた入口です。現段階では準備中です。</p>
          </Link>
          <Link href="/teacher/admin/passwords" className="rounded-2xl border bg-fuchsia-50 p-4 shadow-sm hover:shadow">
            <div className="font-semibold text-slate-900">パスワード管理</div>
            <p className="mt-2 text-sm text-slate-600">初期化・再設定の運用画面です。現段階では準備中です。</p>
          </Link>
          <Link href="/teacher" className="rounded-2xl border bg-gray-50 p-4 shadow-sm hover:shadow">
            <div className="font-semibold text-slate-900">教師ホームへ戻る</div>
            <p className="mt-2 text-sm text-slate-600">日常運用の中心画面へ戻ります。</p>
          </Link>
        </div>
      </section>
    </main>
  );
}
