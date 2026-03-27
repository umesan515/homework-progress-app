"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
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
  attendance_number?: string;
  last_name_kanji?: string;
  first_name_kanji?: string;
  last_name_kana?: string;
  first_name_kana?: string;
};

type BulkCreateResponse = {
  class_id: string;
  created: Array<{
    uid: string;
    class_id: string;
    login_id: string;
    display_name: string;
    initial_password?: string;
  }>;
  skipped: Array<{ loginId: string; error: string }>;
};

type StudentCredential = {
  classId: string;
  loginId: string;
  password: string;
  displayName: string;
  attendanceNumber: string;
};

type StudentDraft = {
  attendanceNumber: string;
  lastNameKanji: string;
  firstNameKanji: string;
  lastNameKana: string;
  firstNameKana: string;
  loginId: string;
  password: string;
};

type PreparedBulkRow = StudentDraft & {
  classId: string;
  displayName: string;
  generatedLoginId: boolean;
  generatedPassword: boolean;
  hasExistingConflict: boolean;
};

const ALL_CLASS = "ALL";

const HIRAGANA_BASE_MAP: Record<string, string> = {
  あ: "a", い: "i", う: "u", え: "e", お: "o",
  か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
  た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
  は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
  や: "ya", ゆ: "yu", よ: "yo",
  ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
  わ: "wa", を: "o", ん: "n",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
  ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
  だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
  ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
  ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o",
  ゃ: "ya", ゅ: "yu", ょ: "yo",
  ゔ: "vu",
  ー: "-",
};

const DIGRAPH_MAP: Record<string, string> = {
  きゃ: "kya", きゅ: "kyu", きょ: "kyo",
  しゃ: "sha", しゅ: "shu", しょ: "sho",
  ちゃ: "cha", ちゅ: "chu", ちょ: "cho",
  にゃ: "nya", にゅ: "nyu", にょ: "nyo",
  ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo",
  みゃ: "mya", みゅ: "myu", みょ: "myo",
  りゃ: "rya", りゅ: "ryu", りょ: "ryo",
  ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo",
  じゃ: "ja", じゅ: "ju", じょ: "jo",
  びゃ: "bya", びゅ: "byu", びょ: "byo",
  ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo",
};

function toHiragana(value: string): string {
  return value.replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
}

function romanizeKana(value: string): string {
  const hira = toHiragana(String(value || "").trim());
  if (!hira) return "";

  let out = "";
  for (let i = 0; i < hira.length; i += 1) {
    const current = hira[i];
    const nextPair = hira.slice(i, i + 2);

    if (current === "っ") {
      const after = hira.slice(i + 1, i + 3);
      const chunk = DIGRAPH_MAP[after] || HIRAGANA_BASE_MAP[hira[i + 1]] || "";
      out += chunk.slice(0, 1);
      continue;
    }

    if (DIGRAPH_MAP[nextPair]) {
      out += DIGRAPH_MAP[nextPair];
      i += 1;
      continue;
    }

    out += HIRAGANA_BASE_MAP[current] || current;
  }

  return out
    .replace(/-/g, "")
    .replace(/nn(?=[bmp])/g, "n")
    .replace(/[^a-z]/g, "")
    .toLowerCase();
}

function buildDisplayName(lastNameKanji: string, firstNameKanji: string, fallback = ""): string {
  const full = [String(lastNameKanji || "").trim(), String(firstNameKanji || "").trim()].filter(Boolean).join(" ").trim();
  return full || fallback;
}

function normalizeClassToken(classId: string): string {
  return String(classId || "")
    .trim()
    .toLowerCase()
    .replace(/[\s　\-_]/g, "")
    .replace(/組/g, "")
    .replace(/年/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeAttendanceNumber(value: string): string {
  const digits = String(value || "").replace(/[^0-9]/g, "");
  if (!digits) return "";
  return digits.padStart(2, "0");
}

function sanitizeLoginId(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s　]/g, "")
    .replace(/[^a-z0-9._-]/g, "");
}

function generateRandomPassword(length = 10): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (v) => chars[v % chars.length]).join("");
}

function suggestLoginId(classId: string, attendanceNumber: string, lastNameKana: string, lastNameKanji: string, index = -1): string {
  const classToken = normalizeClassToken(classId);
  const attendanceToken = normalizeAttendanceNumber(attendanceNumber) || (index >= 0 ? String(index + 1).padStart(2, "0") : "");
  const surnameToken = sanitizeLoginId(romanizeKana(lastNameKana)) || sanitizeLoginId(lastNameKanji);
  if (!classToken || !attendanceToken || !surnameToken) return "";
  return sanitizeLoginId(`${classToken}${attendanceToken}${surnameToken}`);
}

function splitDelimitedLine(line: string): string[] {
  if (line.includes("\t")) {
    return line.split("\t").map((part) => part.trim());
  }
  return line.replace(/，/g, ",").split(",").map((part) => part.trim());
}

function normalizeBulkSourceText(text: string): string {
  const normalized = text.replace(/^\ufeff/, "");
  const lines = normalized
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.join("\n");
}

function parseBulkStudents(text: string): StudentDraft[] {
  const lines = normalizeBulkSourceText(text)
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);

  const rows: StudentDraft[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const cols = splitDelimitedLine(lines[index]);
    const compactHeader = cols.join("|").replace(/[\s"']/g, "").toLowerCase();
    if (
      index === 0 &&
      (compactHeader.includes("attendancenumber") || compactHeader.includes("出席番号") || compactHeader.includes("lastnamekanji"))
    ) {
      continue;
    }

    if (cols.every((col) => !col)) continue;

    rows.push({
      attendanceNumber: cols[0] ?? "",
      lastNameKanji: cols[1] ?? "",
      firstNameKanji: cols[2] ?? "",
      lastNameKana: cols[3] ?? "",
      firstNameKana: cols[4] ?? "",
      loginId: cols[5] ?? "",
      password: cols[6] ?? "",
    });
  }

  return rows;
}

function downloadTextFile(filename: string, content: string, mime = "text/plain;charset=utf-8;") {
  const blob = new Blob(["\ufeff", content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
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

  const [createClassId, setCreateClassId] = useState("");
  const [createAttendanceNumber, setCreateAttendanceNumber] = useState("");
  const [createLastNameKanji, setCreateLastNameKanji] = useState("");
  const [createFirstNameKanji, setCreateFirstNameKanji] = useState("");
  const [createLastNameKana, setCreateLastNameKana] = useState("");
  const [createFirstNameKana, setCreateFirstNameKana] = useState("");
  const [createLoginId, setCreateLoginId] = useState("");
  const [createPassword, setCreatePassword] = useState("");

  const [bulkClassId, setBulkClassId] = useState("");
  const [bulkPassword, setBulkPassword] = useState("");
  const [bulkText, setBulkText] = useState("");

  const [lastIssuedCredentials, setLastIssuedCredentials] = useState<StudentCredential[]>([]);

  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editClassId, setEditClassId] = useState("");
  const [editAttendanceNumber, setEditAttendanceNumber] = useState("");
  const [editLastNameKanji, setEditLastNameKanji] = useState("");
  const [editFirstNameKanji, setEditFirstNameKanji] = useState("");
  const [editLastNameKana, setEditLastNameKana] = useState("");
  const [editFirstNameKana, setEditFirstNameKana] = useState("");
  const [editLoginId, setEditLoginId] = useState("");
  const [editPassword, setEditPassword] = useState("");

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
    }
  }, [ready, router, user]);

  const load = async () => {
    if (!user || user.role !== "teacher") return;
    setBusy(true);
    setErr(null);
    try {
      const [classRows, studentRows] = await Promise.all([
        apiGet<ClassRow[]>("/teacher/classes?details=1"),
        apiGet<{ students: StudentRow[] }>("/teacher/students"),
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
      const hay = [
        row.uid,
        row.login_id,
        row.display_name,
        row.class_id ?? "",
        row.attendance_number ?? "",
        row.last_name_kanji ?? "",
        row.first_name_kanji ?? "",
        row.last_name_kana ?? "",
        row.first_name_kana ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(normalizedSearch);
    });
  }, [normalizedSearch, selectedClass, students]);

  const existingLoginIds = useMemo(() => new Set(students.map((row) => sanitizeLoginId(row.login_id))), [students]);
  const bulkRows = useMemo(() => parseBulkStudents(bulkText), [bulkText]);
  const preparedBulkRows = useMemo<PreparedBulkRow[]>(() => {
    return bulkRows.map((row, index) => {
      const generatedLoginId = suggestLoginId(bulkClassId, row.attendanceNumber, row.lastNameKana, row.lastNameKanji, index);
      const resolvedLoginId = sanitizeLoginId(row.loginId) || generatedLoginId;
      const resolvedPassword = String(row.password || "").trim() || String(bulkPassword || "").trim();
      const displayName = buildDisplayName(row.lastNameKanji, row.firstNameKanji, resolvedLoginId);
      return {
        ...row,
        classId: bulkClassId.trim(),
        displayName,
        loginId: resolvedLoginId,
        password: resolvedPassword,
        generatedLoginId: !sanitizeLoginId(row.loginId),
        generatedPassword: !String(row.password || "").trim() && !String(bulkPassword || "").trim(),
        hasExistingConflict: existingLoginIds.has(resolvedLoginId),
      };
    });
  }, [bulkRows, bulkClassId, bulkPassword, existingLoginIds]);

  const duplicateBulkLoginIds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of preparedBulkRows) {
      counts.set(row.loginId, (counts.get(row.loginId) ?? 0) + 1);
    }
    return new Set(Array.from(counts.entries()).filter(([, count]) => count > 1).map(([loginId]) => loginId));
  }, [preparedBulkRows]);

  const classCount = classes.length;
  const studentCount = students.length;

  const createSuggestedLoginId = useMemo(
    () => suggestLoginId(createClassId, createAttendanceNumber, createLastNameKana, createLastNameKanji, -1),
    [createAttendanceNumber, createClassId, createLastNameKana, createLastNameKanji]
  );
  const createResolvedLoginId = sanitizeLoginId(createLoginId) || createSuggestedLoginId;
  const createResolvedPassword = String(createPassword || "").trim();
  const createDisplayName = buildDisplayName(createLastNameKanji, createFirstNameKanji, createResolvedLoginId);

  const editDisplayName = buildDisplayName(editLastNameKanji, editFirstNameKanji, editLoginId || editingUid || "");

  const resetCreateForm = () => {
    setCreateClassId(selectedClass !== ALL_CLASS ? selectedClass : "");
    setCreateAttendanceNumber("");
    setCreateLastNameKanji("");
    setCreateFirstNameKanji("");
    setCreateLastNameKana("");
    setCreateFirstNameKana("");
    setCreateLoginId("");
    setCreatePassword("");
  };

  const beginEdit = (row: StudentRow) => {
    setEditingUid(row.uid);
    setEditClassId(String(row.class_id ?? ""));
    setEditAttendanceNumber(String(row.attendance_number ?? ""));
    setEditLastNameKanji(String(row.last_name_kanji ?? ""));
    setEditFirstNameKanji(String(row.first_name_kanji ?? ""));
    setEditLastNameKana(String(row.last_name_kana ?? ""));
    setEditFirstNameKana(String(row.first_name_kana ?? ""));
    setEditLoginId(String(row.login_id ?? row.uid));
    setEditPassword("");
    setErr(null);
    setOkMsg(null);
  };

  const cancelEdit = () => {
    setEditingUid(null);
    setEditClassId("");
    setEditAttendanceNumber("");
    setEditLastNameKanji("");
    setEditFirstNameKanji("");
    setEditLastNameKana("");
    setEditFirstNameKana("");
    setEditLoginId("");
    setEditPassword("");
  };

  const setIssuedCredentialsFromBulk = (classId: string, created: BulkCreateResponse["created"]) => {
    const credentials = created
      .filter((row) => row.initial_password)
      .map((row) => ({
        classId,
        loginId: row.login_id,
        password: String(row.initial_password || ""),
        displayName: row.display_name || row.login_id,
        attendanceNumber: "",
      }));
    if (credentials.length > 0) setLastIssuedCredentials(credentials);
  };

  const downloadIssuedCredentials = () => {
    if (lastIssuedCredentials.length === 0) return;
    const csv = [
      ["classId", "loginId", "password", "displayName", "attendanceNumber"].join(","),
      ...lastIssuedCredentials.map((row) =>
        [row.classId, row.loginId, row.password, row.displayName, row.attendanceNumber].map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n");
    downloadTextFile("student_credentials.csv", csv, "text/csv;charset=utf-8;");
  };

  const copyIssuedCredentials = async () => {
    if (lastIssuedCredentials.length === 0) return;
    const lines = lastIssuedCredentials.map((row) => `${row.classId}\t${row.loginId}\t${row.password}\t${row.displayName}`);
    await navigator.clipboard.writeText(["クラス\tログインID\t初期パスワード\t氏名", ...lines].join("\n"));
    setOkMsg("直近に発行したアカウント情報をクリップボードへコピーしました。");
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
    const classId = createClassId.trim();
    const loginId = createResolvedLoginId;
    const password = createResolvedPassword || generateRandomPassword();
    if (!classId || !loginId) {
      setErr("所属クラス、出席番号、氏名かなを確認してください。ログインIDが生成できていません。");
      return;
    }

    setBusy(true);
    setErr(null);
    setOkMsg(null);
    try {
      const result = await apiPost<{ login_id: string; initial_password?: string }>("/teacher/students", {
        loginId,
        password,
        classId,
        displayName: createDisplayName,
        attendanceNumber: normalizeAttendanceNumber(createAttendanceNumber),
        lastNameKanji: createLastNameKanji,
        firstNameKanji: createFirstNameKanji,
        lastNameKana: createLastNameKana,
        firstNameKana: createFirstNameKana,
      });
      setLastIssuedCredentials([
        {
          classId,
          loginId: result.login_id || loginId,
          password: result.initial_password || password,
          displayName: createDisplayName,
          attendanceNumber: normalizeAttendanceNumber(createAttendanceNumber),
        },
      ]);
      setOkMsg(`生徒 ${loginId} を登録しました。初期パスワードも発行済みです。`);
      resetCreateForm();
      await load();
    } catch (e: any) {
      setErr(String(e?.message ?? "生徒登録に失敗しました。"));
    } finally {
      setBusy(false);
    }
  };

  const onBulkCsvSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const normalized = normalizeBulkSourceText(text);
      setBulkText(normalized);
      setOkMsg(`ファイル ${file.name} を読み込みました。Excelから書き出したCSVや、表計算から貼り付けたTSVを利用できます。`);
      setErr(null);
    } catch (e: any) {
      setErr(String(e?.message ?? "CSVファイルの読み込みに失敗しました。"));
    } finally {
      event.target.value = "";
    }
  };

  const downloadBulkCsvTemplate = () => {
    const csv = [
      ["attendanceNumber", "lastNameKanji", "firstNameKanji", "lastNameKana", "firstNameKana", "loginId", "password"].join(","),
      ["01", "荒木", "太郎", "あらき", "たろう", "", ""].join(","),
      ["02", "佐藤", "花子", "さとう", "はなこ", "", ""].join(","),
    ].join("\n");
    downloadTextFile("student_import_template.csv", csv, "text/csv;charset=utf-8;");
  };

  const submitBulkCreate = async () => {
    const classId = bulkClassId.trim();
    if (!classId) {
      setErr("一括追加では対象クラスを入力してください。");
      return;
    }
    if (preparedBulkRows.length === 0) {
      setErr("一括追加する生徒を1行以上入力してください。");
      return;
    }
    if (duplicateBulkLoginIds.size > 0) {
      setErr(`一括入力内でログインIDが重複しています: ${Array.from(duplicateBulkLoginIds).join(", ")}`);
      return;
    }

    setBusy(true);
    setErr(null);
    setOkMsg(null);
    try {
      const result = await apiPost<BulkCreateResponse>("/teacher/students/bulk", {
        classId,
        password: bulkPassword,
        rows: preparedBulkRows.map((row) => ({
          loginId: row.loginId,
          password: row.password || generateRandomPassword(),
          displayName: row.displayName,
          attendanceNumber: normalizeAttendanceNumber(row.attendanceNumber),
          lastNameKanji: row.lastNameKanji,
          firstNameKanji: row.firstNameKanji,
          lastNameKana: row.lastNameKana,
          firstNameKana: row.firstNameKana,
        })),
      });
      setIssuedCredentialsFromBulk(classId, result.created);
      setOkMsg(`${summarizeBulkResult(result)}\n作成済みアカウント情報は下の「初期配布用メモ」から書き出せます。`);
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
    const loginId = sanitizeLoginId(editLoginId);
    if (!classId || !loginId) {
      setErr("所属クラスとログインIDを入力してください。");
      return;
    }

    setBusy(true);
    setErr(null);
    setOkMsg(null);
    try {
      await apiPut(`/teacher/students/${encodeURIComponent(editingUid)}`, {
        classId,
        loginId,
        password: editPassword,
        displayName: editDisplayName,
        attendanceNumber: normalizeAttendanceNumber(editAttendanceNumber),
        lastNameKanji: editLastNameKanji,
        firstNameKanji: editFirstNameKanji,
        lastNameKana: editLastNameKana,
        firstNameKana: editFirstNameKana,
      });
      if (editPassword) {
        setLastIssuedCredentials([
          {
            classId,
            loginId,
            password: editPassword,
            displayName: editDisplayName,
            attendanceNumber: normalizeAttendanceNumber(editAttendanceNumber),
          },
        ]);
      }
      setOkMsg(`生徒 ${editingUid} を更新しました。${editPassword ? "新しい初期パスワードも控えられます。" : ""}`);
      cancelEdit();
      await load();
    } catch (e: any) {
      setErr(String(e?.message ?? "生徒情報の更新に失敗しました。"));
    } finally {
      setBusy(false);
    }
  };

  const submitDeleteClass = async () => {
    if (selectedClass === ALL_CLASS) {
      setErr("削除するクラスを選択してください。");
      return;
    }
    const yes = window.confirm(`クラス ${selectedClass} を削除します。所属生徒もまとめて削除されます。よろしいですか。`);
    if (!yes) return;

    setBusy(true);
    setErr(null);
    setOkMsg(null);
    try {
      const result = await apiDelete<{ class_id: string; deleted_students?: number }>(`/teacher/classes/${encodeURIComponent(selectedClass)}`);
      setOkMsg(`クラス ${result.class_id} を削除しました。削除生徒数: ${result.deleted_students ?? 0} 件`);
      setSelectedClass(ALL_CLASS);
      setRenameClassId("");
      setCreateClassId("");
      setBulkClassId("");
      cancelEdit();
      await load();
    } catch (e: any) {
      setErr(String(e?.message ?? "クラス削除に失敗しました。"));
    } finally {
      setBusy(false);
    }
  };

  const submitDeleteStudent = async (uid: string) => {
    const yes = window.confirm(`生徒 ${uid} を削除します。よろしいですか。`);
    if (!yes) return;

    setBusy(true);
    setErr(null);
    setOkMsg(null);
    try {
      await apiDelete(`/teacher/students/${encodeURIComponent(uid)}`);
      if (editingUid === uid) cancelEdit();
      setOkMsg(`生徒 ${uid} を削除しました。`);
      await load();
    } catch (e: any) {
      setErr(String(e?.message ?? "生徒削除に失敗しました。"));
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
        <p className="page-subtitle">クラス単位での一括登録、個別追加、ログインID管理、初期パスワード配布をまとめて行います。</p>
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
                <input className="form-input max-w-[260px]" value={newClassId} onChange={(e) => setNewClassId(e.target.value)} placeholder="例: 1A / 2-1" />
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
                    selectedClass === ALL_CLASS ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-700"
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
                      selectedClass === row.class_id ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-700"
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
              <div>
                <button className="danger-button" onClick={submitDeleteClass} disabled={busy || selectedClass === ALL_CLASS} type="button">
                  選択クラスを削除
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="section-stack">
          <div>
            <h2 className="section-heading">生徒アカウント管理</h2>
            <p className="section-caption">出席番号・氏名かなからログインIDを自動生成し、初期パスワード配布まで一画面で進められます。</p>
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
                  <label className="text-sm text-slate-700">共通初期パスワード（空欄なら各自自動発行）</label>
                  <input className="form-input" value={bulkPassword} onChange={(e) => setBulkPassword(e.target.value)} placeholder="任意入力" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm text-slate-700">生徒一覧（Excel貼り付け可）</label>
                  <textarea
                    className="form-input min-h-[180px]"
                    value={bulkText}
                    onChange={(e) => setBulkText(e.target.value)}
                    placeholder={[
                      "出席番号,漢字姓,漢字名,ひらがな姓,ひらがな名,ログインID,初期パスワード",
                      "01,荒木,太郎,あらき,たろう,,",
                      "02,佐藤,花子,さとう,はなこ,,",
                    ].join("\n")}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="subtle-button cursor-pointer">
                  CSVを読み込む
                  <input className="hidden" type="file" accept=".csv,.txt" onChange={onBulkCsvSelected} />
                </label>
                <button className="subtle-button" onClick={downloadBulkCsvTemplate} type="button">
                  テンプレートCSVを保存
                </button>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 space-y-1">
                <div>入力行数: {preparedBulkRows.length} 件</div>
                <div>一括入力内の重複ID: {duplicateBulkLoginIds.size > 0 ? Array.from(duplicateBulkLoginIds).join(", ") : "なし"}</div>
                <div>既存IDとの重複候補: {preparedBulkRows.filter((row) => row.hasExistingConflict).map((row) => row.loginId).join(", ") || "なし"}</div>
                <div>ログインID未入力行は「クラス + 出席番号 + 姓かなローマ字」で仮生成します。</div>
              </div>
              {preparedBulkRows.length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 space-y-2">
                  <div className="font-semibold text-slate-900">作成プレビュー（先頭5件）</div>
                  <div className="space-y-2">
                    {preparedBulkRows.slice(0, 5).map((row, index) => (
                      <div key={`${row.loginId}-${index}`} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                        <div className="font-semibold text-slate-900">{row.displayName || row.loginId || `行 ${index + 1}`}</div>
                        <div className="text-slate-600">
                          出席番号: {normalizeAttendanceNumber(row.attendanceNumber) || "—"} / ログインID: {row.loginId} {row.generatedLoginId ? "(自動)" : "(入力)"}
                        </div>
                        <div className="text-slate-600">初期パスワード: {row.password} {row.generatedPassword ? "(自動)" : "(入力/共通)"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <button className="subtle-button" onClick={submitBulkCreate} disabled={busy}>
                一括追加を実行
              </button>
            </div>

            <div className="soft-panel-muted space-y-3">
              <div className="text-sm font-bold text-slate-800">生徒アカウントを個別追加</div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm text-slate-700">所属クラス</label>
                  <input className="form-input" value={createClassId} onChange={(e) => setCreateClassId(e.target.value)} placeholder="例: 1A" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-slate-700">出席番号</label>
                  <input className="form-input" value={createAttendanceNumber} onChange={(e) => setCreateAttendanceNumber(e.target.value)} placeholder="例: 01" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-slate-700">漢字姓</label>
                  <input className="form-input" value={createLastNameKanji} onChange={(e) => setCreateLastNameKanji(e.target.value)} placeholder="例: 荒木" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-slate-700">漢字名</label>
                  <input className="form-input" value={createFirstNameKanji} onChange={(e) => setCreateFirstNameKanji(e.target.value)} placeholder="例: 太郎" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-slate-700">ひらがな姓</label>
                  <input className="form-input" value={createLastNameKana} onChange={(e) => setCreateLastNameKana(e.target.value)} placeholder="例: あらき" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-slate-700">ひらがな名</label>
                  <input className="form-input" value={createFirstNameKana} onChange={(e) => setCreateFirstNameKana(e.target.value)} placeholder="例: たろう" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-slate-700">ログインID（空欄で自動生成）</label>
                  <input className="form-input" value={createLoginId} onChange={(e) => setCreateLoginId(e.target.value)} placeholder={`例: ${createSuggestedLoginId || "1a01araki"}`} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-slate-700">初期パスワード（空欄で自動生成）</label>
                  <div className="flex gap-2">
                    <input className="form-input" value={createPassword} onChange={(e) => setCreatePassword(e.target.value)} placeholder="未入力可" />
                    <button className="subtle-button shrink-0" onClick={() => setCreatePassword(generateRandomPassword())} type="button">
                      自動生成
                    </button>
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 space-y-1">
                <div>表示名: {createDisplayName || "—"}</div>
                <div>作成されるログインID: {createResolvedLoginId || "—"}</div>
                <div>初期パスワード: {createResolvedPassword || "保存時に自動生成"}</div>
              </div>
              <button className="subtle-button" onClick={submitCreateStudent} disabled={busy}>
                生徒を追加
              </button>
            </div>

            <div className="soft-panel-muted space-y-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <div className="text-sm font-bold text-slate-800">初期配布用メモ</div>
                  <div className="text-xs text-slate-500">直近に発行したログインIDと初期パスワードを控えられます。</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="subtle-button" onClick={downloadIssuedCredentials} type="button" disabled={lastIssuedCredentials.length === 0}>
                    CSVを書き出す
                  </button>
                  <button className="subtle-button" onClick={copyIssuedCredentials} type="button" disabled={lastIssuedCredentials.length === 0}>
                    一覧をコピー
                  </button>
                </div>
              </div>
              {lastIssuedCredentials.length === 0 ? (
                <div className="text-sm text-slate-600">まだ発行済みアカウント情報はありません。</div>
              ) : (
                <div className="space-y-2">
                  {lastIssuedCredentials.map((row, index) => (
                    <div key={`${row.loginId}-${index}`} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                      <div className="font-semibold text-slate-900">{row.displayName}</div>
                      <div>クラス: {row.classId} / ログインID: {row.loginId}</div>
                      <div>初期パスワード: {row.password}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="soft-panel-muted space-y-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <div className="text-sm font-bold text-slate-800">生徒一覧</div>
                  <div className="text-xs text-slate-500">表示対象のクラスと検索語に合わせて一覧を絞り込めます。</div>
                </div>
                <div className="w-full md:max-w-[320px] space-y-2">
                  <label className="text-sm text-slate-700">検索</label>
                  <input className="form-input" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="氏名・かな・ログインID・クラスで検索" />
                </div>
              </div>

              {filteredStudents.length === 0 ? (
                <div className="text-sm text-slate-600">該当する生徒はまだ登録されていません。</div>
              ) : (
                <div className="space-y-2">
                  {filteredStudents.map((row) => {
                    const isEditing = editingUid === row.uid;
                    const fullName = buildDisplayName(String(row.last_name_kanji ?? ""), String(row.first_name_kanji ?? ""), row.display_name);
                    return (
                      <div key={row.uid} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div className="min-w-0 text-sm">
                            <div className="font-semibold text-slate-900">{fullName}</div>
                            <div className="text-slate-600">
                              ログインID: {row.login_id} / クラス: {row.class_id ?? "—"} / 出席番号: {row.attendance_number || "—"}
                            </div>
                            <div className="text-slate-500">
                              かな: {[row.last_name_kana, row.first_name_kana].filter(Boolean).join(" ") || "—"}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button className="subtle-button" onClick={() => beginEdit(row)} type="button">
                              {isEditing ? "編集中" : "編集"}
                            </button>
                            <button className="danger-button" onClick={() => submitDeleteStudent(row.uid)} type="button" disabled={busy}>
                              削除
                            </button>
                          </div>
                        </div>

                        {isEditing && (
                          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div className="space-y-2">
                              <label className="text-sm text-slate-700">所属クラス</label>
                              <input className="form-input" value={editClassId} onChange={(e) => setEditClassId(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                              <label className="text-sm text-slate-700">出席番号</label>
                              <input className="form-input" value={editAttendanceNumber} onChange={(e) => setEditAttendanceNumber(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                              <label className="text-sm text-slate-700">漢字姓</label>
                              <input className="form-input" value={editLastNameKanji} onChange={(e) => setEditLastNameKanji(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                              <label className="text-sm text-slate-700">漢字名</label>
                              <input className="form-input" value={editFirstNameKanji} onChange={(e) => setEditFirstNameKanji(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                              <label className="text-sm text-slate-700">ひらがな姓</label>
                              <input className="form-input" value={editLastNameKana} onChange={(e) => setEditLastNameKana(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                              <label className="text-sm text-slate-700">ひらがな名</label>
                              <input className="form-input" value={editFirstNameKana} onChange={(e) => setEditFirstNameKana(e.target.value)} />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                              <label className="text-sm text-slate-700">ログインID</label>
                              <input className="form-input" value={editLoginId} onChange={(e) => setEditLoginId(e.target.value)} />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                              <label className="text-sm text-slate-700">新しい初期パスワード（変更時のみ入力）</label>
                              <div className="flex gap-2">
                                <input className="form-input" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder="未入力なら変更しません" />
                                <button className="subtle-button shrink-0" onClick={() => setEditPassword(generateRandomPassword())} type="button">
                                  自動生成
                                </button>
                              </div>
                            </div>
                            <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                              表示名: {editDisplayName || "—"}
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
