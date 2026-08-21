// أدوات جداول الاستيراد والتصدير: تحليل CSV، وتهريب الخلايا، ومطابقة الترويسات والقيم.
//
// الملف الذي يصل من مستخدم عربي ليس دائمًا كما نتوقّعه: إكسل في لغاتٍ كثيرة يحفظ
// CSV بفاصلة منقوطة، ولوحةُ المفاتيح العربية تكتب الأرقام هندية، ومن يترجم ترويسة
// العمود إلى العربية لا يظنّ أنه كسر شيئًا. فالتساهل هنا ليس رفاهية: بدونه يُقابَل
// المستخدم برسالة «الأعمدة الإلزامية مفقودة» أمام ملفٍ يراه سليمًا تمامًا.

export function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n;\t]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** أرقام عربية-هندية أو فارسية إلى لاتينية. */
export function toEnDigits(s: string): string {
  return String(s ?? '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * الفاصل الذي يفصل الأعمدة فعلًا (فاصلة أو فاصلة منقوطة أو جدولة).
 * يُستنتج من سطر الترويسة: أكثرها ورودًا خارج علامات الاقتباس.
 */
function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] || '';
  const count = (ch: string) => {
    let n = 0, q = false;
    for (const c of first) {
      if (c === '"') q = !q;
      else if (c === ch && !q) n++;
    }
    return n;
  };
  const best = [',', ';', '\t'].map((d) => ({ d, n: count(d) })).sort((a, b) => b.n - a.n)[0];
  return best.n > 0 ? best.d : ',';
}

export function parseCsv(text: string): string[][] {
  text = String(text ?? '').replace(/^﻿/, '');
  const D = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === D) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

/**
 * تطبيع نصٍّ للمطابقة لا للعرض: تُزال التشكيلات والتطويل، وتُوحَّد صور الألف
 * والياء والتاء المربوطة، ويُهمل الفرق بين المسافة والشرطة السفلية وحالة الأحرف.
 * فـ«رقم الهوية» و«رقم الهويه» و«National ID» تُطابق مفتاحًا واحدًا.
 */
export function normKey(s: string): string {
  return String(s ?? '')
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[_\-\s]+/g, ' ')
    .trim().toLowerCase();
}

/** موضع عمود بأيٍّ من أسمائه (الإنجليزي أو مرادفاته العربية)، و−١ إن لم يُذكر. */
export function colOf(header: string[], names: string[]): number {
  const H = header.map(normKey);
  for (const n of names) {
    const i = H.indexOf(normKey(n));
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * القيمة القياسية لخلية كُتبت بالعربية أو بالإنجليزية — أو '' إن لم تُعرف.
 * `aliases`: القيمة القياسية ← كل ما يُكتب مكانها.
 */
export function matchAlias(value: string, aliases: Record<string, string[]>): string {
  const v = normKey(value);
  if (!v) return '';
  for (const [canonical, list] of Object.entries(aliases)) {
    if (normKey(canonical) === v) return canonical;
    if (list.some((a) => normKey(a) === v)) return canonical;
  }
  return '';
}
