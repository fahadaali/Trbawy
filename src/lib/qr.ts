// رمز التحقق (QR) عبر مكتبة qrcode-generator المستقلة (تعمل في Workers).
// يُستخدم أسفل النسخة المصدَّرة من المحضر، ويشير إلى صفحة تحقق عامة.
import qrcode from 'qrcode-generator';

export function qrSvg(text: string, sizePx = 120): string {
  const qr = qrcode(0, 'M'); // 0 = اختيار الإصدار تلقائياً، مستوى تصحيح M
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 2;
  const total = n + quiet * 2;
  const cell = sizePx / total;
  let rects = '';
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (qr.isDark(r, c))
        rects += `<rect x="${((c + quiet) * cell).toFixed(2)}" y="${((r + quiet) * cell).toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sizePx}" height="${sizePx}" viewBox="0 0 ${sizePx} ${sizePx}"><rect width="${sizePx}" height="${sizePx}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}
