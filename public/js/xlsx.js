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
