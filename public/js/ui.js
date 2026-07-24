// أدوات الواجهة المشتركة: تنبيهات، نوافذ منبثقة، تنسيق، وترجمات.

// تهريب HTML لمنع الحقن
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// أرقام عربية-هندية
const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
function arNum(x) { return String(x).replace(/[0-9]/g, (d) => AR_DIGITS[+d]); }

// تنبيه عائم
let toastTimer = null;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3200);
}

// نافذة منبثقة عامة. content: HTML، buttons: [{label, class, onClick(close)}]
function openModal({ title, body, buttons }) {
  const root = document.getElementById('modal-root');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const btnHtml = (buttons || [])
    .map((b, i) => `<button class="btn ${b.class || ''}" data-i="${i}">${esc(b.label)}</button>`)
    .join('');
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="x" aria-label="إغلاق">&times;</button></div>
      <div class="modal-body">${body}</div>
      ${buttons ? `<div class="modal-foot">${btnHtml}</div>` : ''}
    </div>`;
  root.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.x').onclick = close;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  (buttons || []).forEach((b, i) => {
    overlay.querySelector(`[data-i="${i}"]`).onclick = () => b.onClick(close, overlay);
  });
  return { overlay, close };
}

function confirmModal(title, message, onConfirm, opts = {}) {
  openModal({
    title,
    body: `<p>${esc(message)}</p>`,
    buttons: [
      { label: opts.confirmLabel || 'تأكيد', class: opts.danger ? 'btn-danger' : '', onClick: (close) => { close(); onConfirm(); } },
      { label: 'إلغاء', class: 'btn-ghost', onClick: (close) => close() },
    ],
  });
}

// ترجمات
const ROLE_AR = {
  president: 'رئيس المجلس التربوي',
  vice_president: 'نائب الرئيس',
  first_supervisor: 'مشرف أول',
  team_member: 'عضو فريق',
  system_admin: 'مدير النظام',
};
const STAGE_AR = { secondary: 'الثانوية', middle: 'المتوسطة', null: '—', '': '—' };
const COUNCIL_TYPE_AR = { educational: 'المجلس التربوي', secondary: 'مجلس المرحلة الثانوية', middle: 'مجلس المرحلة المتوسطة' };
const MEETING_STATUS_AR = {
  invitation: 'دعوة', draft: 'مسودة', awaiting_signatures: 'بانتظار التوقيعات',
  approved: 'معتمد ومقفل', archived: 'مؤرشف', cancelled: 'ملغى',
};
const ACTION_TYPE_AR = { decision: 'قرار', recommendation: 'توصية', task: 'مهمة' };
const ACTION_STATUS_AR = {
  not_started: 'لم تبدأ', in_progress: 'جارية', done: 'منجزة', stalled: 'متعثرة', cancelled: 'ملغاة',
};
const PRIORITY_AR = { high: 'عالية', medium: 'متوسطة', low: 'منخفضة' };
const STUDENT_STATUS_AR = { active: 'نشط', transferred: 'منقول', withdrawn: 'منسحب', graduated: 'متخرج' };
const CYCLE_STATUS_AR = { draft: 'مسودة', open: 'مفتوحة', closed: 'مغلقة', published: 'منشورة النتائج' };
const TARGET_TYPE_AR = { students: 'الطلاب', team_members: 'أعضاء الفرق', first_supervisors: 'المشرفون الأوائل' };

function statusTag(status, map, colorMap) {
  const cls = (colorMap && colorMap[status]) || 'tag-gray';
  return `<span class="tag ${cls}">${esc((map && map[status]) || status)}</span>`;
}

// تنسيق تاريخ ميلادي + هجري من نص ISO
function fmtDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const g = new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
    const h = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
    return `${h}هـ — ${g}م`;
  } catch { return iso; }
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso.replace(' ', 'T') + (iso.includes('Z') ? '' : 'Z'));
    return new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
  } catch { return iso; }
}
function initials(name) { return (name || '؟').trim().charAt(0); }
