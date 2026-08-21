// صفحات مُخدَّمة من الخادم: التحقق العام، الطباعة/التصدير، وخدمة ملفات R2.
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { loadSession } from '../middleware/auth';
import { getCouncil } from '../lib/meetings';
import { canViewMeeting, hasFullCouncilAccess } from '../permissions';
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
  const m = await c.env.DB.prepare('SELECT id, council_id, created_at, status FROM meetings WHERE id = ?').bind(id).first<any>();
  if (!m) return c.text('المحضر غير موجود', 404);
  const council = await getCouncil(c.env, m.council_id);
  if (!(await canViewMeeting(c.env, s.user, m, council!))) return c.text('لا تملك صلاحية', 403);
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
  if (!(await canViewMeeting(c.env, s.user, m, council!))) return c.text('لا تملك صلاحية', 403);

  // الوقت «عائم» بلا منطقة زمنية عمدًا: المجلس كلّه في توقيت واحد، والوقت العائم
  // يظهر كما كُتب على أي جهاز بلا حاجة إلى VTIMEZONE ولا خطأ في التحويل.
  const d = String(m.greg_date || '').replace(/-/g, '');
  const hm = (v: string | null) => (v ? String(v).slice(0, 5).replace(':', '') + '00' : null);
  const start = hm(m.start_time) || '090000';
  // نهاية بلا بداية معلومة لا معنى لها، والافتراض الثابت كان يُنتج نهاية قبل البداية
  // (بداية ١:٠٠ ونهاية ١٠:٠٠) فيرفض التقويم الحدث. فالافتراض ساعةٌ بعد البداية.
  const end = hm(m.end_time) || addHour(start);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const origin = new URL(c.req.url).origin;
  const cancelled = m.status === 'cancelled';

  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tarbawi Council Platform//AR', 'CALSCALE:GREGORIAN',
    // إلغاء المحضر يصل التقويمَ إلغاءً لا حدثًا جديدًا
    `METHOD:${cancelled ? 'CANCEL' : 'PUBLISH'}`, 'BEGIN:VEVENT',
    // المعرّف ثابت لكل اجتماع، والتسلسل يعلو بكل تعديل: إعادةُ الإضافة بعد تغيير
    // الموعد تُحدّث الحدث القائم في التقويم بدل أن تُضيف نسخة ثانية إلى جانبه.
    `UID:meeting-${id}@tarbawi`,
    `SEQUENCE:${icsSequence(m.updated_at)}`,
    `DTSTAMP:${stamp}`,
    `LAST-MODIFIED:${stamp}`,
    `DTSTART:${d}T${start}`, `DTEND:${d}T${end}`,
    `SUMMARY:${icsEsc((cancelled ? 'ملغى: ' : '') + (m.title ? m.title + ' — ' : '') + council?.name)}`,
    `DESCRIPTION:${icsEsc(`رقم المحضر: ${m.display_number}\n${origin}/#/meetings/${id}`)}`,
    `LOCATION:${icsEsc(m.location_type === 'remote' ? (m.location || 'عن بُعد') : (m.location || 'حضوري'))}`,
    `URL:${origin}/#/meetings/${id}`,
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
  ];
  if (!cancelled) {
    lines.push('BEGIN:VALARM', 'TRIGGER:-PT60M', 'ACTION:DISPLAY', 'DESCRIPTION:تذكير بالاجتماع', 'END:VALARM');
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');

  // النصّ ينتهي بـ CRLF كما تنصّ RFC 5545
  return new Response(lines.map(icsFold).join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="meeting-${id}.ics"`,
      // ملفٌ يتغيّر بتغيّر الموعد فلا يُخزَّن
      'Cache-Control': 'no-store',
    },
  });
});

/** ساعة بعد وقت ICS (HHMMSS) — لا تتجاوز نهاية اليوم. */
function addHour(t: string): string {
  const h = Math.min(23, Number(t.slice(0, 2)) + 1);
  return String(h).padStart(2, '0') + t.slice(2);
}

/** تهريب المحارف ذات المعنى في ICS (RFC 5545). */
const icsEsc = (v: any) => String(v ?? '')
  .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/**
 * تسلسل الحدث: دقائق منذ حقبة يونكس عند آخر تعديل. يعلو مع كل تعديل ولا يعود،
 * وهو ما تعتمده التقاويم للتمييز بين نسخة أحدث ونسخة قديمة من الحدث نفسه.
 */
function icsSequence(updatedAt: string | null): number {
  const ms = Date.parse(String(updatedAt || '').replace(' ', 'T') + 'Z');
  return Number.isFinite(ms) ? Math.floor(ms / 60000) : 0;
}

/**
 * طيّ السطور الطويلة (٧٥ ثمانيّة) دون كسر محرف عربي: العدّ بالبايتات لا بالمحارف،
 * فحرفٌ عربي بايتان — والقسمة في وسطه تُنتج ملفًا لا يُقرأ.
 */
function icsFold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '', bytes = 0, limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) { out.push(cur); cur = ' '; bytes = 1; limit = 74; }
    cur += ch; bytes += n;
  }
  if (cur) out.push(cur);
  return out.join('\r\n');
}

// حزمة محاضر فترة معيّنة في ملف واحد
app.get('/print/bundle', async (c) => {
  const s = await loadSession(c);
  if (!s || s.user.must_change_password) return c.redirect('/');
  const councilId = Number(c.req.query('council_id'));
  const from = c.req.query('from') || '0000-01-01';
  const to = c.req.query('to') || '9999-12-31';
  const council = await getCouncil(c.env, councilId);
  if (!council) return c.text('المجلس غير موجود', 404);
  // تصدير حزمة كاملة لمجلس: للاطلاع الكامل الحالي فقط — الاطلاع التاريخي لا يُصدَّر جملةً
  if (!hasFullCouncilAccess(s.user, council)) return c.text('لا تملك صلاحية', 403);
  const origin = new URL(c.req.url).origin;
  return c.html(await renderBundleHtml(c.env, councilId, from, to, origin));
});

export default app;
