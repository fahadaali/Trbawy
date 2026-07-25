// الإشعارات داخل المنصة: القائمة، عدد غير المقروء، التعليم كمقروء.
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth } from '../middleware/auth';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', requireAuth);

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
