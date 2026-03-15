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
  classIds: string[];
  dueAt?: unknown;
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
  changedAt?: unknown;
  clientAt?: string;
};

export type MaterialType = "image" | "video" | "interactive" | "app";
export type InteractiveKind = "linear" | "parabola" | "bars";

export type MaterialRow = {
  id: string;
  title: string;
  description: string | null;
  subject: string;
  unit_name: string | null;
  grade_level: string | null;
  material_type: MaterialType;
  content_url: string | null;
  thumbnail_url: string | null;
  interactive_kind: InteractiveKind | null;
  interactive_config: Record<string, any> | null;
  is_published: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  class_ids: string[];
};

export type MaterialUploadResponse = {
  ok: true;
  url: string;
  filename: string;
  mimetype: string;
  size: number;
};
