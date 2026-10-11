// تصدير صفحات الطباعة (المحضر · حزمة المحاضر · تقرير الطالب) إلى ملف PDF حقيقي.
//
// لماذا: على الجوال — وخاصةً التطبيق المثبَّت على الشاشة الرئيسية في iPhone — فتحُ
// نافذة جديدة ثم استدعاء window.print() لا يُخرج شيئًا: النافذة تُفتح في متصفح
// منفصل بلا جلسة الدخول، أو لا تتوفّر فيها نافذة الطباعة أصلًا. فنبني الملف هنا
// داخل التطبيق نفسه: نحمّل صفحة الطباعة في إطار مخفي (بجلسة التطبيق)، نقسّمها صفحات
// A4 بقواعد الطباعة نفسها، نرسم كل صفحة صورةً، ونجمعها في ملف PDF يُشارَك أو يُحفظ.
// أما الحاسوب فيبقى على الطباعة الأصلية للمتصفح — أدقّ ونصّها قابل للتحديد.

const PdfExport = (() => {
  const LIBS = ['/js/vendor/html2canvas-1.4.1.min.js', '/js/vendor/jspdf-4.2.1.umd.min.js'];

  // مقاسات A4 وهوامش @page في صفحة الطباعة (12mm أعلى · 14mm يمين ويسار وأسفل)
  const MM = 96 / 25.4;                 // بكسل CSS لكل ملّيمتر
  const PAGE_W = 210, PAGE_H = 297;
  const M_TOP = 12, M_SIDE = 14, M_BOTTOM = 14;
  const CONTENT_W_MM = PAGE_W - 2 * M_SIDE;          // 182mm
  const CONTENT_H_MM = PAGE_H - M_TOP - M_BOTTOM;    // 271mm
  const CONTENT_W = Math.round(CONTENT_W_MM * MM);   // ≈ 688px
  // عرض الإطار أوسع من 760px عمدًا: دونه تنطبق أنماط «قراءة الجوال» في صفحة الطباعة
  const FRAME_W = 820;
  const SCALE = 2;                       // دقة الرسم — نصٌّ واضح دون تضخيم الملف
  const PAGES_PER_SHOT = 3;              // سقف مساحة اللوحة في Safari (~16 مليون بكسل)

  /** الجوال واللوحي: شاشة لمس بلا مؤشر دقيق، أو التطبيق مثبّتًا على الشاشة الرئيسية. */
  function isMobile() {
    const standalone = window.navigator.standalone === true
      || window.matchMedia('(display-mode: standalone)').matches;
    return standalone || window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  }

  function loadScript(doc, src) {
    return new Promise((resolve, reject) => {
      const s = doc.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('تعذّر تحميل أداة التصدير — تحقّق من الاتصال'));
      doc.head.appendChild(s);
    });
  }

  const nextFrame = (w) => new Promise((r) => w.requestAnimationFrame(() => r()));

  /** يحمّل صفحة الطباعة في إطار مخفي بجلسة التطبيق، ومعها أداتا الرسم داخل الإطار نفسه. */
  function loadFrame(url) {
    return new Promise((resolve, reject) => {
      const ifr = document.createElement('iframe');
      ifr.setAttribute('aria-hidden', 'true');
      ifr.tabIndex = -1;
      ifr.style.cssText = `position:fixed;top:0;left:-${FRAME_W + 2000}px;width:${FRAME_W}px;height:1200px;border:0;pointer-events:none;`;
      const timer = setTimeout(() => { ifr.remove(); reject(new Error('انتهت مهلة تحميل المحضر')); }, 45000);
      ifr.onload = async () => {
        clearTimeout(timer);
        try {
          const d = ifr.contentDocument;
          // الجلسة انتهت أو لا صلاحية: الخادم يعيد التوجيه إلى الواجهة أو نصًّا قصيرًا
          if (!d || !d.querySelector('.frame')) {
            const msg = d && d.body ? d.body.textContent.trim().slice(0, 120) : '';
            throw new Error(msg && !d.querySelector('#app') ? msg : 'تعذّر فتح المحضر — أعد تحميل الصفحة وحاول مجددًا');
          }
          // الأداتان تُحمَّلان داخل الإطار: تعمل كلٌّ منهما على مستند نافذتها
          for (const src of LIBS) await loadScript(d, src);
          resolve(ifr);
        } catch (err) { ifr.remove(); reject(err); }
      };
      ifr.src = url;
      document.body.appendChild(ifr);
    });
  }

  /** يجهّز مستند الإطار ليطابق الورق: يلغي زخرفة الشاشة ويثبّت عرض المحتوى على عرض A4. */
  async function prepare(d, w) {
    const st = d.createElement('style');
    st.textContent = `
      html, body { background: #fff !important; padding: 0 !important; margin: 0 !important; }
      .sheet { width: ${CONTENT_W}px !important; max-width: none !important; padding: 0 !important;
        margin: 0 !important; box-shadow: none !important; border-radius: 0 !important; background: #fff !important; }
      .pactions, .watermark { display: none !important; }`;
    d.head.appendChild(st);

    // الخطوط والصور قبل أي قياس: تغيّرها بعد القياس يزيح كل حدود الصفحات
    try { if (d.fonts && d.fonts.ready) await d.fonts.ready; } catch { /* يكفي الخط الاحتياطي */ }
    await Promise.all([...d.images].map((img) => (img.complete ? null : new Promise((r) => {
      img.onload = img.onerror = r;
    }))));

    // أرقام القوائم ونقاطها لا ترسمها أداة الرسم في الاتجاه العربي — نحوّلها نصًّا
    // حقيقيًّا في موضعها نفسه (خارج السطر، على يمينه) فتظهر كما في الورق
    d.querySelectorAll('ol, ul').forEach((list) => {
      const ordered = list.tagName === 'OL';
      let n = ordered ? (parseInt(list.getAttribute('start'), 10) || 1) : 0;
      [...list.children].forEach((li) => {
        if (li.tagName !== 'LI') return;
        const cs = w.getComputedStyle(li);
        if (cs.display !== 'list-item' || cs.listStyleType === 'none') return;
        if (ordered && li.hasAttribute('value')) n = parseInt(li.getAttribute('value'), 10) || n;
        const mk = d.createElement('span');
        mk.textContent = ordered ? `${n++}.` : (cs.listStyleType === 'circle' ? '◦' : cs.listStyleType === 'square' ? '▪' : '•');
        mk.style.cssText = 'position:absolute;top:0;inset-inline-end:100%;padding-inline-end:.4em;'
          + 'white-space:nowrap;font-weight:400;unicode-bidi:isolate;';
        if (cs.position === 'static') li.style.position = 'relative';
        li.style.listStyleType = 'none';
        li.insertBefore(mk, li.firstChild);
      });
    });

    // الرسوم البيانية SVG تُرسم صورةً مستقلة لا ترى أنماط الصفحة — ننسخ ألوانها وخطّها إليها
    d.querySelectorAll('svg *').forEach((el) => {
      const cs = w.getComputedStyle(el);
      const keep = ['fill', 'stroke', 'stroke-width', 'opacity', 'font-size', 'font-weight', 'font-family'];
      el.setAttribute('style', keep.map((k) => `${k}:${cs.getPropertyValue(k)}`).join(';') + ';' + (el.getAttribute('style') || ''));
    });
    await nextFrame(w);
  }

  // عناصر لا تُشطر بين صفحتين (كأنها كتلة واحدة) — والأكبر من صفحة يُترك ليُشطر
  const ATOMIC = '.sec, h1, h2, h3, .note, .banner, .dash, .panels, .kpis, .verify, .meta, tr, '
    + 'ol.agenda > li, .body-rich > *, p, blockquote, img, svg, .sig';
  // عناوين تلازم ما بعدها: لا تبقى وحدها في ذيل صفحة
  const KEEP_WITH_NEXT = 'h1, h2, h3, .note, thead tr';

  /**
   * يقسّم المحتوى صفحاتٍ بإدراج فواصل فارغة: قسمٌ جديد يبدأ من رأس صفحة، وعنصرٌ
   * لا يسعه ما بقي من الصفحة ينتقل كاملًا إلى التالية، وصفّ الجدول المنقول يسبقه
   * رأسُ جدوله مكررًا. يعيد عدد الصفحات.
   */
  function paginate(d, w, root, frameRow, H) {
    const top = (el) => el.getBoundingClientRect().top - root.getBoundingClientRect().top;
    const bottom = (el) => el.getBoundingClientRect().bottom - root.getBoundingClientRect().top;

    const spacerFor = (el) => {
      if (el.tagName === 'TR') {
        const tr = d.createElement('tr');
        tr.setAttribute('data-pdf-spacer', '');
        const td = d.createElement('td');
        td.colSpan = 99;
        td.style.cssText = 'padding:0 !important;border:0 !important;background:transparent !important;height:0;';
        tr.appendChild(td);
        return { node: tr, setH: (h) => { td.style.height = Math.max(0, h) + 'px'; } };
      }
      const div = d.createElement('div');
      div.setAttribute('data-pdf-spacer', '');
      div.style.cssText = 'display:block;margin:0;padding:0;border:0;height:0;';
      return { node: div, setH: (h) => { div.style.height = Math.max(0, h) + 'px'; } };
    };

    // يدفع العنصر إلى رأس الصفحة التالية، ويصحّح الفاصل بالقياس (انطباق الهوامش يغيّر المسافة)
    const pushToNextPage = (el) => {
      const target = (Math.floor(top(el) / H) + 1) * H;
      const sp = spacerFor(el);
      el.parentNode.insertBefore(sp.node, el);
      let h = target - top(el);
      for (let i = 0; i < 3; i++) {
        sp.setH(h);
        const diff = target - top(el);
        if (Math.abs(diff) < 0.5) break;
        h += diff;
      }
      // صفّ جدولٍ انتقل: نكرّر رأس جدوله فوقه ليُقرأ وحده في صفحته الجديدة
      if (el.tagName === 'TR' && el.parentNode.tagName === 'TBODY') {
        const thead = el.closest('table').tHead;
        if (thead && thead.rows.length) {
          const clone = thead.rows[0].cloneNode(true);
          clone.setAttribute('data-pdf-spacer', '');
          el.parentNode.insertBefore(clone, el);
        } else {
          // يحفظ تناوب ألوان الصفوف (nth-child) كما كان
          const keep = d.createElement('tr');
          keep.style.display = 'none';
          keep.setAttribute('data-pdf-spacer', '');
          el.parentNode.insertBefore(keep, el);
        }
      }
    };

    const blocked = (el) => {
      // داخل صفّ جدول (غير إطار الصفحة نفسه): الصفّ هو الكتلة لا ما بداخله
      const tr = el.parentElement && el.parentElement.closest('tr');
      if (tr && tr !== frameRow && root.contains(tr)) return true;
      // داخل حاوية مرنة/شبكية: الفاصل يكسر ترتيبها — حاويتها تُعامل كتلةً واحدة
      const pd = w.getComputedStyle(el.parentElement).display;
      return el.tagName !== 'TR' && /flex|grid/.test(pd);
    };

    const items = [...root.querySelectorAll(ATOMIC)];
    for (const el of items) {
      if (!el.isConnected || blocked(el)) continue;
      const r = el.getBoundingClientRect();
      if (!r.height) continue;
      const t = top(el);
      const offset = t - Math.floor(t / H) * H;

      // قسمٌ جديد يبدأ صفحته (كقاعدة break-before: page في الطباعة) — والقسم نفسه
      // ليس كتلةً واحدة: يمتدّ على ما يحتاجه من صفحات كما في الورق
      if (el.matches('.sec')) {
        const cs = w.getComputedStyle(el);
        const forced = cs.breakBefore === 'page' || cs.pageBreakBefore === 'always';
        if (forced && offset > 1) pushToNextPage(el);
        continue;
      }

      let h = bottom(el) - t;
      if (el.matches(KEEP_WITH_NEXT)) h += 48;   // يكفي ليظهر بعده سطرٌ أو صفّ على الأقل
      const pageEnd = (Math.floor(t / H) + 1) * H;
      if (h <= H && t + h > pageEnd + 0.5 && offset > 1) pushToNextPage(el);
    }
    return Math.max(1, Math.ceil((root.getBoundingClientRect().height - 0.5) / H));
  }

  function canvasToJpeg(canvas) { return canvas.toDataURL('image/jpeg', 0.92); }

  /** يبني ملف PDF من صفحة طباعة. onProgress(نص). */
  async function build(path, onProgress) {
    onProgress && onProgress('جارٍ تحميل المحضر…');
    const ifr = await loadFrame(path);
    try {
      const d = ifr.contentDocument, w = ifr.contentWindow;
      await prepare(d, w);
      const h2c = w.html2canvas;
      const { jsPDF, GState } = w.jspdf;

      const frame = d.querySelector('.frame');
      const headCell = frame.tHead && frame.tHead.rows[0] && frame.tHead.rows[0].cells[0];
      const footCell = frame.tFoot && frame.tFoot.rows[0] && frame.tFoot.rows[0].cells[0];
      const root = frame.tBodies[0].rows[0].cells[0];
      const frameRow = root.parentElement;
      const wmImg = d.querySelector('.watermark img');

      onProgress && onProgress('جارٍ تجهيز الترويسة…');
      const shot = (el, extra = {}) => h2c(el, {
        scale: SCALE, backgroundColor: '#ffffff', useCORS: true, logging: false,
        windowWidth: FRAME_W, ...extra,
      });
      // الترويسة والتذييل يُرسمان مرةً ويُختمان على كل صفحة (كما يكرّرهما الورق)
      const headCanvas = headCell ? await shot(headCell) : null;
      const footCanvas = footCell ? await shot(footCell) : null;
      const headH = headCell ? headCell.getBoundingClientRect().height : 0;
      const footH = footCell ? footCell.getBoundingClientRect().height : 0;
      if (frame.tHead) frame.tHead.style.display = 'none';
      if (frame.tFoot) frame.tFoot.style.display = 'none';
      await nextFrame(w);

      const H = Math.floor(CONTENT_H_MM * MM - headH - footH);
      onProgress && onProgress('جارٍ تقسيم الصفحات…');
      const pages = paginate(d, w, root, frameRow, H);
      await nextFrame(w);

      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
      const pxToMm = (px) => px / MM;
      const headImg = headCanvas ? canvasToJpeg(headCanvas) : null;
      const footImg = footCanvas ? canvasToJpeg(footCanvas) : null;

      // العلامة المائية: في المنتصف بشفافية خفيفة (كما في الورق: 55% من العرض)
      let wm = null;
      if (wmImg && wmImg.naturalWidth) {
        const c = d.createElement('canvas');
        c.width = wmImg.naturalWidth; c.height = wmImg.naturalHeight;
        c.getContext('2d').drawImage(wmImg, 0, 0);
        const wMm = Math.min(CONTENT_W_MM * 0.55, pxToMm(wmImg.naturalWidth));
        wm = { data: c.toDataURL('image/png'), w: wMm, h: wMm * wmImg.naturalHeight / wmImg.naturalWidth };
      }

      for (let start = 0; start < pages; start += PAGES_PER_SHOT) {
        const count = Math.min(PAGES_PER_SHOT, pages - start);
        onProgress && onProgress(`جارٍ رسم الصفحات ${start + 1}–${start + count} من ${pages}…`);
        const big = await shot(root, { y: start * H, height: count * H, width: CONTENT_W });
        for (let i = 0; i < count; i++) {
          const slice = d.createElement('canvas');
          slice.width = big.width;
          slice.height = Math.round(H * SCALE);
          const ctx = slice.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, slice.width, slice.height);
          ctx.drawImage(big, 0, Math.round(i * H * SCALE), big.width, slice.height, 0, 0, slice.width, slice.height);

          if (start + i > 0) pdf.addPage('a4', 'portrait');
          if (headImg) pdf.addImage(headImg, 'JPEG', M_SIDE, M_TOP, CONTENT_W_MM, pxToMm(headH));
          pdf.addImage(canvasToJpeg(slice), 'JPEG', M_SIDE, M_TOP + pxToMm(headH), CONTENT_W_MM, pxToMm(H));
          if (footImg) pdf.addImage(footImg, 'JPEG', M_SIDE, PAGE_H - M_BOTTOM - pxToMm(footH), CONTENT_W_MM, pxToMm(footH));
          if (wm) {
            pdf.setGState(new GState({ opacity: 0.05 }));
            pdf.addImage(wm.data, 'PNG', (PAGE_W - wm.w) / 2, (PAGE_H - wm.h) / 2, wm.w, wm.h);
            pdf.setGState(new GState({ opacity: 1 }));
          }
        }
        big.width = big.height = 0;   // تحرير ذاكرة اللوحة فورًا (مهم على iPhone)
      }

      const title = (d.title || 'محضر').trim();
      pdf.setProperties({ title });
      const name = title.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) + '.pdf';
      return { blob: pdf.output('blob'), name, title };
    } finally {
      ifr.remove();
    }
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  /** نافذة التصدير على الجوال: تبني الملف ثم تعرض «مشاركة/حفظ» و«تنزيل». */
  function exportOnPhone(path) {
    const { overlay, close } = openModal({
      title: 'تصدير PDF',
      body: `<div class="pdfx">
        <div class="spinner"></div>
        <p class="center muted" id="pdfxMsg">جارٍ تجهيز الملف…</p>
        <div id="pdfxActions" hidden></div>
      </div>`,
    });
    const msg = overlay.querySelector('#pdfxMsg');
    const spin = overlay.querySelector('.spinner');
    const actions = overlay.querySelector('#pdfxActions');
    let alive = true;
    const xBtn = overlay.querySelector('.x');
    const origClose = xBtn.onclick;
    xBtn.onclick = () => { alive = false; origClose(); };

    build(path, (t) => { if (alive) msg.textContent = t; })
      .then(({ blob, name, title }) => {
        if (!alive) return;
        spin.remove();
        const file = new File([blob], name, { type: 'application/pdf' });
        const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
        msg.innerHTML = `الملف جاهز: <b dir="auto">${esc(name)}</b>`;
        // المشاركة تحتاج لمسة جديدة من المستخدم — لذا زرٌّ لا استدعاء تلقائي بعد البناء
        actions.innerHTML = `
          ${canShare ? `<button class="btn btn-block" id="pdfxShare">${icon('share', 16)} مشاركة / حفظ في الملفات</button>` : ''}
          <button class="btn ${canShare ? 'btn-ghost' : ''} btn-block mt" id="pdfxDl">${icon('download', 16)} تنزيل الملف</button>`;
        actions.hidden = false;
        const shareBtn = actions.querySelector('#pdfxShare');
        if (shareBtn) shareBtn.onclick = () => {
          navigator.share({ files: [file], title }).catch((err) => {
            if (err && err.name !== 'AbortError') download(blob, name);
          });
        };
        actions.querySelector('#pdfxDl').onclick = () => download(blob, name);
      })
      .catch((err) => {
        if (!alive) return;
        spin.remove();
        msg.textContent = (err && err.message) || 'تعذّر إنشاء الملف';
        actions.innerHTML = `<button class="btn btn-block" id="pdfxRetry">إعادة المحاولة</button>`;
        actions.hidden = false;
        actions.querySelector('#pdfxRetry').onclick = () => { alive = false; close(); exportOnPhone(path); };
      });
  }

  /**
   * نقطة الدخول الوحيدة لكل أزرار «طباعة / تصدير PDF».
   * path: مسار صفحة الطباعة بلا print=1 (مثل /print/meeting/12).
   */
  function open(path) {
    if (isMobile()) return exportOnPhone(path);
    window.open(path + (path.includes('?') ? '&' : '?') + 'print=1', '_blank');
  }

  return { open, build, isMobile };
})();
