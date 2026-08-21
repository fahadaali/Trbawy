// حالة البند الفعلية.
//
// «متعثّر» ليست حالة يضعها إنسان بل واقعة موضوعية: بند مضى استحقاقه ولم يُنجَز.
// كان يُعرض بالحالة المسجَّلة عليه («لم تبدأ») فيقرأ القارئ خلاف الحقيقة، وتضيع
// دلالة التعثّر في المحضر وفي الموقع معًا.
//
// فتُشتقّ الحالة عند العرض ولا تُكتب على البند:
//   • الاشتقاق لا يبطل ما سجّله المسؤول (تقدّمه ونسبته تبقى كما هي).
//   • ولا يتقادم: تمديد الاستحقاق يُعيد البند إلى حالته فورًا بلا ترحيل بيانات.
//   • والمرجع الزمني يتبع السياق: **تاريخ انعقاد المحضر** داخل المحضر لأن الوثيقة
//     تصف حال ذلك اليوم، و**اليوم** في شاشات المتابعة الحيّة.
// وتبقى الحالة المسجَّلة `stalled` متاحة يدويًا لبند متعثّر بلا استحقاق فائت
// (معطَّل بانتظار غيره مثلًا) — فالاشتقاق يضيف ولا يطرح.

/**
 * شرط SQL للحالة الفعلية. `ref` تعبير تاريخ مرجعي (مثلاً `date('now')` أو معامل مربوط).
 */
export const effStatusSql = (status: string, due: string, ref: string) =>
  `CASE WHEN ${status} NOT IN ('done','cancelled') AND ${due} IS NOT NULL AND date(${due}) < date(${ref})
        THEN 'stalled' ELSE ${status} END`;

/**
 * أيام التأخّر عن الاستحقاق حتى التاريخ المرجعي (٠ = لا تأخّر).
 * `ref` يرد مرة واحدة عمدًا: التعبيران يُستعملان بمعامل مربوط (`?`)، وتكراره
 * داخل التعبير يعني معاملًا إضافيًا يُنسى عند الربط.
 */
export const overdueDaysSql = (status: string, due: string, ref: string) =>
  `CASE WHEN ${status} NOT IN ('done','cancelled') AND ${due} IS NOT NULL
        THEN MAX(0, CAST(julianday(date(${ref})) - julianday(date(${due})) AS INTEGER)) ELSE 0 END`;

/**
 * المرجع الزمني لمحضر: تاريخ انعقاده — ولا يتجاوز اليوم.
 * فالمحضر المقفل وثيقة تصف حال يومه فلا تتبدّل بعده، ومسودة محضر مقبل لا تُقدّم
 * تأخيرًا لم يقع بعد. `param` يرد مرة واحدة (انظر ملاحظة الربط أعلاه).
 */
export const meetingRefSql = (param = '?') => `MIN(date(${param}), date('now'))`;

/** نظير الاشتقاق في الشيفرة — لما يُحسب خارج قاعدة البيانات. */
export function effStatus(status: string, dueDate: string | null | undefined, ref: string): string {
  if (status === 'done' || status === 'cancelled') return status;
  if (!dueDate) return status;
  return String(dueDate).slice(0, 10) < String(ref).slice(0, 10) ? 'stalled' : status;
}
