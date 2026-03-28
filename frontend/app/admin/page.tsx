"use client";

import { useEffect } from "react";

export default function AdminPage() {
  useEffect(() => {
    window.location.replace("/teacher?admin=1");
  }, []);

  return <main className="page-shell text-sm text-slate-500">管理者ホームへ移動しています...</main>;
}
