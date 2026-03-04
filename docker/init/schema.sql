CREATE TABLE users (
  uid           text PRIMARY KEY,         -- Firebase UID（当面）
  role          text NOT NULL CHECK (role IN ('teacher','student')),
  class_id      text,
  display_name  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX users_class_id_idx ON users(class_id);

-- collections: 問題集シリーズ（4STEP / FocusGold / サクシード など）
CREATE TABLE collections (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX collections_name_uq ON collections(name);

CREATE TABLE books (
  id            text PRIMARY KEY,            -- Firestore bookId
  collection_id text REFERENCES collections(id) ON DELETE SET NULL,
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chapters (
  id          text PRIMARY KEY,            -- Firestore chapterId
  book_id     text NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  name        text NOT NULL,
  part        text,                        -- I / A / II / B / 未設定
  chapter_no  integer,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX chapters_book_idx ON chapters(book_id);

-- blocks: 章の中の全問表（番号＋属性）
CREATE TABLE blocks (
  id          text PRIMARY KEY,            -- Firestore blockId
  chapter_id  text NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  series      text NOT NULL CHECK (series IN ('problem','exercise','comprehensive')),
  zone        text NOT NULL,               -- 表示属性（例: STEPA / STEPB / 例題 / 練習 / StepUp / 章末 など）
  scope       text NOT NULL,               -- 番号の通しグループ（例: STEP(=STEPA+STEPB+応用) / 演習(=演習A+演習B) / zoneと同一でもOK）
  no          integer NOT NULL,            -- 問題番号（数字）
  label       text NOT NULL,               -- 現状「番号のみ」方針なら noと同じでもOK
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX blocks_chapter_idx ON blocks(chapter_id);
CREATE INDEX blocks_chapter_no_idx ON blocks(chapter_id, no);
CREATE INDEX blocks_chapter_series_idx ON blocks(chapter_id, series);
CREATE INDEX blocks_chapter_zone_idx ON blocks(chapter_id, zone);
CREATE INDEX blocks_chapter_scope_idx ON blocks(chapter_id, scope);

CREATE TABLE templates (
  id           text PRIMARY KEY,           -- Firestore templateId
  name         text NOT NULL,
  mode         text NOT NULL CHECK (mode IN ('book','manual')),
  created_by   text REFERENCES users(uid) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  -- bookテンプレ
  book_id      text REFERENCES books(id) ON DELETE SET NULL,
  chapter_id   text REFERENCES chapters(id) ON DELETE SET NULL,

  -- manualテンプレ（ラベル入力 or 件数）
  problem_count integer
);

-- bookテンプレは「選択したblockの集合」を持つ（多対多）
CREATE TABLE template_blocks (
  template_id  text NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  block_id     text NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
  PRIMARY KEY (template_id, block_id)
);

CREATE INDEX template_blocks_template_idx ON template_blocks(template_id);

CREATE TABLE assignments (
  id            text PRIMARY KEY,          -- Firestore assignmentId
  title         text NOT NULL,
  status        text NOT NULL CHECK (status IN ('open','closed','archived')),
  template_id   text REFERENCES templates(id) ON DELETE SET NULL,
  created_by    text REFERENCES users(uid) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  due_at        timestamptz,               -- NULLなら無期限

  -- book由来追跡（任意）
  book_id       text REFERENCES books(id) ON DELETE SET NULL,
  chapter_id    text REFERENCES chapters(id) ON DELETE SET NULL
);

-- どのクラスに配布したか（ALLも扱う）
CREATE TABLE assignment_classes (
  assignment_id text NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  class_id      text NOT NULL,
  PRIMARY KEY (assignment_id, class_id)
);

CREATE INDEX assignment_classes_class_idx ON assignment_classes(class_id);
CREATE INDEX assignments_created_at_idx ON assignments(created_at DESC);

CREATE TABLE assignment_problems (
  assignment_id text NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  label         text NOT NULL,             -- 例: "1" "2" …（表示用）
  block_id      text REFERENCES blocks(id) ON DELETE SET NULL,  -- book由来なら埋める
  sort_order    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (assignment_id, label)
);

CREATE INDEX assignment_problems_assignment_idx ON assignment_problems(assignment_id);

CREATE TABLE submissions (
  assignment_id text NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_uid   text NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, student_uid)
);

-- 1問ごとの記録（〇△✕＋入力時刻）
CREATE TABLE submission_marks (
  assignment_id text NOT NULL,
  student_uid   text NOT NULL,
  label         text NOT NULL,             -- 問題ラベル（"1"など）
  mark          text NOT NULL CHECK (mark IN ('maru','sankaku','batsu')),
  marked_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, student_uid, label),
  FOREIGN KEY (assignment_id, student_uid) REFERENCES submissions(assignment_id, student_uid) ON DELETE CASCADE
);

CREATE INDEX submission_marks_lookup_idx ON submission_marks(assignment_id, student_uid);
CREATE INDEX submission_marks_assignment_idx ON submission_marks(assignment_id);

