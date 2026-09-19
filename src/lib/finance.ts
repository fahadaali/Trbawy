// المتابعة المالية — أدوات مشتركة: المبالغ، مرفقات الإثبات، وحساب الأرصدة.
//
// المال لا يحتمل تقريبًا عائمًا يتراكم: كل مبلغ يُحفظ مقرَّبًا إلى هللتين (منزلتين
// عشريتين)، وكل مجموع يُقرَّب بعد جمعه. والعملة ريال سعودي — واحدة لا تُختار.
import type { Env } from '../types';
import { extOf, categoryOf, mimeFor } from './filestore';

/** أقصى حجم لمرفق الإثبات الواحد — الرفع يمرّ عبر الـWorker فيبقى ضمن حدّ الطلب. */
export const MAX_FIN_ATTACH_BYTES = 15 * 1024 * 1024;

export type FinanceKind = 'expense' | 'income';
export type CustodyStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export const FINANCE_KINDS: FinanceKind[] = ['expense', 'income'];

/**
 * مرفقات الإثبات صورٌ وملفات PDF وحدها — وهي ما يُصوَّر من الفواتير والإيصالات.
 * الفحص على الامتداد لا على ما يرسله المتصفح: نوعُ المحتوى المُرسَل يُزوَّر بحرف.
 */
export function financeAttachmentCheck(name: string, sentMime?: string | null):
  { ok: true; ext: string; mime: string } | { ok: false; error: string } {
  const ext = extOf(name);
  if (!ext) return { ok: false, error: 'الملف بلا امتداد — المقبول صورة أو PDF' };
  const cat = categoryOf(ext);
  if (cat !== 'image' && cat !== 'pdf')
    return { ok: false, error: 'المقبول صورٌ (JPG · PNG · HEIC…) أو ملفات PDF فقط' };
  // SVG صورةٌ في الاسم ومستندٌ في السلوك: يحمل سكربتًا يُنفَّذ على أصل المنصة
  if (ext === 'svg') return { ok: false, error: 'صيغة SVG غير مقبولة في مرفقات الإثبات' };
  return { ok: true, ext, mime: mimeFor(ext, sentMime) };
}

/** مفتاح R2 لمرفق حركة — فريد بذاته فلا يدهس رفعٌ متزامن مرفقًا قبله. */
export function financeKey(entryId: number, name: string): string {
  const rand = crypto.randomUUID().slice(0, 8);
  const safe = String(name || 'file').replace(/[\\/]+/g, '_').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-80) || 'file';
  return `finance/${entryId}/${Date.now()}_${rand}_${safe}`;
}

/** تقريب إلى هللتين — يُطبَّق عند الحفظ وعند كل مجموع. */
export const money = (n: number): number => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * قراءة مبلغ كما يكتبه صاحبه: أرقام عربية-هندية، فاصلة عشرية عربية، فواصل آلاف.
 * يُرجع null إن لم يكن مبلغًا موجبًا صالحًا — والصفر ليس حركةً ماليّة.
 */
export function parseAmount(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const raw = String(v)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫٬,\s_]/g, (ch) => (ch === '٫' ? '.' : ''))
    .trim();
  if (!/^\d+(\.\d{1,6})?$/.test(raw)) return null;
  const n = money(Number(raw));
  if (!Number.isFinite(n) || n <= 0 || n > 1e12) return null;
  return n;
}

/** تاريخ بصيغة YYYY-MM-DD أو null. */
export function parseDate(v: unknown): string | null {
  const s = String(v ?? '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export interface FinanceSummary {
  income: number;
  expense: number;
  balance: number;
  count: number;
}

/**
 * مجاميع الحركات المطابقة للشرط. الجمع في القاعدة لا في الذاكرة: القائمة محدودة
 * بسقف عرض، والمجاميع يجب أن تصف كل ما طابق الشرط لا ما ظهر منه.
 * `fromSql` هو جملة FROM بانضماماتها كما في استعلام القائمة نفسه — فالشرط قد يذكرها.
 */
export async function summaryOf(
  env: Env, fromSql: string, whereSql: string, binds: unknown[],
): Promise<FinanceSummary> {
  const r = await env.DB.prepare(
    `SELECT COALESCE(SUM(CASE WHEN f.kind = 'income'  THEN f.amount END), 0) AS income,
            COALESCE(SUM(CASE WHEN f.kind = 'expense' THEN f.amount END), 0) AS expense,
            COUNT(*) AS n
       ${fromSql} ${whereSql}`,
  ).bind(...(binds as any[])).first<{ income: number; expense: number; n: number }>();
  const income = money(r?.income ?? 0);
  const expense = money(r?.expense ?? 0);
  return { income, expense, balance: money(income - expense), count: r?.n ?? 0 };
}

/** مجموعُ ما بين يدي المستخدم من صفوف (حين يحصر اطلاعُه التاريخي ما يُرى). */
export function summaryOfRows(rows: { kind: string; amount: number }[]): FinanceSummary {
  let income = 0; let expense = 0;
  for (const r of rows) {
    if (r.kind === 'income') income += r.amount; else expense += r.amount;
  }
  income = money(income); expense = money(expense);
  return { income, expense, balance: money(income - expense), count: rows.length };
}

/**
 * ما صُرف من كل عهدة مقبولة. رصيدها = المقبول − المصروف منها، ولا يدخل في هذا
 * الحساب إلا حركات الصرف: حركةُ الإيراد التي وُلدت عن القبول هي العهدة نفسها.
 */
export async function custodySpent(env: Env, custodyIds: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!custodyIds.length) return out;
  const rows = (await env.DB.prepare(
    `SELECT custody_id, COALESCE(SUM(amount), 0) AS spent
       FROM finance_entries
      WHERE kind = 'expense' AND custody_id IN (${custodyIds.map(() => '?').join(',')})
      GROUP BY custody_id`,
  ).bind(...custodyIds).all<{ custody_id: number; spent: number }>()).results;
  for (const r of rows) out.set(r.custody_id, money(r.spent));
  return out;
}
