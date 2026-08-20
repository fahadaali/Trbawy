// توليد صفحات المحاضر القابلة للطباعة/التصدير (HTML عربي RTL مع الهوية البصرية ورمز QR).
// يدعم: محضراً واحداً، وحزمة محاضر فترة في ملف واحد، وصفحة التحقق العامة.
//
// تخطيط الصفحة المطبوعة: الترويسة والتذييل عنصران ثابتان (position: fixed) يتكرّران
// على كل صفحة، والمحتوى داخل جدول إطار يحمل صفَّي حجز (thead/tfoot) فارغين يحجزان
// ارتفاعهما في **كل** صفحة — وهذا ما يمنع تسلّل النص فوق الترويسة في الصفحات التالية
// (الحشو العلوي وحده يسري على الصفحة الأولى فقط).
//
// ملاحظة: counter(page) لا يُحتسب خارج صناديق @page في Chrome وFirefox (يطبع صفرًا)،
// فالتذييل يحمل رقم المحضر — وهو المعرّف المطلوب تكراره على كل صفحة — ومن أراد ترقيم
// الصفحات فعّل «الترويسة والتذييل» في نافذة الطباعة.
import type { Env } from '../types';
import { getSettings } from '../routes/settings';
import { getCouncil } from './meetings';
import { qrSvg } from './qr';
import { sanitizeHtml } from './sanitize';
import { getFollowups, type FollowupRow } from './followups';
import { donut, bars, meter, kpi, arNum, type Slice } from './charts';

const esc = (s: any) =>
  s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// جلب أصل من R2 وتضمينه كـ data URI (يتجنّب طلبات /file المنفصلة ويغلق أي تسريب على مستوى الكائن).
function abToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
async function assetDataUri(env: Env, key: string | null | undefined): Promise<string> {
  if (!key) return '';
  const obj = await env.FILES.get(key);
  if (!obj) return '';
  const ct = obj.httpMetadata?.contentType || 'image/png';
  return `data:${ct};base64,${abToB64(await obj.arrayBuffer())}`;
}

const ATT_AR: Record<string, string> = { present: 'حاضر', apology: 'معتذر', absent: 'غائب' };
const TYPE_AR: Record<string, string> = { decision: 'قرار', recommendation: 'توصية', task: 'مهمة' };
const STATUS_AR: Record<string, string> = { not_started: 'لم تبدأ', in_progress: 'جارية', done: 'منجزة', stalled: 'متعثرة', cancelled: 'ملغاة' };
const PRIORITY_AR: Record<string, string> = { high: 'عالية', medium: 'متوسطة', low: 'منخفضة' };

// ألوان الدلالة — واحدة في الجداول والمخططات معًا
const C = { ok: '#1f8a54', warn: '#b9770e', bad: '#c0392b', gray: '#6b7a75', info: '#2c6e9b', gold: '#c9a24b' };
const STATUS_TONE: Record<string, string> = {
  not_started: 'gray', in_progress: 'warn', done: 'ok', stalled: 'bad', cancelled: 'gray',
};
const TYPE_TONE: Record<string, string> = { decision: 'info', recommendation: 'gold', task: 'ok' };
const PRIORITY_TONE: Record<string, string> = { high: 'bad', medium: 'warn', low: 'gray' };

const chip = (text: string, tone: string) => `<span class="chip chip-${tone}">${esc(text)}</span>`;
const statusChip = (s: string) => chip(STATUS_AR[s] || s, STATUS_TONE[s] || 'gray');
const typeChip = (t: string) => chip(TYPE_AR[t] || t, TYPE_TONE[t] || 'gray');
const priorityChip = (p: string) => (p ? chip(PRIORITY_AR[p] || p, PRIORITY_TONE[p] || 'gray') : '');

// توافق العدد والمعدود: يوم واحد · يومان · ٣ أيام · ١٥ يومًا
function countAr(n: number, [one, two, few, many]: [string, string, string, string]): string {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${arNum(n)} ${few}`;
  return `${arNum(n)} ${many}`;
}

// شارة التأخير: موجب = تأخّر بالأيام، صفر أو سالب = في الموعد.
function delayChip(delay: number | null | undefined, hasDue: boolean): string {
  if (!hasDue) return '<span class="muted">—</span>';
  if (delay == null) return '<span class="muted">—</span>';
  if (delay > 0) return chip(`تأخّر ${countAr(delay, ['يومًا واحدًا', 'يومين', 'أيام', 'يومًا'])}`, 'bad');
  return chip('في الموعد', 'ok');
}

function progressCell(p: number | null | undefined): string {
  const v = Math.max(0, Math.min(100, Number(p ?? 0)));
  const color = v >= 80 ? C.ok : v >= 50 ? C.warn : v > 0 ? C.gold : C.gray;
  return `<span class="pbar"><span class="pbar-fill" style="width:${v}%;background:${color}"></span></span>
    <span class="pbar-num">${arNum(v)}٪</span>`;
}

function roleAr(role: string): string {
  return ({ president: 'رئيس المجلس التربوي', vice_president: 'نائب الرئيس', first_supervisor: 'مشرف أول', team_member: 'عضو فريق', system_admin: 'مدير النظام' } as any)[role] || '';
}

// عرض الوقت المخزَّن (HH:MM) بصيغة عربية ١٢ ساعة: ٩:٣٠ ص
function timeAr(hhmm: string | null): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
  if (!m) return '';
  const h = Number(m[1]);
  return `${arNum(h % 12 === 0 ? 12 : h % 12)}:${arNum(m[2])} ${h < 12 ? 'ص' : 'م'}`;
}

const dateAr = (d: string | null | undefined) =>
  (d ? `<span class="num">${arNum(String(d).slice(0, 10).replace(/-/g, '/'))}</span>` : '<span class="muted">—</span>');
// طابع زمني كامل: التاريخ ثم الساعة، في اتجاه واحد حتى لا يُقلب ترتيبه في سياق RTL
const stampAr = (t: string | null | undefined) => {
  if (!t) return '';
  const [d, hm] = String(t).split(' ');
  return `<span class="num">${arNum(d.replace(/-/g, '/'))}${hm ? ' ' + arNum(hm.slice(0, 5)) : ''}</span>`;
};

function printStyles(primary: string, font: string): string {
  return `
  * { box-sizing: border-box; }
  /* الألوان جزء من المعنى هنا (حالات ومؤشرات) فتُطبع كما تُعرض */
  html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: '${font}', Tahoma, sans-serif; color: #1c2a26; margin: 0; font-size: 13px; }
  @page { size: A4; margin: 12mm 14mm 14mm 14mm; }

  /* إطار الصفحة: صفّا الحجز يحفظان مكان الترويسة والتذييل في كل صفحة */
  /* الإطار مثبَّت العرض: وإلا وسّعه أعرض محتوى بداخله فطفح الجدول خارج هوامش الصفحة */
  .frame { width: 100%; table-layout: fixed; border-collapse: collapse; }
  .frame > thead > tr > td, .frame > tbody > tr > td, .frame > tfoot > tr > td { border: 0; padding: 0; }
  .sp-h { height: 21mm; } .sp-f { height: 15mm; }

  .page-head { display: flex; align-items: center; justify-content: space-between;
    border-bottom: 2.5px solid ${primary}; padding: 3mm 0 2mm; background: #fff; }
  .page-head .org { font-weight: 700; color: ${primary}; font-size: 15px; }
  .page-head .logo { height: 14mm; max-width: 46mm; object-fit: contain; }
  .page-foot { display: flex; align-items: center; justify-content: space-between;
    border-top: 1px solid #dfe6e3; font-size: 10.5px; color: #6b7a75; padding-top: 2mm; background: #fff; }
  .page-foot .doc { font-weight: 700; color: #4a5b55; }

  .watermark { position: fixed; inset: 0; display: grid; place-items: center; opacity: .05; z-index: -1; }
  .watermark img { max-width: 55%; }

  .content { padding: 2mm 0 4mm; }
  .content.brk { break-before: page; page-break-before: always; }

  /* العناوين */
  h1 { font-size: 21px; text-align: center; color: ${primary}; margin: 4px 0 2px; }
  .subnum { text-align: center; font-weight: 700; direction: ltr; color: ${primary};
    background: ${primary}12; border: 1px solid ${primary}33; border-radius: 999px;
    display: inline-block; padding: 2px 14px; }
  .center { text-align: center; }
  h2 { font-size: 14.5px; color: ${primary}; margin: 14px 0 6px; padding: 4px 10px 4px 0;
    border-right: 4px solid ${primary}; background: ${primary}0f; border-radius: 0 6px 6px 0; }
  h3.sub { font-size: 12.5px; color: #4a5b55; margin: 8px 0 4px; }

  /* الجداول */
  table.tbl { width: 100%; border-collapse: collapse; margin: 6px 0 10px; }
  table.tbl th, table.tbl td { border: 1px solid #dbe3e0; padding: 5px 8px; text-align: right;
    font-size: 12px; vertical-align: middle; }
  table.tbl th { background: ${primary}; color: #fff; font-weight: 700; font-size: 11.5px; }
  table.tbl tbody tr:nth-child(even) td { background: #f7faf9; }
  table.tbl tbody tr.row-bad td { background: #fdf1ef; }
  table.tbl tbody tr.row-ok  td { background: #f1f9f4; }
  table.tbl thead { display: table-header-group; }
  table.tbl.fixed { table-layout: fixed; }
  table.tbl tr { break-inside: avoid; page-break-inside: avoid; }
  .meta { width: 100%; border-collapse: collapse; margin: 10px 0; }
  .meta td, .meta th { border: 1px solid #dbe3e0; padding: 5px 9px; text-align: right; font-size: 12px; }
  .meta th { background: ${primary}14; color: ${primary}; width: 15%; font-weight: 700; }

  /* الشارات */
  .chip { display: inline-block; padding: 1px 9px; border-radius: 999px; font-size: 11px;
    font-weight: 700; white-space: nowrap; line-height: 1.7; }
  .chip-ok   { background: #e7f5ee; color: ${C.ok};   border: 1px solid #bfe3d0; }
  .chip-warn { background: #fdf3e1; color: ${C.warn}; border: 1px solid #f0dcb4; }
  .chip-bad  { background: #fdecea; color: ${C.bad};  border: 1px solid #f5c9c2; }
  .chip-gray { background: #eff2f1; color: ${C.gray}; border: 1px solid #dbe3e0; }
  .chip-info { background: #e8f1f8; color: ${C.info}; border: 1px solid #c6dcec; }
  .chip-gold { background: #faf3e0; color: #96751f;   border: 1px solid #ecdcb0; }

  /* شريط نسبة داخل الجدول */
  .pbar { display: inline-block; width: 28px; height: 6px; border-radius: 3px; background: #e6ebe9;
    overflow: hidden; vertical-align: middle; }
  .pbar-fill { display: block; height: 100%; }
  .pbar-num { font-size: 10.5px; color: #4a5b55; margin-inline-start: 3px; }

  /* لوحة المؤشرات */
  .dash { border: 1px solid #e0e6e3; border-radius: 10px; padding: 10px 12px; background: #fcfdfd;
    break-inside: avoid; page-break-inside: avoid; }
  .kpis { display: flex; flex-wrap: wrap; gap: 8px; }
  .kpi { flex: 1 1 88px; border: 1px solid #e0e6e3; border-radius: 9px; padding: 7px 6px;
    text-align: center; background: #fff; }
  .kpi-v { font-size: 19px; font-weight: 700; line-height: 1.2; }
  .kpi-l { font-size: 10.5px; color: #5b6a65; }
  .kpi-s { font-size: 9.5px; color: #8a9691; }
  .kpi-ok .kpi-v { color: ${C.ok}; }  .kpi-warn .kpi-v { color: ${C.warn}; }
  .kpi-bad .kpi-v { color: ${C.bad}; } .kpi-neutral .kpi-v { color: ${primary}; }
  .panels { display: flex; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
  .panel { flex: 1 1 220px; border: 1px solid #e8edeb; border-radius: 9px; padding: 8px 10px; background: #fff; }
  .panel > .ttl { font-size: 11.5px; font-weight: 700; color: #4a5b55; margin-bottom: 6px; }

  .chart { display: flex; align-items: center; gap: 10px; }
  .dn-v { font-size: 20px; font-weight: 700; fill: ${primary}; }
  .dn-s { font-size: 9px; fill: #8a9691; }
  .legend { flex: 1; }
  .lg-row { display: flex; align-items: center; gap: 6px; font-size: 11px; margin-bottom: 3px; }
  .lg-dot { width: 9px; height: 9px; border-radius: 3px; display: inline-block; }
  .lg-lbl { flex: 1; color: #4a5b55; } .lg-val { font-weight: 700; }
  .lg-pct { font-weight: 400; color: #8a9691; }

  .bars { margin-top: 2px; }
  .bar-row { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; font-size: 11px; }
  .bar-lbl { width: 58px; color: #4a5b55; }
  .bar-track { flex: 1; height: 9px; background: #eef2f1; border-radius: 5px; overflow: hidden; }
  .bar-fill { display: block; height: 100%; border-radius: 5px; }
  .bar-val { width: 34px; text-align: left; font-weight: 700; }

  .meter { margin-top: 6px; }
  .meter-top { display: flex; justify-content: space-between; font-size: 11px; color: #4a5b55; margin-bottom: 3px; }
  .meter-track { display: block; height: 9px; background: #eef2f1; border-radius: 5px; overflow: hidden; }
  .meter-fill { display: block; height: 100%; border-radius: 5px; }
  .cols { width: 100%; } .cl-v { font-size: 9px; fill: #4a5b55; } .cl-l { font-size: 9px; fill: #8a9691; }

  /* البنود والمحتوى الغني */
  ol.agenda { padding-inline-start: 20px; margin: 6px 0; }
  ol.agenda > li { margin-bottom: 8px; break-inside: avoid; page-break-inside: avoid; }
  ol.agenda > li > b { color: ${primary}; }
  .body-rich { margin-top: 3px; }
  .body-rich img { max-width: 100%; }
  .body-rich mark { background: #fff3b0; padding: 0 2px; border-radius: 3px; }
  .body-rich table { width: 100%; border-collapse: collapse; }
  .body-rich table td, .body-rich table th { border: 1px solid #dbe3e0; padding: 4px 7px; font-size: 12px; }
  .body-rich blockquote { border-right: 3px solid ${primary}55; margin: 6px 0; padding: 2px 10px; color: #4a5b55; }

  .sig { height: 12mm; }
  .stamp { font-style: italic; border: 1px dashed ${primary}; padding: 1px 8px; border-radius: 6px; color: ${primary}; }
  .code { direction: ltr; font-family: monospace; font-size: 10.5px; text-align: right; white-space: nowrap; }
  .num { direction: ltr; unicode-bidi: isolate; white-space: nowrap; display: inline-block; }
  table.tbl td .chip, table.tbl th .chip { white-space: nowrap; font-size: 10px; padding: 1px 6px; }
  table.tbl td { word-break: normal; overflow-wrap: break-word; }
  .ov { color: ${C.warn}; font-weight: 700; } .muted { color: #8a9691; }
  .verify { margin-top: 14px; display: flex; align-items: center; gap: 14px; border: 1px solid #e0e6e3;
    border-radius: 10px; padding: 10px; break-inside: avoid; background: #fcfdfd; }
  .verify .txt { font-size: 11.5px; color: #5b6a65; }
  .banner { text-align: center; font-weight: 700; margin: 8px 0; padding: 6px 10px; border-radius: 8px; }
  .banner-ok { color: ${C.ok}; background: #e7f5ee; border: 1px solid #bfe3d0; }
  .banner-warn { color: ${C.warn}; background: #fdf3e1; border: 1px solid #f0dcb4; }
  .note { font-size: 11px; color: #8a9691; margin: 4px 0; }

  @media print {
    .page-head { position: fixed; top: 0; left: 0; right: 0; height: 19mm; }
    .page-foot { position: fixed; bottom: 0; left: 0; right: 0; height: 13mm; }
  }
  @media screen {
    body { background: #eceff0; padding: 16px 0; }
    .sp-h, .sp-f { display: none; }
    .sheet { background: #fff; max-width: 820px; margin: 0 auto; padding: 22mm 16mm;
      box-shadow: 0 2px 22px rgba(0,0,0,.14); border-radius: 4px; }
  }`;
}

// ---------------------------------------------------------------------------
// لوحة مؤشرات المحضر — تمثيل بصري لحالة الحضور والبنود والالتزام
// ---------------------------------------------------------------------------
function meetingDashboard(attendees: any[], actions: any[], followups: FollowupRow[]): string {
  const members = attendees.filter((a) => !a.is_guest);
  const guests = attendees.filter((a) => a.is_guest);
  const att = {
    present: members.filter((a) => a.attendance_status === 'present').length,
    apology: members.filter((a) => a.attendance_status === 'apology').length,
    absent: members.filter((a) => a.attendance_status === 'absent').length,
  };
  const attRate = members.length ? Math.round((att.present / members.length) * 100) : 0;
  const signed = members.filter((a) => a.signed_at || a.signature_override).length;

  const byType = (t: string) => actions.filter((a) => a.type === t).length;
  const all = [...followups.map((f) => ({ status: f.status })), ...actions.map((a) => ({ status: a.status }))];
  const cnt = (s: string) => all.filter((x) => x.status === s).length;

  const overdue = followups.filter((f) => f.status !== 'done' && (f.overdue_days ?? 0) > 0).length;
  const lateDone = followups.filter((f) => f.status === 'done' && (f.delay_days ?? 0) > 0);
  const delayTotal = lateDone.reduce((a, f) => a + (f.delay_days ?? 0), 0);
  const carried = followups.filter((f) => !f.is_final).length;
  const documented = followups.filter((f) => f.is_final).length;
  const doneRate = followups.length ? Math.round((documented / followups.length) * 100) : 0;

  const attSlices: Slice[] = [
    { label: 'حاضر', value: att.present, color: C.ok },
    { label: 'معتذر', value: att.apology, color: C.warn },
    { label: 'غائب', value: att.absent, color: C.bad },
  ];
  const statusRows: Slice[] = [
    { label: 'منجزة', value: cnt('done'), color: C.ok },
    { label: 'جارية', value: cnt('in_progress'), color: C.warn },
    { label: 'لم تبدأ', value: cnt('not_started'), color: C.gray },
    { label: 'متعثرة', value: cnt('stalled'), color: C.bad },
  ];

  return `<div class="dash">
    <div class="kpis">
      ${kpi(`${arNum(att.present)}/${arNum(members.length)}`, 'الحضور', attRate >= 75 ? 'ok' : attRate >= 50 ? 'warn' : 'bad', `${arNum(attRate)}٪`)}
      ${kpi(signed, 'التواقيع', signed >= att.present ? 'ok' : 'warn', `من ${arNum(att.present)} حاضر`)}
      ${kpi(actions.length, 'بنود هذا المحضر', 'neutral',
        [[byType('decision'), 'قرار', 'قراران', 'قرارات', 'قرارًا'] as const,
         [byType('recommendation'), 'توصية', 'توصيتان', 'توصيات', 'توصية'] as const,
         [byType('task'), 'مهمة', 'مهمتان', 'مهام', 'مهمة'] as const]
          .filter(([n]) => n > 0)
          .map(([n, ...forms]) => countAr(n as number, forms as unknown as [string, string, string, string]))
          .join(' · ') || 'لا بنود جديدة')}
      ${kpi(carried, 'بنود مُرحَّلة', carried ? 'warn' : 'ok', 'من محاضر سابقة')}
      ${kpi(overdue, 'متأخرة عن الاستحقاق', overdue ? 'bad' : 'ok')}
      ${kpi(delayTotal, 'أيام التأخير', delayTotal ? 'bad' : 'ok',
        lateDone.length ? `على ${countAr(lateDone.length, ['بند واحد', 'بندين', 'بنود', 'بندًا'])}` : 'لا تأخير')}
      ${guests.length ? kpi(guests.length, 'ضيوف', 'neutral') : ''}
    </div>
    <div class="panels">
      <div class="panel"><div class="ttl">توزيع الحضور</div>
        ${donut(attSlices, { centerTop: `${arNum(attRate)}٪`, centerSub: 'نسبة الحضور' })}</div>
      <div class="panel"><div class="ttl">حالة القرارات والتوصيات والمهام</div>
        ${bars(statusRows)}
        ${meter(doneRate, 'إنجاز بنود المتابعة الموثّقة في هذا المحضر')}
        ${meter(attRate, 'نسبة الحضور')}</div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// كتلة محتوى محضر واحد (تُعاد استخدامها في الحزمة)
// ---------------------------------------------------------------------------
async function meetingContentBlock(env: Env, m: any, origin: string, brk: boolean): Promise<string> {
  const council = await getCouncil(env, m.council_id);
  const attendees = (await env.DB.prepare(
    `SELECT a.*, u.name AS user_name, u.role AS user_role, u.signature_image
       FROM meeting_attendees a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.meeting_id = ? ORDER BY a.is_guest, a.id`,
  ).bind(m.id).all()).results as any[];
  const agenda = (await env.DB.prepare('SELECT * FROM agenda_items WHERE meeting_id = ? ORDER BY sort_order').bind(m.id).all()).results as any[];
  // بنود هذا المحضر مع المسؤولين عنها (عمود المسؤول جزء أصيل من الجدول)
  const actions = (await env.DB.prepare(
    `SELECT a.*,
            (SELECT GROUP_CONCAT(u.name, '، ') FROM action_assignees aa
               JOIN users u ON u.id = aa.user_id WHERE aa.action_item_id = a.id) AS assignees
       FROM action_items a WHERE a.source_meeting_id = ? ORDER BY a.type, a.id`,
  ).bind(m.id).all()).results as any[];
  // جدول المتابعة: بنود المحاضر السابقة المرحَّلة إلى هذا المحضر (§٤٫٣)
  const followups = await getFollowups(env, m);
  const writer = m.writer_id ? await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(m.writer_id).first<any>() : null;
  const approver = m.approved_by ? await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(m.approved_by).first<any>() : null;

  const verifyUrl = m.verify_code ? `${origin}/verify/${m.verify_code}` : '';
  const qr = verifyUrl ? qrSvg(verifyUrl, 110) : '';
  const guests = attendees.filter((a) => a.is_guest);
  const finalized = m.status === 'approved' || m.status === 'archived';

  const signRows = (await Promise.all(attendees.filter((a) => !a.is_guest).map(async (a) => {
    let sig = '<span class="muted">—</span>';
    if (a.signed_at) {
      const uri = a.signature_image ? await assetDataUri(env, a.signature_image) : '';
      sig = uri ? `<img class="sig" src="${uri}" />` : `<span class="stamp">${esc(a.user_name)}</span>`;
    } else if (a.signature_override) sig = '<span class="ov">تجاوز موثّق</span>';
    else if (a.attendance_status !== 'present') sig = `<span class="muted">${esc(ATT_AR[a.attendance_status])}</span>`;
    return `<tr><td>${esc(a.user_name)}</td><td>${attChip(a.attendance_status)}</td><td>${sig}</td>
      <td class="code">${a.signature_hash ? esc(a.signature_hash) : ''}</td><td class="code">${stampAr(a.signed_at)}</td></tr>`;
  }))).join('');

  const followupRows = followups.map((f) => {
    const overdue = f.status !== 'done' && (f.overdue_days ?? 0) > 0;
    const cls = f.status === 'done' ? 'row-ok' : (overdue || f.status === 'stalled') ? 'row-bad' : '';
    return `<tr class="${cls}">
      <td>${typeChip(f.type)}</td>
      <td class="code">${esc(f.display_number)}</td>
      <td>${esc(f.text)}</td>
      <td>${esc(f.assignees || '—')}</td>
      <td>${dateAr(f.due_date)}</td>
      <td>${statusChip(f.status)}
        ${overdue ? chip(`متأخرة ${countAr(f.overdue_days, ['يومًا واحدًا', 'يومين', 'أيام', 'يومًا'])}`, 'bad')
          : f.status === 'done' ? delayChip(f.delay_days, !!f.due_date) : ''}</td>
      <td>${progressCell(f.progress)}</td>
      <td class="center">${f.is_final ? chip('توثيق أخير', 'ok') : chip(`ترحيل ${arNum(f.carried_index ?? 1)}`, 'warn')}</td>
    </tr>`;
  }).join('');

  const actionRows = actions.map((a) => `<tr>
      <td>${typeChip(a.type)}</td>
      <td class="code">${esc(a.display_number)}</td>
      <td>${esc(a.text)}</td>
      <td>${esc(a.assignees || '—')}</td>
      <td>${priorityChip(a.priority)}</td>
      <td>${dateAr(a.due_date)}</td>
      <td>${statusChip(a.status)}</td>
      <td>${progressCell(a.progress)}</td>
    </tr>`).join('');

  return `<div class="content${brk ? ' brk' : ''}">
    <h1>محضر اجتماع ${finalized ? '' : '(مسودة)'}</h1>
    <div class="center"><span class="subnum">${esc(m.display_number)}</span></div>
    ${m.title ? `<p class="center" style="font-weight:700;margin:6px 0 0">${esc(m.title)}</p>` : ''}
    ${m.parent_meeting_id ? `<p class="center muted">محضر تصويب/ملحق</p>` : ''}
    ${finalized
      ? `<div class="banner banner-ok">✔ محضر معتمد ومقفل — حرّره: ${writer ? esc(writer.name) : '—'} · اعتمده: ${approver ? esc(approver.name) : '—'}</div>`
      : `<div class="banner banner-warn">مسودة غير معتمدة — للاطلاع فقط</div>`}
    <table class="meta"><tbody>
      <tr><th>المجلس</th><td>${esc(council?.name)}</td><th>التاريخ الهجري</th><td>${esc(m.hijri_date || '')}</td></tr>
      <tr><th>التاريخ الميلادي</th><td>${dateAr(m.greg_date)}</td><th>الوقت</th><td>${esc(timeAr(m.start_time))} ${m.end_time ? '– ' + esc(timeAr(m.end_time)) : ''}</td></tr>
      <tr><th>المكان</th><td>${m.location_type === 'remote' ? 'عن بُعد' : 'حضوري'}${m.location ? ' — ' + esc(m.location) : ''}</td>
          <th>كاتب المحضر</th><td>${writer ? esc(writer.name) : '—'}</td></tr>
    </tbody></table>

    <h2>لوحة مؤشرات المحضر</h2>
    ${meetingDashboard(attendees, actions, followups)}

    <h2>الحضور</h2>
    <table class="tbl"><thead><tr><th>الاسم</th><th>الصفة</th><th>الحالة</th></tr></thead><tbody>
      ${attendees.filter((a) => !a.is_guest).map((a) => `<tr><td>${esc(a.user_name)}</td><td>${esc(roleAr(a.user_role))}</td><td>${attChip(a.attendance_status)}</td></tr>`).join('')}
      ${guests.map((g) => `<tr><td>${esc(g.guest_name)} ${chip('ضيف', 'info')}</td><td>${esc(g.guest_title || '')}</td><td>${attChip('present')}</td></tr>`).join('')}
    </tbody></table>

    <h2>جدول الأعمال والبنود</h2>
    <ol class="agenda">${agenda.map((it) => `<li><b>${esc(it.title)}</b>${it.body ? `<div class="body-rich">${sanitizeHtml(it.body)}</div>` : ''}</li>`).join('') || '<li>—</li>'}</ol>

    ${followups.length ? `<h2>متابعة بنود المحاضر السابقة</h2>
    <p class="note">البند غير المنجَز يُرحَّل إلى المحضر التالي حتى يُنجَز، ثم يظهر ظهورًا أخيرًا للتوثيق.</p>
    <table class="tbl fixed">
      <colgroup><col style="width:9%" /><col style="width:12%" /><col style="width:24%" /><col style="width:13%" />
        <col style="width:10%" /><col style="width:14%" /><col style="width:7%" /><col style="width:11%" /></colgroup>
      <thead><tr><th>النوع</th><th>الرقم</th><th>النص</th><th>المسؤول</th><th>الاستحقاق</th>
      <th>الحالة والالتزام</th><th>الإنجاز</th><th>الترحيل</th></tr></thead>
      <tbody>${followupRows}</tbody></table>` : ''}

    ${actions.length ? `<h2>القرارات والتوصيات والمهام</h2>
    <table class="tbl fixed">
      <colgroup><col style="width:9%" /><col style="width:12%" /><col style="width:26%" /><col style="width:14%" />
        <col style="width:9%" /><col style="width:10%" /><col style="width:11%" /><col style="width:9%" /></colgroup>
      <thead><tr><th>النوع</th><th>الرقم</th><th>النص</th><th>المسؤول</th><th>الأولوية</th>
      <th>الاستحقاق</th><th>الحالة</th><th>الإنجاز</th></tr></thead>
      <tbody>${actionRows}</tbody></table>` : ''}

    <h2>التوقيعات</h2>
    <table class="tbl"><thead><tr><th>الاسم</th><th>الحالة</th><th>التوقيع</th><th>رمز التحقق</th><th>وقت التوقيع</th></tr></thead>
      <tbody>${signRows}</tbody></table>
    ${qr ? `<div class="verify">${qr}<div class="txt"><b>رمز التحقق من صحة المحضر</b><br />امسح الرمز أو افتح:<br /><span dir="ltr">${esc(verifyUrl)}</span></div></div>` : ''}
  </div>`;
}

const attChip = (s: string) =>
  chip(ATT_AR[s] || s, s === 'present' ? 'ok' : s === 'apology' ? 'warn' : 'bad');

function shell(settings: any, primary: string, footerRight: string, bodies: string, logoUri: string, wmUri: string, extraCss = ''): string {
  // الخط من إعدادات الهوية البصرية (Tajawal افتراضيًا)
  const font = String(settings.font_family || 'Tajawal').replace(/[^\w\s-]/g, '') || 'Tajawal';
  const logoImg = logoUri ? `<img class="logo" src="${logoUri}" />` : '';
  const watermark = wmUri ? `<div class="watermark"><img src="${wmUri}" /></div>` : '';
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(footerRight)}</title>
<link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(font)}:wght@400;500;700&display=swap" rel="stylesheet" />
<style>${printStyles(primary, font)}${extraCss}</style></head><body>
${watermark}
<div class="sheet">
  <div class="page-head"><span class="org">${esc(settings.header_text || settings.org_name || '')}</span>${logoImg}</div>
  <table class="frame">
    <thead><tr><td><div class="sp-h"></div></td></tr></thead>
    <tbody><tr><td>${bodies}</td></tr></tbody>
    <tfoot><tr><td><div class="sp-f"></div></td></tr></tfoot>
  </table>
  <!-- التذييل بعد المحتوى ليقع أسفل الصفحة على الشاشة، ويثبت في كل صفحة عند الطباعة -->
  <div class="page-foot"><span>${esc(settings.footer_text || settings.org_name || '')}</span><span class="doc" dir="ltr">${esc(footerRight)}</span></div>
</div>
<script>window.addEventListener('load',function(){if(location.search.indexOf('print=1')>-1)window.print();});</script>
</body></html>`;
}

export async function renderMeetingHtml(env: Env, meetingId: number, origin: string): Promise<string | null> {
  const m = await env.DB.prepare('SELECT * FROM meetings WHERE id = ?').bind(meetingId).first<any>();
  if (!m) return null;
  const settings = await getSettings(env);
  const primary = esc(settings.primary_color || '#1f6f54');
  const [logoUri, wmUri] = await Promise.all([assetDataUri(env, settings.logo_key), assetDataUri(env, settings.watermark_key)]);
  const body = await meetingContentBlock(env, m, origin, false);
  return shell(settings, primary, m.display_number, body, logoUri, wmUri);
}

// حزمة محاضر فترة معيّنة في ملف واحد
export async function renderBundleHtml(
  env: Env, councilId: number, from: string, to: string, origin: string,
): Promise<string> {
  const settings = await getSettings(env);
  const primary = esc(settings.primary_color || '#1f6f54');
  const [logoUri, wmUri] = await Promise.all([assetDataUri(env, settings.logo_key), assetDataUri(env, settings.watermark_key)]);
  const council = await getCouncil(env, councilId);
  const meetings = (await env.DB.prepare(
    `SELECT * FROM meetings WHERE council_id = ? AND status IN ('approved','archived')
       AND greg_date >= ? AND greg_date <= ? ORDER BY greg_date, number`,
  ).bind(councilId, from, to).all()).results as any[];

  if (!meetings.length) {
    return shell(settings, primary, 'حزمة محاضر', `<div class="content"><h1>حزمة محاضر</h1><p class="center muted">لا توجد محاضر معتمدة في هذه الفترة.</p></div>`, logoUri, wmUri);
  }
  const blocks: string[] = [];
  for (let i = 0; i < meetings.length; i++) blocks.push(await meetingContentBlock(env, meetings[i], origin, i > 0));
  return shell(settings, primary, `حزمة ${council?.name || ''}`, blocks.join('\n'), logoUri, wmUri);
}

// بطاقة تقرير الطالب (قابلة للطباعة/التصدير PDF)
export async function renderStudentReportHtml(
  env: Env, student: any, timeline: any[], alert: string | null,
): Promise<string> {
  const settings = await getSettings(env);
  const primary = esc(settings.primary_color || '#1f6f54');
  const [logoUri, wmUri] = await Promise.all([
    assetDataUri(env, settings.logo_key), assetDataUri(env, settings.watermark_key),
  ]);
  const STAGE_AR: Record<string, string> = { secondary: 'الثانوية', middle: 'المتوسطة' };
  const STU_STATUS: Record<string, string> = { active: 'نشط', transferred: 'منقول', withdrawn: 'منسحب', graduated: 'متخرج' };

  const tone = (v: number | null) => (v == null ? 'gray' : v >= 4 ? 'ok' : v >= 3 ? 'warn' : 'bad');
  const rows = timeline.map((t) => `<tr>
    <td>${esc(t.name)}</td>
    <td>${t.score != null ? chip(arNum(t.score.toFixed(2)), tone(t.score)) : '<span class="muted">—</span>'}</td>
    <td>${t.class_avg != null ? arNum(t.class_avg.toFixed(2)) : '—'}</td>
    <td>${t.stage_avg != null ? arNum(t.stage_avg.toFixed(2)) : '—'}</td></tr>`).join('');

  // مخطط تطوّر (SVG)
  const pts = timeline.filter((t) => t.score != null);
  let chart = '<p class="muted">لا بيانات كافية للمخطط.</p>';
  if (pts.length) {
    const W = 520, H = 180, pad = 34, n = timeline.length;
    const x = (i: number) => pad + (n === 1 ? (W - 2 * pad) / 2 : (i * (W - 2 * pad)) / (n - 1));
    const y = (v: number) => H - pad - ((v - 1) / 4) * (H - 2 * pad);
    const line = (key: string, color: string) => {
      const seg = timeline.map((t, i) => ({ t, i })).filter((o: any) => o.t[key] != null);
      if (!seg.length) return '';
      const path = seg.map((o: any, k: number) => `${k === 0 ? 'M' : 'L'}${x(o.i).toFixed(1)},${y(o.t[key]).toFixed(1)}`).join(' ');
      const dots = seg.map((o: any) => `<circle cx="${x(o.i).toFixed(1)}" cy="${y(o.t[key]).toFixed(1)}" r="3.2" fill="${color}"/>`).join('');
      return `<path d="${path}" fill="none" stroke="${color}" stroke-width="2.2"/>${dots}`;
    };
    const grid = [1, 2, 3, 4, 5].map((v) =>
      `<line x1="${pad}" y1="${y(v)}" x2="${W - pad}" y2="${y(v)}" stroke="#e6ebe9"/><text x="8" y="${y(v) + 4}" font-size="10" fill="#8a9691">${arNum(v)}</text>`).join('');
    chart = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;border:1px solid #e0e6e3;border-radius:8px;background:#fff">
      ${grid}${line('stage_avg', C.gold)}${line('score', primary)}
      <text x="${W - pad}" y="14" font-size="11" fill="${primary}" text-anchor="end">■ الطالب</text>
      <text x="${W - pad - 70}" y="14" font-size="11" fill="${C.gold}" text-anchor="end">■ المرحلة</text></svg>`;
  }

  const scores = pts.map((t: any) => t.score as number);
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const last = scores.length ? scores[scores.length - 1] : null;
  const alertHtml = alert === 'low'
    ? `<div class="banner" style="color:${C.bad};background:#fdecea;border:1px solid #f5c9c2">تنبيه: أداء متدنٍّ (أقل من ٣)</div>`
    : alert === 'declining' ? `<div class="banner banner-warn">تنبيه: تراجع عن الدورة السابقة</div>` : '';

  const body = `<div class="content">
    <h1>بطاقة تقرير الطالب</h1>
    <div class="center"><span class="subnum">${esc(student.name)}</span></div>
    ${alertHtml}
    <div class="dash"><div class="kpis">
      ${kpi(timeline.length, 'دورات التقييم', 'neutral')}
      ${kpi(avg != null ? arNum(avg.toFixed(2)) : '—', 'المتوسط العام', avg == null ? 'neutral' : avg >= 4 ? 'ok' : avg >= 3 ? 'warn' : 'bad')}
      ${kpi(last != null ? arNum(last.toFixed(2)) : '—', 'آخر نتيجة', last == null ? 'neutral' : last >= 4 ? 'ok' : last >= 3 ? 'warn' : 'bad')}
      ${kpi(esc(STAGE_AR[student.stage] || student.stage), 'المرحلة', 'neutral')}
    </div>
    ${avg != null ? meter((avg / 5) * 100, 'مستوى الأداء من ٥') : ''}</div>
    <table class="meta"><tbody>
      <tr><th>رقم الهوية</th><td class="code">${esc(student.national_id)}</td><th>المرحلة</th><td>${esc(STAGE_AR[student.stage] || student.stage)}</td></tr>
      <tr><th>الصف</th><td>${esc(student.grade || '—')}</td><th>الفصل</th><td>${esc(student.class || '—')}</td></tr>
      <tr><th>الحالة</th><td>${esc(STU_STATUS[student.status] || student.status)}</td><th>عدد الدورات</th><td>${arNum(timeline.length)}</td></tr>
    </tbody></table>
    <h2>مخطط التطوّر</h2>${chart}
    <h2>نتائج دورات التقييم</h2>
    <table class="tbl"><thead><tr><th>الدورة</th><th>نتيجته</th><th>متوسط صفه</th><th>متوسط مرحلته</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">لا توجد نتائج منشورة</td></tr>'}</tbody></table>
    ${student.notes ? `<h2>ملاحظات</h2><p>${esc(student.notes)}</p>` : ''}
  </div>`;

  return shell(settings, primary, `تقرير: ${student.name}`, body, logoUri, wmUri);
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
    h1{color:${primary};font-size:20px}.ok{color:${C.ok}}.bad{color:${C.bad}}
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
    <p style="margin-top:16px;color:#8a9691;font-size:13px">${esc(settings.org_name || '')}</p>
  </div></body></html>`;
}
