// ترقيات تدريجية للقواعد القائمة. آمنة للتكرار: نتجاهل خطأ العمود الموجود.
import type { Env } from '../types';

const COLUMN_ADDS = [
  "ALTER TABLE meetings ADD COLUMN academic_year TEXT",
  "ALTER TABLE eval_cycles ADD COLUMN academic_year TEXT",
  "ALTER TABLE settings ADD COLUMN current_academic_year TEXT",
  // دورة حياة المستخدم: التعليق والحذف الأرشيفي
  "ALTER TABLE users ADD COLUMN suspended_at TEXT",
  "ALTER TABLE users ADD COLUMN suspended_reason TEXT",
  "ALTER TABLE users ADD COLUMN deleted_at TEXT",
  "ALTER TABLE users ADD COLUMN deleted_by INTEGER",
  "ALTER TABLE users ADD COLUMN deleted_email TEXT",
  // قياس الالتزام على بنود القرارات/المهام + سجل ترحيل المتابعة
  "ALTER TABLE action_items ADD COLUMN first_due_date TEXT",
  "ALTER TABLE action_items ADD COLUMN delay_days INTEGER",
  "ALTER TABLE action_items ADD COLUMN carried_count INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE action_items ADD COLUMN last_carried_meeting_id INTEGER",
  "ALTER TABLE meetings ADD COLUMN followups_frozen_at TEXT",
  // مفاتيح إشعارات الدفع (تُولَّد مرة إن لم تُضبط كأسرار بيئة)
  "ALTER TABLE settings ADD COLUMN push_public_key TEXT",
  "ALTER TABLE settings ADD COLUMN push_private_key TEXT",
  // لون تمييز الشخص في جداول المحاضر والمهام
  "ALTER TABLE users ADD COLUMN color TEXT",
  // منشئ البند — المهمة المستقلة (بلا محضر) يديرها منشئها
  "ALTER TABLE action_items ADD COLUMN created_by INTEGER",
];

/**
 * إضافة الأعمدة الناقصة للجداول القائمة.
 * تُنفَّذ **قبل** إنشاء المخطط: فـ CREATE TABLE IF NOT EXISTS لا يعدّل جدولًا قائمًا،
 * وأي فهرس جديد على عمود جديد سيفشل ما لم يُضَف العمود أولًا.
 */
export async function addMissingColumns(env: Env): Promise<void> {
  for (const sql of COLUMN_ADDS) {
    try { await env.DB.prepare(sql).run(); }
    catch { /* العمود موجود مسبقًا أو الجدول لم يُنشأ بعد — تجاهُل مقصود */ }
  }
}

/**
 * تعبئة فترة الدور الجارية لكل مستخدم بلا فترة (أساس الاطلاع التاريخي).
 * تبدأ من تاريخ إنشاء الحساب حتى لا يُحرم أحد من أرشيفه القائم.
 * تُنفَّذ **بعد** إنشاء المخطط لأنها تحتاج جدول user_role_periods.
 */
export async function backfillRolePeriods(env: Env): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO user_role_periods (user_id, role, stage, from_at, note)
       SELECT u.id, u.role, u.stage, u.created_at, 'تعبئة أولية'
         FROM users u
        WHERE NOT EXISTS (SELECT 1 FROM user_role_periods p WHERE p.user_id = u.id)`,
    ).run();
  } catch (e) {
    console.error('backfill role periods failed', e);
  }
}

/**
 * تعبئة قياسات الالتزام للبنود القائمة (أثر رجعي):
 *   first_due_date — أول استحقاق معروف (نأخذ الحالي مرجعًا للبنود القديمة).
 *   delay_days     — الإنجاز ناقص الاستحقاق بالأيام: موجب = تأخير، صفر أو سالب = في الموعد.
 * تُنفَّذ بعد إنشاء المخطط، وتلمس الصفوف الفارغة فقط فتكون رخيصة عند التكرار.
 */
export async function backfillActionMetrics(env: Env): Promise<void> {
  try {
    await env.DB.prepare(
      `UPDATE action_items SET first_due_date = due_date
        WHERE first_due_date IS NULL AND due_date IS NOT NULL`,
    ).run();
    await env.DB.prepare(
      `UPDATE action_items
          SET delay_days = CAST(julianday(date(completed_at)) - julianday(date(due_date)) AS INTEGER)
        WHERE delay_days IS NULL AND status = 'done'
          AND completed_at IS NOT NULL AND due_date IS NOT NULL`,
    ).run();
  } catch (e) {
    console.error('backfill action metrics failed', e);
  }
}

// ============================================================
// إرخاء قيد «المهمة لا تكون إلا من محضر»
// ============================================================
//
// كان `action_items.source_meeting_id` مُعرَّفًا `NOT NULL`، فلا يقبل بندًا بلا محضر.
// والمهام المستقلة تحتاجه NULL. وSQLite لا يرفع قيد NOT NULL بـ ALTER، والطريق الوحيد
// إعادة بناء الجدول — وهي عملية خطرة على قاعدة حيّة: مفاتيح D1 الأجنبية مُفعَّلة، و
// `DROP TABLE` يُطلق `ON DELETE CASCADE` فيمحو المسؤولين والمرفقات وسجل الترحيل معه.
//
// فتُبنى الجداول الأربعة (الأب وأبناؤه الثلاثة) نسخًا جديدة تشير إلى الأب الجديد، ثم
// لا يُحذف شيء إلا بعد التحقّق من تطابق أعداد الصفوف صفًّا صفًّا. وحين يُحذف الأب لا
// يبقى ما يشير إليه، فلا يقع حذف متسلسل. وإعادة التسمية تُصحّح مراجع الأبناء تلقائيًا
// (SQLite يُعيد كتابة REFERENCES عند تسمية الجدول المُشار إليه).
//
// والدالة قابلة للاستئناف: انقطاعُ العزلة في منتصف العملية يترك البيانات كاملة في
// جداول `_v2`، ويُكمل النداءُ التالي إعادة التسمية وحدها.

interface RebuildTable {
  real: string;
  cols: string;     // أعمدة النسخ صراحةً — لا نعتمد على ترتيب الأعمدة
  create: string;   // تعريف نسخة _v2 (تشير إلى action_items_v2)
}

const ACTION_REBUILD: RebuildTable[] = [
  {
    real: 'action_items',
    cols: `id, type, council_id, source_meeting_id, number, display_number, text, priority,
           due_date, status, progress, completed_at, completed_by, completion_note,
           original_completed_at, reported_done_meeting_id, first_due_date, delay_days,
           carried_count, last_carried_meeting_id, created_by, created_at, updated_at`,
    create: `CREATE TABLE IF NOT EXISTS action_items_v2 (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  type              TEXT    NOT NULL CHECK (type IN ('decision','recommendation','task')),
  council_id        INTEGER NOT NULL REFERENCES councils(id),
  source_meeting_id INTEGER REFERENCES meetings(id),
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
  original_completed_at TEXT,
  reported_done_meeting_id INTEGER REFERENCES meetings(id),
  first_due_date    TEXT,
  delay_days        INTEGER,
  carried_count     INTEGER NOT NULL DEFAULT 0,
  last_carried_meeting_id INTEGER REFERENCES meetings(id),
  created_by        INTEGER REFERENCES users(id),
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (council_id, type, number)
)`,
  },
  {
    real: 'action_assignees',
    cols: 'action_item_id, user_id',
    create: `CREATE TABLE IF NOT EXISTS action_assignees_v2 (
  action_item_id INTEGER NOT NULL REFERENCES action_items_v2(id) ON DELETE CASCADE,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (action_item_id, user_id)
)`,
  },
  {
    real: 'action_attachments',
    cols: 'id, action_item_id, r2_key, file_name, uploaded_by, uploaded_at',
    create: `CREATE TABLE IF NOT EXISTS action_attachments_v2 (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  action_item_id INTEGER NOT NULL REFERENCES action_items_v2(id) ON DELETE CASCADE,
  r2_key         TEXT    NOT NULL,
  file_name      TEXT    NOT NULL,
  uploaded_by    INTEGER REFERENCES users(id),
  uploaded_at    TEXT    NOT NULL DEFAULT (datetime('now'))
)`,
  },
  {
    real: 'meeting_followups',
    cols: `meeting_id, action_item_id, status, progress, due_date, completed_at, delay_days,
           is_final, carried_index, reconstructed, snapshot_at`,
    create: `CREATE TABLE IF NOT EXISTS meeting_followups_v2 (
  meeting_id     INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  action_item_id INTEGER NOT NULL REFERENCES action_items_v2(id) ON DELETE CASCADE,
  status         TEXT    NOT NULL,
  progress       INTEGER NOT NULL DEFAULT 0,
  due_date       TEXT,
  completed_at   TEXT,
  delay_days     INTEGER,
  is_final       INTEGER NOT NULL DEFAULT 0,
  carried_index  INTEGER NOT NULL DEFAULT 1,
  reconstructed  INTEGER NOT NULL DEFAULT 0,
  snapshot_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (meeting_id, action_item_id)
)`,
  },
];

async function tableNames(env: Env): Promise<Set<string>> {
  const rows = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>();
  return new Set(rows.results.map((r) => r.name));
}

async function countOf(env: Env, table: string): Promise<number> {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return r?.n ?? 0;
}

/** إتمام إعادة التسمية: يُستدعى في نهاية إعادة البناء وعند استئنافها بعد انقطاع. */
async function finishRename(env: Env): Promise<void> {
  // الأب أولًا: تسميتُه تُعيد كتابة مراجع الأبناء من action_items_v2 إلى action_items
  for (const t of ACTION_REBUILD) {
    const names = await tableNames(env);
    if (names.has(t.real) || !names.has(`${t.real}_v2`)) continue;
    await env.DB.prepare(`ALTER TABLE ${t.real}_v2 RENAME TO ${t.real}`).run();
  }
}

export async function relaxActionSourceMeeting(env: Env): Promise<void> {
  try {
    const names = await tableNames(env);
    // قاعدة جديدة تمامًا: ensureSchema سينشئ الجداول بالتعريف الجديد أصلًا
    if (!names.has('action_items') && !names.has('action_items_v2')) return;

    // استئناف بعد انقطاع: البيانات في _v2 ولم تكتمل التسمية
    if (!names.has('action_items') && names.has('action_items_v2')) return await finishRename(env);

    const def = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'action_items'",
    ).first<{ sql: string }>();
    if (!def?.sql || !/source_meeting_id\s+INTEGER\s+NOT\s+NULL/i.test(def.sql)) return;  // مُرخى مسبقًا

    // ١) نسخ الجداول الأربعة (idempotent: التعريف والنسخ كلاهما يحتمل التكرار)
    for (const t of ACTION_REBUILD) await env.DB.prepare(t.create).run();
    for (const t of ACTION_REBUILD) {
      const cols = t.cols.replace(/\s+/g, ' ');
      await env.DB.prepare(
        `INSERT OR IGNORE INTO ${t.real}_v2 (${cols}) SELECT ${cols} FROM ${t.real}`,
      ).run();
    }

    // ٢) لا يُحذف شيء قبل التحقّق — تفاوتُ صفٍّ واحد يوقف العملية وتبقى القاعدة كما هي
    for (const t of ACTION_REBUILD) {
      const [before, after] = await Promise.all([countOf(env, t.real), countOf(env, `${t.real}_v2`)]);
      if (before !== after) {
        console.error(`relax action_items aborted: ${t.real} ${before} != ${after}`);
        return;
      }
    }

    // ٣) الأبناء أولًا (لا شيء يشير إليهم)، ثم الأب — وقد صار بلا مُشير فلا حذف متسلسل
    for (const t of [...ACTION_REBUILD].reverse()) await env.DB.prepare(`DROP TABLE ${t.real}`).run();

    // ٤) إعادة التسمية — والفهارس يُعيد ensureSchema إنشاءها بعدها
    await finishRename(env);
    console.log('action_items rebuilt: source_meeting_id is now nullable');
  } catch (e) {
    console.error('relax action_items source_meeting_id failed', e);
  }
}
