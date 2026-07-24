// صفحات مُخدَّمة من الخادم: التحقق العام، الطباعة/التصدير، وخدمة ملفات R2.
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { loadSession } from '../middleware/auth';
import { getCouncil } from '../lib/meetings';
import { canViewCouncil } from '../permissions';
import { renderMeetingHtml, renderVerifyHtml, renderBundleHtml } from '../lib/print';
import { serveAsset } from './settings';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// صفحة التحقق العامة (بلا مصادقة) — يفتحها رمز QR
app.get('/verify/:code', async (c) => {
  const html = await renderVerifyHtml(c.env, c.req.param('code'));
  return c.html(html);
});

// خدمة أصول الهوية البصرية العامة (شعار/علامة مائية) — تتطلب جلسة فقط.
// التواقيع ومرفقات البنود لا تُقدَّم هنا: التواقيع تُضمَّن في صفحة الطباعة (بعد فحص صلاحية المحضر)،
// والمرفقات لها مسار مُصرَّح على مستوى الكائن في /api/actions/:id/attachments/:attId.
app.get('/file', async (c) => {
  const s = await loadSession(c);
  if (!s) return c.text('غير مصرّح', 401);
  const key = c.req.query('key') || '';
  if (!/^branding\//.test(key)) return c.text('غير مسموح', 403);
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

// حزمة محاضر فترة معيّنة في ملف واحد
app.get('/print/bundle', async (c) => {
  const s = await loadSession(c);
  if (!s || s.user.must_change_password) return c.redirect('/');
  const councilId = Number(c.req.query('council_id'));
  const from = c.req.query('from') || '0000-01-01';
  const to = c.req.query('to') || '9999-12-31';
  const council = await getCouncil(c.env, councilId);
  if (!council) return c.text('المجلس غير موجود', 404);
  if (!(await canViewCouncil(c.env, s.user, council))) return c.text('لا تملك صلاحية', 403);
  const origin = new URL(c.req.url).origin;
  return c.html(await renderBundleHtml(c.env, councilId, from, to, origin));
});

export default app;
