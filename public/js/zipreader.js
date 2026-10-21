// قارئ أرشيف ZIP كسول — يقرأ الأرشيف من القرص مقطعًا مقطعًا بلا تحميله كاملًا في الذاكرة.
//
// وُضع لاستيراد مجلدات قوقل درايف: درايف يُنزّل المجلد أرشيفًا (أو عدة أرشيفات
// -001.zip ‏-002.zip حين يكبر)، وقد يبلغ الواحد غيغابايتات. فلا يُقرأ منه إلا الفهرس
// المركزي في ذيله، ثم يُفكّ كل ملف وحده حين يحين رفعه (DecompressionStream) — فتبقى
// الذاكرة بقدر ملفٍ واحد لا بقدر الأرشيف. ويدعم ZIP64 (ما فوق ٤ ج.ب أو ٦٥٥٣٥ ملفًا).
//
// (unzip في xlsx.js يكفي ملفات أوفيس الصغيرة: يقرأ الأرشيف كله ويفكّ كل ما فيه دفعةً.)

const ZIP_SIG_EOCD = 0x06054b50;
const ZIP_SIG_EOCD64 = 0x06064b50;
const ZIP_SIG_EOCD64_LOC = 0x07064b50;
const ZIP_SIG_CENTRAL = 0x02014b50;
const ZIP_SIG_LOCAL = 0x04034b50;

// ملفات يكتبها نظام التشغيل في الأرشيف ولا يقصدها صاحبه
const ZIP_JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$|\._)/i;

async function zipSlice(blob, start, end) {
  return new DataView(await blob.slice(start, end).arrayBuffer());
}

const u64 = (dv, o) => dv.getUint32(o, true) + dv.getUint32(o + 4, true) * 4294967296;

/** اسم المدخل: UTF-8 إن صرّح به الأرشيف أو صحّ ترميزه، وإلا ترميز ويندوز العربي. */
function zipName(bytes, utf8Flag) {
  if (utf8Flag) return new TextDecoder('utf-8').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch {
    try { return new TextDecoder('windows-1256').decode(bytes); }
    catch { return new TextDecoder('utf-8').decode(bytes); }
  }
}

/**
 * يفتح أرشيفًا (File أو Blob) ويُرجع مدخلاته: [{ path, size, compressedSize, method,
 * offset, encrypted, dir }]. لا يقرأ من الأرشيف إلا ذيله وفهرسه المركزي.
 */
async function openZip(file) {
  const size = file.size;
  if (size < 22) throw new Error('الملف ليس أرشيف ZIP صالحًا');

  // نهاية الفهرس المركزي (EOCD) في آخر ٢٢ بايتًا + تعليقٍ أقصاه ٦٥٥٣٥
  const tailLen = Math.min(size, 22 + 65535 + 20);
  const tailStart = size - tailLen;
  const tail = await zipSlice(file, tailStart, size);
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === ZIP_SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('الملف ليس أرشيف ZIP صالحًا (أو أنه تالف أو غير مكتمل التنزيل)');

  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);

  // ZIP64: القيم المشبعة تحيل إلى سجلٍّ موسَّع يدلّ عليه «محدِّد» قبل EOCD مباشرة
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc < 0 || tail.getUint32(loc, true) !== ZIP_SIG_EOCD64_LOC)
      throw new Error('أرشيف ZIP64 بلا محدِّد صالح');
    const at = u64(tail, loc + 8);
    const z = await zipSlice(file, at, at + 56);
    if (z.getUint32(0, true) !== ZIP_SIG_EOCD64) throw new Error('أرشيف ZIP64 تالف');
    count = u64(z, 32);
    cdSize = u64(z, 40);
    cdOffset = u64(z, 48);
  }
  if (cdOffset + cdSize > size) throw new Error('الأرشيف غير مكتمل — أعد تنزيله ثم حاول');

  const cd = await zipSlice(file, cdOffset, cdOffset + cdSize);
  const entries = [];
  let p = 0;
  for (let n = 0; n < count && p + 46 <= cd.byteLength; n++) {
    if (cd.getUint32(p, true) !== ZIP_SIG_CENTRAL) break;
    const flags = cd.getUint16(p + 8, true);
    const method = cd.getUint16(p + 10, true);
    let compressedSize = cd.getUint32(p + 20, true);
    let uncompressed = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    let offset = cd.getUint32(p + 42, true);
    const nameBytes = new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen);
    let name = zipName(nameBytes, (flags & 0x800) !== 0);

    // الحقول الإضافية: ZIP64 (0x0001) يحمل ما أُشبع من الأحجام والإزاحة بترتيبها،
    // ومسار يونيكود (0x7075) يحمل الاسم UTF-8 حين كُتب الأصل بترميزٍ محلي
    let e = p + 46 + nameLen;
    const eEnd = e + extraLen;
    while (e + 4 <= eEnd) {
      const id = cd.getUint16(e, true);
      const len = cd.getUint16(e + 2, true);
      let q = e + 4;
      if (id === 0x0001) {
        if (uncompressed === 0xffffffff) { uncompressed = u64(cd, q); q += 8; }
        if (compressedSize === 0xffffffff) { compressedSize = u64(cd, q); q += 8; }
        if (offset === 0xffffffff) { offset = u64(cd, q); }
      } else if (id === 0x7075 && len > 5) {
        name = new TextDecoder('utf-8').decode(new Uint8Array(cd.buffer, cd.byteOffset + e + 9, len - 5));
      }
      e += 4 + len;
    }

    const path = name.replace(/\\/g, '/');
    entries.push({
      path, size: uncompressed, compressedSize, method, offset,
      encrypted: (flags & 1) !== 0,
      dir: path.endsWith('/'),
    });
    p = eEnd + commentLen;
  }
  return entries;
}

/** محتوى مدخلٍ واحد Blob — يُقرأ من موضعه ويُفكّ ضغطه متدفقًا. */
async function zipEntryBlob(file, entry, type = '') {
  if (entry.encrypted) throw new Error('ملف محميّ بكلمة مرور داخل الأرشيف');
  const head = await zipSlice(file, entry.offset, entry.offset + 30);
  if (head.getUint32(0, true) !== ZIP_SIG_LOCAL) throw new Error('مدخل تالف في الأرشيف');
  const start = entry.offset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
  const raw = file.slice(start, start + entry.compressedSize);
  if (entry.method === 0) return new Blob([raw], { type });
  if (entry.method !== 8) throw new Error('طريقة ضغط غير مدعومة في هذا الملف');
  if (typeof DecompressionStream === 'undefined') throw new Error('المتصفح لا يدعم فك الضغط — حدّثه');
  const stream = raw.stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const out = await new Response(stream).blob();
  if (out.size !== entry.size) throw new Error('تعذّر فك ضغط الملف كاملًا — قد يكون الأرشيف تالفًا');
  return type ? new Blob([out], { type }) : out;
}

/** هل المسار من ملفات النظام التي لا تُستورد؟ */
const zipIsJunk = (path) => ZIP_JUNK.test(path);
