// مخطط قاعدة البيانات مُضمَّنًا للتهيئة الذاتية عند أول تشغيل.
// مُولَّد من migrations/0001_init.sql — لا يُحرَّر يدويًا؛ عدّل ملف SQL ثم أعد التوليد.
// كل العبارات CREATE ... IF NOT EXISTS (آمنة للتكرار).

export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT    NOT NULL,
  email                TEXT    NOT NULL UNIQUE,
  password_hash        TEXT    NOT NULL,
  role                 TEXT    NOT NULL CHECK (role IN
                         ('president','vice_president','first_supervisor','team_member','system_admin')),
  stage                TEXT    CHECK (stage IN ('secondary','middle')),
  signature_image      TEXT,                       -- مفتاح R2 لصورة التوقيع
  color                TEXT,                       -- لون تمييز الشخص في المحاضر والمهام
  must_change_password INTEGER NOT NULL DEFAULT 1,  -- إلزام التغيير عند أول دخول
  is_active            INTEGER NOT NULL DEFAULT 1,  -- 0 = معلَّق (تعليق قابل للرجوع)
  suspended_at         TEXT,                       -- وقت التعليق
  suspended_reason     TEXT,                       -- سبب التعليق (يظهر في التدقيق)
  deleted_at           TEXT,                       -- حذف أرشيفي: يختفي من المنصة ويبقى في السجلات
  deleted_by           INTEGER REFERENCES users(id),
  deleted_email        TEXT,                       -- البريد الأصلي (يُحرَّر عند الحذف لإعادة الاستخدام)
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
)`,
  `CREATE INDEX IF NOT EXISTS idx_users_role  ON users(role)`,
  `CREATE INDEX IF NOT EXISTS idx_users_stage ON users(stage)`,
  `CREATE INDEX IF NOT EXISTS idx_users_deleted ON users(deleted_at)`,
  `CREATE TABLE IF NOT EXISTS user_role_periods (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT    NOT NULL,
  stage      TEXT,
  from_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  to_at      TEXT,                                 -- NULL = الفترة الجارية
  changed_by INTEGER REFERENCES users(id),
  note       TEXT
)`,
  `CREATE INDEX IF NOT EXISTS idx_role_periods_user ON user_role_periods(user_id)`,
  `CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT    PRIMARY KEY,        -- رمز الجلسة العشوائي
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  last_active  TEXT    NOT NULL DEFAULT (datetime('now')),
  ip           TEXT,
  user_agent   TEXT
)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS councils (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  type              TEXT    NOT NULL UNIQUE CHECK (type IN ('educational','secondary','middle')),
  number_prefix     TEXT    NOT NULL,        -- تربوي | ثانوي | متوسط  (لترقيم المحاضر)
  parent_id         INTEGER REFERENCES councils(id),
  default_writer_id INTEGER REFERENCES users(id),
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
)`,
  `CREATE TABLE IF NOT EXISTS council_members (
  council_id  INTEGER NOT NULL REFERENCES councils(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  position    TEXT    NOT NULL DEFAULT 'member' CHECK (position IN ('chair','member')),
  PRIMARY KEY (council_id, user_id)
)`,
  `CREATE INDEX IF NOT EXISTS idx_council_members_user ON council_members(user_id)`,
  `CREATE TABLE IF NOT EXISTS fixed_agenda_templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  council_id  INTEGER NOT NULL REFERENCES councils(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  body        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1
)`,
  `CREATE INDEX IF NOT EXISTS idx_fixed_templates_council ON fixed_agenda_templates(council_id)`,
  `CREATE TABLE IF NOT EXISTS meetings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  council_id     INTEGER NOT NULL REFERENCES councils(id),
  number         INTEGER NOT NULL,             -- تسلسل مستقل لكل مجلس/سنة هجرية
  hijri_year     INTEGER NOT NULL,
  display_number TEXT    NOT NULL,             -- مثل: تربوي/١٤٤٧/٠٠٣
  hijri_date     TEXT    NOT NULL,
  greg_date      TEXT    NOT NULL,
  start_time     TEXT,
  end_time       TEXT,
  location_type  TEXT    NOT NULL DEFAULT 'in_person' CHECK (location_type IN ('in_person','remote')),
  location       TEXT,                         -- المكان أو رابط الاجتماع
  title          TEXT,
  status         TEXT    NOT NULL DEFAULT 'invitation' CHECK (status IN
                   ('invitation','draft','awaiting_signatures','approved','archived','cancelled')),
  created_by     INTEGER NOT NULL REFERENCES users(id),
  writer_id      INTEGER REFERENCES users(id), -- كاتب هذا المحضر (يتجاوز الافتراضي)
  approved_at    TEXT,
  approved_by    INTEGER REFERENCES users(id),
  verify_code    TEXT,                         -- رمز تحقق فريد للمحضر (QR)
  cancel_reason  TEXT,
  parent_meeting_id INTEGER REFERENCES meetings(id), -- لمحاضر التصويب/الملحق
  academic_year  TEXT,                         -- السنة الدراسية (سياق)
  followups_frozen_at TEXT,                    -- وقت تجميد جدول المتابعة (عند الاعتماد)
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (council_id, hijri_year, number)
)`,
  `CREATE INDEX IF NOT EXISTS idx_meetings_council ON meetings(council_id)`,
  `CREATE INDEX IF NOT EXISTS idx_meetings_status  ON meetings(status)`,
  `CREATE TABLE IF NOT EXISTS meeting_attendees (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id        INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id           INTEGER REFERENCES users(id),
  is_guest          INTEGER NOT NULL DEFAULT 0,
  guest_name        TEXT,
  guest_title       TEXT,
  attendance_status TEXT NOT NULL DEFAULT 'present' CHECK (attendance_status IN ('present','apology','absent')),
  signed_at         TEXT,
  signature_hash    TEXT,                       -- رمز التحقق الفريد
  signature_override INTEGER NOT NULL DEFAULT 0, -- توقيع تجاوزه الرئيس
  override_reason   TEXT
)`,
  `CREATE INDEX IF NOT EXISTS idx_attendees_meeting ON meeting_attendees(meeting_id)`,
  `CREATE TABLE IF NOT EXISTS agenda_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id    INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  title         TEXT    NOT NULL,
  body          TEXT,
  item_type     TEXT    NOT NULL DEFAULT 'new' CHECK (item_type IN ('fixed','followup','new'))
)`,
  `CREATE INDEX IF NOT EXISTS idx_agenda_meeting ON agenda_items(meeting_id)`,
  `CREATE TABLE IF NOT EXISTS action_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  type              TEXT    NOT NULL CHECK (type IN ('decision','recommendation','task')),
  council_id        INTEGER NOT NULL REFERENCES councils(id),
  source_meeting_id INTEGER NOT NULL REFERENCES meetings(id),
  number            INTEGER NOT NULL,
  display_number    TEXT    NOT NULL,
  text              TEXT    NOT NULL,
  priority          TEXT    NOT NULL DEFAULT 'medium' CHECK (priority IN ('high','medium','low')),
  due_date          TEXT,
  status            TEXT    NOT NULL DEFAULT 'not_started' CHECK (status IN
                      ('not_started','in_progress','done','stalled','cancelled')),
  progress          INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  completed_at      TEXT,
  completed_by      INTEGER REFERENCES users(id),
  completion_note   TEXT,
  original_completed_at TEXT,                  -- التاريخ الأصلي قبل أي تعديل يدوي
  reported_done_meeting_id INTEGER REFERENCES meetings(id),
  first_due_date    TEXT,
  delay_days        INTEGER,
  carried_count     INTEGER NOT NULL DEFAULT 0,
  last_carried_meeting_id INTEGER REFERENCES meetings(id),
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (council_id, type, number)
)`,
  `CREATE INDEX IF NOT EXISTS idx_actions_council ON action_items(council_id)`,
  `CREATE INDEX IF NOT EXISTS idx_actions_meeting ON action_items(source_meeting_id)`,
  `CREATE INDEX IF NOT EXISTS idx_actions_status  ON action_items(status)`,
  `CREATE TABLE IF NOT EXISTS action_assignees (
  action_item_id INTEGER NOT NULL REFERENCES action_items(id) ON DELETE CASCADE,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (action_item_id, user_id)
)`,
  `CREATE INDEX IF NOT EXISTS idx_action_assignees_user ON action_assignees(user_id)`,
  `CREATE TABLE IF NOT EXISTS action_attachments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  action_item_id INTEGER NOT NULL REFERENCES action_items(id) ON DELETE CASCADE,
  r2_key         TEXT    NOT NULL,
  file_name      TEXT    NOT NULL,
  uploaded_by    INTEGER REFERENCES users(id),
  uploaded_at    TEXT    NOT NULL DEFAULT (datetime('now'))
)`,
  `CREATE TABLE IF NOT EXISTS students (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  national_id TEXT    NOT NULL UNIQUE,          -- المعرّف الفريد الدائم
  name        TEXT    NOT NULL,
  stage       TEXT    NOT NULL CHECK (stage IN ('secondary','middle')),
  grade       TEXT,
  class       TEXT,
  status      TEXT    NOT NULL DEFAULT 'active' CHECK (status IN
                ('active','transferred','withdrawn','graduated')),
  notes       TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
)`,
  `CREATE INDEX IF NOT EXISTS idx_students_stage ON students(stage)`,
  `CREATE TABLE IF NOT EXISTS student_transfers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  from_stage  TEXT,
  to_stage    TEXT,
  moved_by    INTEGER REFERENCES users(id),
  moved_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  note        TEXT
)`,
  `CREATE TABLE IF NOT EXISTS eval_cycles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  start_date   TEXT    NOT NULL,
  end_date     TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN
                 ('draft','open','closed','published')),
  target_types TEXT    NOT NULL,               -- CSV
  academic_year TEXT,                          -- السنة الدراسية (سياق)
  created_by   INTEGER NOT NULL REFERENCES users(id),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
)`,
  `CREATE TABLE IF NOT EXISTS eval_criteria (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_id    INTEGER REFERENCES eval_cycles(id) ON DELETE CASCADE, -- NULL = قالب مرجعي
  target_type TEXT    NOT NULL CHECK (target_type IN ('students','team_members','first_supervisors')),
  name        TEXT    NOT NULL,
  description TEXT,
  weight      REAL    NOT NULL DEFAULT 0,       -- نسبة مئوية
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1
)`,
  `CREATE INDEX IF NOT EXISTS idx_criteria_cycle ON eval_criteria(cycle_id, target_type)`,
  `CREATE TABLE IF NOT EXISTS evaluations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_id     INTEGER NOT NULL REFERENCES eval_cycles(id) ON DELETE CASCADE,
  evaluator_id INTEGER NOT NULL REFERENCES users(id),
  target_type  TEXT    NOT NULL CHECK (target_type IN ('students','team_members','first_supervisors')),
  target_id    INTEGER NOT NULL,               -- students.id أو users.id
  submitted_at TEXT,
  general_note TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (cycle_id, evaluator_id, target_type, target_id)
)`,
  `CREATE INDEX IF NOT EXISTS idx_eval_cycle_target ON evaluations(cycle_id, target_type, target_id)`,
  `CREATE INDEX IF NOT EXISTS idx_eval_evaluator ON evaluations(cycle_id, evaluator_id)`,
  `CREATE TABLE IF NOT EXISTS evaluation_scores (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  evaluation_id INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  criterion_id  INTEGER NOT NULL REFERENCES eval_criteria(id),
  score         INTEGER CHECK (score BETWEEN 1 AND 5),
  is_na         INTEGER NOT NULL DEFAULT 0,     -- لا ينطبق: يُستبعد ويُعاد توزيع وزنه
  note          TEXT,
  UNIQUE (evaluation_id, criterion_id)
)`,
  `CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT    NOT NULL,
  title      TEXT    NOT NULL,
  body       TEXT,
  link       TEXT,
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read)`,
  `CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id),
  action      TEXT    NOT NULL,
  entity_type TEXT,
  entity_id   INTEGER,
  old_value   TEXT,
  new_value   TEXT,
  ip          TEXT,
  timestamp   TEXT    NOT NULL DEFAULT (datetime('now'))
)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_user   ON audit_log(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_time   ON audit_log(timestamp)`,
  `CREATE TABLE IF NOT EXISTS settings (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  org_name       TEXT,
  header_text    TEXT,
  footer_text    TEXT,
  logo_key       TEXT,     -- R2
  watermark_key  TEXT,     -- R2
  primary_color  TEXT    DEFAULT '#1f6f54',
  font_family    TEXT    DEFAULT 'Tajawal',
  current_academic_year TEXT,                  -- السنة الدراسية الحالية
  push_public_key  TEXT,
  push_private_key TEXT,
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
)`,
  `CREATE TABLE IF NOT EXISTS meeting_comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  body       TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
)`,
  `CREATE INDEX IF NOT EXISTS idx_mcomments_meeting ON meeting_comments(meeting_id)`,
  `CREATE TABLE IF NOT EXISTS meeting_attachments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id  INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  r2_key      TEXT    NOT NULL,
  file_name   TEXT    NOT NULL,
  uploaded_by INTEGER REFERENCES users(id),
  uploaded_at TEXT    NOT NULL DEFAULT (datetime('now'))
)`,
  `CREATE INDEX IF NOT EXISTS idx_mattach_meeting ON meeting_attachments(meeting_id)`,
  `CREATE TABLE IF NOT EXISTS meeting_followups (
  meeting_id     INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  action_item_id INTEGER NOT NULL REFERENCES action_items(id) ON DELETE CASCADE,
  status         TEXT    NOT NULL,
  progress       INTEGER NOT NULL DEFAULT 0,
  due_date       TEXT,
  completed_at   TEXT,
  delay_days     INTEGER,
  is_final       INTEGER NOT NULL DEFAULT 0,   -- 1 = ظهور التوثيق الأخير بعد الإنجاز
  carried_index  INTEGER NOT NULL DEFAULT 1,   -- ترتيب هذا الترحيل للبند
  reconstructed  INTEGER NOT NULL DEFAULT 0,   -- 1 = صف أُعيد بناؤه لمحضر قديم (أثر رجعي)
  snapshot_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (meeting_id, action_item_id)
)`,
  `CREATE INDEX IF NOT EXISTS idx_mfollowups_action ON meeting_followups(action_item_id)`,
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint     TEXT    NOT NULL UNIQUE,
  p256dh       TEXT    NOT NULL,
  auth         TEXT    NOT NULL,
  user_agent   TEXT,
  is_standalone INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  fail_count   INTEGER NOT NULL DEFAULT 0
)`,
  `CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id)`,
];
