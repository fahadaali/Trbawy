// أدوات الواجهة المشتركة: تنبيهات، نوافذ منبثقة، تنسيق، وترجمات.

// ---------- أيقونات خطية منحنية الأطراف (SVG أصلية مضمّنة) ----------
const ICON_PATHS = {
  home: '<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/>',
  meetings: '<path d="M7 3.5h6l4 4V20.5H7z"/><path d="M13 3.5v4h4"/><path d="M9.5 12.5h5M9.5 16h5"/>',
  tasks: '<path d="M9.5 4.5h5V7h-5z"/><path d="M9.5 5.5H6.5v15h11v-15h-3"/><path d="M9 13.2l1.8 1.8 3.4-3.8"/>',
  evaluations: '<path d="M4.5 4.5v15h15"/><path d="M8 16.5v-4M12 16.5v-7M16 16.5v-3.5"/>',
  students: '<path d="M2.5 9 12 5l9.5 4L12 13z"/><path d="M6.5 11v3.6c0 1.6 2.5 2.9 5.5 2.9s5.5-1.3 5.5-2.9V11"/><path d="M21.5 9.2v4.3"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.4 19.5c0-3.1 2.5-5.3 5.6-5.3s5.6 2.2 5.6 5.3"/><path d="M16.5 5.4a3.2 3.2 0 0 1 0 6.2"/><path d="M17.8 14.6c2.2.6 3.8 2.4 3.8 4.9"/>',
  councils: '<path d="M3.5 9.5 12 4.5l8.5 5"/><path d="M4.5 9.5h15"/><path d="M6.5 9.5v8M10 9.5v8M14 9.5v8M17.5 9.5v8"/><path d="M4 19.5h16"/>',
  branding: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 1.9-1 1.9-1.9 0-1.4 1-1.9 2.3-1.9h1.6a2.7 2.7 0 0 0 2.7-2.7c0-4.7-4.3-8.5-9.5-8.5Z"/><circle cx="7.7" cy="11" r="1"/><circle cx="12" cy="8" r="1"/><circle cx="16.3" cy="11" r="1"/>',
  audit: '<path d="M12 3.5 19 6.2v4.8c0 4.4-2.9 7.8-7 9.5-4.1-1.7-7-5.1-7-9.5V6.2z"/><path d="M9 12l2 2 4-4"/>',
  backups: '<ellipse cx="12" cy="6" rx="6.8" ry="2.8"/><path d="M5.2 6v6c0 1.6 3 2.8 6.8 2.8s6.8-1.2 6.8-2.8V6"/><path d="M5.2 12v6c0 1.6 3 2.8 6.8 2.8s6.8-1.2 6.8-2.8v-6"/>',
  bell: '<path d="M6.5 9.5a5.5 5.5 0 0 1 11 0c0 4.5 1.8 5.6 1.8 5.6H4.7s1.8-1.1 1.8-5.6Z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
  pen: '<path d="M14.5 4.5 19 9l-8.5 8.5-4.7 1.2 1.2-4.7z"/><path d="M13 6.5 17 10.5"/>',
  key: '<circle cx="8" cy="8" r="4"/><path d="M10.8 10.8 20 20"/><path d="M16.5 16.5 18.5 14.5M18.5 18.5 20.5 16.5"/>',
  warning: '<path d="M12 4.5 20.5 19.5H3.5z"/><path d="M12 10v4.2"/><path d="M12 17.4v.2"/>',
  inbox: '<path d="M4 13 6.5 6h11L20 13v5.5H4z"/><path d="M4 13h4.2l1.4 2.4h4.8L15.8 13H20"/>',
  student: '<circle cx="12" cy="8" r="3.4"/><path d="M5.5 20c0-3.4 2.9-5.8 6.5-5.8s6.5 2.4 6.5 5.8"/>',
  check: '<path d="M5 12.5 10 17.5 19 7"/>',
  print: '<path d="M7 9V4h10v5"/><path d="M7 18H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v6H7z"/>',
  package: '<path d="M3.5 7 12 3l8.5 4v9L12 21 3.5 16z"/><path d="M3.5 7 12 11l8.5-4"/><path d="M12 11v10"/>',
  highlight: '<path d="M14.5 4.5 19 9l-7 7H8l-1-3z"/><path d="M4.5 20h7"/><path d="M12 7l4 4"/>',
  image: '<path d="M4 5h16v14H4z"/><circle cx="8.5" cy="9.5" r="1.4"/><path d="M4 16.5l4.5-4.5 4 4 3-3 4.5 4.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  logout: '<path d="M14 4H6v16h8"/><path d="M18 12H10"/><path d="M15 9l3 3-3 3"/>',
};
function icon(name, size = 20) {
  return `<svg class="ic-svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
}


// تهريب HTML لمنع الحقن
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// هل يملك المستخدم صلاحية الإنشاء/تعيين الكاتب/البنود الثابتة لهذا المجلس؟
// يطابق canCreateMeeting و canAssignWriter في الخادم (بما فيه فحص المرحلة).
function canCreateForCouncil(cl) {
  const u = State.user;
  if (!u || !cl) return false;
  if (u.role === 'president') return true;
  return u.role === 'first_supervisor' && cl.type !== 'educational' &&
    ((cl.type === 'secondary' && u.stage === 'secondary') || (cl.type === 'middle' && u.stage === 'middle'));
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
      <button type="button" data-hl title="تظليل">${icon('highlight', 16)}</button>
      <button type="button" data-table title="جدول">▦</button>
      <button type="button" data-img title="صورة">${icon('image', 16)}</button>
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
