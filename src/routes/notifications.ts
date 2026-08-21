// الإشعارات: القائمة داخل المنصة، وعدد غير المقروء، والتعليم كمقروء،
// وتسجيل أجهزة إشعارات الدفع (متصفح الجوال وتطبيق الشاشة الرئيسية).
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth } from '../middleware/auth';
import { getVapidKeys, b64uDecode } from '../lib/webpush';
import { pushToUsers } from '../lib/pushnotify';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', requireAuth);

// ---------------------------------------------------------------
// إشعارات الدفع — تُسجَّل قبل مسارات المعرّف حتى لا تلتقطها كمعرّف
// ---------------------------------------------------------------

/** المفتاح العام الذي يشترك به المتصفح (applicationServerKey). */
app.get('/push/key', async (c) => {
  const keys = await getVapidKeys(c.env);
  return c.json({ key: keys?.publicKey || null, enabled: !!keys });
});

const MAX_DEVICES = 10;

/** تسجيل جهاز (أو تحديث تسجيله إن تغيّر مفتاحه). */
app.post('/push/subscribe', async (c) => {
  const u = c.get('user');
  const b = await c.req.json().catch(() => ({} as any));
  const endpoint = String(b.endpoint || '');
  const p256dh = String(b.keys?.p256dh || '');
  const auth = String(b.keys?.auth || '');
  if (!/^https?:\/\//.test(endpoint)) return c.json({ error: 'عنوان الاشتراك غير صالح' }, 400);
  // مفتاح المتصفح نقطة غير مضغوطة ٦٥ بايت، وسرّ الاشتراك ١٦ بايت
  try {
    if (b64uDecode(p256dh).length !== 65 || b64uDecode(auth).length !== 16) throw new Error('bad keys');
  } catch {
    return c.json({ error: 'مفاتيح الاشتراك غير صالحة' }, 400);
  }

  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, is_standalone)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh,
       auth = excluded.auth, user_agent = excluded.user_agent, is_standalone = excluded.is_standalone,
       fail_count = 0`,
  ).bind(u.id, endpoint, p256dh, auth, c.req.header('user-agent') || null, b.standalone ? 1 : 0).run();

  // حدّ أعلى للأجهزة: نُبقي الأحدث ونحذف ما زاد (جهاز قديم لم يعد يُستعمل)
  await c.env.DB.prepare(
    `DELETE FROM push_subscriptions WHERE user_id = ? AND id NOT IN (
       SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT ?)`,
  ).bind(u.id, u.id, MAX_DEVICES).run();

  return c.json({ ok: true });
});

/** إلغاء تسجيل جهاز. */
app.post('/push/unsubscribe', async (c) => {
  const b = await c.req.json().catch(() => ({} as any));
  const endpoint = String(b.endpoint || '');
  if (!endpoint) return c.json({ error: 'عنوان الاشتراك مطلوب' }, 400);
  await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?')
    .bind(endpoint, c.get('user').id).run();
  return c.json({ ok: true });
});

/** أجهزة المستخدم المسجَّلة للإشعارات. */
app.get('/push/devices', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, endpoint, user_agent, is_standalone, created_at, last_used_at
       FROM push_subscriptions WHERE user_id = ? ORDER BY id DESC`,
  ).bind(c.get('user').id).all();
  return c.json({ devices: rows.results });
});

/** إشعار تجريبي إلى أجهزة المستخدم نفسه — للتأكد من وصول الإشعارات. */
app.post('/push/test', async (c) => {
  const u = c.get('user');
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?')
    .bind(u.id).first<{ n: number }>();
  if (!n?.n) return c.json({ error: 'لا يوجد جهاز مسجَّل للإشعارات' }, 400);
  await pushToUsers(c.env, [u.id], {
    title: 'تجربة الإشعارات',
    body: 'وصلك هذا الإشعار — الإشعارات مفعّلة على هذا الجهاز.',
    link: '#/notifications',
    type: 'push_test',
  });
  return c.json({ ok: true, devices: n.n });
});

app.get('/', async (c) => {
  const u = c.get('user');
  const limit = Math.min(Number(c.req.query('limit') || 50), 200);
  const offset = Number(c.req.query('offset') || 0);
  const onlyUnread = c.req.query('unread') === '1';
  const type = c.req.query('type');

  const where = ['user_id = ?'];
  const binds: any[] = [u.id];
  if (onlyUnread) where.push('is_read = 0');
  if (type) { where.push('type = ?'); binds.push(type); }

  const rows = await c.env.DB.prepare(
    `SELECT id, type, title, body, link, is_read, created_at FROM notifications
      WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ? OFFSET ?`,
  ).bind(...binds, limit, offset).all();
  const unread = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0')
    .bind(u.id).first<{ n: number }>();
  return c.json({ notifications: rows.results, unread: unread?.n ?? 0 });
});

app.post('/:id/read', async (c) => {
  await c.env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?')
    .bind(Number(c.req.param('id')), c.get('user').id).run();
  return c.json({ ok: true });
});

app.post('/read-all', async (c) => {
  await c.env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').bind(c.get('user').id).run();
  return c.json({ ok: true });
});

export default app;
