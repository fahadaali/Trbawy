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
