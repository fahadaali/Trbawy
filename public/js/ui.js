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
