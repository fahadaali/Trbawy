// عرض سجل التدقيق — للرئيس ومدير النظام.
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import { isPresident, isAdmin } from '../permissions';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', requireAuth, requirePasswordChanged);
app.use('*', async (c, next) => {
  const u = c.get('user');
  if (!isPresident(u) && !isAdmin(u)) return c.json({ error: 'لا تملك صلاحية الاطلاع على سجل التدقيق' }, 403);
  await next();
});

app.get('/', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') || 100), 500);
  const offset = Number(c.req.query('offset') || 0);
  const entityType = c.req.query('entity_type');
  const action = c.req.query('action');

  const where: string[] = [];
  const binds: any[] = [];
  if (entityType) { where.push('a.entity_type = ?'); binds.push(entityType); }
  if (action) { where.push('a.action = ?'); binds.push(action); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const rows = await c.env.DB.prepare(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.old_value, a.new_value,
            a.ip, a.timestamp, u.name AS user_name
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       ${whereSql}
      ORDER BY a.id DESC LIMIT ? OFFSET ?`,
  )
    .bind(...binds, limit, offset)
    .all();

  return c.json({ entries: rows.results });
});

export default app;
