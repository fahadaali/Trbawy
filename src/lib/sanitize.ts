// منقّي HTML بقائمة سماح صارمة — لمحتوى المحرر الغني (عناوين، قوائم، جداول، تظليل، صور).
// يُطبَّق عند الحفظ ليُخزَّن محتوى آمن، ويُعرَض كما هو.

const ALLOWED_TAGS = new Set([
  'h2', 'h3', 'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'ul', 'ol', 'li',
  'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'mark', 'span', 'img', 'div', 'a',
]);

const ALLOWED_ATTRS: Record<string, string[]> = {
  img: ['src', 'alt'],
  a: ['href'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
};

const SELF_CLOSING = new Set(['img', 'br']);

function safeUrl(val: string): boolean {
  return /^(https:\/\/|#|data:image\/(png|jpe?g|gif|webp);base64,)/i.test(val.trim());
}

export function sanitizeHtml(dirty: string): string {
  if (!dirty) return '';
  // إزالة الكتل الخطرة والتعليقات
  let s = String(dirty)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed)[^>]*>/gi, '');

  // معالجة كل وسم: إسقاط غير المسموح (مع إبقاء النص)، وتنقية السمات
  s = s.replace(/<(\/?)([a-zA-Z0-9]+)((?:[^>"']|"[^"]*"|'[^']*')*)>/g, (_full, slash, tagRaw, attrs) => {
    const tag = tagRaw.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return '';
    if (slash === '/') return `</${tag}>`;

    let clean = '';
    const allowed = ALLOWED_ATTRS[tag] || [];
    const attrRe = /([a-zA-Z:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(attrs)) !== null) {
      const name = m[1].toLowerCase();
      if (name.startsWith('on')) continue;          // أي معالج أحداث
      if (!allowed.includes(name)) continue;
      let val = m[3] ?? m[4] ?? m[5] ?? '';
      if ((name === 'src' || name === 'href') && !safeUrl(val)) continue;
      val = val.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      clean += ` ${name}="${val}"`;
    }
    return `<${tag}${clean}${SELF_CLOSING.has(tag) ? ' /' : ''}>`;
  });

  return s;
}
