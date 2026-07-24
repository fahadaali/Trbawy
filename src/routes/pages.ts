// صفحات مُخدَّمة من الخادم: التحقق العام، الطباعة/التصدير، وخدمة ملفات R2.
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { loadSession } from '../middleware/auth';
import { getCouncil } from '../lib/meetings';
import { canViewCouncil } from '../permissions';
import { renderMeetingHtml, renderVerifyHtml } from '../lib/print';
import { serveAsset } from './settings';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// صفحة التحقق العامة (بلا مصادقة) — يفتحها رمز QR
app.get('/verify/:code', async (c) => {
  const html = await renderVerifyHtml(c.env, c.req.param('code'));
  return c.html(html);
});

// خدمة ملف من R2 (يتطلب جلسة) — للشعار/العلامة/التواقيع داخل صفحة الطباعة
app.get('/file', async (c) => {
  const s = await loadSession(c);
  if (!s) return c.text('غير مصرّح', 401);
  const key = c.req.query('key') || '';
  // سماح فقط بالبادئات المعروفة
  if (!/^(branding|signatures|actions)\//.test(key)) return c.text('غير مسموح', 403);
  return serveAsset(c.env, key);
});

// صفحة المحضر القابلة للطباعة/التصدير (تتطلب صلاحية الاطلاع)
app.get('/print/meeting/:id', async (c) => {
  const s = await loadSession(c);
  if (!s) return c.redirect('/');
  if (s.user.must_change_password) return c.redirect('/');
  const id = Number(c.req.param('id'));
  const m = await c.env.DB.prepare('SELECT council_id FROM meetings WHERE id = ?').bind(id).first<any>();
  if (!m) return c.text('المحضر غير موجود', 404);
  const council = await getCouncil(c.env, m.council_id);
  if (!(await canViewCouncil(c.env, s.user, council!))) return c.text('لا تملك صلاحية', 403);
  const origin = new URL(c.req.url).origin;
  const html = await renderMeetingHtml(c.env, id, origin);
  if (!html) return c.text('تعذّر التوليد', 500);
  return c.html(html);
});

export default app;
