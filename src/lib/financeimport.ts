// استيراد الحركات المالية من قالب (Excel/CSV) — تحليلُ الصفوف وفحصُها قبل الحفظ.
//
// القالب يُنزَّل من المنصة، لكن الجداول المالية الجاهزة عند الناس أوسع منه: من يكتب
// «مصروف» مكان «صرف»، ومن يضع المبلغ بعملته «١٬٢٠٠ ر.س»، ومن يفصل الوارد عن المنصرف
// في عمودين كدفتر اليومية، ومن يكتب التاريخ هجريًا. فيُقبل هذا كله، ويُبلَّغ صاحب
// الملف عن كل صفٍّ لم يُفهم بسببه — ولا يُحفظ شيءٌ إلا بعد معاينته.
//
// الفحص هنا صورةٌ مُجمَّعة لفحص الحركة المفردة (validateEntry في routes/finance.ts):
// المجلس، والنوع، والمبلغ، والبيان، والتاريخ، والمسؤول عضوًا في المجلس — لكنه يحمّل
// ما يحتاجه مرة واحدة بدل استعلامٍ لكل صف. والعُهد لا تُربط في الاستيراد: رصيدها
// يُحسب صفًّا بصف، والربط بها قرارٌ يُتخذ على الحركة نفسها بعد حفظها.
import type { Env, User } from '../types';
import { canWriteFinance, isAdmin, hasFullCouncilAccess, type CouncilRow } from '../permissions';
import { parseCsv, colOf, matchAlias, normKey, toEnDigits } from './csv';
import { parseLooseDate } from './hijri';
import { money, parseAmount, type FinanceKind } from './finance';

export const MAX_IMPORT_ROWS = 2000;
const MAX_STATEMENT = 400;
const MAX_NOTE = 1000;

const KIND_ALIASES: Record<FinanceKind, string[]> = {
  expense: ['صرف', 'مصروف', 'مصروفات', 'مصاريف', 'منصرف', 'المنصرف', 'سحب', 'دفع', 'مدفوعات', 'مدين', 'out', 'debit'],
  income: ['إيراد', 'ايراد', 'إيرادات', 'دخل', 'وارد', 'الوارد', 'إيداع', 'ايداع', 'مقبوضات', 'دائن', 'in', 'credit'],
};

const COUNCIL_TYPE_ALIASES: Record<string, string[]> = {
  educational: ['تربوي', 'التربوي', 'المجلس التربوي', 'مجلس تربوي', 'educational'],
  secondary: ['ثانوي', 'الثانوي', 'الثانوية', 'المرحلة الثانوية', 'مجلس الثانوي', 'مجلس المرحلة الثانوية', 'secondary'],
  middle: ['متوسط', 'المتوسط', 'المتوسطة', 'المرحلة المتوسطة', 'مجلس المتوسط', 'مجلس المرحلة المتوسطة', 'middle'],
};

// ترويسات القالب — بالعربية لأنها ما يراه من يعبّئه، وتُقبل مرادفاتها والإنجليزية
const COLS = {
  council: ['المجلس', 'council', 'الجهة', 'المرحلة'],
  kind: ['النوع', 'نوع الحركة', 'kind', 'type'],
  statement: ['البيان', 'statement', 'الوصف', 'التفاصيل', 'description', 'البند'],
  amount: ['المبلغ', 'amount', 'القيمة', 'المبلغ ر.س', 'المبلغ (ر.س)'],
  expense_amount: ['المنصرف', 'منصرف', 'صرف', 'المصروف', 'مدين', 'debit', 'expense'],
  income_amount: ['الوارد', 'وارد', 'إيراد', 'ايراد', 'الإيراد', 'دائن', 'credit', 'income'],
  date: ['التاريخ', 'date', 'تاريخ الحركة', 'entry_date'],
  owner: ['المسؤول', 'owner', 'المستلم', 'المسؤول عن الحركة', 'بواسطة'],
  note: ['ملاحظة', 'ملاحظات', 'note', 'notes'],
};

export const TEMPLATE_HEADER = ['المجلس', 'النوع', 'البيان', 'المبلغ', 'التاريخ', 'المسؤول', 'ملاحظة'];

/** مبلغٌ بعملته أو بإشارته: «١٬٢٠٠ ر.س» · «(٣٥٠)» · «-٣٥٠» — والإشارة تُعاد منفصلة. */
export function parseSignedAmount(v: unknown): { amount: number | null; negative: boolean } {
  let s = toEnDigits(String(v ?? ''))
    .replace(/ر\.?\s*س\.?|ريالات|ريالا|ريال|SAR|SR|﷼/gi, '')
    .replace(/[‎‏]/g, '').trim();
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1).trim(); }
  if (/^[-−–]/.test(s)) { negative = true; s = s.replace(/^[-−–]\s*/, ''); }
  if (/[-−–]$/.test(s)) { negative = true; s = s.replace(/\s*[-−–]$/, ''); }
  return { amount: parseAmount(s), negative };
}

interface CouncilInfo {
  council: CouncilRow;
  name: string;
  members: { id: number; name: string; key: string }[];
}

export interface ImportOptions {
  defaultCouncilId: number | null;
  defaultKind: FinanceKind | null;
}

export interface ImportRow {
  row: number;
  council_id: number | null;
  council_name: string;
  kind: FinanceKind | '';
  statement: string;
  amount: number | null;
  entry_date: string | null;
  owner_id: number | null;
  owner_name: string;
  note: string;
  errors: string[];
}

/** مجالس النظام بأعضائها — مجموعة المسؤولين المقبولة هي نفسها في /finance/meta. */
async function loadCouncils(env: Env, u: User): Promise<CouncilInfo[]> {
  const rows = (await env.DB.prepare(
    'SELECT id, name, type, default_writer_id FROM councils ORDER BY id',
  ).all<any>()).results;
  const out: CouncilInfo[] = [];
  for (const r of rows) {
    const council: CouncilRow = { id: r.id, type: r.type, default_writer_id: r.default_writer_id };
    const members = (await env.DB.prepare(
      `SELECT us.id, us.name FROM council_members cm JOIN users us ON us.id = cm.user_id
        WHERE cm.council_id = ? AND us.is_active = 1 AND us.deleted_at IS NULL
          AND us.role != 'system_admin'`,
    ).bind(r.id).all<{ id: number; name: string }>()).results;
    if (!isAdmin(u) && hasFullCouncilAccess(u, council) && !members.some((m) => m.id === u.id))
      members.push({ id: u.id, name: u.name });
    out.push({ council, name: r.name, members: members.map((m) => ({ ...m, key: normKey(m.name) })) });
  }
  return out;
}

/** المسؤول بالاسم: تطابقٌ تام بعد التطبيع، وإلا اسمٌ واحد يحتوي المكتوب أو يحتويه. */
function matchMember(info: CouncilInfo, raw: string): { id: number; name: string } | null | 'ambiguous' {
  const k = normKey(raw);
  if (!k) return null;
  const exact = info.members.filter((m) => m.key === k);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return 'ambiguous';
  const partial = info.members.filter((m) => m.key.includes(k) || k.includes(m.key));
  if (partial.length === 1) return partial[0];
  return partial.length > 1 ? 'ambiguous' : null;
}

function matchCouncil(councils: CouncilInfo[], raw: string): CouncilInfo | null {
  const k = normKey(raw);
  if (!k) return null;
  const byName = councils.find((c) => normKey(c.name) === k);
  if (byName) return byName;
  const type = matchAlias(raw, COUNCIL_TYPE_ALIASES);
  return type ? councils.find((c) => c.council.type === type) || null : null;
}

const dupKey = (councilId: number, date: string, amount: number, statement: string) =>
  `${councilId}|${date}|${money(amount)}|${normKey(statement)}`;

/**
 * يحلّل الملف ويفحص كل صف — لا يكتب شيئًا. الأعمدة الإلزامية: البيان والتاريخ،
 * ومبلغٌ في عمود «المبلغ» أو في عمودَي «الوارد/المنصرف». والمجلس والنوع يُؤخذان
 * من الملف، وإلا من الاختيار الافتراضي في نافذة الاستيراد.
 */
export async function analyzeFinanceImport(
  env: Env, u: User, csv: string, opts: ImportOptions,
): Promise<{ error: string } | { rows: ImportRow[] }> {
  // سطور العنوان فوق الجدول («كشف حساب المجلس») بلا فاصل، وتُضلّل استنتاجَ الفاصل
  // من السطر الأول — فتُزال قبل التحليل
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/);
  while (lines.length && !/[,;\t]/.test(lines[0])) lines.shift();
  const table = parseCsv(lines.join('\n'));
  if (table.length < 2) return { error: 'الملف فارغ أو بلا صفوف بيانات' };
  if (table.length - 1 > MAX_IMPORT_ROWS)
    return { error: `الملف يتجاوز ${MAX_IMPORT_ROWS} صف — قسّمه إلى ملفات أصغر` };

  // الترويسة: أول صفٍّ فيه عمود البيان — بعض القوالب تبدأ بعنوانٍ أو سطرٍ فارغ
  let headerAt = table.findIndex((r) => colOf(r.map((h) => h.trim()), COLS.statement) >= 0);
  if (headerAt < 0) headerAt = 0;
  const header = table[headerAt].map((h) => h.trim());
  const col = Object.fromEntries(
    Object.entries(COLS).map(([k, names]) => [k, colOf(header, names)]),
  ) as Record<keyof typeof COLS, number>;

  const hasAmount = col.amount >= 0 || col.expense_amount >= 0 || col.income_amount >= 0;
  if (col.statement < 0 || col.date < 0 || !hasAmount)
    return { error: 'الأعمدة الإلزامية مفقودة: البيان · التاريخ · المبلغ (أو عمودا الوارد والمنصرف)' };

  const councils = await loadCouncils(env, u);
  const defCouncil = opts.defaultCouncilId
    ? councils.find((c) => c.council.id === opts.defaultCouncilId) || null : null;

  const cell = (r: string[], i: number) => (i >= 0 ? String(r[i] ?? '').trim() : '');
  const rows: ImportRow[] = [];

  for (let i = headerAt + 1; i < table.length; i++) {
    const r = table[i];
    const errors: string[] = [];

    // المجلس
    const rawCouncil = cell(r, col.council);
    let info: CouncilInfo | null = rawCouncil ? matchCouncil(councils, rawCouncil) : defCouncil;
    if (rawCouncil && !info) errors.push(`المجلس «${rawCouncil}» غير معروف`);
    else if (!info) errors.push('المجلس غير محدد — اختر مجلسًا افتراضيًا أو أضف عمود المجلس');
    else if (!canWriteFinance(u, info.council, 'add')) {
      errors.push('لا تملك صلاحية إضافة حركة في هذا المجلس');
    }

    // المبلغ والنوع
    let amount: number | null = null;
    let kind: FinanceKind | '' = '';
    const rawKind = cell(r, col.kind);
    if (rawKind) {
      kind = (matchAlias(rawKind, KIND_ALIASES) as FinanceKind) || '';
      if (!kind) errors.push(`النوع «${rawKind}» غير معروف — صرف أو إيراد`);
    }
    const rawAmount = cell(r, col.amount);
    const rawOut = cell(r, col.expense_amount);
    const rawIn = cell(r, col.income_amount);
    if (rawAmount) {
      const p = parseSignedAmount(rawAmount);
      amount = p.amount;
      if (!rawKind) kind = p.negative ? 'expense' : (opts.defaultKind || '');
    } else if (rawOut || rawIn) {
      if (rawOut && rawIn) errors.push('الصف فيه وارد ومنصرف معًا — اجعل كلًّا منهما في صف');
      const p = parseSignedAmount(rawOut || rawIn);
      amount = p.amount;
      if (!rawKind) kind = rawOut ? 'expense' : 'income';
    }
    if (amount == null) errors.push(rawAmount || rawOut || rawIn ? 'المبلغ غير صالح' : 'المبلغ ناقص');
    if (!kind && !rawKind) errors.push('النوع غير محدد — صرف أو إيراد');

    const statement = cell(r, col.statement).slice(0, MAX_STATEMENT);
    if (!statement) errors.push('البيان ناقص');

    const rawDate = cell(r, col.date);
    const entryDate = parseLooseDate(rawDate);
    if (!rawDate) errors.push('التاريخ ناقص');
    else if (!entryDate) errors.push(`التاريخ «${rawDate}» غير مفهوم`);

    // المسؤول (اختياري) — من أعضاء مجلس الحركة
    const rawOwner = cell(r, col.owner);
    let owner: { id: number; name: string } | null = null;
    if (rawOwner && info) {
      const m = matchMember(info, rawOwner);
      if (m === 'ambiguous') errors.push(`المسؤول «${rawOwner}» يطابق أكثر من عضو — اكتب الاسم كاملًا`);
      else if (!m) errors.push(`المسؤول «${rawOwner}» ليس من أعضاء هذا المجلس`);
      else owner = m;
    }

    const note = cell(r, col.note).slice(0, MAX_NOTE);
    // صفٌّ كله فارغ عدا خلايا محسوبة (كمجموعٍ في ذيل الجدول) لا يُعدّ صفًّا
    if (!statement && amount == null && !rawDate) continue;

    rows.push({
      row: i + 1,
      council_id: info?.council.id ?? null,
      council_name: info?.name ?? rawCouncil,
      kind, statement, amount, entry_date: entryDate,
      owner_id: owner?.id ?? null, owner_name: owner?.name ?? rawOwner,
      note, errors,
    });
  }

  // التكرار: في القاعدة (ضمن مدى تواريخ الملف) أو داخل الملف نفسه
  const ok = rows.filter((r) => !r.errors.length && r.council_id && r.entry_date && r.amount != null);
  if (ok.length) {
    const dates = ok.map((r) => r.entry_date!).sort();
    const ids = [...new Set(ok.map((r) => r.council_id!))];
    const existing = (await env.DB.prepare(
      `SELECT council_id, entry_date, amount, statement FROM finance_entries
        WHERE council_id IN (${ids.map(() => '?').join(',')}) AND entry_date BETWEEN ? AND ?`,
    ).bind(...ids, dates[0], dates[dates.length - 1]).all<any>()).results;
    const inDb = new Set(existing.map((e) => dupKey(e.council_id, e.entry_date, e.amount, e.statement)));
    const seen = new Set<string>();
    for (const r of ok) {
      const k = dupKey(r.council_id!, r.entry_date!, r.amount!, r.statement);
      if (inDb.has(k)) r.errors.push('مسجّلة مسبقًا (المجلس والتاريخ والمبلغ والبيان نفسها)');
      else if (seen.has(k)) r.errors.push('مكررة داخل الملف');
      seen.add(k);
    }
  }

  return { rows };
}

/** يحفظ الصفوف الصحيحة على دفعات — حركاتٌ يدوية (manual) تُحرَّر وتُحذف كغيرها. */
export async function commitFinanceImport(env: Env, u: User, rows: ImportRow[]): Promise<number> {
  const valid = rows.filter((r) => !r.errors.length);
  for (let i = 0; i < valid.length; i += 50) {
    await env.DB.batch(valid.slice(i, i + 50).map((r) => env.DB.prepare(
      `INSERT INTO finance_entries (council_id, kind, statement, amount, entry_date, owner_id,
         custody_id, source, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 'manual', ?, ?)`,
    ).bind(r.council_id, r.kind, r.statement, r.amount, r.entry_date, r.owner_id, r.note || null, u.id)));
  }
  return valid.length;
}
