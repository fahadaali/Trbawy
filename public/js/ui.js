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
  calendar2: '<path d="M4.5 6.5h15v13h-15z"/><path d="M4.5 10.5h15M9 4v4M15 4v4"/><path d="M8.5 14h2M13.5 14h2"/>',
  copy: '<path d="M9 9h10.5v10.5H9z"/><path d="M15 9V4.5H4.5V15H9"/>',
  paperclip: '<path d="M20 11.5 12 19.5a4.5 4.5 0 0 1-6.4-6.4l8.4-8.4a3 3 0 0 1 4.3 4.3l-8.4 8.4a1.5 1.5 0 0 1-2.1-2.1l7.7-7.7"/>',
  comment: '<path d="M4.5 5.5h15v10h-9L6 19.5v-4H4.5z"/><path d="M8.5 9.5h7M8.5 12h4.5"/>',
  share: '<circle cx="17.5" cy="6" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><circle cx="17.5" cy="18" r="2.5"/><path d="M8.8 10.8 15.2 7.4M8.8 13.2l6.4 3.4"/>',
  sparkle: '<path d="M12 3.5l1.9 4.9 4.9 1.9-4.9 1.9L12 17.1l-1.9-4.9L5.2 10.3l4.9-1.9z"/><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  mic: '<rect x="9" y="3.5" width="6" height="10" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v2.5M9 20.5h6"/>',
  logout: '<path d="M14 4H6v16h8"/><path d="M18 12H10"/><path d="M15 9l3 3-3 3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l4.5 4.5"/>',
  lock: '<rect x="4.5" y="10" width="15" height="10" rx="2.2"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>',
  download: '<path d="M12 4v10"/><path d="M8 10.5 12 14.5l4-4"/><path d="M4.5 17.5v2h15v-2"/>',
  addbox: '<rect x="4.5" y="4.5" width="15" height="15" rx="3.5"/><path d="M12 8.5v7M8.5 12h7"/>',
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

// تفعيل البحث بالضغط على Enter داخل حقل
function onEnter(inputId, fn) {
  const el = document.getElementById(inputId);
  if (el) el.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); fn(); } };
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

// ---------- التسجيل الصوتي المباشر ----------
// هل يدعم المتصفح التسجيل من الميكروفون؟ (يتطلب HTTPS أو localhost)
function canRecordAudio() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
}

// رسالة عربية مفهومة لأخطاء الميكروفون
function micErrorMessage(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'لم يُسمح باستخدام الميكروفون — فعّل الإذن من إعدادات المتصفح';
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError') return 'لا يوجد ميكروفون متاح على هذا الجهاز';
  if (n === 'NotReadableError') return 'الميكروفون مشغول بتطبيق آخر';
  return (e && e.message) || 'تعذّر بدء التسجيل';
}

// يبدأ التسجيل ويُرجع مقبضًا: { startedAt, stop(): Promise<File>, cancel() }
async function startAudioRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
    .find((t) => window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.start(1000);
  const release = () => stream.getTracks().forEach((t) => t.stop());
  return {
    startedAt: Date.now(),
    cancel() { try { if (rec.state !== 'inactive') rec.stop(); } catch { /* أُوقف مسبقًا */ } release(); },
    stop() {
      return new Promise((resolve, reject) => {
        rec.onstop = () => {
          release();
          const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
          if (!blob.size) return reject(new Error('لم يُلتقط أي صوت — تحقق من الميكروفون'));
          const ext = (blob.type.split('/')[1] || 'webm').split(';')[0];
          resolve(new File([blob], `تسجيل.${ext}`, { type: blob.type }));
        };
        try { rec.stop(); } catch (e) { release(); reject(e); }
      });
    },
  };
}

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

// ربط أزرار الإملاء الصوتي: تسجيل مباشر من الميكروفون أو تفريغ ملف صوتي محفوظ.
// opts: { meetingId, recBtn, fileBtn, fileInput, setState(msg,kind), busy(flag), insert(text), doneMessage }
// يُرجع { destroy } لإيقاف أي تسجيل جارٍ عند إغلاق الشاشة.
function wireDictation(opts) {
  const { meetingId, recBtn, fileBtn, fileInput } = opts;
  const setState = opts.setState || (() => {});
  const busy = opts.busy || (() => {});
  let handle = null, tick = null;
  const stopTick = () => { if (tick) { clearInterval(tick); tick = null; } };

  const transcribe = async (file) => {
    if (!file) return;
    if (file.size > MAX_AUDIO_BYTES) { setState('حجم التسجيل يتجاوز ٢٠ ميجابايت', 'is-err'); return; }
    busy(true);
    setState('جارٍ تفريغ الصوت…');
    try {
      const fd = new FormData();
      fd.append('meeting_id', String(meetingId));
      fd.append('audio', file);
      const { text } = await aiUpload('/transcribe', fd);
      opts.insert(String(text).trim());
      setState(opts.doneMessage || 'أُضيف نص التفريغ — راجعه وعدّله', 'is-ok');
    } catch (e) { setState(e.message, 'is-err'); }
    finally { busy(false); }
  };

  if (recBtn) {
    const idleLabel = recBtn.innerHTML;
    recBtn.onclick = async () => {
      if (handle) {                                  // إيقاف التسجيل ثم التفريغ
        const h = handle; handle = null; stopTick();
        recBtn.classList.remove('rec-on'); recBtn.innerHTML = idleLabel;
        try { await transcribe(await h.stop()); } catch (e) { setState(e.message, 'is-err'); }
        return;
      }
      try { handle = await startAudioRecording(); }
      catch (e) { setState(micErrorMessage(e), 'is-err'); return; }
      recBtn.classList.add('rec-on');
      const upd = () => {
        const s = Math.max(0, Math.floor((Date.now() - handle.startedAt) / 1000));
        recBtn.innerHTML = `■ إيقاف التسجيل · ${arNum(String(Math.floor(s / 60)).padStart(2, '0'))}:${arNum(String(s % 60).padStart(2, '0'))}`;
      };
      upd(); tick = setInterval(upd, 1000);
      setState('جارٍ التسجيل… تحدّث ثم اضغط «إيقاف التسجيل» ليُفرَّغ نصًا', 'is-ok');
    };
  }
  if (fileBtn && fileInput) {
    fileBtn.onclick = () => fileInput.click();
    fileInput.onchange = () => { const f = fileInput.files[0]; fileInput.value = ''; transcribe(f); };
  }
  return { destroy() { stopTick(); if (handle) { handle.cancel(); handle = null; } } };
}

// محرر نصوص غني عربي RTL (عناوين، قوائم، جداول، تظليل، صور).
// يُرجع { el, getHtml, setHtml, destroy } — يعتمد contenteditable وأوامر التحرير القياسية.
// opts.ai = { meetingId, title() } يفعّل شريط المساعد داخل المحرر نفسه:
// صياغة محتوى المربع كما هو، وإملاء صوتي (تسجيل مباشر أو رفع ملف) — بلا مربع نص إضافي.
function richEditor(initialHtml, opts = {}) {
  const ai = opts.ai && State.aiEnabled ? opts.ai : null;
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
    ${ai ? `<div class="rich-ai">
      <button type="button" class="btn-ghost btn-sm ai-btn" data-ai-draft>${icon('sparkle', 15)} صياغة المكتوب</button>
      ${canRecordAudio() ? `<button type="button" class="btn-ghost btn-sm" data-ai-rec>${icon('mic', 15)} تسجيل صوتي</button>` : ''}
      <button type="button" class="btn-ghost btn-sm" data-ai-file title="تفريغ ملف صوتي محفوظ">${icon('paperclip', 15)} ملف صوتي</button>
      <input type="file" accept="audio/*" data-ai-input hidden />
      <button type="button" class="btn-ghost btn-sm" data-ai-undo hidden>تراجع عن الصياغة</button>
      <span class="rich-ai-state"></span>
    </div>` : ''}
    <div class="rich-area body-rich" contenteditable="true" dir="rtl"></div>`;
  const area = wrap.querySelector('.rich-area');
  area.innerHTML = initialHtml || '';
  try { document.execCommand('styleWithCSS', false, false); } catch {}
  // تغيير المحتوى برمجيًا (صياغة/تفريغ) لا يُطلق input تلقائيًا — نُطلقه ليعلم به الحفظ التلقائي
  const touched = () => area.dispatchEvent(new Event('input', { bubbles: true }));

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

  // ---- شريط المساعد داخل المحرر: صياغة المكتوب + إملاء صوتي ----
  let dictation = null;
  if (ai) {
    const stateEl = wrap.querySelector('.rich-ai-state');
    const draftBtn = wrap.querySelector('[data-ai-draft]');
    const recBtn = wrap.querySelector('[data-ai-rec]');
    const fileBtn = wrap.querySelector('[data-ai-file]');
    const fileInp = wrap.querySelector('[data-ai-input]');
    const undoBtn = wrap.querySelector('[data-ai-undo]');
    const aiButtons = [draftBtn, recBtn, fileBtn].filter(Boolean);
    const setState = (msg, kind) => { stateEl.textContent = msg || ''; stateEl.className = 'rich-ai-state' + (kind ? ' ' + kind : ''); };
    const titleOf = () => (typeof ai.title === 'function' ? ai.title() : ai.title) || '';

    // صياغة ما هو مكتوب في المربع نفسه — بلا مربع نقاط منفصل
    draftBtn.onclick = () => {
      const points = (area.innerText || '').replace(/\s+\n/g, '\n').trim();
      if (!points) { setState('اكتب نقاط المناقشة داخل المربع ثم اضغط «صياغة المكتوب»', 'is-err'); area.focus(); return; }
      setState('');
      aiRun(draftBtn, async () => {
        try {
          const { html } = await API.post('/ai/agenda-draft', { meeting_id: ai.meetingId, title: titleOf(), points });
          const before = area.innerHTML;
          area.innerHTML = html; touched();
          undoBtn.hidden = false;
          undoBtn.onclick = () => { area.innerHTML = before; touched(); undoBtn.hidden = true; setState('أُعيد النص السابق'); };
          setState('صياغة مقترحة — راجعها وعدّلها قبل الحفظ', 'is-ok');
        } catch (e) { setState(e.message, 'is-err'); }
      });
    };

    // الإملاء الصوتي: تسجيل مباشر أو ملف — يُدرَج النص في نهاية المحتوى
    dictation = wireDictation({
      meetingId: ai.meetingId, recBtn, fileBtn, fileInput: fileInp, setState,
      busy: (f) => aiButtons.forEach((b) => b.disabled = f),
      doneMessage: 'أُضيف نص التفريغ — اضغط «صياغة المكتوب» لتحويله إلى نص محضر',
      insert: (text) => {
        const paras = text.split(/\n+/).filter((t) => t.trim()).map((t) => `<p>${esc(t.trim())}</p>`).join('');
        area.innerHTML += paras; touched();
      },
    });
  }

  return {
    el: wrap,
    getHtml: () => area.innerHTML.trim(),
    setHtml: (html) => { area.innerHTML = html || ''; touched(); },
    focus: () => area.focus(),
    // إيقاف أي تسجيل جارٍ عند إزالة المحرر من الصفحة (تحرير الميكروفون)
    destroy: () => { if (dictation) dictation.destroy(); },
  };
}

// لوح رسم التوقيع (يدعم الفأرة واللمس) — يُرجع { el, toBlob, clear, isEmpty }
function signaturePad(width = 460, height = 180) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="sigpad">
      <canvas class="sigpad-canvas" width="${width * 2}" height="${height * 2}"
        style="width:100%;height:${height}px;touch-action:none"></canvas>
      <div class="sigpad-hint">ارسم توقيعك هنا بالإصبع أو الفأرة</div>
    </div>
    <div class="row mt"><button type="button" class="btn-ghost btn-sm" data-clear>مسح</button></div>`;
  const cv = wrap.querySelector('canvas');
  const ctx = cv.getContext('2d');
  ctx.scale(2, 2);
  ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#12303f';
  let drawing = false, empty = true;

  const pos = (e) => {
    const r = cv.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: (p.clientX - r.left) * (cv.width / 2 / r.width), y: (p.clientY - r.top) * (cv.height / 2 / r.height) };
  };
  const start = (e) => { e.preventDefault(); drawing = true; const { x, y } = pos(e); ctx.beginPath(); ctx.moveTo(x, y); };
  const move = (e) => { if (!drawing) return; e.preventDefault(); const { x, y } = pos(e); ctx.lineTo(x, y); ctx.stroke(); empty = false; wrap.querySelector('.sigpad-hint').style.display = 'none'; };
  const end = () => { drawing = false; };
  cv.addEventListener('mousedown', start); cv.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  cv.addEventListener('touchstart', start, { passive: false });
  cv.addEventListener('touchmove', move, { passive: false });
  cv.addEventListener('touchend', end);

  const clear = () => {
    ctx.clearRect(0, 0, cv.width, cv.height); empty = true;
    wrap.querySelector('.sigpad-hint').style.display = '';
  };
  wrap.querySelector('[data-clear]').onclick = clear;
  return {
    el: wrap,
    isEmpty: () => empty,
    clear,
    toBlob: () => new Promise((res) => cv.toBlob(res, 'image/png')),
  };
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
const ACTION_STATUS_COLOR = {
  not_started: 'tag-gray', in_progress: 'tag-gold', done: 'tag-green', stalled: 'tag-red', cancelled: 'tag-gray',
};
const PRIORITY_COLOR = { high: 'tag-red', medium: 'tag-gold', low: 'tag-gray' };
const STUDENT_STATUS_AR = { active: 'نشط', transferred: 'منقول', withdrawn: 'منسحب', graduated: 'متخرج' };
const CYCLE_STATUS_AR = { draft: 'مسودة', open: 'مفتوحة', closed: 'مغلقة', published: 'منشورة النتائج' };
const TARGET_TYPE_AR = { students: 'الطلاب', team_members: 'أعضاء الفرق', first_supervisors: 'المشرفون الأوائل' };

function statusTag(status, map, colorMap) {
  const cls = (colorMap && colorMap[status]) || 'tag-gray';
  return `<span class="tag ${cls}">${esc((map && map[status]) || status)}</span>`;
}

// ---------- مؤشرات الالتزام ----------
// شارة الالتزام بالموعد: للمنجَز فرق أيام (الإنجاز − الاستحقاق)، وللمفتوح تأخّره حتى اليوم.
function delayTag(a) {
  if (!a.due_date) return '<span class="muted">—</span>';
  if (a.status === 'done') {
    if (a.delay_days == null) return '<span class="muted">—</span>';
    return a.delay_days > 0
      ? `<span class="tag tag-red">تأخّر ${arCount(a.delay_days, ['يومًا واحدًا', 'يومين', 'أيام', 'يومًا'])}</span>`
      : '<span class="tag tag-green">في الموعد</span>';
  }
  const over = Number(a.overdue_days || 0);
  if (over > 0) return `<span class="tag tag-red">متأخرة ${arCount(over, ['يومًا واحدًا', 'يومين', 'أيام', 'يومًا'])}</span>`;
  return '<span class="muted">—</span>';
}

// ---------- تمييز الأشخاص بلون ثابت ----------
// اللون محفوظ على المستخدم (users.color) فيبقى نفسه في كل المحاضر وكل المجالس،
// فيُعرف صاحب المهمة بلمحة بصر لا بقراءة سرد الأسماء.
const PERSON_FALLBACK = '#475569';
function personTint(hex, alpha) {
  const h = /^#[0-9a-fA-F]{6}$/.test(String(hex || '')) ? hex : PERSON_FALLBACK;
  const n = parseInt(h.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
/** شارة شخص واحد: إطار منحنٍ بلونه وخلفية فاتحة منه. */
function personChip(name, color) {
  const c = /^#[0-9a-fA-F]{6}$/.test(String(color || '')) ? color : PERSON_FALLBACK;
  return `<span class="who" style="color:${c};background:${personTint(c, 0.13)};border-color:${personTint(c, 0.42)}">${esc(name)}</span>`;
}
/**
 * خلية المسؤولين. تقبل ما يرسله الخادم: مصفوفة JSON ‏[{n,c}] أو مصفوفة
 * جاهزة [{name,color}] أو نصًّا مسرودًا من واجهة قديمة.
 */
function personChips(value) {
  let list = value;
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t) return '<span class="muted">—</span>';
    if (t.startsWith('[')) { try { list = JSON.parse(t); } catch { list = null; } }
    if (!Array.isArray(list)) list = t.split(/[،,]/).map((n) => ({ n: n.trim() })).filter((x) => x.n);
  }
  if (!Array.isArray(list) || !list.length) return '<span class="muted">—</span>';
  return `<span class="whos">${list.map((p) => personChip(p.n ?? p.name ?? '', p.c ?? p.color)).join('')}</span>`;
}

// توافق العدد والمعدود: يوم واحد · يومان · ٣ أيام · ١٥ يومًا
function arCount(n, [one, two, few, many]) {
  n = Number(n);
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${arNum(n)} ${few}`;
  return `${arNum(n)} ${many}`;
}

// شريط نسبة مصغّر داخل الجداول
function miniBar(pct) {
  const v = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  const color = v >= 80 ? 'var(--success)' : v >= 50 ? 'var(--warning)' : v > 0 ? 'var(--accent)' : 'var(--border)';
  return `<span class="mbar"><span style="width:${v}%;background:${color}"></span></span><span class="mbar-num">${arNum(v)}٪</span>`;
}

// ---------- الوقت ----------
// تحويل الأرقام العربية-الهندية إلى لاتينية
function toEnDigits(s) {
  return String(s).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

// تطبيع وقت مكتوب يدويًا إلى "HH:MM" — يقبل ٩:٣٠ ص · 9:30 م · 09:30 · 0930 · 9
// يُرجع null إن كان فارغًا، و undefined إن تعذّر فهمه. (يطابق parseTime في الخادم)
function parseTimeInput(v) {
  if (v === null || v === undefined) return null;
  const raw = toEnDigits(String(v).trim());
  if (!raw) return null;
  const pm = /م|مساء|pm/i.test(raw);
  const am = /ص|صباح|am/i.test(raw);
  let h, mi;
  const colon = /(\d{1,2})\s*[:.]\s*(\d{1,2})/.exec(raw);
  if (colon) { h = Number(colon[1]); mi = Number(colon[2]); }
  else {
    const d = raw.replace(/\D/g, '');
    if (d.length === 4) { h = Number(d.slice(0, 2)); mi = Number(d.slice(2)); }
    else if (d.length === 3) { h = Number(d.slice(0, 1)); mi = Number(d.slice(1)); }
    else if (d.length >= 1 && d.length <= 2) { h = Number(d); mi = 0; }
    else return undefined;
  }
  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;
  if (h > 23 || mi > 59) return undefined;
  return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
}

// عرض الوقت بالعربية مع ص/م (مثل: ٩:٣٠ ص)
function fmtTime(hhmm) {
  const t = parseTimeInput(hhmm);
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  const suffix = h < 12 ? 'ص' : 'م';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${arNum(h12)}:${arNum(String(m).padStart(2, '0'))} ${suffix}`;
}

// وقت الجهاز الآن بالتوقيت المحلي بصيغة HH:MM
function nowTime() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// فرق الدقائق بين وقتين (يُعالج تجاوز منتصف الليل)
function timeDiffMinutes(start, end) {
  const a = parseTimeInput(start), b = parseTimeInput(end);
  if (!a || !b) return null;
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  let diff = toMin(b) - toMin(a);
  if (diff < 0) diff += 24 * 60;
  return diff;
}

// مدة بالعربية (ساعة و٢٥ دقيقة)
function fmtDuration(mins) {
  if (mins == null) return '';
  if (mins < 1) return 'أقل من دقيقة';
  const h = Math.floor(mins / 60), m = mins % 60;
  // جمع القلّة (٣–١٠) ثم التمييز المفرد (١١ فأكثر)
  const unit = (n, one, two, few, many) => (n === 1 ? one : n === 2 ? two : n <= 10 ? `${arNum(n)} ${few}` : `${arNum(n)} ${many}`);
  const parts = [];
  if (h) parts.push(unit(h, 'ساعة', 'ساعتان', 'ساعات', 'ساعة'));
  if (m) parts.push(unit(m, 'دقيقة', 'دقيقتان', 'دقائق', 'دقيقة'));
  return parts.join(' و');
}

// عدّاد hh:mm:ss بالأرقام العربية
function fmtStopwatch(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  const p = (n) => arNum(String(n).padStart(2, '0'));
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

// تخزين محلي متسامح (قد يكون معطّلًا في وضع التصفح الخاص)
const LS = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* غير حرج */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* غير حرج */ } },
};

// تنسيق تاريخ ووقت من نص ISO
function fmtDateTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso.replace(' ', 'T') + (iso.includes('Z') ? '' : 'Z'));
    return new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
  } catch { return iso; }
}
function initials(name) { return (name || '؟').trim().charAt(0); }

// تاريخ ميلادي قصير بأرقام عربية واتجاه معزول: ٢٠٢٦/٠٣/٠٩
// (التاريخ الخام YYYY-MM-DD ينقلب ترتيبه بصريًا داخل نص عربي)
function fmtDate(d) {
  if (!d) return '—';
  const p = String(d).slice(0, 10).replace(/-/g, '/');
  return `<span class="num">${arNum(p)}</span>`;
}


// ============================================================
// تحسينات الجوال
// ============================================================

/**
 * الجداول على الشاشات الصغيرة: كل صف بطاقة، وكل خلية سطر «العنوان: القيمة».
 * ننسخ عنوان العمود إلى الخلية (data-l) فيقرأه CSS — فلا حاجة لتعديل كل جدول
 * في الوحدات، وأي جدول جديد يستفيد تلقائيًا.
 */
function stackTables(root) {
  (root || document).querySelectorAll('table.tbl').forEach((tbl) => {
    // جدول كثيف الأعمدة لا يسعه عرض البطاقة، فتُضغط أعمدته حتى تصير كلمة في كل
    // سطر. غلاف بتمرير أفقي يعيد للأعمدة عرضها الطبيعي بدل عصر النص.
    if (!tbl.parentElement.classList.contains('t-scroll')) {
      const wrap = document.createElement('div');
      wrap.className = 't-scroll';
      tbl.parentElement.insertBefore(wrap, tbl);
      wrap.appendChild(tbl);
    }
    const heads = [...tbl.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    if (!heads.length) return;                       // جدول بلا ترويسة يُترك كما هو
    if (heads.length >= 7) tbl.classList.add('wide'); // كثيف الأعمدة: يستحق حدًّا أدنى للعرض
    tbl.classList.add('stack');
    tbl.querySelectorAll('tbody tr').forEach((tr) => {
      [...tr.children].forEach((td, i) => {
        if (td.hasAttribute('colspan') && Number(td.getAttribute('colspan')) > 1) { td.dataset.l = ''; return; }
        const label = heads[i] || '';
        td.dataset.l = label;
        // خلية بلا عنوان = عمود أزرار؛ وخلية فارغة تُخفى بدل أن تشغل سطرًا فارغًا
        if (!label) td.classList.add('cell-actions');
        else if (!td.textContent.trim() && !td.querySelector('img,svg,input,button')) td.classList.add('cell-empty');
      });
    });
  });
}

// أي محتوى يُحقن في الصفحة يمرّ على المُحسِّن — الشاشات تُبنى بـ innerHTML فلا حدث نعتمد عليه
function watchTables() {
  const target = document.getElementById('app');
  if (!target || window.__tblObserver) return;
  const run = () => stackTables(target);
  window.__tblObserver = new MutationObserver(() => { clearTimeout(window.__tblTimer); window.__tblTimer = setTimeout(run, 40); });
  window.__tblObserver.observe(target, { childList: true, subtree: true });
  run();
}

// بحث الجوال: حقل البحث نفسه يُعرض كورقة أعلى الشاشة
function openMobileSearch() {
  const gs = document.querySelector('.gsearch');
  if (!gs) return;
  const open = !gs.classList.contains('mobile-open');
  gs.classList.toggle('mobile-open', open);
  if (open) {
    const inp = document.getElementById('gsInput');
    if (inp) { inp.value = ''; setTimeout(() => inp.focus(), 60); }
    setTimeout(() => document.addEventListener('click', closeMobileSearchOutside, true), 250);
  }
}
function closeMobileSearchOutside(e) {
  const gs = document.querySelector('.gsearch.mobile-open');
  if (!gs) return document.removeEventListener('click', closeMobileSearchOutside, true);
  if (gs.contains(e.target) || e.target.closest('#gsMobileBtn')) return;
  gs.classList.remove('mobile-open');
  document.removeEventListener('click', closeMobileSearchOutside, true);
}

// ---------- تطبيق الشاشة الرئيسية (PWA) ----------
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);   // iPad بواجهة سطح مكتب
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; });

/**
 * دعوة لتثبيت التطبيق على الشاشة الرئيسية.
 * iPhone لا يدعم beforeinstallprompt، فنعرض له خطوات المشاركة؛ وغيره يُثبَّت بضغطة.
 * تظهر مرة واحدة ثم تُحفظ الاستجابة محليًا.
 */
// البطاقة العائمة تحجب جزءًا من الشاشة، فتظهر على الصفحة الرئيسية وحدها
// وتنسحب تلقائيًا بعد ١٤ ثانية إن لم يتفاعل معها المستخدم.
function onDashboard() {
  const h = location.hash.replace(/^#\/?/, '').split('?')[0];
  return !h || h === 'dashboard';
}
function autoHideCard(el, ms = 14000) {
  setTimeout(() => { if (document.body.contains(el)) el.remove(); }, ms);
}

function maybeShowInstallCard() {
  if (isStandalone() || localStorage.getItem('a2hs_dismissed') === '1') return;
  if (!onDashboard() || document.querySelector('.a2hs')) return;
  const ios = isIOS();
  if (!ios && !deferredInstall) return;              // متصفح لا يدعم التثبيت الآن
  const el = document.createElement('div');
  el.className = 'a2hs';
  el.innerHTML = `
    <div class="ic">${icon('addbox', 22)}</div>
    <div class="tx"><b>ثبّت المنصة على شاشتك الرئيسية</b>
      ${ios
        ? 'افتح قائمة <b style="display:inline">المشاركة</b> في سفل Safari ثم اختر «إضافة إلى الشاشة الرئيسية».'
        : 'تفتح كتطبيق مستقل وتعمل أسرع، وتصلك إشعاراتها من الشاشة الرئيسية.'}
      ${!ios ? '<div style="margin-top:8px"><button class="btn btn-sm" id="a2hsGo">تثبيت الآن</button></div>' : ''}
    </div>
    <button class="x" id="a2hsX" aria-label="إخفاء">&times;</button>`;
  document.body.appendChild(el);
  autoHideCard(el);
  el.querySelector('#a2hsX').onclick = () => { localStorage.setItem('a2hs_dismissed', '1'); el.remove(); };
  const go = el.querySelector('#a2hsGo');
  if (go) go.onclick = async () => {
    el.remove();
    localStorage.setItem('a2hs_dismissed', '1');
    if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; }
  };
}

/**
 * دعوة لتفعيل الإشعارات داخل التطبيق المثبَّت.
 * على iPhone لا تُمنح الإشعارات إلا للتطبيق المضاف للشاشة الرئيسية، فبعد التثبيت
 * لا شيء يُذكّر المستخدم بتفعيلها — هذه البطاقة هي التذكير، وتظهر مرة واحدة.
 */
function maybeShowPushCard() {
  if (!isStandalone() || !Push.supported()) return;
  if (Push.permission() !== 'default') return;
  if (localStorage.getItem('push_prompt_dismissed') === '1') return;
  if (!onDashboard() || document.querySelector('.a2hs')) return;
  const el = document.createElement('div');
  el.className = 'a2hs';
  el.innerHTML = `
    <div class="ic">${icon('bell', 22)}</div>
    <div class="tx"><b>فعّل الإشعارات</b>
      تصلك تنبيهات الدعوات والتوقيعات والمهام المستحقة حتى والتطبيق مغلق.
      <div style="margin-top:8px"><button class="btn btn-sm" id="pushGo">تفعيل الآن</button></div>
    </div>
    <button class="x" id="pushX" aria-label="إخفاء">&times;</button>`;
  document.body.appendChild(el);
  autoHideCard(el);
  el.querySelector('#pushX').onclick = () => { localStorage.setItem('push_prompt_dismissed', '1'); el.remove(); };
  el.querySelector('#pushGo').onclick = async () => {
    localStorage.setItem('push_prompt_dismissed', '1');
    try { await Push.enable(); toast('فُعّلت الإشعارات على هذا الجهاز', 'ok'); }
    catch (err) { toast(err.message, 'err'); }
    el.remove();
  };
}

// ارتفاع الشريط العلوي الحقيقي — تعتمد عليه العناصر العائمة أسفله بدل أرقام ثابتة
// (يتغيّر بمنطقة الأمان في الأجهزة ذات الشقّ وبتدوير الشاشة).
function syncTopbarHeight() {
  const tb = document.querySelector('.topbar');
  if (tb) document.documentElement.style.setProperty('--topbar-h', tb.offsetHeight + 'px');
}

function initMobile() {
  if (isStandalone()) document.documentElement.classList.add('standalone');
  watchTables();
  syncTopbarHeight();
  if (!window.__topbarWatch) {
    window.__topbarWatch = true;
    addEventListener('resize', syncTopbarHeight);
    addEventListener('orientationchange', () => setTimeout(syncTopbarHeight, 250));
  }
  // تُستدعى مع كل تنقّل (إعادة بناء الهيكل)، والدعوات تظهر مرة واحدة في الجلسة
  if (!window.__a2hsScheduled) {
    window.__a2hsScheduled = true;
    setTimeout(() => { maybeShowInstallCard(); maybeShowPushCard(); }, 4000);
  }
}


// ============================================================
// إضافة موعد الاجتماع إلى التقويم الشخصي
// ============================================================
//
// طريقان يغطّيان ما يستعمله الناس: رابطٌ مباشر لتقويم Google، وملفُ ICS قياسي تفتحه
// تقاويم Apple وسامسونج وOutlook وغيرها فتُضيف الحدث. والوقت في الاثنين «عائم» بلا
// منطقة زمنية، فيظهر كما كُتب على أي جهاز بلا تحويلٍ يزحزحه ساعات.
//
// المعرّف ثابت في ملف ICS لكل اجتماع (UID) وتسلسله يعلو بكل تعديل، فمن غيّر موعده
// ثم أعاد الإضافة وجد الحدثَ نفسه قد تحدّث، لا حدثًا ثانيًا إلى جانب الأول.

const Calendar = {
  /** حقول الموعد جاهزةً — أو null إن كان الاجتماع بلا تاريخ. */
  fields(m, councilName) {
    const date = String(m.greg_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const hms = (t) => String(t).slice(0, 5).replace(':', '') + '00';
    const start = m.start_time ? hms(m.start_time) : '090000';
    // نهاية غير مذكورة = ساعة بعد البداية (لا وقتٌ ثابت قد يسبقها)
    const end = m.end_time ? hms(m.end_time)
      : String(Math.min(23, Number(start.slice(0, 2)) + 1)).padStart(2, '0') + start.slice(2);
    return {
      date, day: date.replace(/-/g, ''), start, end,
      summary: (m.title ? m.title + ' — ' : '') + (councilName || 'اجتماع المجلس'),
      location: m.location || (m.location_type === 'remote' ? 'عن بُعد' : 'حضوري'),
      details: `رقم المحضر: ${m.display_number || ''}\n${location.origin}/#/meetings/${m.id}`,
    };
  },

  googleUrl(f) {
    return 'https://calendar.google.com/calendar/render?' + new URLSearchParams({
      action: 'TEMPLATE',
      text: f.summary,
      dates: `${f.day}T${f.start}/${f.day}T${f.end}`,
      details: f.details,
      location: f.location,
    }).toString();
  },

  /** نافذة الاختيار. تُستدعى من شاشة المحضر ومن بطاقة الاجتماعات القادمة وبعد الإنشاء. */
  open(m, councilName, opts = {}) {
    const f = this.fields(m, councilName);
    if (!f) return toast('الاجتماع بلا تاريخ — حدّد التاريخ أولًا ثم أضِفه للتقويم', 'err');
    const when = `${dayNameAr(f.date)} ${arNum(f.date.replace(/-/g, '/'))}`;
    const time = m.start_time
      ? `${fmtTime(m.start_time)}${m.end_time ? ' — ' + fmtTime(m.end_time) : ''}`
      : 'الوقت غير محدّد — سيُضاف ٩:٠٠ ص لساعة';
    const { overlay, close } = openModal({
      title: opts.title || 'إضافة الموعد إلى تقويمي',
      body: `
        <div class="cal-when">
          <b>${esc(f.summary)}</b>
          <div><span class="muted">${icon('calendar2', 15)} التاريخ:</span> ${when}</div>
          <div><span class="muted">الوقت:</span> ${esc(time)}</div>
          <div><span class="muted">المكان:</span> ${esc(f.location)}</div>
        </div>
        <a class="btn btn-block mt" href="${esc(this.googleUrl(f))}" target="_blank" rel="noopener">تقويم Google</a>
        <button class="btn btn-ghost btn-block mt" id="calIcs">تقويم Apple · سامسونج · Outlook</button>
        <p class="hint mt">الزرّ الثاني يُنزّل ملف موعد قياسيًّا (‎.ics) يفتحه تطبيق التقويم في جهازك
          فيضيف الموعد ومعه تذكيرٌ قبله بساعة. وإن تغيّر الموعد لاحقًا فأعِد الإضافة —
          يُحدَّث الحدث نفسه ولا يتكرّر.</p>`,
      buttons: [{ label: 'إغلاق', class: 'btn-ghost', onClick: (cl) => cl() }],
    });
    overlay.querySelector('#calIcs').onclick = () => {
      window.location.href = '/ics/meeting/' + m.id;
      setTimeout(close, 600);        // نترك المتصفح يبدأ التنزيل قبل إغلاق النافذة
    };
  },
};

/** اسم اليوم بالعربية من تاريخ ميلادي (YYYY-MM-DD). */
function dayNameAr(date) {
  try {
    const d = new Date(date + 'T12:00:00');
    return new Intl.DateTimeFormat('ar', { weekday: 'long' }).format(d);
  } catch { return ''; }
}


// ============================================================
// سحب الشاشة للتحديث
// ============================================================
//
// إيماءة الجوال المألوفة: سحبٌ لأسفل والصفحةُ في أعلاها يُنزل حلقةً تدور، ثم تُعاد
// بناء الشاشة الحالية. المقاومة أُسّية كإيماءة النظام: أولُ السحب يستجيب وآخره يشدّ.
// وتُلغى الإيماءة حيث قد تُتلف عملًا أو تُربك تمريرًا — نافذةٌ مفتوحة، أو درجُ
// القائمة، أو محرّرٌ فيه كتابة لم تُحفظ، أو منطقةٌ لها تمريرها الرأسي.

const PullRefresh = {
  THRESHOLD: 58,      // نزول الحلقة الذي يُطلق التحديث عند رفع الإصبع
  MAX: 88,            // أقصى نزول مهما امتدّ السحب
  PARKED: -44,        // موضع الحلقة مستقرّةً: فوق النطاق فيقصّها الشريط العلوي
  el: null, ring: null, onRefresh: null,
  startY: 0, lastY: 0, pull: 0, touching: false, tracking: false, halted: false, busy: false,

  init(onRefresh) {
    this.onRefresh = onRefresh;
    if (this.el) return;
    const zone = document.createElement('div');
    zone.className = 'ptr-zone';
    zone.setAttribute('aria-hidden', 'true');   // مؤشّر بصري بحت: الحالة تُعلن في المحتوى
    zone.innerHTML = '<div class="ptr"><i></i></div>';
    document.body.appendChild(zone);
    this.el = zone.querySelector('.ptr');
    this.ring = zone.querySelector('i');
    // اللمس غير المنفعل شرطُ منع اهتزاز الصفحة تحت الإصبع أثناء السحب
    addEventListener('touchstart', (e) => this.start(e), { passive: true });
    addEventListener('touchmove', (e) => this.move(e), { passive: false });
    addEventListener('touchend', () => this.end());
    addEventListener('touchcancel', () => this.end());
  },

  atTop() { return (document.scrollingElement || document.documentElement).scrollTop <= 0; },

  /** مواضع لا تصلح فيها الإيماءة — تُترك للتمرير أو تُصان مما تُتلفه إعادةُ البناء. */
  blocked(target) {
    if (!document.getElementById('content')) return true;      // شاشة دخول أو تغيير كلمة مرور
    if (document.querySelector('.modal-overlay')) return true;
    const sb = document.getElementById('sidebar');
    if (sb && sb.classList.contains('open')) return true;
    if (document.querySelector('#content [contenteditable="true"]')) return true;  // كتابة لم تُحفظ
    for (let n = target; n && n !== document.body; n = n.parentElement) {
      if (n.scrollHeight - n.clientHeight > 2) {
        const oy = getComputedStyle(n).overflowY;
        if (oy === 'auto' || oy === 'scroll') return true;
      }
    }
    return false;
  },

  start(e) {
    this.tracking = false;
    this.touching = false;
    if (this.busy || e.touches.length !== 1) return;
    this.halted = this.blocked(e.target);
    this.touching = true;
    this.startY = this.lastY = e.touches[0].clientY;
    this.pull = 0;
    this.tracking = !this.halted && this.atTop();
  },

  move(e) {
    if (!this.touching || this.halted) return;
    if (e.touches.length !== 1) { this.cancel(); return; }
    const y = e.touches[0].clientY;
    const goingDown = y > this.lastY;
    this.lastY = y;
    // لم نكن نتتبّع لأن الصفحة كانت مُمرَّرة: نبدأ متى بلغت أعلاها والإصبع ما زال
    // ينزل — فمن يمرّر إلى الأعلى ثم يواصل النزول بلا رفع إصبعه يجد التحديث بانتظاره
    if (!this.tracking) {
      if (!goingDown || !this.atTop()) return;
      this.tracking = true;
      this.startY = y;
    }
    const dy = y - this.startY;
    if (dy <= 0) {
      // عاد لأعلى: تمريرٌ عادي — ولا نُنهي التتبّع، فقد يسحب ثانيةً بلا رفع إصبعه
      if (this.pull) { this.pull = 0; this.draw(0); }
      return;
    }
    e.preventDefault();
    this.pull = this.MAX * (1 - Math.exp(-dy / this.MAX));
    this.draw(this.pull);
  },

  draw(v) {
    const t = Math.min(1, v / this.THRESHOLD);
    this.el.style.transition = 'none';                 // أثناء السحب تتبع الحلقة الإصبع بلا تأخير
    this.el.style.opacity = String(Math.min(1, v / 16));
    this.el.style.transform = `translateY(${this.PARKED + v}px) scale(${0.85 + 0.15 * t})`;
    this.ring.style.transform = `rotate(${v * 4}deg)`;
    this.el.classList.toggle('ready', t >= 1);
  },

  async end() {
    this.touching = false;
    if (!this.tracking) return;
    this.tracking = false;
    if (this.pull < this.THRESHOLD) return this.hide();

    this.busy = true;
    this.el.style.transition = 'transform .22s ease, opacity .22s ease';
    this.el.style.opacity = '1';
    this.el.style.transform = `translateY(${this.PARKED + this.THRESHOLD}px) scale(1)`;
    this.ring.style.transform = '';                    // الدوران يتولّاه التحريك لا الإصبع
    this.el.classList.add('spin');
    const started = Date.now();
    try { await this.onRefresh(); } catch { /* الشاشة تعرض خطأها بنفسها */ }
    // ومضةٌ أقصر من أن تُرى تبدو كزرّ لم يعمل — نُبقي الحلقة لحظةً تُدرَك
    const rest = 450 - (Date.now() - started);
    if (rest > 0) await new Promise((r) => setTimeout(r, rest));
    this.busy = false;
    this.hide();
  },

  cancel() { this.tracking = this.touching = false; if (this.pull) this.hide(); },

  hide() {
    this.pull = 0;
    this.el.classList.remove('spin', 'ready');
    this.el.style.transition = 'transform .25s ease, opacity .2s ease';
    this.el.style.opacity = '0';
    this.el.style.transform = `translateY(${this.PARKED}px) scale(.85)`;
    this.ring.style.transform = '';
  },
};


// ============================================================
// إشعارات الدفع على الجهاز (متصفح الجوال وتطبيق الشاشة الرئيسية)
// ============================================================
//
// قاعدة iPhone: iOS لا يمنح إذن الإشعارات لصفحة في Safari — يمنحه فقط للتطبيق
// المضاف إلى الشاشة الرئيسية (iOS 16.4 فأحدث). لذلك نُرشد مستخدم iPhone للتثبيت
// أولًا بدل عرض زر لا يعمل.

const Push = {
  supported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  },
  // iPhone في Safari (غير مثبَّت): الإشعارات غير متاحة حتى يُضاف للشاشة الرئيسية
  iosNeedsInstall() { return isIOS() && !isStandalone(); },
  permission() { return ('Notification' in window) ? Notification.permission : 'default'; },

  async registration() {
    if (!('serviceWorker' in navigator)) return null;
    try { return await navigator.serviceWorker.ready; } catch { return null; }
  },

  async current() {
    const reg = await this.registration();
    if (!reg || !reg.pushManager) return null;
    try { return await reg.pushManager.getSubscription(); } catch { return null; }
  },

  /** حالة الإشعارات على هذا الجهاز — تُستعمل لرسم الزر ونصّه. */
  async state() {
    if (!this.supported()) {
      return { state: this.iosNeedsInstall() ? 'ios-install' : 'unsupported' };
    }
    if (this.iosNeedsInstall()) return { state: 'ios-install' };
    const perm = this.permission();
    if (perm === 'denied') return { state: 'denied' };
    const sub = await this.current();
    if (sub && perm === 'granted') return { state: 'on', endpoint: sub.endpoint };
    return { state: 'off' };
  },

  /** تفعيل الإشعارات — يجب استدعاؤها من نقرة مستخدم (شرط iOS و Safari). */
  async enable() {
    if (!this.supported()) throw new Error('هذا المتصفح لا يدعم إشعارات الدفع');
    if (this.iosNeedsInstall()) throw new Error('على iPhone: أضف المنصة إلى الشاشة الرئيسية أولًا ثم فعّل الإشعارات من داخل التطبيق');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('لم يُمنح إذن الإشعارات لهذا الجهاز');

    const { key, enabled } = await API.get('/notifications/push/key');
    if (!enabled || !key) throw new Error('الإشعارات غير مُهيّأة على الخادم');
    const reg = await this.registration();
    if (!reg) throw new Error('عامل الخدمة غير جاهز — أعد تحميل الصفحة');

    let sub = await reg.pushManager.getSubscription();
    // اشتراك قائم بمفتاح خادم مختلف لا يصلح — نُلغيه ونشترك من جديد
    if (sub && !this.sameKey(sub, key)) { try { await sub.unsubscribe(); } catch {} sub = null; }
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
    }
    await this.register(sub);
    return sub;
  },

  sameKey(sub, key) {
    try {
      const cur = sub.options && sub.options.applicationServerKey;
      if (!cur) return true;
      const a = new Uint8Array(cur), b = b64ToBytes(key);
      return a.length === b.length && a.every((v, i) => v === b[i]);
    } catch { return true; }
  },

  async register(sub) {
    const json = sub.toJSON ? sub.toJSON() : sub;
    await API.post('/notifications/push/subscribe', {
      endpoint: json.endpoint, keys: json.keys, standalone: isStandalone(),
    });
  },

  /** إعادة تسجيل هذا الجهاز من الصفر — علاجُ اشتراكٍ بطل أو مفتاحٍ لم يعد مطابقًا. */
  async reregister() {
    await this.disable();
    return await this.enable();
  },

  async disable() {
    const sub = await this.current();
    if (sub) {
      try { await API.post('/notifications/push/unsubscribe', { endpoint: sub.endpoint }); } catch {}
      try { await sub.unsubscribe(); } catch {}
    }
  },

  /** مزامنة صامتة عند الإقلاع: جهاز مأذون له يبقى مسجَّلًا على الخادم. */
  async syncSilently() {
    try {
      if (!this.supported() || this.permission() !== 'granted') return;
      const reg = await this.registration();
      if (!reg || !reg.pushManager) return;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) return;
      // مفتاح الخادم قد يتبدّل (إعادة تهيئة أو توليد جديد)، والاشتراك القديم يبقى
      // يبدو «مفعَّلًا» بينما ترفض خدمةُ الدفع كل إشعار. نكتشفه هنا ونشترك من جديد
      // بلا إزعاج — والإذن ممنوح أصلًا فلا حاجة إلى نقرة.
      const { key, enabled } = await API.get('/notifications/push/key');
      if (enabled && key && !this.sameKey(sub, key)) {
        try { await sub.unsubscribe(); } catch {}
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
      }
      await this.register(sub);
    } catch { /* غير حرج */ }
  },
};

// مفتاح الخادم يصل بترميز base64url ويحتاجه المتصفح كبايتات
function b64ToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// شارة العدد على أيقونة التطبيق (الشاشة الرئيسية) — تُحدَّث مع شارة الجرس
function setAppBadge(n) {
  try {
    if (!('setAppBadge' in navigator)) return;
    if (n > 0) navigator.setAppBadge(n); else navigator.clearAppBadge();
  } catch { /* غير مدعوم */ }
}
