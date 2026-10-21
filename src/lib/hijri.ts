// التاريخ الهجري (تقويم أم القرى) عبر Intl المتوفر في Workers مع ICU كامل.

// السنة الهجرية كرقم (لاتيني) — تُستخدم في ترقيم المحاضر.
export function hijriYear(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { year: 'numeric' }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value ?? '0';
  return parseInt(y.replace(/[^0-9]/g, ''), 10);
}

// أرقام عربية-هندية للعرض في المعرّفات مثل تربوي/١٤٤٧/٠٠٣
const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
export function toArabicDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => ARABIC_DIGITS[+d]);
}

// أجزاء التاريخ الهجري (أم القرى) لتاريخ ميلادي — أرقامٌ لاتينية.
function hijriParts(date: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
    year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC',
  }).formatToParts(date);
  const n = (t: string) => parseInt((parts.find((p) => p.type === t)?.value ?? '0').replace(/[^0-9]/g, ''), 10);
  return { y: n('year'), m: n('month'), d: n('day') };
}

/**
 * تاريخ هجري (أم القرى) إلى ميلادي YYYY-MM-DD، أو null إن لم يكن تاريخًا قائمًا.
 * Intl يُنسّق ولا يُحلّل، فنقدّر اليوم بالمتوسط الفلكي ثم نبحث حوله يومًا يومًا —
 * والتقدير لا يبعد عن الحقيقة إلا أيامًا معدودة.
 */
export function hijriToGreg(y: number, m: number, d: number): string | null {
  if (!(y > 1300 && y < 1600 && m >= 1 && m <= 12 && d >= 1 && d <= 30)) return null;
  // ١ محرم ١ هـ ≈ ١٦ يوليو ٦٢٢م (يوم جولياني 1948439.5)
  const jd = Math.floor((11 * y + 3) / 30) + 354 * y + 30 * m - Math.floor((m - 1) / 2) + d + 1948440 - 385;
  const guess = (jd - 2440587.5) * 86400000;
  for (let off = 0; off <= 40; off++) {
    for (const s of off ? [off, -off] : [0]) {
      const dt = new Date(guess + s * 86400000);
      const h = hijriParts(dt);
      if (h.y === y && h.m === m && h.d === d) return dt.toISOString().slice(0, 10);
    }
  }
  return null;
}

/**
 * تاريخٌ كما يكتبه الناس في جداولهم ومحاضرهم إلى YYYY-MM-DD، أو null.
 * يقبل: 2025-09-14 · 2025/9/14 · 14/9/2025 · 14-09-2025 · أرقامًا عربية-هندية،
 * والهجري بأيّ من هذه الصيغ (السنة أقل من ١٦٠٠ تُعدّ هجرية، ويُتسامح مع «هـ»)،
 * والرقم التسلسلي لإكسل (الأيام منذ ١٩٠٠) حين تصل خلية التاريخ رقمًا مجرّدًا.
 */
export function parseLooseDate(v: unknown): string | null {
  const s = String(v ?? '')
    .replace(/[٠-٩]/g, (ch) => String(ch.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (ch) => String(ch.charCodeAt(0) - 0x06f0))
    .replace(/[هـم]+\s*$/u, '').replace(/[‎‏]/g, '').trim();
  if (!s) return null;

  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Math.floor(Number(s));
    if (n < 20000 || n > 80000) return null;
    return new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);
  }

  let y: number, m: number, d: number;
  let mt = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/);
  if (mt) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
  else {
    mt = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:\s.*)?$/);
    if (!mt) return null;
    d = +mt[1]; m = +mt[2]; y = +mt[3];
  }
  if (y < 1600) return hijriToGreg(y, m, d);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dt = new Date(iso + 'T00:00:00Z');
  return !isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === iso ? iso : null;
}
