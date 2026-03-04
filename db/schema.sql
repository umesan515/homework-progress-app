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
  subject     text NOT NULL DEFAULT 'other',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX collections_name_uq ON collections(name);

CREATE TABLE books (
  id            text PRIMARY KEY,            -- Firestore bookId
  collection_id text REFERENCES collections(id) ON DELETE SET NULL,
  subject       text NOT NULL DEFAULT 'other',
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

-- =========================
-- Calendar: shared test events
-- =========================

CREATE TABLE IF NOT EXISTS test_events (
  id          text PRIMARY KEY,
  title       text NOT NULL,
  event_date  date NOT NULL,
  created_by  text REFERENCES users(uid) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 配信先クラス（ALLも扱う）
CREATE TABLE IF NOT EXISTS test_event_classes (
  event_id  text NOT NULL REFERENCES test_events(id) ON DELETE CASCADE,
  class_id  text NOT NULL,
  PRIMARY KEY (event_id, class_id)
);

CREATE INDEX IF NOT EXISTS test_event_classes_class_idx ON test_event_classes(class_id);
CREATE INDEX IF NOT EXISTS test_events_date_idx ON test_events(event_date);

-- ===== 問題集（教材）管理（追加） =====
-- 問題集（教材）管理の正規化スキーマ追加
-- 既存機能を壊さないため、既存テーブルは変更しない（追加のみ）


CREATE TABLE IF NOT EXISTS book_series (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  publisher   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS books (
  id          text PRIMARY KEY,
  series_id   text REFERENCES book_series(id) ON DELETE SET NULL,
  title       text NOT NULL,
  subject     text,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS book_editions (
  id            text PRIMARY KEY,
  book_id       text NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  edition_label text,
  published_on  date,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 章/節/単元/例題/演習などの階層ツリー
CREATE TABLE IF NOT EXISTS content_nodes (
  id         text PRIMARY KEY,
  book_id    text NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  parent_id  text REFERENCES content_nodes(id) ON DELETE CASCADE,
  node_type  text NOT NULL,
  title      text NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS content_nodes_book_idx ON content_nodes(book_id);
CREATE INDEX IF NOT EXISTS content_nodes_parent_idx ON content_nodes(parent_id);

-- 小問（問題番号）
CREATE TABLE IF NOT EXISTS problems (
  id           text PRIMARY KEY,
  book_id      text NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  node_id      text REFERENCES content_nodes(id) ON DELETE SET NULL,
  label        text NOT NULL,
  page         int,
  problem_type text,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS problems_book_idx ON problems(book_id);
CREATE INDEX IF NOT EXISTS problems_node_idx ON problems(node_id);

-- タグ（分野/典型/要復習など）
CREATE TABLE IF NOT EXISTS tags (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  category   text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tags_name_unique ON tags(name);

CREATE TABLE IF NOT EXISTS problem_tags (
  problem_id text NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  tag_id     text NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY(problem_id, tag_id)
);

-- テンプレと問題の紐づけ（将来的にテンプレ作成UIで利用）
CREATE TABLE IF NOT EXISTS template_problem_items (
  template_id text NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  problem_id  text NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  sort_order  int NOT NULL DEFAULT 0,
  PRIMARY KEY(template_id, problem_id)
);

CREATE INDEX IF NOT EXISTS template_problem_items_template_idx ON template_problem_items(template_id);


