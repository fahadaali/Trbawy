// قارئ Excel (.xlsx) في المتصفح — بلا مكتبات خارجية.
// ملف xlsx هو أرشيف ZIP يحوي XML؛ نفك الضغط عبر DecompressionStream('deflate-raw')
// ثم نقرأ ورقة العمل الأولى وجدول النصوص المشتركة، ونُخرج صفوفًا (ثم CSV).

// ---------- فك أرشيف ZIP ----------
async function unzip(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  const u8 = new Uint8Array(arrayBuffer);
  // إيجاد سجل نهاية الفهرس المركزي (EOCD): التوقيع 0x06054b50
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0 && i > u8.length - 66000; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ملف غير صالح (ليس أرشيف xlsx)');
  const count = dv.getUint16(eocd + 10, true);
  let ptr = dv.getUint32(eocd + 16, true); // إزاحة بداية الفهرس المركزي

  const files = {};
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(ptr, true) !== 0x02014b50) break;
    const method = dv.getUint16(ptr + 10, true);
    const compSize = dv.getUint32(ptr + 20, true);
    const nameLen = dv.getUint16(ptr + 28, true);
    const extraLen = dv.getUint16(ptr + 30, true);
    const commentLen = dv.getUint16(ptr + 32, true);
    const localOff = dv.getUint32(ptr + 42, true);
    const name = new TextDecoder().decode(u8.subarray(ptr + 46, ptr + 46 + nameLen));

    // ترويسة محلية: الاسم والحقول الإضافية قد تختلف أطوالها
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = u8.subarray(dataStart, dataStart + compSize);

    files[name] = method === 0 ? raw : await inflateRaw(raw);
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') throw new Error('المتصفح لا يدعم فك ضغط xlsx — استخدم CSV');
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---------- قراءة XML ----------
function textOf(bytes) { return new TextDecoder('utf-8').decode(bytes); }

// جدول النصوص المشتركة: كل <si> قد يحوي عدة <t> (نصوص منسّقة) فنجمعها
function parseSharedStrings(xml) {
  const out = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml)) !== null) {
    let s = '';
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let t;
    while ((t = tRe.exec(m[1])) !== null) s += decodeXml(t[1]);
    out.push(s);
  }
  return out;
}

function decodeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&amp;/g, '&');
}

// تحويل مرجع خلية (A1, BC12) إلى فهرس عمود صفري
function colIndex(ref) {
  const letters = (ref.match(/^[A-Z]+/) || ['A'])[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSheet(xml, shared) {
  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let r;
  while ((r = rowRe.exec(xml)) !== null) {
    const cells = [];
    const cRe = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let c;
    while ((c = cRe.exec(r[1])) !== null) {
      const attrs = c[1] || '';
      const inner = c[2] || '';
      const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1] || '';
      const type = (attrs.match(/t="([^"]+)"/) || [])[1] || 'n';
      let val = '';
      if (type === 's') {
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        val = v != null ? (shared[+v] ?? '') : '';
      } else if (type === 'inlineStr') {
        const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let t; while ((t = tRe.exec(inner)) !== null) val += decodeXml(t[1]);
      } else {
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        val = v != null ? decodeXml(v) : '';
      }
      const idx = ref ? colIndex(ref) : cells.length;
      while (cells.length < idx) cells.push('');
      cells[idx] = val;
    }
    rows.push(cells);
  }
  return rows;
}

// ---------- الواجهة العامة ----------
// يُرجع مصفوفة صفوف (مصفوفة نصوص) من أول ورقة عمل
async function readXlsxRows(file) {
  const files = await unzip(await file.arrayBuffer());
  const sharedRaw = files['xl/sharedStrings.xml'];
  const shared = sharedRaw ? parseSharedStrings(textOf(sharedRaw)) : [];
  // أول ورقة: نبحث عن sheet1 وإلا أول ملف worksheets
  const sheetName = files['xl/worksheets/sheet1.xml']
    ? 'xl/worksheets/sheet1.xml'
    : Object.keys(files).find((k) => /^xl\/worksheets\/.*\.xml$/.test(k));
  if (!sheetName) throw new Error('لا توجد ورقة عمل في الملف');
  const rows = parseSheet(textOf(files[sheetName]), shared);
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}

// تحويل صفوف إلى CSV لإعادة استخدام مسارات الاستيراد الحالية
function rowsToCsv(rows) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\n');
}

/**
 * نصّ ملف CSV بالترميز الصحيح.
 * إكسل على ويندوز يحفظ «CSV» بترميز النظام (windows-1256 عربيًّا) لا بـUTF-8،
 * فتصل الأسماء العربية حروفًا مشوّهة. نقرأ أولًا UTF-8، فإن ظهرت محارف بديلة (‏�‏)
 * أعدنا القراءة بـwindows-1256 — والملف السليم لا يتأثّر بهذه المحاولة.
 */
async function csvText(file) {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buf);
  if (!utf8.includes('\uFFFD')) return utf8;
  try {
    const cp1256 = new TextDecoder('windows-1256').decode(buf);
    return cp1256.includes('\uFFFD') ? utf8 : cp1256;
  } catch { return utf8; }
}

// يقبل .xlsx أو .csv ويُرجع نص CSV في الحالتين
async function fileToCsv(file) {
  const isXlsx = /\.xlsx$/i.test(file.name) ||
    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (!isXlsx) return await csvText(file);
  return rowsToCsv(await readXlsxRows(file));
}

// ============================================================
// قراءة المصنّف كاملًا للمعاينة (أوراق متعدّدة بأسمائها)
// ============================================================
// ما يلزم المعاينة أكثر من الاستيراد: أسماء الأوراق، وتحويل الأرقام المنسّقة
// كتواريخ إلى تواريخ مقروءة (وإلا ظهر التاريخ رقمًا تسلسليًا لا يعني شيئًا).

// أنماط التاريخ المضمَّنة في إكسل + أي نمط مخصَّص فيه y/m/d بلا تهريب
const BUILTIN_DATE_FMT = [14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47];

function parseNumberFormats(stylesXml) {
  if (!stylesXml) return { dateStyles: new Set() };
  const custom = {};
  const numFmtRe = /<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"[^>]*\/>/g;
  let m;
  while ((m = numFmtRe.exec(stylesXml)) !== null) custom[+m[1]] = decodeXml(m[2]);
  const isDateCode = (code) => /[dmy]/i.test(String(code).replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, ''));
  const cellXfs = (stylesXml.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/) || [''])[0];
  const dateStyles = new Set();
  let i = 0;
  const xfRe = /<xf\b([^>]*)\/?>/g;
  let x;
  while ((x = xfRe.exec(cellXfs)) !== null) {
    const id = +((x[1].match(/numFmtId="(\d+)"/) || [])[1] || 0);
    if (BUILTIN_DATE_FMT.includes(id) || (custom[id] && isDateCode(custom[id]))) dateStyles.add(i);
    i++;
  }
  return { dateStyles };
}

// الرقم التسلسلي في إكسل: الأيام منذ ١٩٠٠/١/٠ مع خطأ السنة الكبيسة التاريخي
function excelSerialToDate(n) {
  const ms = Math.round((Number(n) - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (!isFinite(d.getTime())) return String(n);
  const p = (v) => String(v).padStart(2, '0');
  const date = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  const hasTime = Math.abs(Number(n) % 1) > 1e-6;
  return hasTime ? `${date} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` : date;
}

function parseSheetRich(xml, shared, fmt) {
  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let r;
  while ((r = rowRe.exec(xml)) !== null) {
    const cells = [];
    const cRe = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let c;
    while ((c = cRe.exec(r[1])) !== null) {
      const attrs = c[1] || '';
      const inner = c[2] || '';
      const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1] || '';
      const type = (attrs.match(/t="([^"]+)"/) || [])[1] || 'n';
      const style = +((attrs.match(/s="(\d+)"/) || [])[1] || -1);
      let val = '';
      if (type === 's') {
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        val = v != null ? (shared[+v] ?? '') : '';
      } else if (type === 'inlineStr' || type === 'str') {
        const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let t;
        while ((t = tRe.exec(inner)) !== null) val += decodeXml(t[1]);
        if (!val) val = decodeXml((inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || '');
      } else if (type === 'b') {
        val = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1] === '1' ? 'TRUE' : 'FALSE';
      } else {
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        val = v != null ? decodeXml(v) : '';
        if (val !== '' && fmt.dateStyles.has(style) && isFinite(+val)) val = excelSerialToDate(val);
      }
      const idx = ref ? colIndex(ref) : cells.length;
      while (cells.length < idx) cells.push('');
      cells[idx] = val;
    }
    rows.push(cells);
  }
  return rows;
}

/** يقرأ كل أوراق المصنّف: [{ name, rows }] — يقبل File أو Blob. */
async function readXlsxWorkbook(blobOrFile) {
  const files = await unzip(await blobOrFile.arrayBuffer());
  const sharedRaw = files['xl/sharedStrings.xml'];
  const shared = sharedRaw ? parseSharedStrings(textOf(sharedRaw)) : [];
  const fmt = parseNumberFormats(files['xl/styles.xml'] ? textOf(files['xl/styles.xml']) : '');

  // أسماء الأوراق وترتيبها من workbook.xml، وموضع كل ورقة من ملف العلاقات
  const rels = {};
  if (files['xl/_rels/workbook.xml.rels']) {
    const relRe = /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g;
    const relXml = textOf(files['xl/_rels/workbook.xml.rels']);
    let m;
    while ((m = relRe.exec(relXml)) !== null) rels[m[1]] = m[2].replace(/^\/?xl\//, '').replace(/^\//, '');
  }
  const sheets = [];
  if (files['xl/workbook.xml']) {
    const wbXml = textOf(files['xl/workbook.xml']);
    const sRe = /<sheet\b([^>]*)\/?>/g;
    let m;
    while ((m = sRe.exec(wbXml)) !== null) {
      const name = decodeXml((m[1].match(/name="([^"]*)"/) || [])[1] || 'ورقة');
      const rid = (m[1].match(/r:id="([^"]+)"/) || [])[1];
      const target = rels[rid];
      const key = target ? 'xl/' + target : null;
      if (key && files[key]) sheets.push({ name, key });
    }
  }
  if (!sheets.length) {
    Object.keys(files).filter((k) => /^xl\/worksheets\/.*\.xml$/.test(k))
      .forEach((k, i) => sheets.push({ name: 'ورقة ' + (i + 1), key: k }));
  }
  return sheets.map((s) => ({ name: s.name, rows: parseSheetRich(textOf(files[s.key]), shared, fmt) }));
}

// ============================================================
// قراءة مستند وورد (.docx) وعرض تقريبي بصيغة HTML
// ============================================================
// المستند أرشيف ZIP فيه word/document.xml. نترجم الفقرات والتنسيقات الأساسية
// والجداول والصور — لا محاكاة كاملة لوورد، بل معاينة أمينة لما في المستند.
const DOCX_STYLE_TAG = {
  Title: 'h1', Heading1: 'h1', Heading2: 'h2', Heading3: 'h3',
  Heading4: 'h4', Heading5: 'h5', Heading6: 'h6',
};

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function docxRuns(xml) {
  let out = '';
  const rRe = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g;
  let r;
  while ((r = rRe.exec(xml)) !== null) {
    const body = r[1];
    const props = (body.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/) || [])[1] || '';
    let text = '';
    const tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    let t;
    while ((t = tRe.exec(body)) !== null) text += decodeXml(t[1]);
    if (/<w:br\b/.test(body)) text += '\n';
    if (/<w:tab\b/.test(body)) text += '\t';
    if (!text) continue;
    let html = xmlEscape(text).replace(/\n/g, '<br>').replace(/\t/g, '&emsp;');
    if (/<w:b\b(?![^>]*w:val="(0|false)")/.test(props)) html = '<strong>' + html + '</strong>';
    if (/<w:i\b(?![^>]*w:val="(0|false)")/.test(props)) html = '<em>' + html + '</em>';
    if (/<w:u\b/.test(props)) html = '<u>' + html + '</u>';
    const hl = (props.match(/<w:highlight[^>]*w:val="([^"]+)"/) || [])[1];
    const color = (props.match(/<w:color[^>]*w:val="([0-9A-Fa-f]{6})"/) || [])[1];
    const style = (hl && hl !== 'none' ? `background:${hl};` : '') + (color && color !== '000000' ? `color:#${color};` : '');
    if (style) html = `<span style="${style}">${html}</span>`;
    out += html;
  }
  return out;
}

function docxParagraph(xml, images) {
  const props = (xml.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/) || [])[1] || '';
  const styleId = (props.match(/<w:pStyle[^>]*w:val="([^"]+)"/) || [])[1] || '';
  const jc = (props.match(/<w:jc[^>]*w:val="([^"]+)"/) || [])[1] || '';
  const isList = /<w:numPr>/.test(props);
  let inner = docxRuns(xml);

  // الصور المضمَّنة: نربط معرّف العلاقة بملف الوسائط داخل الأرشيف
  const blipRe = /<a:blip\b[^>]*r:embed="([^"]+)"/g;
  let b;
  while ((b = blipRe.exec(xml)) !== null) {
    const src = images[b[1]];
    if (src) inner += `<img src="${src}" alt="" />`;
  }
  if (!inner.trim()) return '';
  const align = jc === 'center' ? 'center' : jc === 'left' ? 'left' : jc === 'right' ? 'right' : '';
  const tag = DOCX_STYLE_TAG[styleId.replace(/\s/g, '')] || (isList ? 'li' : 'p');
  return `<${tag}${align ? ` style="text-align:${align}"` : ''}>${inner}</${tag}>`;
}

function docxTable(xml, images) {
  let html = '<table class="doc-table">';
  const trRe = /<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g;
  let tr;
  while ((tr = trRe.exec(xml)) !== null) {
    html += '<tr>';
    const tcRe = /<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/g;
    let tc;
    while ((tc = tcRe.exec(tr[1])) !== null) {
      const span = +((tc[1].match(/<w:gridSpan[^>]*w:val="(\d+)"/) || [])[1] || 1);
      let cell = '';
      const pRe = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
      let p;
      while ((p = pRe.exec(tc[1])) !== null) cell += docxParagraph(p[0], images);
      html += `<td${span > 1 ? ` colspan="${span}"` : ''}>${cell || '&nbsp;'}</td>`;
    }
    html += '</tr>';
  }
  return html + '</table>';
}

/** يحوّل ملف .docx إلى HTML للمعاينة. يُرجع { html, images } (روابط blob تُحرَّر لاحقًا). */
async function readDocxHtml(blobOrFile) {
  const files = await unzip(await blobOrFile.arrayBuffer());
  const docKey = files['word/document.xml'] ? 'word/document.xml'
    : Object.keys(files).find((k) => /^word\/document\d*\.xml$/.test(k));
  if (!docKey) throw new Error('ليس مستند وورد صالحًا');
  const xml = textOf(files[docKey]);

  // خريطة الصور: معرّف العلاقة ← رابط blob
  const images = {};
  const urls = [];
  const relKey = 'word/_rels/' + docKey.split('/').pop() + '.rels';
  if (files[relKey]) {
    const relXml = textOf(files[relKey]);
    const relRe = /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g;
    let m;
    while ((m = relRe.exec(relXml)) !== null) {
      const target = m[2].replace(/^\.\.\//, '').replace(/^\//, '');
      const bytes = files['word/' + target] || files[target];
      if (!bytes || !/\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(target)) continue;
      const ext = target.split('.').pop().toLowerCase();
      const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : 'image/' + ext;
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      images[m[1]] = url;
      urls.push(url);
    }
  }

  const body = (xml.match(/<w:body>([\s\S]*)<\/w:body>/) || [, xml])[1];
  // الفقرات والجداول بترتيبهما في المستند
  const blockRe = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:p(?:\s[^>]*)?\/>/g;
  let html = '';
  let m2;
  let inList = false;
  while ((m2 = blockRe.exec(body)) !== null) {
    const block = m2[0];
    const piece = block.startsWith('<w:tbl') ? docxTable(block, images) : docxParagraph(block, images);
    const isLi = piece.startsWith('<li');
    if (isLi && !inList) { html += '<ul>'; inList = true; }
    if (!isLi && inList) { html += '</ul>'; inList = false; }
    html += piece;
  }
  if (inList) html += '</ul>';
  return { html: html || '<p class="muted">المستند فارغ</p>', urls };
}

// ============================================================
// قراءة عرض بوربوينت (.pptx) — نص كل شريحة بترتيبها
// ============================================================
async function readPptxSlides(blobOrFile) {
  const files = await unzip(await blobOrFile.arrayBuffer());
  const keys = Object.keys(files)
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => (+a.match(/\d+/)[0]) - (+b.match(/\d+/)[0]));
  if (!keys.length) throw new Error('ليس عرضًا صالحًا');
  return keys.map((k, i) => {
    const xml = textOf(files[k]);
    const lines = [];
    // كل <a:p> فقرة، ونصوصها في <a:t>
    const pRe = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g;
    let p;
    while ((p = pRe.exec(xml)) !== null) {
      let line = '';
      const tRe = /<a:t>([\s\S]*?)<\/a:t>/g;
      let t;
      while ((t = tRe.exec(p[1])) !== null) line += decodeXml(t[1]);
      if (line.trim()) lines.push(line.trim());
    }
    return { index: i + 1, lines };
  });
}

/** تقسيم نصّ CSV/TSV إلى صفوف (يفهم الاقتباس المزدوج). */
function parseDelimited(text, delimiter) {
  const d = delimiter || (text.split('\n')[0].split('\t').length > text.split('\n')[0].split(',').length ? '\t' : ',');
  const rows = [];
  let row = [], cell = '', quoted = false;
  const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === d) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}
