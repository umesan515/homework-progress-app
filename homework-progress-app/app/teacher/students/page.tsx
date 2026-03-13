"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiGet, apiPost, apiPut } from "@/lib/api";
import { getUserFromToken, logout } from "@/lib/auth";

type TeacherUser = {
  uid: string;
  role: "teacher" | "student";
  classId?: string | null;
};

type ClassRow = {
  class_id: string;
  student_count?: number;
};

type StudentRow = {
  uid: string;
  login_id: string;
  class_id: string | null;
  display_name: string;
};

type ClassResponse = ClassRow[];
type StudentResponse = { students: StudentRow[] };
type BulkCreateResponse = {
  class_id: string;
  created: Array<{ uid: string; class_id: string }>;
  skipped: Array<{ loginId: string; error: string }>;
};

type BulkParsedRow = {
  loginId: string;
  displayName: string;
};

const ALL_CLASS = "ALL";

function parseBulkStudents(text: string): BulkParsedRow[] {
  const lines = text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);

  const rows: BulkParsedRow[] = [];
  for (const line of lines) {
    const cols = line
      .replaceAll("，", ",")
      .split(",")
      .map((part) => part.trim());
    const loginId = cols[0] ?? "";
    const displayName = cols.slice(1).join(",").trim();
    if (!loginId) continue;
    rows.push({ loginId, displayName });
  }
  return rows;
}

function summarizeBulkResult(result: BulkCreateResponse): string {
  const createdCount = result.created?.length ?? 0;
  const skippedCount = result.skipped?.length ?? 0;
  const head = `クラス ${result.class_id} に ${createdCount} 件登録しました。`;
  if (skippedCount === 0) return head;
  const detail = result.skipped
    .slice(0, 5)
    .map((row) => `${row.loginId || "(空欄)"}: ${row.error}`)
    .join(" / ");
  return `${head}\n未登録 ${skippedCount} 件: ${detail}`;
}

export default function TeacherStudentsPage() {
  const router = useRouter();

  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<TeacherUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [selectedClass, setSelectedClass] = useState<string>(ALL_CLASS);
  const [searchText, setSearchText] = useState("");

  const [newClassId, setNewClassId] = useState("");
  const [renameClassId, setRenameClassId] = useState("");

  const [createLoginId, setCreateLoginId] = useState("");
  const [createDisplayName, setCreateDisplayName] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createClassId, setCreateClassId] = useState("");

  const [bulkClassId, setBulkClassId] = useState("");
  const [bulkPassword, setBulkPassword] = useState("");
  const [bulkText, setBulkText] = useState("");

  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editClassId, setEditClassId] = useState("");

  useEffect(() => {
    setUser(getUserFromToken() as TeacherUser | null);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      router.replace("/login?role=teacher");
      return;
    }
    if (user.role !== "teacher") {
      router.replace("/student");
      return;
    }
  }, [ready, router, user]);

  const load = async () => {
    if (!user || user.role !== "teacher") return;
    setBusy(true);
    setErr(null);
    try {
      const [classRows, studentRows] = await Promise.all([
        apiGet<ClassResponse>("/teacher/classes?details=1"),
        apiGet<StudentResponse>("/teacher/students"),
      ]);
      const sortedClasses = [...(classRows ?? [])].sort((a, b) =>
        String(a.class_id).localeCompare(String(b.class_id), "ja", { numeric: true, sensitivity: "base" })
      );
      setClasses(sortedClasses);
      setStudents(studentRows?.students ?? []);

      setSelectedClass((prev) => {
        if (prev === ALL_CLASS) return prev;
        return sortedClasses.some((row) => row.class_id === prev) ? prev : ALL_CLASS;
      });
    } catch (e: any) {
      const msg = String(e?.message ?? "読み込みに失敗しました。");
      if (msg.includes("401")) {
        logout("teacher");
        router.replace("/login?role=teacher");
        return;
      }
      setErr(msg);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?.uid, user?.role]);

  useEffect(() => {
    if (selectedClass !== ALL_CLASS) {
      setRenameClassId(selectedClass);
      if (!createClassId) setCreateClassId(selectedClass);
      if (!bulkClassId) setBulkClassId(selectedClass);
      if (!editClassId && editingUid) setEditClassId(selectedClass);
    }
  }, [bulkClassId, createClassId, editClassId, editingUid, selectedClass]);

  const normalizedSearch = searchText.trim().toLowerCase();

  const filteredStudents = useMemo(() => {
    const byClass = selectedClass === ALL_CLASS ? students : students.filter((row) => String(row.class_id ?? "") === selectedClass);
    if (!normalizedSearch) return byClass;
    return byClass.filter((row) => {
      const hay = [row.uid, row.login_id, row.display_name, row.class_id ?? ""].join(" ").toLowerCase();
      return hay.includes(normalizedSearch);
    });
  }, [normalizedSearch, selectedClass, students]);

  const bulkRows = useMemo(() => parseBulkStudents(bulkText), [bulkText]);
  const duplicateBulkLoginIds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of bulkRows) {
      counts.set(row.loginId, (counts.get(row.loginId) ?? 0) + 1);
    }
    return new Set(Array.from(counts.entries()).filter(([, count]) => count > 1).map(([loginId]) => loginId));
  }, [bulkRows]);

  const existingLoginIds = useMemo(() => new Set(students.map((row) => row.login_id)), [students]);

  const classCount = classes.length;
  const studentCount = students.length;

  const resetCreateForm = () => {
    setCreateLoginId("");
    setCreateDisplayName("");
    setCreatePassword("");
    setCreateClassId(selectedClass !== ALL_CLASS ? selectedClass : "");
  };

  const beginEdit = (row: StudentRow) => {
    setEditingUid(row.uid);
    setEditDisplayName(row.display_name ?? row.uid);
    setEditPassword("");
    setEditClassId(String(row.class_id ?? ""));
    setOkMsg(null);
    setErr(null);
  };

  const cancelEdit = () => {
    setEditingUid(null);
    setEditDisplayName("");
    setEditPassword("");
    setEditClassId("");
  };

  const submitCreateClass = async () => {
    const classId = newClassId.trim();
    if (!classId) {
      setErr("クラス名を入力してください。");
      return;
    }

    setBusy(true);
    setErr(null);
    setOkMsg(null);
    try {
      await apiPost("/teacher/classes", { classId });
      setNewClassId("");
      setSelectedClass(classId);
      setCreateClassId(classId);
      setBulkClassId(classId);
      setRenameClassId(classId);
      setOkMsg(`クラス ${classId} を登録しました。`);
      await load();
    } catch (e: any) {
      setErr(String(e?.message ?? "クラス登録に失敗しました。"));
    } finally {
      setBusy(false);
    }
  };

  const submitRenameClass = async () => {
    const nextClassId = renameClassId.trim();
    if (selectedClass === ALL_CLASS) {
      setErr("変更対象のクラスを選択してください。");
      return;
    }
    if (!nextClassId) {
      setErr("変更後のクラス名を入力してください。");
      return;
    }

    setBusy(true);
    setErr(null);
    setOkMsg(null);
    try {
      await apiPut(`/teacher/classes/${encodeURIComponent(selectedClass)}`, { nextClassId });
      setSelectedClass(nextClassId);
      setCreateClassId(nextClassId);
      setBulkClassId(nextClassId);
      setEditClassId(nextClassId);
      setOkMsg(`クラス名を ${selectedClass} から ${nextClassId} に変更しました。`);
      await load();
    } catch (e: any) {
      setErr(String(e?.message ?? "クラス名の変更に失敗しました。"));
    } finally {
      setBusy(false);
    }
  };

  const submitCreateStudent = async () => {
    const loginId = createLoginId.trim();
    const displayName = createDisplayName.trim();
    const password = createPassword;
    const classId = createClassId.trim();

    if (!loginId || !password || !classId) {
      setErr("生徒ID、クラス、初期パスワードを入力してください。");
      return;
    }

    setBusy(true);
    setErr(null);
    setOkMsg(null);
    try {
      await apiPost("/teacher/students", {
        loginId,
        displayName: displayName || loginId,
        password,
        classId,
      });
      setOkMsg(`生徒 ${loginId} を登録しました。`);
      resetCreateForm();
      await load();
    } catch (e: any) {
      setErr(String(e?.message ?? "生徒登録に失敗しました。"));
    } finally {
      setBusy(false);
    }
  };

  const submitBulkCreate = async () => {
    const classId = bulkClassId.trim();
    const password = bulkPassword;
    if (!classId || !password) {
      setErr("一括追加ではクラスと共通初期パスワードを入力してください。");
      return;
    }
    if (bulkRows.length === 0) {
      setErr("一括追加する生徒を1行以上入力してください。");
      return;
    }
    if (duplicateBulkLoginIds.size > 0) {
      setErr(`一括入力内で生徒IDが重複しています: ${Array.from(duplicateBulkLoginIds).join(", ")}`);
      return;
    }

    setBusy(true);
    setErr(null);
    setOkMsg(null);
    try {
      const result = await apiPost<BulkCreateResponse>("/teacher/students/bulk", {
        classId,
        password,
        rows: bulkRows,
      });
      setOkMsg(summarizeBulkResult(result));
      setBulkText("");
      setSelectedClass(classId);
      await load();
    } catch (e: any) {
      setErr(String(e?.message ?? "一括追加に失敗しました。"));
    } finally {
      setBusy(false);
    }
  };

  const submitEditStudent = async () => {
    if (!editingUid) return;

    const classId = editClassId.trim();
    const displayName = editDisplayName.trim();
    if (!classId) {
      setErr("所属クラスを入力してください。");
      return;
    }

    setBusy(true);
    setErr(null);
    setOkMsg(null);
    try {
      await apiPut(`/teacher/students/${encodeURIComponent(editingUid)}`, {
        displayName: displayName || editingUid,
        classId,
        password: editPassword,
      });
      setOkMsg(`生徒 ${editingUid} を更新しました。`);
      cancelEdit();
      await load();
    } catch (e: any) {
      setErr(String(e?.message ?? "生徒情報の更新に失敗しました。"));
    } finally {
      setBusy(false);
    }
  };

  if (!ready) return <main className="p-6">認証確認中...</main>;
  if (!user) return <main className="p-6">ログインへ遷移中...</main>;

  return (
    <main className="page-shell">
      <div className="page-title-block">
        <h1 className="page-title">生徒管理</h1>
        <p className="page-subtitle">クラスごとの生徒アカウント追加・編集・一覧確認をまとめて行います。</p>
        {err && <p className="text-sm text-rose-600 whitespace-pre-wrap">{err}</p>}
        {okMsg && <p className="text-sm text-emerald-700 whitespace-pre-wrap">{okMsg}</p>}
        {busy && <p className="text-sm text-slate-500">処理中...</p>}
      </div>

      <section className="section-stack">
        <div>
          <h2 className="section-heading">現在の登録状況</h2>
          <p className="section-caption">対象クラスを切り替えながら、追加・編集・一覧確認を進められます。</p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="info-card">
            <div className="info-card-label">登録クラス数</div>
            <div className="info-card-value">{classCount}</div>
            <div className="info-card-sub">学校表記のままクラス名を保持できます。</div>
          </div>
          <div className="info-card">
            <div className="info-card-label">登録生徒数</div>
            <div className="info-card-value">{studentCount}</div>
            <div className="info-card-sub">現在管理対象になっている生徒アカウント数です。</div>
          </div>
          <div className="info-card">
            <div className="info-card-label">現在の表示対象</div>
            <div className="info-card-value text-2xl">{selectedClass === ALL_CLASS ? "全クラス" : selectedClass}</div>
            <div className="info-card-sub">一覧・追加フォームはこの選択に合わせて使えます。</div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <div className="section-stack">
          <div>
            <h2 className="section-heading">クラス管理</h2>
            <p className="section-caption">1A、2-1 など学校の表記そのままで登録・管理できます。</p>
          </div>

          <div className="soft-panel space-y-4">
            <div className="soft-panel-muted space-y-3">
              <div className="text-sm font-bold text-slate-800">クラスを新規登録</div>
              <label className="text-sm text-slate-700">クラス名</label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="form-input max-w-[260px]"
                  value={newClassId}
                  onChange={(e) => setNewClassId(e.target.value)}
                  placeholder="例: 1A / 2-1"
                />
                <button className="subtle-button" onClick={submitCreateClass} disabled={busy}>
                  登録
                </button>
              </div>
            </div>

            <div className="soft-panel-muted space-y-3">
              <div className="text-sm font-bold text-slate-800">登録済みクラス</div>
              <div className="flex flex-wrap gap-2">
                <button
                  className={`rounded-full border px-3 py-1.5 text-sm ${
                    selectedClass === ALL_CLASS
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700"
                  }`}
                  onClick={() => setSelectedClass(ALL_CLASS)}
                  type="button"
                >
                  全クラス
                </button>
                {classes.map((row) => (
                  <button
                    key={row.class_id}
                    className={`rounded-full border px-3 py-1.5 text-sm ${
                      selectedClass === row.class_id
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white text-slate-700"
                    }`}
                    onClick={() => setSelectedClass(row.class_id)}
                    type="button"
                  >
                    {row.class_id}
                    <span className="ml-2 text-xs opacity-80">{row.student_count ?? 0}名</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="soft-panel-muted space-y-3">
              <div className="text-sm font-bold text-slate-800">選択クラス名を変更</div>
              <label className="text-sm text-slate-700">変更後のクラス名</label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="form-input max-w-[260px]"
                  value={renameClassId}
                  onChange={(e) => setRenameClassId(e.target.value)}
                  placeholder="選択中クラスの新しい名称"
                  disabled={selectedClass === ALL_CLASS}
                />
                <button className="subtle-button" onClick={submitRenameClass} disabled={busy || selectedClass === ALL_CLASS}>
                  クラス名を変更
                </button>
              </div>
              <div className="text-xs text-slate-500">現在の選択: {selectedClass === ALL_CLASS ? "全クラス" : selectedClass}</div>
            </div>
          </div>
        </div>

        <div className="section-stack">
          <div>
            <h2 className="section-heading">生徒アカウント管理</h2>
            <p className="section-caption">クラス単位の一括追加、個別追加、既存アカウントの編集を同じ画面で進められます。</p>
          </div>

          <div className="soft-panel space-y-4">
            <div className="soft-panel-muted space-y-3">
              <div className="text-sm font-bold text-slate-800">クラス単位で一括追加</div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm text-slate-700">対象クラス</label>
                  <input className="form-input" value={bulkClassId} onChange={(e) => setBulkClassId(e.target.value)} placeholder="例: 1A" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-slate-700">共通初期パスワード</label>
                  <input
                    className="form-input"
                    type="password"
                    value={bulkPassword}
                    onChange={(e) => setBulkPassword(e.target.value)}
                    placeholder="全員に設定する初期パスワード"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm text-slate-700">生徒一覧（1行ごとに「生徒ID,表示名」）</label>
                  <textarea
                    className="form-input min-h-[160px]"
                    value={bulkText}
                    onChange={(e) => setBulkText(e.target.value)}
                    placeholder={"例:\nstudent02,田中 太郎\nstudent03,佐藤 花子\nstudent04"}
                  />
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                <div>入力行数: {bulkRows.length} 件</div>
                <div>重複ID: {duplicateBulkLoginIds.size > 0 ? Array.from(duplicateBulkLoginIds).join(", ") : "なし"}</div>
                <div>
                  既存IDとの重複候補: {
                    bulkRows
                      .map((row) => row.loginId)
                      .filter((loginId, index, arr) => arr.indexOf(loginId) === index && existingLoginIds.has(loginId))
                      .join(", ") || "なし"
                  }
                </div>
              </div>
              <button className="subtle-button" onClick={submitBulkCreate} disabled={busy}>
                一括追加を実行
              </button>
            </div>

            <div className="soft-panel-muted space-y-3">
              <div className="text-sm font-bold text-slate-800">生徒アカウントを個別追加</div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm text-slate-700">生徒ID</label>
                  <input className="form-input" value={createLoginId} onChange={(e) => setCreateLoginId(e.target.value)} placeholder="例: student02" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-slate-700">表示名</label>
                  <input className="form-input" value={createDisplayName} onChange={(e) => setCreateDisplayName(e.target.value)} placeholder="例: 田中 太郎" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-slate-700">所属クラス</label>
                  <input className="form-input" value={createClassId} onChange={(e) => setCreateClassId(e.target.value)} placeholder="例: 1A" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-slate-700">初期パスワード</label>
                  <input
                    className="form-input"
                    type="password"
                    value={createPassword}
                    onChange={(e) => setCreatePassword(e.target.value)}
                    placeholder="初期パスワード"
                  />
                </div>
              </div>
              <button className="subtle-button" onClick={submitCreateStudent} disabled={busy}>
                生徒を追加
              </button>
            </div>

            <div className="soft-panel-muted space-y-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <div className="text-sm font-bold text-slate-800">生徒一覧</div>
                  <div className="text-xs text-slate-500">表示対象のクラスと検索語に合わせて一覧を絞り込めます。</div>
                </div>
                <div className="w-full md:max-w-[320px] space-y-2">
                  <label className="text-sm text-slate-700">検索</label>
                  <input
                    className="form-input"
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    placeholder="生徒ID・表示名・クラスで検索"
                  />
                </div>
              </div>

              {filteredStudents.length === 0 ? (
                <div className="text-sm text-slate-600">該当する生徒はまだ登録されていません。</div>
              ) : (
                <div className="space-y-2">
                  {filteredStudents.map((row) => {
                    const isEditing = editingUid === row.uid;
                    return (
                      <div key={row.uid} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div className="min-w-0 text-sm">
                            <div className="font-semibold text-slate-900">{row.display_name}</div>
                            <div className="text-slate-600">
                              ID: {row.login_id} / クラス: {row.class_id ?? "—"}
                            </div>
                          </div>
                          <button className="subtle-button" onClick={() => beginEdit(row)} type="button">
                            {isEditing ? "編集中" : "編集"}
                          </button>
                        </div>

                        {isEditing && (
                          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div className="space-y-2">
                              <label className="text-sm text-slate-700">表示名</label>
                              <input className="form-input" value={editDisplayName} onChange={(e) => setEditDisplayName(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                              <label className="text-sm text-slate-700">所属クラス</label>
                              <input className="form-input" value={editClassId} onChange={(e) => setEditClassId(e.target.value)} />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                              <label className="text-sm text-slate-700">新しいパスワード（変更時のみ入力）</label>
                              <input
                                className="form-input"
                                type="password"
                                value={editPassword}
                                onChange={(e) => setEditPassword(e.target.value)}
                                placeholder="未入力なら変更しません"
                              />
                            </div>
                            <div className="md:col-span-2 flex flex-wrap gap-2">
                              <button className="subtle-button" onClick={submitEditStudent} disabled={busy} type="button">
                                保存
                              </button>
                              <button className="danger-button" onClick={cancelEdit} disabled={busy} type="button">
                                取消
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
