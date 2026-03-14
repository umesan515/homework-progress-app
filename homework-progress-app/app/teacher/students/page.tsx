"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
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
  displayNameKana?: string;
  attendanceNumber?: string;
  source: "loginId" | "generated";
};

const ALL_CLASS = "ALL";
const DEFAULT_ID_PREFIX = "";

const COMMON_SURNAME_ROMAJI: Record<string, string> = {
  "田中": "tanaka",
  "佐藤": "satou",
  "鈴木": "suzuki",
  "高橋": "takahashi",
  "渡辺": "watanabe",
  "渡邊": "watanabe",
  "伊藤": "itou",
  "山本": "yamamoto",
  "中村": "nakamura",
  "小林": "kobayashi",
  "加藤": "katou",
  "吉田": "yoshida",
  "山田": "yamada",
  "佐々木": "sasaki",
  "山口": "yamaguchi",
  "松本": "matsumoto",
  "井上": "inoue",
  "木村": "kimura",
  "林": "hayashi",
  "斉藤": "saitou",
  "斎藤": "saitou",
  "齋藤": "saitou",
  "清水": "shimizu",
  "山崎": "yamazaki",
  "山﨑": "yamazaki",
  "阿部": "abe",
  "池田": "ikeda",
  "橋本": "hashimoto",
  "石川": "ishikawa",
  "前田": "maeda",
  "藤田": "fujita",
  "小川": "ogawa",
  "後藤": "gotou",
  "岡田": "okada",
  "長谷川": "hasegawa",
  "村上": "murakami",
  "近藤": "kondou",
  "石井": "ishii",
  "坂本": "sakamoto",
  "遠藤": "endou",
  "青木": "aoki",
  "藤井": "fujii",
  "西村": "nishimura",
  "福田": "fukuda",
  "太田": "oota",
  "大田": "oota",
  "三浦": "miura",
  "藤原": "fujiwara",
  "岡本": "okamoto",
  "松田": "matsuda",
  "中島": "nakajima",
  "中野": "nakano",
  "原田": "harada",
  "小野": "ono",
  "田村": "tamura",
  "竹内": "takeuchi",
  "金子": "kaneko",
  "和田": "wada",
  "中川": "nakagawa",
};

function splitCsvLine(line: string): string[] {
  return line
    .replaceAll("，", ",")
    .split(",")
    .map((part) => part.trim().replace(/^"(.*)"$/, "$1"));
}

function normalizeBulkSourceText(text: string): string {
  return text.replace(/^\ufeff/, "").replace(/\r\n/g, "\n");
}

function countMojibakeIndicators(text: string): number {
  return (text.match(/[�Ã¢ã]/g) ?? []).length;
}

function decodeCsvArrayBuffer(buffer: ArrayBuffer): string {
  const encodings = ["utf-8", "shift_jis"] as const;
  const candidates = encodings.map((encoding) => {
    try {
      const decoded = new TextDecoder(encoding).decode(buffer);
      return { encoding, decoded, score: countMojibakeIndicators(decoded) };
    } catch {
      return { encoding, decoded: "", score: Number.MAX_SAFE_INTEGER };
    }
  });
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0]?.decoded ?? "";
}

function sanitizeIdToken(token: string): string {
  return token.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeClassToken(classId: string): string {
  return classId
    .trim()
    .toLowerCase()
    .replace(/[\s　]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeAttendanceToken(value: string): string {
  const digits = value.trim().replace(/[^0-9]/g, "");
  if (!digits) return "";
  const n = Number(digits);
  if (!Number.isFinite(n)) return "";
  return String(Math.trunc(n)).padStart(2, "0");
}

function toKatakana(value: string): string {
  return value.replace(/[ぁ-ゖ]/g, (s) => String.fromCharCode(s.charCodeAt(0) + 0x60));
}

function kanaToRomaji(value: string): string {
  const text = toKatakana(value);
  const digraphMap: Record<string, string> = {
    キャ: "kya", キュ: "kyu", キョ: "kyo",
    シャ: "sha", シュ: "shu", ショ: "sho",
    チャ: "cha", チュ: "chu", チョ: "cho",
    ニャ: "nya", ニュ: "nyu", ニョ: "nyo",
    ヒャ: "hya", ヒュ: "hyu", ヒョ: "hyo",
    ミャ: "mya", ミュ: "myu", ミョ: "myo",
    リャ: "rya", リュ: "ryu", リョ: "ryo",
    ギャ: "gya", ギュ: "gyu", ギョ: "gyo",
    ジャ: "ja", ジュ: "ju", ジョ: "jo",
    ビャ: "bya", ビュ: "byu", ビョ: "byo",
    ピャ: "pya", ピュ: "pyu", ピョ: "pyo",
  };
  const monoMap: Record<string, string> = {
    ア: "a", イ: "i", ウ: "u", エ: "e", オ: "o",
    カ: "ka", キ: "ki", ク: "ku", ケ: "ke", コ: "ko",
    サ: "sa", シ: "shi", ス: "su", セ: "se", ソ: "so",
    タ: "ta", チ: "chi", ツ: "tsu", テ: "te", ト: "to",
    ナ: "na", ニ: "ni", ヌ: "nu", ネ: "ne", ノ: "no",
    ハ: "ha", ヒ: "hi", フ: "fu", ヘ: "he", ホ: "ho",
    マ: "ma", ミ: "mi", ム: "mu", メ: "me", モ: "mo",
    ヤ: "ya", ユ: "yu", ヨ: "yo",
    ラ: "ra", リ: "ri", ル: "ru", レ: "re", ロ: "ro",
    ワ: "wa", ヲ: "wo", ン: "n",
    ガ: "ga", ギ: "gi", グ: "gu", ゲ: "ge", ゴ: "go",
    ザ: "za", ジ: "ji", ズ: "zu", ゼ: "ze", ゾ: "zo",
    ダ: "da", ヂ: "ji", ヅ: "zu", デ: "de", ド: "do",
    バ: "ba", ビ: "bi", ブ: "bu", ベ: "be", ボ: "bo",
    パ: "pa", ピ: "pi", プ: "pu", ペ: "pe", ポ: "po",
    ァ: "a", ィ: "i", ゥ: "u", ェ: "e", ォ: "o",
    ー: "-",
  };

  let result = "";
  let geminate = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "ッ") {
      geminate = true;
      continue;
    }
    const pair = text.slice(i, i + 2);
    let chunk = digraphMap[pair];
    if (chunk) {
      i += 1;
    } else {
      chunk = monoMap[char] ?? "";
    }
    if (!chunk) continue;
    if (chunk === "-") {
      if (/[aeiou]$/.test(result)) result += result.slice(-1);
      continue;
    }
    if (geminate) {
      chunk = `${chunk[0] || ""}${chunk}`;
      geminate = false;
    }
    result += chunk;
  }
  return sanitizeIdToken(result);
}

function firstSurnameToken(displayName: string): string {
  const normalized = displayName.trim().replace(/[　]+/g, " ");
  if (!normalized) return "";
  return normalized.split(" ")[0] ?? "";
}

function surnameToIdToken(displayName: string): string {
  const surname = firstSurnameToken(displayName);
  if (!surname) return "";
  const ascii = sanitizeIdToken(surname);
  if (ascii) return ascii;
  const mapped = COMMON_SURNAME_ROMAJI[surname];
  if (mapped) return sanitizeIdToken(mapped);
  const kana = kanaToRomaji(surname);
  if (kana) return kana;
  return "";
}

function buildGeneratedLoginId(prefix: string, classId: string, attendanceNumber: string, displayName = ""): string {
  const explicitPrefix = sanitizeIdToken(prefix);
  const baseToken = explicitPrefix || surnameToIdToken(displayName);
  const classToken = normalizeClassToken(classId);
  const attendanceToken = normalizeAttendanceToken(attendanceNumber);
  if (!baseToken || !classToken || !attendanceToken) return "";
  return `${baseToken}${classToken}${attendanceToken}`;
}

function isLikelyHeaderRow(cols: string[]): boolean {
  const compact = cols.map((col) => col.replace(/[\s_"']/g, "").toLowerCase());
  return compact.some((col) =>
    [
      "loginid",
      "login",
      "userid",
      "studentid",
      "displayname",
      "displaynamekana",
      "kananame",
      "name",
      "attendancenumber",
      "number",
      "shussekibangou",
      "出席番号",
      "氏名",
      "名前",
      "生徒id",
      "ログインid",
    ].includes(col)
  );
}

function parseBulkStudents(text: string, classId: string, idPrefix: string): BulkParsedRow[] {
  const lines = text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const firstCols = splitCsvLine(lines[0]);
  const hasHeader = isLikelyHeaderRow(firstCols);

  const rows: BulkParsedRow[] = [];
  if (hasHeader) {
    const headers = firstCols.map((col) => col.replace(/[\s_"']/g, "").toLowerCase());
    const loginIndex = headers.findIndex((col) => ["loginid", "login", "userid", "studentid", "生徒id", "ログインid", "mail", "email", "メールアドレス"].includes(col));
    const displayIndex = headers.findIndex((col) => ["displayname", "name", "氏名", "名前", "漢字氏名"].includes(col));
    const displayKanaIndex = headers.findIndex((col) => ["displaynamekana", "kananame", "かな氏名", "ひらがなしめい", "ひらがな氏名", "ふりがな"].includes(col));
    const attendanceIndex = headers.findIndex((col) => ["attendancenumber", "number", "shussekibangou", "出席番号"].includes(col));

    for (const line of lines.slice(1)) {
      const cols = splitCsvLine(line);
      const rawLoginId = loginIndex >= 0 ? (cols[loginIndex] ?? "").trim() : "";
      const displayName = displayIndex >= 0 ? (cols[displayIndex] ?? "").trim() : "";
      const displayNameKana = displayKanaIndex >= 0 ? (cols[displayKanaIndex] ?? "").trim() : "";
      const attendanceNumber = attendanceIndex >= 0 ? normalizeAttendanceToken(cols[attendanceIndex] ?? "") : "";
      const generatedLoginId = rawLoginId || buildGeneratedLoginId(idPrefix, classId, attendanceNumber, displayName);
      if (!generatedLoginId) continue;
      rows.push({
        loginId: generatedLoginId,
        displayName: displayName || generatedLoginId,
        displayNameKana,
        attendanceNumber,
        source: rawLoginId ? "loginId" : "generated",
      });
    }
    return rows;
  }

  for (const line of lines) {
    const cols = splitCsvLine(line);
    const first = cols[0] ?? "";
    const second = cols[1] ?? "";
    const third = cols[2] ?? "";

    if (/^\d+$/.test(first) && second) {
      const attendanceNumber = normalizeAttendanceToken(first);
      const displayName = second.trim();
      const hasFourColumns = cols.length >= 4;
      const displayNameKana = hasFourColumns ? third.trim() : cols.length >= 3 && !third.includes("@") ? third.trim() : "";
      const rawLoginId = hasFourColumns ? (cols[3] ?? "").trim() : cols.length >= 3 && third.includes("@") ? third.trim() : "";
      const generatedLoginId = rawLoginId || buildGeneratedLoginId(idPrefix, classId, attendanceNumber, displayName);
      if (!generatedLoginId) continue;
      rows.push({
        loginId: generatedLoginId,
        displayName: displayName || generatedLoginId,
        displayNameKana,
        attendanceNumber,
        source: rawLoginId ? "loginId" : "generated",
      });
      continue;
    }

    const loginId = first.trim();
    const displayName = cols.slice(1).join(",").trim();
    if (!loginId) continue;
    rows.push({ loginId, displayName: displayName || loginId, source: "loginId" });
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
  const [createAttendanceNumber, setCreateAttendanceNumber] = useState("");
  const [createIdPrefix, setCreateIdPrefix] = useState("");
  const [showCreatePassword, setShowCreatePassword] = useState(false);

  const [bulkClassId, setBulkClassId] = useState("");
  const [bulkPassword, setBulkPassword] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [bulkIdPrefix, setBulkIdPrefix] = useState("");
  const [showBulkPassword, setShowBulkPassword] = useState(false);
  const [bulkSourceFileName, setBulkSourceFileName] = useState("");
  const bulkFileInputRef = useRef<HTMLInputElement | null>(null);

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

  const bulkRows = useMemo(() => parseBulkStudents(bulkText, bulkClassId, bulkIdPrefix), [bulkClassId, bulkIdPrefix, bulkText]);
  const duplicateBulkLoginIds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of bulkRows) {
      counts.set(row.loginId, (counts.get(row.loginId) ?? 0) + 1);
    }
    return new Set(Array.from(counts.entries()).filter(([, count]) => count > 1).map(([loginId]) => loginId));
  }, [bulkRows]);

  const bulkExplicitLoginIdCount = useMemo(() => bulkRows.filter((row) => row.source === "loginId").length, [bulkRows]);
  const bulkUsesMixedLoginPolicy = bulkRows.length > 0 && bulkExplicitLoginIdCount > 0 && bulkExplicitLoginIdCount < bulkRows.length;
  const existingLoginIds = useMemo(() => new Set(students.map((row) => row.login_id)), [students]);

  const generatedCreateLoginId = useMemo(() => {
    if (createLoginId.trim()) return createLoginId.trim();
    return buildGeneratedLoginId(createIdPrefix, createClassId, createAttendanceNumber, createDisplayName);
  }, [createAttendanceNumber, createClassId, createDisplayName, createIdPrefix, createLoginId]);

  const classCount = classes.length;
  const studentCount = students.length;

  const resetCreateForm = () => {
    setCreateLoginId("");
    setCreateDisplayName("");
    setCreatePassword("");
    setCreateClassId(selectedClass !== ALL_CLASS ? selectedClass : "");
    setCreateAttendanceNumber("");
    setCreateIdPrefix("");
    setShowCreatePassword(false);
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
    const loginId = generatedCreateLoginId.trim();
    const displayName = createDisplayName.trim();
    const password = createPassword;
    const classId = createClassId.trim();

    if (!displayName) {
      setErr("表示名を入力してください。");
      return;
    }
    if (!password || !classId) {
      setErr("クラスと初期パスワードを入力してください。");
      return;
    }
    if (!loginId) {
      setErr("生徒IDを直接入力するか、接頭辞または氏名・クラス・出席番号から自動生成できるように入力してください。");
      return;
    }

    setBusy(true);
    setErr(null);
    setOkMsg(null);
    try {
      await apiPost("/teacher/students", {
        loginId,
        displayName,
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

  const onBulkCsvSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const decoded = decodeCsvArrayBuffer(buffer);
      const normalized = normalizeBulkSourceText(decoded);
      setBulkText(normalized);
      setBulkSourceFileName(file.name);
      setOkMsg(`CSVファイル ${file.name} を読み込みました。`);
      setErr(null);
    } catch (e: any) {
      setErr(String(e?.message ?? "CSVファイルの読み込みに失敗しました。"));
    } finally {
      event.target.value = "";
    }
  };

  const downloadBulkCsvTemplate = () => {
    const csv = "attendanceNumber,displayName,displayNameKana\n1,田中 太郎,たなか たろう\n2,佐藤 花子,さとう はなこ\n3,山本 葵,やまもと あおい\n";
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "student_import_template.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
    if (bulkUsesMixedLoginPolicy) {
      setErr("メールアドレスなど loginId を使う場合は、一括登録の全員に loginId 列を入力してください。自動生成と混在はできません。");
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
      setBulkSourceFileName("");
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
                  <label className="text-sm text-slate-700">ID接頭辞（任意）</label>
                  <input
                    className="form-input"
                    value={bulkIdPrefix}
                    onChange={(e) => setBulkIdPrefix(e.target.value)}
                    placeholder="空欄なら姓から自動生成"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-slate-700">共通初期パスワード</label>
                  <div className="flex gap-2">
                    <input
                      className="form-input"
                      type={showBulkPassword ? "text" : "password"}
                      value={bulkPassword}
                      onChange={(e) => setBulkPassword(e.target.value)}
                      placeholder="全員に設定する初期パスワード"
                    />
                    <button
                      className="subtle-button shrink-0"
                      onClick={() => setShowBulkPassword((prev) => !prev)}
                      type="button"
                    >
                      {showBulkPassword ? "非表示" : "表示"}
                    </button>
                  </div>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm text-slate-700">CSV読込</label>
                  <input
                    ref={bulkFileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    onChange={onBulkCsvSelected}
                    className="hidden"
                  />
                  <div className="flex flex-col gap-2 md:flex-row md:items-center">
                    <button className="subtle-button" onClick={() => bulkFileInputRef.current?.click()} type="button">
                      CSVファイルを選択
                    </button>
                    <button className="subtle-button" onClick={downloadBulkCsvTemplate} type="button">
                      テンプレートCSVを保存
                    </button>
                  </div>
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-600">
                    {bulkSourceFileName ? `選択中のCSV: ${bulkSourceFileName}` : "attendanceNumber,displayName,displayNameKana のCSVを選ぶと、自動で下欄へ反映します。"}
                  </div>
                  <div className="text-xs text-slate-500">
                    Excelで保存したCSVの文字化けを減らすため、UTF-8 と Shift_JIS の両方を考慮して読み込みます。基本の列は「出席番号・漢字氏名・ひらがな氏名」です。メールアドレスを使う場合は 4 列目 loginId を一括登録する全員に入れてください。
                  </div>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm text-slate-700">読込内容（自動入力後にそのまま確認・修正できます）</label>
                  <textarea
                    className="form-input min-h-[160px]"
                    value={bulkText}
                    onChange={(e) => setBulkText(e.target.value)}
                    placeholder={`例1: 姓から自動生成
attendanceNumber,displayName,displayNameKana
1,田中 太郎,たなか たろう
2,佐藤 花子,さとう はなこ

例2: 接頭辞を使って自動生成
attendanceNumber,displayName,displayNameKana
1,田中 太郎,たなか たろう
2,佐藤 花子,さとう はなこ

例3: メールアドレスを一括指定
attendanceNumber,displayName,displayNameKana,loginId
1,田中 太郎,たなか たろう,tanaka@example.ed.jp
2,佐藤 花子,さとう はなこ,satou@example.ed.jp`}
                  />
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 space-y-1">
                <div>入力行数: {bulkRows.length} 件</div>
                <div>自動生成IDの例: {buildGeneratedLoginId(bulkIdPrefix, bulkClassId || "1A", "1", "田中 太郎") || "tanaka1a01"}</div>
                <div>重複ID: {duplicateBulkLoginIds.size > 0 ? Array.from(duplicateBulkLoginIds).join(", ") : "なし"}</div>
                <div>
                  既存IDとの重複候補: {
                    bulkRows
                      .map((row) => row.loginId)
                      .filter((loginId, index, arr) => arr.indexOf(loginId) === index && existingLoginIds.has(loginId))
                      .join(", ") || "なし"
                  }
                </div>
                <div className="text-xs text-slate-500">
                  接頭辞は任意です。入力した場合は「接頭辞 + クラス + 2桁の出席番号」で登録します。空欄なら氏名の姓から生成します。出席番号は 1 桁でも 01 のように 2 桁で登録します。loginId 列を使う場合は全員分を入力してください。
                </div>
              </div>
              {bulkRows.length > 0 && (
                <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">出席番号</th>
                        <th className="px-3 py-2 text-left font-semibold">漢字氏名</th>
                        <th className="px-3 py-2 text-left font-semibold">ひらがな氏名</th>
                        <th className="px-3 py-2 text-left font-semibold">登録される生徒ID</th>
                        <th className="px-3 py-2 text-left font-semibold">生成方法</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkRows.slice(0, 8).map((row, index) => (
                        <tr key={`${row.loginId}-${index}`} className="border-t border-slate-100">
                          <td className="px-3 py-2 text-slate-700">{row.attendanceNumber || "-"}</td>
                          <td className="px-3 py-2 text-slate-700">{row.displayName}</td>
                          <td className="px-3 py-2 text-slate-700">{row.displayNameKana || "-"}</td>
                          <td className="px-3 py-2 font-medium text-slate-900">{row.loginId}</td>
                          <td className="px-3 py-2 text-slate-600">{row.source === "generated" ? "自動生成" : "CSV指定"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {bulkRows.length > 8 && <div className="px-3 py-2 text-xs text-slate-500">先頭8件のみ表示しています。</div>}
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
                  <label className="text-sm text-slate-700">表示名</label>
                  <input className="form-input" value={createDisplayName} onChange={(e) => setCreateDisplayName(e.target.value)} placeholder="例: 田中 太郎" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-slate-700">所属クラス</label>
                  <input className="form-input" value={createClassId} onChange={(e) => setCreateClassId(e.target.value)} placeholder="例: 1A" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-slate-700">ID接頭辞（任意）</label>
                  <input className="form-input" value={createIdPrefix} onChange={(e) => setCreateIdPrefix(e.target.value)} placeholder="空欄なら姓から自動生成" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-slate-700">出席番号</label>
                  <input
                    className="form-input"
                    value={createAttendanceNumber}
                    onChange={(e) => setCreateAttendanceNumber(e.target.value)}
                    placeholder="例: 1"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm text-slate-700">生徒ID</label>
                  <input
                    className="form-input"
                    value={createLoginId}
                    onChange={(e) => setCreateLoginId(e.target.value)}
                    placeholder="空欄なら接頭辞または氏名・クラス・出席番号から自動生成"
                  />
                  <div className="text-xs text-slate-500">登録される生徒ID: {generatedCreateLoginId || "未生成"}（接頭辞が空欄なら姓から生成、出席番号は 2 桁化）</div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-slate-700">初期パスワード</label>
                  <div className="flex gap-2">
                    <input
                      className="form-input"
                      type={showCreatePassword ? "text" : "password"}
                      value={createPassword}
                      onChange={(e) => setCreatePassword(e.target.value)}
                      placeholder="初期パスワード"
                    />
                    <button
                      className="subtle-button shrink-0"
                      onClick={() => setShowCreatePassword((prev) => !prev)}
                      type="button"
                    >
                      {showCreatePassword ? "非表示" : "表示"}
                    </button>
                  </div>
                </div>
              </div>
              <div className="text-xs text-slate-500">
                接頭辞は任意です。入力した場合は {buildGeneratedLoginId("prefix", "1A", "1", "田中 太郎") || "prefix1a01"}、空欄なら {buildGeneratedLoginId("", "1A", "1", "田中 太郎") || "tanaka1a01"} のように生成します。出席番号は 1 でも 01 として登録します。
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
