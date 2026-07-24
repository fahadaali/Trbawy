// لوحات القيادة: ملخص الصفحة الرئيسية، ولوحة تحليلات الطلاب.
import { Hono } from 'hono';
import type { Env, Variables, User } from '../types';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import { canViewResults, isPresident, isVice } from '../permissions';
import { weightedForEvaluation } from '../lib/evalcalc';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', requireAuth, requirePasswordChanged);

// ---- ملخص الصفحة الرئيسية ----
app.get('/summary', async (c) => {
  const u = c.get('user');
  // مهامي المفتوحة
  const myTasks = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM action_items a JOIN action_assignees aa ON aa.action_item_id = a.id
      WHERE aa.user_id = ? AND a.status NOT IN ('done','cancelled')`,
  ).bind(u.id).first<{ n: number }>();

  // محاضر بانتظار توقيعي
  const awaitingSign = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM meeting_attendees ma JOIN meetings m ON m.id = ma.meeting_id
      WHERE ma.user_id = ? AND ma.is_guest = 0 AND ma.attendance_status = 'present'
        AND ma.signed_at IS NULL AND ma.signature_override = 0 AND m.status = 'awaiting_signatures'`,
  ).bind(u.id).first<{ n: number }>();

  // دورات تقييم مفتوحة
  const openCycles = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM eval_cycles WHERE status = 'open'").first<{ n: number }>();

  // آخر المحاضر التي أراها
  const recent = await c.env.DB.prepare(
    `SELECT m.id, m.display_number, m.title, m.status, m.council_id, co.type AS council_type
       FROM meetings m JOIN councils co ON co.id = m.council_id ORDER BY m.id DESC LIMIT 20`,
  ).all<any>();
  const { canViewCouncil } = await import('../permissions');
  const visible = [];
  for (const m of recent.results) {
    if (await canViewCouncil(c.env, u, { id: m.council_id, type: m.council_type, default_writer_id: null } as any)) {
      visible.push(m);
      if (visible.length >= 5) break;
    }
  }

  return c.json({
    my_tasks: myTasks?.n ?? 0,
    awaiting_signature: awaitingSign?.n ?? 0,
    open_cycles: openCycles?.n ?? 0,
    recent_meetings: visible,
  });
});

// ---- لوحة تحليلات الطلاب لدورة ----
app.get('/students', async (c) => {
  const u = c.get('user');
  if (!canViewResults(u, 'students')) return c.json({ error: 'لا تملك صلاحية' }, 403);
  const cycleId = Number(c.req.query('cycle_id'));
  const cycle = await c.env.DB.prepare('SELECT * FROM eval_cycles WHERE id = ?').bind(cycleId).first<any>();
  if (!cycle) return c.json({ error: 'الدورة غير موجودة' }, 404);
  if (cycle.status !== 'published') return c.json({ error: 'النتائج غير منشورة' }, 409);

  // نطاق المرحلة
  const canAllStages = isPresident(u) || isVice(u);
  const stageParam = c.req.query('stage');
  const stage = canAllStages ? (stageParam || null) : (u.stage || null);

  const board = await stageBoard(c.env, cycleId, stage);
  // مقارنة الثانوي بالمتوسط (للرئيس والنائب)
  let comparison = null;
  if (canAllStages && !stage) {
    const sec = await stageBoard(c.env, cycleId, 'secondary');
    const mid = await stageBoard(c.env, cycleId, 'middle');
    comparison = { secondary: sec.overall_avg, middle: mid.overall_avg };
  }
  // مقارنة بالدورة السابقة
  const prev = await c.env.DB.prepare(
    "SELECT id FROM eval_cycles WHERE status='published' AND id < ? AND target_types LIKE '%students%' ORDER BY id DESC LIMIT 1",
  ).bind(cycleId).first<any>();
  let prevAvg = null;
  if (prev) prevAvg = (await stageBoard(c.env, prev.id, stage)).overall_avg;

  return c.json({ cycle, stage, board, comparison, previous_avg: prevAvg });
});

async function stageBoard(env: Env, cycleId: number, stage: string | null) {
  const criteria = (await env.DB.prepare(
    "SELECT * FROM eval_criteria WHERE cycle_id = ? AND target_type = 'students' AND is_active = 1",
  ).bind(cycleId).all<any>()).results;

  const students = (await env.DB.prepare(
    `SELECT id, name, grade FROM students WHERE status='active' ${stage ? 'AND stage = ?' : ''}`,
  ).bind(...(stage ? [stage] : [])).all<any>()).results;

  const evals = (await env.DB.prepare(
    `SELECT e.id, e.target_id, e.evaluator_id FROM evaluations e
      WHERE e.cycle_id = ? AND e.target_type='students' AND e.submitted_at IS NOT NULL`,
  ).bind(cycleId).all<any>()).results;
  const allScores = (await env.DB.prepare(
    `SELECT es.* FROM evaluation_scores es JOIN evaluations e ON e.id = es.evaluation_id
      WHERE e.cycle_id = ? AND e.target_type='students'`,
  ).bind(cycleId).all<any>()).results;
  const scoresByEval: Record<number, any[]> = {};
  allScores.forEach((s: any) => { (scoresByEval[s.evaluation_id] ||= []).push(s); });

  const studentIds = new Set(students.map((s: any) => s.id));
  const results: { id: number; name: string; grade: string; score: number | null }[] = [];
  // متوسط كل معيار على مستوى المرحلة
  const critSum: Record<number, { sum: number; n: number; name: string }> = {};
  criteria.forEach((cr: any) => { critSum[cr.id] = { sum: 0, n: 0, name: cr.name }; });

  for (const st of students) {
    const evForT = evals.filter((e: any) => e.target_id === st.id);
    const perEval = evForT.map((e: any) => weightedForEvaluation(scoresByEval[e.id] || [], criteria)).filter((x: any): x is number => x != null);
    const overall = perEval.length ? perEval.reduce((a, b) => a + b, 0) / perEval.length : null;
    results.push({ id: st.id, name: st.name, grade: st.grade, score: overall });
    for (const e of evForT) for (const s of (scoresByEval[e.id] || [])) {
      if (!s.is_na && s.score != null && critSum[s.criterion_id]) { critSum[s.criterion_id].sum += s.score; critSum[s.criterion_id].n++; }
    }
  }

  const scored = results.filter((r) => r.score != null) as { id: number; name: string; grade: string; score: number }[];
  const overallAvg = scored.length ? scored.reduce((a, b) => a + b.score, 0) / scored.length : null;

  // توزيع الدرجات (نطاقات)
  const dist = { '1-2': 0, '2-3': 0, '3-4': 0, '4-5': 0 };
  scored.forEach((r) => {
    if (r.score < 2) dist['1-2']++; else if (r.score < 3) dist['2-3']++; else if (r.score < 4) dist['3-4']++; else dist['4-5']++;
  });

  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const top = sorted.slice(0, 10).map((r) => ({ name: r.name, score: r.score }));
  const bottom = sorted.slice(-10).reverse().map((r) => ({ name: r.name, score: r.score }));

  const weakest = Object.values(critSum).filter((c) => c.n > 0)
    .map((c) => ({ name: c.name, avg: c.sum / c.n })).sort((a, b) => a.avg - b.avg).slice(0, 3);

  const totalTargets = students.length;
  const evaluatedCount = scored.length;

  return {
    total_students: totalTargets,
    evaluated: evaluatedCount,
    completion: totalTargets ? Math.round((evaluatedCount / totalTargets) * 100) : 0,
    overall_avg: overallAvg,
    distribution: dist,
    top,
    bottom,
    weakest_criteria: weakest,
  };
}

export default app;
