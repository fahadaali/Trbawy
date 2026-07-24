// التاريخ الهجري (تقويم أم القرى) عبر Intl المتوفر في Workers مع ICU كامل.

const HIJRI_LOCALE = 'ar-SA-u-ca-islamic-umalqura';

// السنة الهجرية كرقم (لاتيني) — تُستخدم في ترقيم المحاضر.
export function hijriYear(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { year: 'numeric' }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value ?? '0';
  return parseInt(y.replace(/[^0-9]/g, ''), 10);
}

// نص هجري كامل بالعربية: مثل «١٥ محرم ١٤٤٧هـ»
export function hijriDate(date: Date): string {
  return new Intl.DateTimeFormat(HIJRI_LOCALE, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date) + 'هـ';
}

// نص ميلادي بالعربية
export function gregDate(date: Date): string {
  return new Intl.DateTimeFormat('ar', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date) + 'م';
}

// أرقام عربية-هندية للعرض في المعرّفات مثل تربوي/١٤٤٧/٠٠٣
const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
export function toArabicDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => ARABIC_DIGITS[+d]);
}
