// توليد صفحات المحاضر القابلة للطباعة/التصدير (HTML عربي RTL مع الهوية البصرية ورمز QR).
// يدعم: محضراً واحداً، وحزمة محاضر فترة في ملف واحد، وصفحة التحقق العامة.
import type { Env } from '../types';
import { getSettings } from '../routes/settings';
import { getCouncil } from './meetings';
import { qrSvg } from './qr';
import { sanitizeHtml } from './sanitize';

const esc = (s: any) =>
  s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ATT_AR: Record<string, string> = { present: 'حاضر', apology: 'معتذر', absent: 'غائب' };
const TYPE_AR: Record<string, string> = { decision: 'قرار', recommendation: 'توصية', task: 'مهمة' };
const STATUS_AR: Record<string, string> = { not_started: 'لم تبدأ', in_progress: 'جارية', done: 'منجزة', stalled: 'متعثرة', cancelled: 'ملغاة' };

function roleAr(role: string): string {
  return ({ president: 'رئيس المجلس التربوي', vice_president: 'نائب الرئيس', first_supervisor: 'مشرف أول', team_member: 'عضو فريق', system_admin: 'مدير النظام' } as any)[role] || '';
}

function printStyles(primary: string): string {
  return `
  * { box-sizing: border-box; }
  body { font-family: 'Tajawal', Tahoma, sans-serif; color: #1c2a26; margin: 0; }
  @page { size: A4; margin: 22mm 16mm 22mm 16mm; }
  .page-head { position: fixed; top: 0; left: 0; right: 0; height: 18mm; display: flex; align-items: center;
    justify-content: space-between; border-bottom: 2px solid ${primary}; padding: 4px 0; }
  .page-head .org { font-weight: 700; color: ${primary}; }
  .page-head .logo { height: 15mm; }
  .page-foot { position: fixed; bottom: 0; left: 0; right: 0; height: 14mm; border-top: 1px solid #ccc;
    display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: #667; padding-top: 4px; }
  .watermark { position: fixed; inset: 0; display: grid; place-items: center; opacity: .06; z-index: -1; }
  .watermark img { max-width: 60%; }
  .content { padding-top: 20mm; padding-bottom: 16mm; }
  .content.brk { page-break-before: always; }
  h1 { font-size: 20px; text-align: center; color: ${primary}; margin: 6px 0; }
  .subnum { text-align: center; font-weight: 700; direction: ltr; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0; }
  th, td { border: 1px solid #cdd6d2; padding: 6px 9px; text-align: right; font-size: 13px; }
  th { background: ${primary}1a; color: ${primary}; }
  .meta { width: 100%; margin: 12px 0; }
  .meta td { border: 1px solid #cdd6d2; }
  h2 { font-size: 15px; color: ${primary}; border-bottom: 1px solid #e0e6e3; padding-bottom: 4px; margin-top: 18px; }
  ol.agenda { padding-inline-start: 20px; }
  ol.agenda li { margin-bottom: 6px; }
  .body-rich img { max-width: 100%; } .body-rich mark { background: #fff3b0; }
  .sig { height: 12mm; } .stamp { font-family: 'Tajawal'; font-style: italic; border: 1px dashed ${primary}; padding: 2px 8px; border-radius: 6px; color: ${primary}; }
  .code { direction: ltr; font-family: monospace; font-size: 11px; }
  .ov { color: #b9770e; } .muted { color: #889; }
  .verify { margin-top: 20px; display: flex; align-items: center; gap: 14px; border: 1px solid #e0e6e3; border-radius: 10px; padding: 12px; }
  .verify .txt { font-size: 12px; color: #556; }
  .approved-badge { text-align: center; color: ${primary}; font-weight: 700; margin: 8px 0; }
  @media screen { body { background: #eee; } .content { background: #fff; max-width: 800px; margin: 20mm auto; padding: 24mm 18mm; box-shadow: 0 2px 20px rgba(0,0,0,.15); } }`;
}

// كتلة محتوى محضر واحد (تُعاد استخدامها في الحزمة)
async function meetingContentBlock(env: Env, m: any, origin: string, brk: boolean): Promise<string> {
  const council = await getCouncil(env, m.council_id);
  const attendees = (await env.DB.prepare(
    `SELECT a.*, u.name AS user_name, u.role AS user_role, u.signature_image
       FROM meeting_attendees a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.meeting_id = ? ORDER BY a.is_guest, a.id`,
  ).bind(m.id).all()).results as any[];
  const agenda = (await env.DB.prepare('SELECT * FROM agenda_items WHERE meeting_id = ? ORDER BY sort_order').bind(m.id).all()).results as any[];
  const actions = (await env.DB.prepare('SELECT * FROM action_items WHERE source_meeting_id = ? ORDER BY id').bind(m.id).all()).results as any[];
  const writer = m.writer_id ? await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(m.writer_id).first<any>() : null;
  const approver = m.approved_by ? await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(m.approved_by).first<any>() : null;

  const verifyUrl = m.verify_code ? `${origin}/verify/${m.verify_code}` : '';
  const qr = verifyUrl ? qrSvg(verifyUrl, 110) : '';
  const guests = attendees.filter((a) => a.is_guest);
  const finalized = m.status === 'approved' || m.status === 'archived';

  const signRows = attendees.filter((a) => !a.is_guest).map((a) => {
    let sig = '—';
    if (a.signed_at) sig = a.signature_image ? `<img class="sig" src="/file?key=${encodeURIComponent(a.signature_image)}" />` : `<span class="stamp">${esc(a.user_name)}</span>`;
    else if (a.signature_override) sig = '<span class="ov">تجاوز موثّق</span>';
    else if (a.attendance_status !== 'present') sig = `<span class="muted">${esc(ATT_AR[a.attendance_status])}</span>`;
    return `<tr><td>${esc(a.user_name)}</td><td>${esc(ATT_AR[a.attendance_status] || '')}</td><td>${sig}</td>
      <td class="code">${a.signature_hash ? esc(a.signature_hash) : ''}</td><td>${a.signed_at ? esc(a.signed_at) : ''}</td></tr>`;
  }).join('');

  return `<div class="content${brk ? ' brk' : ''}">
    <h1>محضر اجتماع ${finalized ? '' : '(مسودة)'}</h1>
    <div class="subnum">${esc(m.display_number)}</div>
    ${m.title ? `<p style="text-align:center">${esc(m.title)}</p>` : ''}
    ${m.parent_meeting_id ? `<p style="text-align:center" class="muted">محضر تصويب/ملحق</p>` : ''}
    ${finalized ? `<div class="approved-badge">✔ محضر معتمد ومقفل — حرّره: ${writer ? esc(writer.name) : '—'} · اعتمده: ${approver ? esc(approver.name) : '—'}</div>` : ''}
    <table class="meta"><tbody>
      <tr><th>المجلس</th><td>${esc(council?.name)}</td><th>التاريخ الهجري</th><td>${esc(m.hijri_date || '')}</td></tr>
      <tr><th>التاريخ الميلادي</th><td>${esc(m.greg_date || '')}</td><th>الوقت</th><td>${esc(m.start_time || '')} ${m.end_time ? '– ' + esc(m.end_time) : ''}</td></tr>
      <tr><th>المكان</th><td>${m.location_type === 'remote' ? 'عن بُعد' : 'حضوري'}${m.location ? ' — ' + esc(m.location) : ''}</td>
          <th>كاتب المحضر</th><td>${writer ? esc(writer.name) : '—'}</td></tr>
    </tbody></table>
    <h2>الحضور</h2>
    <table><thead><tr><th>الاسم</th><th>الصفة</th><th>الحالة</th></tr></thead><tbody>
      ${attendees.filter((a) => !a.is_guest).map((a) => `<tr><td>${esc(a.user_name)}</td><td>${esc(roleAr(a.user_role))}</td><td>${esc(ATT_AR[a.attendance_status] || '')}</td></tr>`).join('')}
      ${guests.map((g) => `<tr><td>${esc(g.guest_name)} (ضيف)</td><td>${esc(g.guest_title || '')}</td><td>حاضر</td></tr>`).join('')}
    </tbody></table>
    <h2>جدول الأعمال والبنود</h2>
    <ol class="agenda">${agenda.map((it) => `<li><b>${esc(it.title)}</b>${it.body ? `<div class="body-rich">${sanitizeHtml(it.body)}</div>` : ''}</li>`).join('') || '<li>—</li>'}</ol>
    ${actions.length ? `<h2>القرارات والتوصيات والمهام</h2>
    <table><thead><tr><th>النوع</th><th>الرقم</th><th>النص</th><th>المسؤولية/الاستحقاق</th><th>الحالة</th></tr></thead><tbody>
      ${actions.map((a) => `<tr><td>${esc(TYPE_AR[a.type] || a.type)}</td><td class="code">${esc(a.display_number)}</td><td>${esc(a.text)}</td><td>${esc(a.due_date || '')}</td><td>${esc(STATUS_AR[a.status] || a.status)}</td></tr>`).join('')}
    </tbody></table>` : ''}
    <h2>التوقيعات</h2>
    <table><thead><tr><th>الاسم</th><th>الحالة</th><th>التوقيع</th><th>رمز التحقق</th><th>وقت التوقيع</th></tr></thead><tbody>${signRows}</tbody></table>
    ${qr ? `<div class="verify">${qr}<div class="txt"><b>رمز التحقق من صحة المحضر</b><br />امسح الرمز أو افتح:<br /><span dir="ltr">${esc(verifyUrl)}</span></div></div>` : ''}
  </div>`;
}

function shell(settings: any, primary: string, footerRight: string, bodies: string): string {
  const logoImg = settings.logo_key ? `<img class="logo" src="/file?key=${encodeURIComponent(settings.logo_key)}" />` : '';
  const watermark = settings.watermark_key ? `<div class="watermark"><img src="/file?key=${encodeURIComponent(settings.watermark_key)}" /></div>` : '';
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8" />
<title>${esc(footerRight)}</title>
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap" rel="stylesheet" />
<style>${printStyles(primary)}</style></head><body>
${watermark}
<div class="page-head"><span class="org">${esc(settings.header_text || settings.org_name || '')}</span>${logoImg}</div>
<div class="page-foot"><span>${esc(settings.footer_text || '')}</span><span dir="ltr">${esc(footerRight)}</span></div>
${bodies}
<script>window.addEventListener('load',function(){if(location.search.indexOf('print=1')>-1)window.print();});</script>
</body></html>`;
}

export async function renderMeetingHtml(env: Env, meetingId: number, origin: string): Promise<string | null> {
  const m = await env.DB.prepare('SELECT * FROM meetings WHERE id = ?').bind(meetingId).first<any>();
  if (!m) return null;
  const settings = await getSettings(env);
  const primary = esc(settings.primary_color || '#1f6f54');
  const body = await meetingContentBlock(env, m, origin, false);
  return shell(settings, primary, m.display_number, body);
}

// حزمة محاضر فترة معيّنة في ملف واحد
export async function renderBundleHtml(
  env: Env, councilId: number, from: string, to: string, origin: string,
): Promise<string> {
  const settings = await getSettings(env);
  const primary = esc(settings.primary_color || '#1f6f54');
  const council = await getCouncil(env, councilId);
  const meetings = (await env.DB.prepare(
    `SELECT * FROM meetings WHERE council_id = ? AND status IN ('approved','archived')
       AND greg_date >= ? AND greg_date <= ? ORDER BY number`,
  ).bind(councilId, from, to).all()).results as any[];

  if (!meetings.length) {
    return shell(settings, primary, 'حزمة محاضر', `<div class="content"><h1>حزمة محاضر</h1><p style="text-align:center" class="muted">لا توجد محاضر معتمدة في هذه الفترة.</p></div>`);
  }
  const blocks: string[] = [];
  for (let i = 0; i < meetings.length; i++) blocks.push(await meetingContentBlock(env, meetings[i], origin, i > 0));
  return shell(settings, primary, `حزمة ${council?.name || ''}`, blocks.join('\n'));
}

// صفحة التحقق العامة (بلا مصادقة)
export async function renderVerifyHtml(env: Env, code: string): Promise<string> {
  const m = await env.DB.prepare('SELECT * FROM meetings WHERE verify_code = ?').bind(code).first<any>();
  const settings = await getSettings(env);
  const primary = esc(settings.primary_color || '#1f6f54');
  const head = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" /><title>التحقق من المحضر</title>
    <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700&display=swap" rel="stylesheet" />
    <style>body{font-family:'Tajawal',sans-serif;background:#f4f6f5;margin:0;padding:20px;color:#1c2a26}
    .card{max-width:520px;margin:40px auto;background:#fff;border-radius:14px;padding:28px;box-shadow:0 4px 24px rgba(0,0,0,.08)}
    h1{color:${primary};font-size:20px}.ok{color:#1f8a54}.bad{color:#c0392b}
    table{width:100%;border-collapse:collapse;margin-top:14px}td,th{border:1px solid #e2e8e5;padding:8px;text-align:right;font-size:14px}
    .badge{display:inline-block;padding:4px 12px;border-radius:20px;font-weight:700}</style></head><body><div class="card">`;

  if (!m) return head + `<h1>التحقق من المحضر</h1><p class="bad">لا يوجد محضر بهذا الرمز. قد يكون الرمز غير صحيح.</p></div></body></html>`;

  const signers = (await env.DB.prepare(
    `SELECT u.name, a.signed_at, a.signature_override FROM meeting_attendees a JOIN users u ON u.id = a.user_id
      WHERE a.meeting_id = ? AND a.is_guest = 0 AND (a.signed_at IS NOT NULL OR a.signature_override = 1)`,
  ).bind(m.id).all()).results as any[];
  const statusAr: Record<string, string> = { approved: 'معتمد ومقفل', archived: 'مؤرشف', awaiting_signatures: 'بانتظار التوقيعات', cancelled: 'ملغى' };
  return head + `
    <h1>✔ محضر موثّق</h1>
    <table><tbody>
      <tr><th>رقم المحضر</th><td dir="ltr">${esc(m.display_number)}</td></tr>
      <tr><th>الحالة</th><td><span class="badge ${m.status === 'approved' || m.status === 'archived' ? 'ok' : ''}">${esc(statusAr[m.status] || m.status)}</span></td></tr>
      <tr><th>تاريخ الاعتماد</th><td>${esc(m.approved_at || '—')}</td></tr>
    </tbody></table>
    <h3>الموقّعون (${signers.length})</h3>
    <table><thead><tr><th>الاسم</th><th>وقت التوقيع</th></tr></thead><tbody>
    ${signers.map((s) => `<tr><td>${esc(s.name)}</td><td>${s.signed_at ? esc(s.signed_at) : 'تجاوز موثّق'}</td></tr>`).join('') || '<tr><td colspan="2">—</td></tr>'}
    </tbody></table>
    <p style="margin-top:16px;color:#889;font-size:13px">${esc(settings.org_name || '')}</p>
  </div></body></html>`;
}
