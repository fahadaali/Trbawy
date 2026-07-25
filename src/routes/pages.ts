// صفحات مُخدَّمة من الخادم: التحقق العام، الطباعة/التصدير، وخدمة ملفات R2.
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { loadSession } from '../middleware/auth';
import { getCouncil } from '../lib/meetings';
import { canViewCouncil } from '../permissions';
import { renderMeetingHtml, renderVerifyHtml, renderBundleHtml, renderStudentReportHtml } from '../lib/print';
import { buildStudentTimeline } from './students';
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

// بطاقة تقرير الطالب (طباعة/PDF)
app.get('/print/student/:id', async (c) => {
  const s = await loadSession(c);
  if (!s || s.user.must_change_password) return c.redirect('/');
  const id = Number(c.req.param('id'));
  const student = await c.env.DB.prepare('SELECT * FROM students WHERE id = ?').bind(id).first<any>();
  if (!student) return c.text('الطالب غير موجود', 404);
  // نطاق الاطلاع: الرئيس/النائب كل المراحل، وغيرهما مرحلته
  const u = s.user;
  const all = u.role === 'president' || u.role === 'vice_president';
  const canSee = all || ((u.role === 'first_supervisor' || u.role === 'team_member') && u.stage === student.stage);
  if (!canSee) return c.text('لا تملك صلاحية', 403);

  const { timeline, alert } = await buildStudentTimeline(c.env, student);
  return c.html(await renderStudentReportHtml(c.env, student, timeline, alert));
});

// تصدير دعوة تقويم (ICS) لاجتماع — تُضاف لتقويم العضو
app.get('/ics/meeting/:id', async (c) => {
  const s = await loadSession(c);
  if (!s || s.user.must_change_password) return c.text('غير مصرّح', 401);
  const id = Number(c.req.param('id'));
  const m = await c.env.DB.prepare('SELECT * FROM meetings WHERE id = ?').bind(id).first<any>();
  if (!m) return c.text('المحضر غير موجود', 404);
  const council = await getCouncil(c.env, m.council_id);
  if (!(await canViewCouncil(c.env, s.user, council!))) return c.text('لا تملك صلاحية', 403);

  // تحويل التاريخ/الوقت إلى صيغة ICS (بلا منطقة زمنية — وقت محلي عائم)
  const d = String(m.greg_date || '').replace(/-/g, '');
  const t = (v: string | null, fallback: string) => (v ? String(v).replace(':', '') + '00' : fallback);
  const dtStart = `${d}T${t(m.start_time, '090000')}`;
  const dtEnd = `${d}T${t(m.end_time, '100000')}`;
  const esc = (v: any) => String(v ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const origin = new URL(c.req.url).origin;

  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tarbawi Council Platform//AR', 'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:meeting-${id}@tarbawi`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
    `DTSTART:${dtStart}`, `DTEND:${dtEnd}`,
    `SUMMARY:${esc((m.title ? m.title + ' — ' : '') + council?.name)}`,
    `DESCRIPTION:${esc('رقم المحضر: ' + m.display_number)}`,
    `LOCATION:${esc(m.location_type === 'remote' ? (m.location || 'عن بُعد') : (m.location || 'حضوري'))}`,
    `URL:${origin}/#/meetings/${id}`,
    'BEGIN:VALARM', 'TRIGGER:-PT60M', 'ACTION:DISPLAY', 'DESCRIPTION:تذكير بالاجتماع', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return new Response(lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="meeting-${id}.ics"`,
    },
  });
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
