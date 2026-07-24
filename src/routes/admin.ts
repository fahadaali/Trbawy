// إدارة النظام: النسخ الاحتياطي (مدير النظام).
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import { isAdmin, isPresident } from '../permissions';
import { audit } from '../lib/audit';
import { createBackup, listBackups } from '../lib/backup';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', requireAuth, requirePasswordChanged);
app.use('*', async (c, next) => {
  const u = c.get('user');
  if (!isAdmin(u) && !isPresident(u)) return c.json({ error: 'خاص بمدير النظام' }, 403);
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

export default app;
