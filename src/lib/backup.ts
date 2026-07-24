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
