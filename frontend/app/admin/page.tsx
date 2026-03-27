"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { getUserFromToken, type JwtUser } from "@/lib/auth";

type ActionCardProps = {
  href: string;
  title: string;
  description: string;
  theme: string;
};

function ActionCard({ href, title, description, theme }: ActionCardProps) {
  return (
    <Link href={href} className={`home-action-card ${theme}`}>
      <div className="home-action-card-title">{title}</div>
      <div className="home-action-card-desc">{description}</div>
      <div className="home-action-card-arrow">開く</div>
    </Link>
  );
}

export default function AdminHomePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<JwtUser | null>(null);

  useEffect(() => {
    setUser(getUserFromToken());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      router.replace("/login?force=1");
      return;
    }
    if (user.role === "teacher") {
      router.replace("/teacher");
      return;
    }
    if (user.role === "student") {
      router.replace("/student");
    }
  }, [ready, router, user]);

  if (!ready || !user) {
    return <main className="page-shell text-sm text-slate-500">認証を確認しています...</main>;
  }

  if (user.role !== "admin") {
    return <main className="page-shell text-sm text-slate-500">権限を確認しています...</main>;
  }

  return (
    <main className="page-shell">
      <section className="page-title-block">
        <h1 className="page-title">管理者ホーム</h1>
        <p className="page-subtitle">
          管理者アカウントで学校全体の設定を扱います。教師向けの各管理画面にもここから移動できます。
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <ActionCard
          href="/teacher/students"
          title="生徒管理"
          description="クラス単位の生徒追加、編集、削除、初期パスワード管理を行います。"
          theme="theme-emerald"
        />
        <ActionCard
          href="/teacher/classes"
          title="クラス管理"
          description="クラスの作成、整理、各クラスの運用確認へ進みます。"
          theme="theme-blue"
        />
        <ActionCard
          href="/teacher/books"
          title="問題集管理"
          description="問題集、章、大問など教材基盤の編集を行います。"
          theme="theme-violet"
        />
        <ActionCard
          href="/teacher/templates"
          title="課題配布"
          description="テンプレート作成やクラス配布の流れに進みます。"
          theme="theme-amber"
        />
        <ActionCard
          href="/teacher/assignments"
          title="進捗確認"
          description="配布済み課題の状況確認や停止操作を行います。"
          theme="theme-indigo"
        />
        <ActionCard
          href="/teacher/questions"
          title="質問対応"
          description="生徒からの質問の確認と返信に進みます。"
          theme="theme-rose"
        />
      </section>

      <section className="soft-panel-muted">
        <div className="info-card-label">ログイン中</div>
        <div className="mt-2 text-lg font-semibold text-slate-900">{user.uid}</div>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          この管理者アカウントは、管理者ホームへの遷移に加え、教師向けページにもそのままアクセスできます。
        </p>
      </section>
    </main>
  );
}
