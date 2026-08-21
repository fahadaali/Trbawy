// إدارة النظام: النسخ الاحتياطي (مدير النظام).
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import { canViewBackups, canCreateBackup, canRestoreBackup } from '../permissions';
import { audit } from '../lib/audit';
import { createBackup, listBackups, restoreBackup } from '../lib/backup';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', requireAuth, requirePasswordChanged);
app.use('*', async (c, next) => {
  const u = c.get('user');
  // الاطلاع بابُ هذه الشاشة كلها؛ والإنشاء والاستعادة يُفحصان في موضعهما
  if (!canViewBackups(u)) return c.json({ error: 'خاص بمدير النظام' }, 403);
  await next();
});

app.get('/backups', async (c) => c.json({ backups: await listBackups(c.env) }));

app.post('/backups', async (c) => {
  const key = await createBackup(c.env);
  await audit(c.env, { userId: c.get('user').id, action: 'manual_backup', entityType: 'backup', newValue: { key } });
  return c.json({ ok: true, key }, 201);
});

app.get('/backups/download', async (c) => {
  const key = c.req.query('key') || '';
  if (!/^backups\//.test(key)) return c.json({ error: 'مفتاح غير صالح' }, 400);
  const obj = await c.env.FILES.get(key);
  if (!obj) return c.json({ error: 'الملف غير موجود' }, 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${key.split('/').pop()}"`,
    },
  });
});

// ---- استعادة نسخة احتياطية (مدير النظام حصراً) ----
// عملية استبدال كامل: تُنشأ نسخة وقائية تلقائياً قبل التنفيذ.
app.post('/backups/restore', async (c) => {
  if (!canRestoreBackup(c.get('user'))) return c.json({ error: 'الاستعادة لمدير النظام حصراً' }, 403);
  const b = await c.req.json().catch(() => ({}));
  const key = String(b.key || '');
  // تأكيد صريح يمنع التنفيذ العرضي
  if (b.confirm !== 'استعادة') return c.json({ error: 'اكتب كلمة «استعادة» للتأكيد' }, 400);

  try {
    const report = await restoreBackup(c.env, key);
    await audit(c.env, {
      userId: c.get('user').id, action: 'restore_backup', entityType: 'backup',
      newValue: { key, tables: report.length, rows: report.reduce((a, r) => a + r.rows, 0) },
    });
    return c.json({ ok: true, report });
  } catch (e) {
    console.error('restore failed', e);
    return c.json({ error: (e as Error).message || 'تعذّرت الاستعادة' }, 400);
  }
});

// ---- الجلسات النشطة لكل المستخدمين ----
app.get('/sessions', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT s.id, s.user_id, s.created_at, s.last_active, s.ip, s.user_agent, u.name AS user_name, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id
      ORDER BY s.last_active DESC LIMIT 200`,
  ).all<any>();
  const cur = c.get('sessionId');
  return c.json({ sessions: rows.results.map((r) => ({ ...r, is_current: r.id === cur })) });
});

// إنهاء جلسة أي مستخدم عن بُعد
app.delete('/sessions/:id', async (c) => {
  const sid = c.req.param('id');
  if (sid === c.get('sessionId')) return c.json({ error: 'لا يمكن إنهاء جلستك الحالية من هنا' }, 400);
  const row = await c.env.DB.prepare('SELECT user_id FROM sessions WHERE id = ?').bind(sid).first<{ user_id: number }>();
  if (!row) return c.json({ error: 'الجلسة غير موجودة' }, 404);
  await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
  await audit(c.env, {
    userId: c.get('user').id, action: 'admin_revoke_session', entityType: 'session',
    entityId: row.user_id, newValue: { target_user_id: row.user_id },
  });
  return c.json({ ok: true });
});

export default app;
