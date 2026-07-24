// حساب المتوسط المرجّح لتقييم واحد مع معالجة «لا ينطبق» (إعادة توزيع الوزن).
export function weightedForEvaluation(scoreRows: any[], criteria: any[]): number | null {
  let wSum = 0, acc = 0;
  const byId: Record<number, any> = {};
  scoreRows.forEach((s) => { byId[s.criterion_id] = s; });
  for (const cr of criteria) {
    const s = byId[cr.id];
    if (!s || s.is_na || s.score == null) continue;
    wSum += cr.weight;
    acc += cr.weight * s.score;
  }
  if (wSum === 0) return null;
  return acc / wSum; // النطاق 1..5
}
