-- ============================================================
-- منصة المجلس التربوي — المخطط الكامل لقاعدة البيانات (D1 / SQLite)
-- المرحلة ١: الأساس — كل الكيانات معرّفة هنا حتى تبني المراحل التالية فوقها.
-- ============================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- المستخدمون
-- role: president | vice_president | first_supervisor | team_member | system_admin
-- stage: secondary | middle | NULL  (للمشرف الأول وعضو الفريق)
-- ------------------------------------------------------------
CREATE TABLE users (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT    NOT NULL,
  email                TEXT    NOT NULL UNIQUE,
  password_hash        TEXT    NOT NULL,
  role                 TEXT    NOT NULL CHECK (role IN
                         ('president','vice_president','first_supervisor','team_member','system_admin')),
  stage                TEXT    CHECK (stage IN ('secondary','middle')),
  signature_image      TEXT,                       -- مفتاح R2 لصورة التوقيع
  must_change_password INTEGER NOT NULL DEFAULT 1,  -- إلزام التغيير عند أول دخول
  is_active            INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_users_role  ON users(role);
CREATE INDEX idx_users_stage ON users(stage);

-- ------------------------------------------------------------
-- الجلسات (مصادقة قائمة على رمز في كوكي httpOnly، خمول ٨ ساعات)
-- ------------------------------------------------------------
CREATE TABLE sessions (
  id           TEXT    PRIMARY KEY,        -- رمز الجلسة العشوائي
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  last_active  TEXT    NOT NULL DEFAULT (datetime('now')),
  ip           TEXT,
  user_agent   TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- ------------------------------------------------------------
-- المجالس
-- type: educational (التربوي) | secondary (الثانوية) | middle (المتوسطة)
-- parent_id: للربط الهرمي (مجالس المراحل تحت التربوي منطقياً — اختياري)
-- default_writer_id: الكاتب الافتراضي الدائم لمحاضر هذا المجلس
-- ------------------------------------------------------------
CREATE TABLE councils (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  type              TEXT    NOT NULL UNIQUE CHECK (type IN ('educational','secondary','middle')),
  number_prefix     TEXT    NOT NULL,        -- تربوي | ثانوي | متوسط  (لترقيم المحاضر)
  parent_id         INTEGER REFERENCES councils(id),
  default_writer_id INTEGER REFERENCES users(id),
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- عضوية المجالس  (position: chair | member)
CREATE TABLE council_members (
  council_id  INTEGER NOT NULL REFERENCES councils(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  position    TEXT    NOT NULL DEFAULT 'member' CHECK (position IN ('chair','member')),
  PRIMARY KEY (council_id, user_id)
);
CREATE INDEX idx_council_members_user ON council_members(user_id);

-- ------------------------------------------------------------
-- قوالب البنود الثابتة لكل مجلس (تظهر تلقائياً في كل محضر جديد)
-- ------------------------------------------------------------
CREATE TABLE fixed_agenda_templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  council_id  INTEGER NOT NULL REFERENCES councils(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  body        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_fixed_templates_council ON fixed_agenda_templates(council_id);

-- ------------------------------------------------------------
-- المحاضر
-- status: invitation | draft | awaiting_signatures | approved | archived | cancelled
-- ------------------------------------------------------------
CREATE TABLE meetings (
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
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (council_id, hijri_year, number)
);
CREATE INDEX idx_meetings_council ON meetings(council_id);
CREATE INDEX idx_meetings_status  ON meetings(status);

-- الحضور والتواقيع
-- attendance_status: present | apology | absent  |  الضيف: is_guest=1
CREATE TABLE meeting_attendees (
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
);
CREATE INDEX idx_attendees_meeting ON meeting_attendees(meeting_id);

-- بنود المحضر
-- item_type: fixed | followup | new
CREATE TABLE agenda_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id    INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  title         TEXT    NOT NULL,
  body          TEXT,
  item_type     TEXT    NOT NULL DEFAULT 'new' CHECK (item_type IN ('fixed','followup','new'))
);
CREATE INDEX idx_agenda_meeting ON agenda_items(meeting_id);

-- ------------------------------------------------------------
-- القرارات والتوصيات والمهام (كيان مستقل)
-- type: decision | recommendation | task
-- status: not_started | in_progress | done | stalled | cancelled
-- ------------------------------------------------------------
CREATE TABLE action_items (
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
  -- المحضر الذي ظهرت فيه المهمة كمنجزة (لتختفي من جدول المتابعة بعده)
  reported_done_meeting_id INTEGER REFERENCES meetings(id),
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (council_id, type, number)
);
CREATE INDEX idx_actions_council ON action_items(council_id);
CREATE INDEX idx_actions_meeting ON action_items(source_meeting_id);
CREATE INDEX idx_actions_status  ON action_items(status);

CREATE TABLE action_assignees (
  action_item_id INTEGER NOT NULL REFERENCES action_items(id) ON DELETE CASCADE,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (action_item_id, user_id)
);
CREATE INDEX idx_action_assignees_user ON action_assignees(user_id);

-- مرفقات إثبات الإنجاز (مفاتيح R2)
CREATE TABLE action_attachments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  action_item_id INTEGER NOT NULL REFERENCES action_items(id) ON DELETE CASCADE,
  r2_key         TEXT    NOT NULL,
  file_name      TEXT    NOT NULL,
  uploaded_by    INTEGER REFERENCES users(id),
  uploaded_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- سجل الطلاب
-- status: active | transferred | withdrawn | graduated
-- ------------------------------------------------------------
CREATE TABLE students (
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
);
CREATE INDEX idx_students_stage ON students(stage);

-- سجل نقل الطلاب بين المراحل (الاحتفاظ بالسجل التاريخي)
CREATE TABLE student_transfers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  from_stage  TEXT,
  to_stage    TEXT,
  moved_by    INTEGER REFERENCES users(id),
  moved_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  note        TEXT
);

-- ------------------------------------------------------------
-- التقييم التربوي
-- target_types (في الدورة): CSV مثل "students,team_members,first_supervisors"
-- status: draft | open | closed | published
-- ------------------------------------------------------------
CREATE TABLE eval_cycles (
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
);

-- معايير التقييم — تُنسخ داخل الدورة عند فتحها (cycle_id يثبّتها)
-- target_type: students | team_members | first_supervisors
CREATE TABLE eval_criteria (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_id    INTEGER REFERENCES eval_cycles(id) ON DELETE CASCADE, -- NULL = قالب مرجعي
  target_type TEXT    NOT NULL CHECK (target_type IN ('students','team_members','first_supervisors')),
  name        TEXT    NOT NULL,
  description TEXT,
  weight      REAL    NOT NULL DEFAULT 0,       -- نسبة مئوية
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_criteria_cycle ON eval_criteria(cycle_id, target_type);

-- تقييم واحد = مقيِّم واحد لمُقيَّم واحد في دورة
CREATE TABLE evaluations (
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
);
CREATE INDEX idx_eval_cycle_target ON evaluations(cycle_id, target_type, target_id);
CREATE INDEX idx_eval_evaluator ON evaluations(cycle_id, evaluator_id);

CREATE TABLE evaluation_scores (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  evaluation_id INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  criterion_id  INTEGER NOT NULL REFERENCES eval_criteria(id),
  score         INTEGER CHECK (score BETWEEN 1 AND 5),
  is_na         INTEGER NOT NULL DEFAULT 0,     -- لا ينطبق: يُستبعد ويُعاد توزيع وزنه
  note          TEXT,
  UNIQUE (evaluation_id, criterion_id)
);

-- ------------------------------------------------------------
-- الإشعارات
-- ------------------------------------------------------------
CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT    NOT NULL,
  title      TEXT    NOT NULL,
  body       TEXT,
  link       TEXT,
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);

-- ------------------------------------------------------------
-- سجل التدقيق الشامل
-- ------------------------------------------------------------
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id),
  action      TEXT    NOT NULL,
  entity_type TEXT,
  entity_id   INTEGER,
  old_value   TEXT,
  new_value   TEXT,
  ip          TEXT,
  timestamp   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_user   ON audit_log(user_id);
CREATE INDEX idx_audit_time   ON audit_log(timestamp);

-- ------------------------------------------------------------
-- إعدادات المنصة والهوية البصرية (صف واحد)
-- ------------------------------------------------------------
CREATE TABLE settings (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  org_name       TEXT,
  header_text    TEXT,
  footer_text    TEXT,
  logo_key       TEXT,     -- R2
  watermark_key  TEXT,     -- R2
  primary_color  TEXT    DEFAULT '#1f6f54',
  font_family    TEXT    DEFAULT 'Tajawal',
  current_academic_year TEXT,                  -- السنة الدراسية الحالية
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- توسعة: تعليقات المحضر، مرفقات المحضر، والسنة الدراسية
-- ============================================================

-- تعليقات/مناقشة على مسودة المحضر قبل الاعتماد
CREATE TABLE meeting_comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  body       TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_mcomments_meeting ON meeting_comments(meeting_id);

-- مرفقات على مستوى المحضر نفسه (مفاتيح R2)
CREATE TABLE meeting_attachments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id  INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  r2_key      TEXT    NOT NULL,
  file_name   TEXT    NOT NULL,
  uploaded_by INTEGER REFERENCES users(id),
  uploaded_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_mattach_meeting ON meeting_attachments(meeting_id);
