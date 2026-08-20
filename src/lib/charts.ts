// تمثيل بصري لصفحات الطباعة: مخططات SVG مضمَّنة بلا أي مكتبة خارجية،
// فتظهر كما هي في المتصفح وفي ملف PDF المُصدَّر.
import { toArabicDigits } from './hijri';

export interface Slice {
  label: string;
  value: number;
  color: string;
}

const esc = (s: any) =>
  s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const arNum = (n: number | string) => toArabicDigits(String(n));
const pctOf = (v: number, total: number) => (total > 0 ? Math.round((v / total) * 100) : 0);

/**
 * حلقة نسب (Donut) مع وسيلة إيضاح جانبية.
 * تُرسم بشرائح stroke-dasharray على دائرة واحدة — أخف من مسارات القوس وأدقّ طباعةً.
 */
export function donut(slices: Slice[], opts: { size?: number; centerTop?: string; centerSub?: string } = {}): string {
  const size = opts.size ?? 132;
  const total = slices.reduce((a, s) => a + s.value, 0);
  const r = 52, cx = 66, cy = 66, circ = 2 * Math.PI * r;
  let offset = 0;

  const ring = total === 0
    ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e6ebe9" stroke-width="20" />`
    : slices.filter((s) => s.value > 0).map((s) => {
      const len = (s.value / total) * circ;
      const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="20"
        stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}"
        stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})" />`;
      offset += len;
      return seg;
    }).join('');

  const legend = slices.map((s) =>
    `<div class="lg-row"><span class="lg-dot" style="background:${s.color}"></span>
      <span class="lg-lbl">${esc(s.label)}</span>
      <span class="lg-val">${arNum(s.value)}<span class="lg-pct"> (${arNum(pctOf(s.value, total))}٪)</span></span></div>`).join('');

  return `<div class="chart">
    <svg viewBox="0 0 132 132" width="${size}" height="${size}" role="img">
      ${ring}
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" class="dn-v">${esc(opts.centerTop ?? arNum(total))}</text>
      <text x="${cx}" y="${cy + 14}" text-anchor="middle" class="dn-s">${esc(opts.centerSub ?? 'الإجمالي')}</text>
    </svg>
    <div class="legend">${legend}</div>
  </div>`;
}

/** أشرطة أفقية (RTL: تنمو من اليمين) — للمقارنة بين فئات قليلة. */
export function bars(rows: Slice[], opts: { max?: number; unit?: string } = {}): string {
  const max = opts.max ?? Math.max(1, ...rows.map((r) => r.value));
  return `<div class="bars">${rows.map((r) => `
    <div class="bar-row">
      <span class="bar-lbl">${esc(r.label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${Math.round((r.value / max) * 100)}%;background:${r.color}"></span></span>
      <span class="bar-val">${arNum(r.value)}${opts.unit ? esc(opts.unit) : ''}</span>
    </div>`).join('')}</div>`;
}

/** شريط نسبة مئوية واحد بلون يتدرّج حسب مستوى الإنجاز. */
export function meter(pct: number, label: string): string {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  const color = v >= 80 ? '#1f8a54' : v >= 50 ? '#b9770e' : '#c0392b';
  return `<div class="meter">
    <div class="meter-top"><span>${esc(label)}</span><b style="color:${color}">${arNum(v)}٪</b></div>
    <span class="meter-track"><span class="meter-fill" style="width:${v}%;background:${color}"></span></span>
  </div>`;
}

/** بطاقة مؤشر مفردة. */
export function kpi(value: string | number, label: string, tone: 'ok' | 'warn' | 'bad' | 'neutral' = 'neutral', sub?: string): string {
  return `<div class="kpi kpi-${tone}">
    <div class="kpi-v">${esc(typeof value === 'number' ? arNum(value) : value)}</div>
    <div class="kpi-l">${esc(label)}</div>
    ${sub ? `<div class="kpi-s">${esc(sub)}</div>` : ''}
  </div>`;
}

/** مخطط أعمدة زمني بسيط (اتجاه عبر المحاضر). */
export function columns(points: { label: string; value: number }[], color: string, unit = ''): string {
  if (!points.length) return '';
  const W = 520, H = 150, pad = 26, bw = Math.min(46, (W - 2 * pad) / points.length - 8);
  const max = Math.max(1, ...points.map((p) => p.value));
  const x = (i: number) => W - pad - (i + 1) * ((W - 2 * pad) / points.length) + ((W - 2 * pad) / points.length - bw) / 2;
  const cols = points.map((p, i) => {
    const h = Math.round((p.value / max) * (H - 2 * pad));
    const y = H - pad - h;
    return `<rect x="${x(i).toFixed(1)}" y="${y}" width="${bw.toFixed(1)}" height="${h}" rx="3" fill="${color}" />
      <text x="${(x(i) + bw / 2).toFixed(1)}" y="${y - 4}" text-anchor="middle" class="cl-v">${arNum(p.value)}${esc(unit)}</text>
      <text x="${(x(i) + bw / 2).toFixed(1)}" y="${H - pad + 13}" text-anchor="middle" class="cl-l">${esc(p.label)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="cols" role="img">
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#dbe3e0" />${cols}</svg>`;
}
