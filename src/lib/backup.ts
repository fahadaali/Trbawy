// النسخ الاحتياطي: تصدير كل جداول D1 إلى ملف JSON في R2 (يومياً + يدوي).
import type { Env } from '../types';

const TABLES = [
  'users', 'councils', 'council_members', 'fixed_agenda_templates', 'meetings',
  'meeting_attendees', 'agenda_items', 'action_items', 'action_assignees', 'action_attachments',
  'students', 'student_transfers', 'eval_cycles', 'eval_criteria', 'evaluations',
  'evaluation_scores', 'notifications', 'audit_log', 'settings',
];

export async function createBackup(env: Env): Promise<string> {
  const dump: Record<string, unknown[]> = {};
  for (const t of TABLES) {
    const rows = await env.DB.prepare(`SELECT * FROM ${t}`).all();
    dump[t] = rows.results;
  }
  // كلمات المرور مشفّرة أصلاً (تجزئة أحادية) — تبقى كما هي في النسخة.
  const stamp = (await env.DB.prepare("SELECT strftime('%Y-%m-%d_%H%M', 'now') AS s").first<{ s: string }>())!.s;
  const key = `backups/backup_${stamp}.json`;
  const payload = JSON.stringify({ created_at: stamp, tables: dump }, null, 0);
  await env.FILES.put(key, payload, { httpMetadata: { contentType: 'application/json' } });
  return key;
}

export async function listBackups(env: Env): Promise<{ key: string; size: number; uploaded: string }[]> {
  const list = await env.FILES.list({ prefix: 'backups/' });
  return list.objects
    .map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded.toISOString() }))
    .sort((a, b) => (a.uploaded < b.uploaded ? 1 : -1));
}

// ترتيب الحذف (عكس ترتيب الإدراج) لاحترام المفاتيح الأجنبية
const DELETE_ORDER = [...TABLES].reverse();

export interface RestoreReport { table: string; rows: number; skipped: number }

// استعادة نسخة احتياطية: تُفرَّغ الجداول ثم تُعاد الصفوف كما هي.
// عملية حسّاسة — تُنشأ نسخة وقائية قبلها، وتُبقى الجلسات كما هي حتى لا يُطرد المنفِّذ.
export async function restoreBackup(env: Env, key: string): Promise<RestoreReport[]> {
  if (!/^backups\/[\w.\-]+\.json$/.test(key)) throw new Error('مفتاح النسخة غير صالح');
  const obj = await env.FILES.get(key);
  if (!obj) throw new Error('ملف النسخة غير موجود');

  let parsed: any;
  try { parsed = JSON.parse(await obj.text()); }
  catch { throw new Error('ملف النسخة تالف أو ليس بصيغة JSON'); }
  const tables = parsed && parsed.tables;
  if (!tables || typeof tables !== 'object') throw new Error('بنية النسخة غير متوقّعة');

  // نسخة وقائية قبل الاستبدال (للتراجع عند الحاجة)
  await createBackup(env);

  // حذف users يجرف الجلسات معه (ON DELETE CASCADE) فيُطرد الجميع بمن فيهم المنفِّذ.
  // نحتفظ بها ونعيد ما يخصّ مستخدمين ما زالوا موجودين بعد الاستعادة.
  const keptSessions = (await env.DB.prepare('SELECT * FROM sessions').all<any>()).results;

  const report: RestoreReport[] = [];
  for (const t of DELETE_ORDER) {
    if (!Array.isArray(tables[t])) continue;
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  for (const t of TABLES) {
    const rows = tables[t];
    if (!Array.isArray(rows)) continue;
    let inserted = 0; let skipped = 0;
    // الأعمدة الفعلية في المخطط الحالي — نتجاهل أي عمود قديم لم يعد موجوداً
    const info = await env.DB.prepare(`PRAGMA table_info(${t})`).all<{ name: string }>();
    const cols = new Set(info.results.map((r) => r.name));
    for (let i = 0; i < rows.length; i += 25) {
      const chunk = rows.slice(i, i + 25);
      const stmts = [];
      for (const row of chunk) {
        if (!row || typeof row !== 'object') { skipped++; continue; }
        const keys = Object.keys(row).filter((k) => cols.has(k));
        if (!keys.length) { skipped++; continue; }
        stmts.push(env.DB.prepare(
          `INSERT OR REPLACE INTO ${t} (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
        ).bind(...keys.map((k) => (row as any)[k])));
      }
      if (stmts.length) { await env.DB.batch(stmts); inserted += stmts.length; }
    }
    report.push({ table: t, rows: inserted, skipped });
  }

  // إعادة الجلسات لمن بقي حسابه قائماً ونشطاً
  if (keptSessions.length) {
    const alive = new Set(
      (await env.DB.prepare('SELECT id FROM users WHERE is_active = 1 AND deleted_at IS NULL').all<{ id: number }>())
        .results.map((r) => r.id),
    );
    const stmts = keptSessions
      .filter((s) => alive.has(s.user_id))
      .map((s) => env.DB.prepare(
        'INSERT OR REPLACE INTO sessions (id, user_id, created_at, last_active, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(s.id, s.user_id, s.created_at, s.last_active, s.ip, s.user_agent));
    for (let i = 0; i < stmts.length; i += 25) await env.DB.batch(stmts.slice(i, i + 25));
  }

  return report;
}
