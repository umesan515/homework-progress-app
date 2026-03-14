"use client";

import Link from "next/link";

export default function StudentQuizzesPage() {
  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">小テスト</h1>
        <p className="mt-3 text-sm text-gray-600">このページは現在準備中です。今後、小テストの受験や結果確認をここに追加します。</p>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-100 via-white to-gray-100 p-6 shadow-[0_10px_28px_rgba(15,23,42,0.06)]">
        <div className="inline-flex rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-xs font-medium text-slate-700">準備中</div>
        <div className="mt-4 text-2xl font-bold text-gray-900">小テスト機能を整備しています</div>
        <p className="mt-3 text-sm leading-6 text-gray-600">
          教師側の設定と連動し、生徒が小テストを受けられるページにする予定です。現段階では遷移確認用の画面のみ実装しています。
        </p>
        <div className="mt-6">
          <Link href="/student" className="inline-flex items-center rounded-xl border border-slate-200 bg-white/90 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-white">
            生徒ホームへ戻る
          </Link>
        </div>
      </div>
    </div>
  );
}
