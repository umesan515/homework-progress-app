"use client";

import Link from "next/link";

export default function TeacherAdminTeachersPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-slate-900">教師管理</h1>
        <p className="text-sm text-slate-600">
          まずは管理者1名 + 教師複数名の構成を想定しています。
          ただし現段階では、正式運用に必要な管理者・生徒・クラス周りを先に優先するため、この画面は準備中です。
        </p>
      </div>

      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">今後ここに入れる予定</h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-700">
          <li>・教師アカウント追加</li>
          <li>・担当教科や表示名の設定</li>
          <li>・有効化 / 無効化</li>
          <li>・教師別の運用メモ</li>
        </ul>
      </section>

      <Link href="/teacher" className="inline-flex rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">
        教師ホームへ戻る
      </Link>
    </main>
  );
}
