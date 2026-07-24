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
// رقم عشري بالعربية بفاصلة عربية (مثل ٤٫٢)
function arFixed(n, d = 1) { return n == null ? '—' : arNum(Number(n).toFixed(d)).replace('.', '٫'); }

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

// محرر نصوص غني عربي RTL (عناوين، قوائم، جداول، تظليل، صور).
// يُرجع { el, getHtml } — يعتمد contenteditable وأوامر التحرير القياسية.
function richEditor(initialHtml) {
  const wrap = document.createElement('div');
  wrap.className = 'rich';
  wrap.innerHTML = `
    <div class="rich-tb">
      <button type="button" data-cmd="bold" title="عريض"><b>B</b></button>
      <button type="button" data-cmd="italic" title="مائل"><i>I</i></button>
      <button type="button" data-cmd="underline" title="تسطير"><u>U</u></button>
      <span class="sep"></span>
      <button type="button" data-block="h2" title="عنوان">ع١</button>
      <button type="button" data-block="h3" title="عنوان فرعي">ع٢</button>
      <button type="button" data-block="p" title="فقرة">¶</button>
      <span class="sep"></span>
      <button type="button" data-cmd="insertUnorderedList" title="قائمة نقطية">•</button>
      <button type="button" data-cmd="insertOrderedList" title="قائمة رقمية">١.</button>
      <span class="sep"></span>
      <button type="button" data-hl title="تظليل">🖍</button>
      <button type="button" data-table title="جدول">▦</button>
      <button type="button" data-img title="صورة">🖼</button>
      <button type="button" data-clear title="إزالة التنسيق">⨯</button>
    </div>
    <div class="rich-area body-rich" contenteditable="true" dir="rtl"></div>`;
  const area = wrap.querySelector('.rich-area');
  area.innerHTML = initialHtml || '';
  try { document.execCommand('styleWithCSS', false, false); } catch {}

  const exec = (cmd, val) => { area.focus(); document.execCommand(cmd, false, val); };
  wrap.querySelectorAll('[data-cmd]').forEach((b) => b.onclick = () => exec(b.dataset.cmd));
  wrap.querySelectorAll('[data-block]').forEach((b) => b.onclick = () => exec('formatBlock', b.dataset.block));
  wrap.querySelector('[data-clear]').onclick = () => exec('removeFormat');
  wrap.querySelector('[data-hl]').onclick = () => {
    const sel = window.getSelection();
    if (sel && sel.toString()) exec('insertHTML', '<mark>' + esc(sel.toString()) + '</mark>');
  };
  wrap.querySelector('[data-table]').onclick = () => {
    const r = parseInt(prompt('عدد الصفوف؟', '2') || '0', 10);
    const cc = parseInt(prompt('عدد الأعمدة؟', '2') || '0', 10);
    if (r > 0 && cc > 0 && r <= 20 && cc <= 10) {
      let t = '<table><tbody>';
      for (let i = 0; i < r; i++) { t += '<tr>'; for (let j = 0; j < cc; j++) t += '<td>&nbsp;</td>'; t += '</tr>'; }
      t += '</tbody></table><p><br></p>';
      exec('insertHTML', t);
    }
  };
  wrap.querySelector('[data-img]').onclick = () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return;
      if (f.size > 1500000) { toast('حجم الصورة كبير (الحد ~١٫٥ م.ب)', 'err'); return; }
      const rd = new FileReader();
      rd.onload = () => exec('insertHTML', `<img src="${rd.result}" alt="صورة" />`);
      rd.readAsDataURL(f);
    };
    inp.click();
  };
  return { el: wrap, getHtml: () => area.innerHTML.trim() };
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
const MEETING_STATUS_COLOR = {
  invitation: 'tag-gray', draft: 'tag-gold', awaiting_signatures: 'tag-gold',
  approved: 'tag-green', archived: 'tag-gray', cancelled: 'tag-red',
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

// تنسيق تاريخ ووقت من نص ISO
function fmtDateTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso.replace(' ', 'T') + (iso.includes('Z') ? '' : 'Z'));
    return new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
  } catch { return iso; }
}
function initials(name) { return (name || '؟').trim().charAt(0); }
