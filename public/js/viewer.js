// المستعرض الموحّد — نافذة معاينة واحدة لكل الصيغ داخل المنصة (على نمط «المعاينة السريعة»):
//   PDF · صور · فيديو · صوت · وورد · إكسل · بوربوينت · نصوص وCSV.
// كل التحليل يجري في المتصفح بلا مكتبات خارجية (قارئ ZIP/XML في xlsx.js)، والمحتوى
// يُجلب من مسار الملف المُصرَّح فتبقى الصلاحيات هي نفسها في العرض والتنزيل.

const Viewer = {
  items: [],
  index: 0,
  el: null,
  urls: [],            // روابط blob تُحرَّر عند الإغلاق
  onChange: null,      // يُستدعى بعد كل تعديل من داخل المستعرض (استبدال مثلاً)

  /** فتح المعاينة على ملف من قائمة (الأسهم تتنقّل داخلها). */
  open(items, index = 0, opts = {}) {
    this.items = (items || []).filter((f) => f && f.id);
    if (!this.items.length) return;
    this.index = Math.max(0, Math.min(index, this.items.length - 1));
    this.onChange = opts.onChange || null;
    this.mount();
    this.show();
  },

  mount() {
    if (this.el) return;
    const el = document.createElement('div');
    el.className = 'qlook';
    el.innerHTML = `
      <div class="ql-bar">
        <button class="ql-x" title="إغلاق (Esc)" aria-label="إغلاق">&times;</button>
        <div class="ql-title"><b id="qlName"></b><span id="qlMeta"></span></div>
        <div class="ql-tools" id="qlTools"></div>
      </div>
      <div class="ql-stage" id="qlStage"></div>
      <div class="ql-nav" id="qlNav"></div>`;
    document.body.appendChild(el);
    this.el = el;
    el.querySelector('.ql-x').onclick = () => this.close();
    el.addEventListener('mousedown', (e) => { if (e.target === el || e.target.id === 'qlStage') this.close(); });
    this._key = (e) => {
      if (!this.el) return;
      if (e.key === 'Escape') this.close();
      else if (e.key === 'ArrowLeft') this.go(1);      // في الاتجاه العربي: التالي يسارًا
      else if (e.key === 'ArrowRight') this.go(-1);
    };
    document.addEventListener('keydown', this._key);
    document.body.style.overflow = 'hidden';
  },

  close() {
    if (!this.el) return;
    document.removeEventListener('keydown', this._key);
    this.revoke();
    this.el.remove();
    this.el = null;
    document.body.style.overflow = '';
  },

  revoke() {
    this.urls.forEach((u) => { try { URL.revokeObjectURL(u); } catch {} });
    this.urls = [];
  },

  go(step) {
    const next = this.index + step;
    if (next < 0 || next >= this.items.length) return;
    this.index = next;
    this.show();
  },

  /** تحديث بطاقة الملف الحالي بعد تعديل خارجي (استبدال أو إعادة تسمية). */
  refresh(patch) {
    Object.assign(this.items[this.index], patch || {});
    this.show();
  },

  async show() {
    this.revoke();
    const f = this.items[this.index];
    const el = this.el;
    el.querySelector('#qlName').textContent = f.name;
    el.querySelector('#qlMeta').textContent =
      [FILE_CAT_AR[f.category] || 'ملف', fileSize(f.size), f.version > 1 ? 'الإصدار ' + arNum(f.version) : '']
        .filter(Boolean).join(' · ');

    // الأدوات: تنزيل دائمًا، والاستبدال والسجل بحسب الصلاحية
    const tools = el.querySelector('#qlTools');
    tools.innerHTML = `
      <a class="ql-btn" href="/api/files/${f.id}/download" title="تنزيل">${icon('download', 17)}<span>تنزيل</span></a>
      <button class="ql-btn" id="qlHist" title="سجل الملف">${icon('audit', 17)}<span>السجل</span></button>
      ${f.can_edit ? `<button class="ql-btn" id="qlRepl" title="استبدال الملف">${icon('replace', 17)}<span>استبدال</span></button>` : ''}
      <a class="ql-btn only-desktop" href="${this.rawUrl(f)}" target="_blank" rel="noopener" title="فتح في نافذة">${icon('external', 17)}<span>نافذة</span></a>`;
    tools.querySelector('#qlHist').onclick = () => fileHistoryDialog(f);
    const repl = tools.querySelector('#qlRepl');
    if (repl) repl.onclick = () => replaceFileDialog(f, (patch) => {
      this.refresh(patch);
      if (this.onChange) this.onChange();
    });

    // شريط التنقّل بين ملفات القائمة نفسها
    const nav = el.querySelector('#qlNav');
    nav.innerHTML = this.items.length > 1 ? `
      <button class="ql-arrow" id="qlPrev" ${this.index === 0 ? 'disabled' : ''} aria-label="السابق">›</button>
      <span>${arNum(this.index + 1)} من ${arNum(this.items.length)}</span>
      <button class="ql-arrow" id="qlNext" ${this.index === this.items.length - 1 ? 'disabled' : ''} aria-label="التالي">‹</button>` : '';
    if (this.items.length > 1) {
      nav.querySelector('#qlPrev').onclick = () => this.go(-1);
      nav.querySelector('#qlNext').onclick = () => this.go(1);
    }

    const stage = el.querySelector('#qlStage');
    stage.innerHTML = '<div class="spinner" style="margin:60px auto"></div>';
    const token = (this._token = Symbol('render'));
    try {
      const node = await this.render(f);
      if (token !== this._token) return;             // انتقل المستخدم إلى ملف آخر أثناء التحميل
      stage.innerHTML = '';
      stage.appendChild(node);
    } catch (err) {
      if (token !== this._token) return;
      stage.innerHTML = `<div class="ql-fallback">
        <div class="ic">${icon('warning', 40)}</div>
        <p>تعذّرت المعاينة داخل المنصة</p>
        <span>${esc(err.message || 'صيغة غير مدعومة')}</span>
        <a class="btn btn-sm" href="/api/files/${f.id}/download">تنزيل الملف</a></div>`;
    }
  },

  // الاسم جزءٌ من الرابط ليظهر في عنوان مستعرض PDF المدمج وفي ما يحفظه المستخدم منه
  rawUrl(f) { return `/api/files/${f.id}/raw/${encodeURIComponent(f.name)}`; },

  async blobOf(f) {
    const res = await fetch(this.rawUrl(f), { credentials: 'same-origin' });
    if (!res.ok) throw new Error(res.status === 403 ? 'لا تملك صلاحية الاطلاع' : 'تعذّر تحميل الملف');
    return await res.blob();
  },

  async textOf(f, limit = 2 * 1024 * 1024) {
    const blob = await this.blobOf(f);
    const buf = await blob.slice(0, limit).arrayBuffer();
    const utf8 = new TextDecoder('utf-8').decode(buf);
    // مثل ملفات CSV القادمة من إكسل العربي: نُعيد القراءة بترميز ويندوز عند التشويه
    if (!utf8.includes('�')) return { text: utf8, truncated: blob.size > limit };
    try {
      const cp = new TextDecoder('windows-1256').decode(buf);
      return { text: cp.includes('�') ? utf8 : cp, truncated: blob.size > limit };
    } catch { return { text: utf8, truncated: blob.size > limit }; }
  },

  /** يختار المستعرض المناسب للصنف ويُرجع عنصر DOM جاهزًا. */
  async render(f) {
    const ext = (f.ext || '').toLowerCase();
    switch (f.category) {
      case 'image': return this.renderImage(f);
      case 'video': return this.renderMedia(f, 'video');
      case 'audio': return this.renderMedia(f, 'audio');
      case 'pdf': return this.renderPdf(f);
      case 'sheet': return ['xlsx', 'xlsm'].includes(ext) ? await this.renderWorkbook(f) : await this.renderDelimited(f);
      case 'doc':
        if (ext !== 'docx') throw new Error('صيغة وورد القديمة (.doc) لا تُعاين — احفظه بصيغة .docx');
        return await this.renderDocx(f);
      case 'slide':
        if (ext !== 'pptx') throw new Error('صيغة العرض القديمة (.ppt) لا تُعاين — احفظه بصيغة .pptx');
        return await this.renderPptx(f);
      case 'text': return await this.renderText(f);
      default: throw new Error('لا مستعرض لهذه الصيغة');
    }
  },

  // ---------- صورة (مع تكبير وتحريك) ----------
  renderImage(f) {
    const wrap = document.createElement('div');
    wrap.className = 'ql-image-wrap';
    wrap.innerHTML = `<img class="ql-img" src="${this.rawUrl(f)}" alt="${esc(f.name)}" />
      <div class="ql-zoom">
        <button data-z="out" aria-label="تصغير">−</button>
        <button data-z="fit">ملء</button>
        <button data-z="in" aria-label="تكبير">+</button>
      </div>`;
    const img = wrap.querySelector('img');
    let scale = 1, x = 0, y = 0, drag = null;
    const apply = () => { img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`; };
    const zoom = (factor) => { scale = Math.max(0.2, Math.min(8, scale * factor)); apply(); };
    wrap.querySelectorAll('[data-z]').forEach((b) => b.onclick = (e) => {
      e.stopPropagation();
      const z = b.dataset.z;
      if (z === 'in') zoom(1.25);
      else if (z === 'out') zoom(0.8);
      else { scale = 1; x = 0; y = 0; apply(); }
    });
    img.onwheel = (e) => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.1 : 0.9); };
    img.ondblclick = () => { scale = scale > 1 ? 1 : 2; x = 0; y = 0; apply(); };
    img.onmousedown = (e) => { e.preventDefault(); drag = { sx: e.clientX - x, sy: e.clientY - y }; };
    window.addEventListener('mousemove', (e) => { if (drag) { x = e.clientX - drag.sx; y = e.clientY - drag.sy; apply(); } });
    window.addEventListener('mouseup', () => { drag = null; });
    img.onerror = () => { wrap.innerHTML = '<div class="ql-fallback"><p>تعذّر عرض الصورة</p></div>'; };
    return wrap;
  },

  // ---------- فيديو وصوت (يدعم التنقّل داخل المقطع عبر Range) ----------
  renderMedia(f, kind) {
    const wrap = document.createElement('div');
    wrap.className = 'ql-media';
    wrap.innerHTML = kind === 'video'
      ? `<video class="ql-video" src="${this.rawUrl(f)}" controls playsinline preload="metadata"></video>`
      : `<div class="ql-audio">
           <div class="ic">${icon('mic', 44)}</div>
           <b>${esc(f.name)}</b>
           <audio src="${this.rawUrl(f)}" controls preload="metadata"></audio>
         </div>`;
    return wrap;
  },

  // ---------- PDF ----------
  renderPdf(f) {
    const wrap = document.createElement('div');
    wrap.className = 'ql-doc-frame';
    wrap.innerHTML = `<iframe class="ql-frame" src="${this.rawUrl(f)}#view=FitH" title="${esc(f.name)}"></iframe>
      <div class="ql-hint only-mobile">إن لم تظهر كل الصفحات على الجوال، افتح الملف في نافذة مستقلة:
        <a href="${this.rawUrl(f)}" target="_blank" rel="noopener">فتح</a></div>`;
    return wrap;
  },

  // ---------- مصنّف إكسل ----------
  async renderWorkbook(f) {
    const sheets = await readXlsxWorkbook(await this.blobOf(f));
    const wrap = document.createElement('div');
    wrap.className = 'ql-sheet';
    const tabs = sheets.map((s, i) => `<button class="ql-tab ${i === 0 ? 'active' : ''}" data-i="${i}">${esc(s.name)}</button>`).join('');
    wrap.innerHTML = `${sheets.length > 1 ? `<div class="ql-tabs">${tabs}</div>` : ''}<div class="ql-sheet-body"></div>`;
    const body = wrap.querySelector('.ql-sheet-body');
    const draw = (i) => { body.innerHTML = sheetTableHtml(sheets[i].rows); };
    wrap.querySelectorAll('.ql-tab').forEach((b) => b.onclick = () => {
      wrap.querySelectorAll('.ql-tab').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      draw(+b.dataset.i);
    });
    draw(0);
    return wrap;
  },

  // ---------- CSV / TSV ----------
  async renderDelimited(f) {
    const { text, truncated } = await this.textOf(f);
    const rows = parseDelimited(text, (f.ext || '') === 'tsv' ? '\t' : null);
    const wrap = document.createElement('div');
    wrap.className = 'ql-sheet';
    wrap.innerHTML = `<div class="ql-sheet-body">${sheetTableHtml(rows)}</div>
      ${truncated ? '<div class="ql-hint">عُرض أول جزء من الملف لضخامته — نزّله لعرضه كاملاً</div>' : ''}`;
    return wrap;
  },

  // ---------- مستند وورد ----------
  async renderDocx(f) {
    const { html, urls } = await readDocxHtml(await this.blobOf(f));
    this.urls.push(...urls);
    const wrap = document.createElement('div');
    wrap.className = 'ql-paper';
    wrap.innerHTML = `<div class="ql-page doc-view">${html}</div>`;
    return wrap;
  },

  // ---------- عرض بوربوينت ----------
  async renderPptx(f) {
    const slides = await readPptxSlides(await this.blobOf(f));
    const wrap = document.createElement('div');
    wrap.className = 'ql-paper';
    wrap.innerHTML = `<div class="ql-slides">${slides.map((s) => `
      <div class="ql-slide">
        <div class="n">شريحة ${arNum(s.index)}</div>
        ${s.lines.length
          ? `<h4>${esc(s.lines[0])}</h4>${s.lines.slice(1).map((l) => `<p>${esc(l)}</p>`).join('')}`
          : '<p class="muted">شريحة بلا نص (صور أو أشكال)</p>'}
      </div>`).join('')}</div>
      <div class="ql-hint">تُعرض نصوص الشرائح بترتيبها — للتصميم الكامل نزّل العرض</div>`;
    return wrap;
  },

  // ---------- نصوص ----------
  async renderText(f) {
    const { text, truncated } = await this.textOf(f);
    let body = text;
    if ((f.ext || '') === 'json') { try { body = JSON.stringify(JSON.parse(text), null, 2); } catch {} }
    const wrap = document.createElement('div');
    wrap.className = 'ql-paper';
    const ltr = (f.ext || '') !== 'md' && (f.ext || '') !== 'txt';
    wrap.innerHTML = `<pre class="ql-text${ltr ? ' ltr' : ''}">${esc(body)}</pre>
      ${truncated ? '<div class="ql-hint">عُرض أول جزء من الملف لضخامته</div>' : ''}`;
    return wrap;
  },
};

/** جدول معاينة لصفوف ورقة — أول صف ترويسة، وترقيم الصفوف على اليمين. */
function sheetTableHtml(rows) {
  if (!rows || !rows.length) return '<div class="empty" style="padding:30px">الورقة فارغة</div>';
  const width = rows.reduce((n, r) => Math.max(n, r.length), 0);
  const cell = (v) => esc(String(v ?? ''));
  const head = rows[0];
  const body = rows.slice(1, 2000);
  return `<div class="ql-table-scroll"><table class="ql-table">
    <thead><tr><th class="rn"></th>${Array.from({ length: width }, (_, i) => `<th>${cell(head[i])}</th>`).join('')}</tr></thead>
    <tbody>${body.map((r, i) => `<tr><td class="rn">${arNum(i + 2)}</td>${
      Array.from({ length: width }, (_, j) => `<td>${cell(r[j])}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>${rows.length > 2001 ? '<div class="ql-hint">عُرض أول ألفَي صف</div>' : ''}`;
}
