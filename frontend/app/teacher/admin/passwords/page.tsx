"use client";

import Link from "next/link";

export default function TeacherAdminPasswordsPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-slate-900">パスワード管理</h1>
        <p className="text-sm text-slate-600">
          各アカウントのログインパスワード管理を今後ここに集約します。
          まずは実運用に必要な管理者アカウントと生徒管理の基盤を優先しているため、この画面は準備中です。
        </p>
      </div>

      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">今後ここに入れる予定</h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-700">
          <li>・初期パスワード再設定</li>
          <li>・管理者による一括初期化</li>
          <li>・教師 / 生徒別の更新履歴</li>
          <li>・パスワード変更運用の注意表示</li>
        </ul>
      </section>

      <Link href="/teacher" className="inline-flex rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">
        教師ホームへ戻る
      </Link>
    </main>
  );
}
