// lib/types.ts
export type UserRole = "teacher" | "student";

export type UserDoc = {
  role: UserRole;
  displayName?: string;
  classId?: string;
  studentNumber?: number;
  schoolYear?: number;
  createdAt?: unknown;
};

export type StatusValue = "none" | "maru" | "sankaku" | "batsu";

export type TemplateDoc = {
  ownerTeacherUid: string;
  title: string;
  book: string;
  unit: string;
  problemLabels: string[];
  version: number;
  isArchived: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type AssignmentDoc = {
  templateId: string;
  title: string;
  classIds: string[]; // まずは ["class_2A"] のように固定でOK
  dueAt?: unknown;    // まずは未使用でもOK
  createdBy: string;
  createdAt?: unknown;
  status: "open" | "closed";
  problemCount: number;
};

export type SubmissionDoc = {
  assignmentId: string;
  classId: string;
  studentUid: string;
  statusByLabel: Record<string, StatusValue>;
  lastChangedAt?: unknown;
};

export type SubmissionEventDoc = {
  label: string;
  from: StatusValue;
  to: StatusValue;
  changedAt?: unknown;  // serverTimestamp
  clientAt?: string;    // ISO string
};
