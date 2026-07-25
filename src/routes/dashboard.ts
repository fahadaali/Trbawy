// لوحات القيادة: ملخص الصفحة الرئيسية، ولوحة تحليلات الطلاب.
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import { canViewResults, canViewCouncil, canEvaluate, isPresident, isVice } from '../permissions';
import { weightedForEvaluation } from '../lib/evalcalc';
import { evaluationTargets } from '../lib/evaltargets';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', requireAuth, requirePasswordChanged);

// ---- العناصر التي تنتظر إجراء المستخدم (لتنبيه منبثق عند الدخول/فتح الصفحة) ----
app.get('/pending', async (c) => {
  const u = c.get('user');

  // محاضر بانتظار توقيعي
  const signatures = (await c.env.DB.prepare(
    `SELECT m.id, m.display_number FROM meeting_attendees ma JOIN meetings m ON m.id = ma.meeting_id
      WHERE ma.user_id = ? AND ma.is_guest = 0 AND ma.attendance_status = 'present'
        AND ma.signed_at IS NULL AND ma.signature_override = 0 AND m.status = 'awaiting_signatures'
      ORDER BY m.id DESC`,
  ).bind(u.id).all<any>()).results;

  // مهامي المفتوحة
  const tasks = (await c.env.DB.prepare(
    `SELECT a.id, a.text, a.due_date FROM action_items a
       JOIN action_assignees aa ON aa.action_item_id = a.id
      WHERE aa.user_id = ? AND a.status NOT IN ('done','cancelled')
      ORDER BY a.due_date IS NULL, a.due_date LIMIT 20`,
  ).bind(u.id).all<any>()).results;

  // دورات تقييم مفتوحة لم أُكملها بعد
  const openCycles = (await c.env.DB.prepare(
    "SELECT id, name, target_types FROM eval_cycles WHERE status = 'open'",
  ).all<any>()).results;
  const evaluations: { id: number; name: string; remaining: number }[] = [];
  for (const cy of openCycles) {
    const types: string[] = cy.target_types.split(',');
    let expected = 0;
    for (const tt of types) {
      if (!canEvaluate(u, tt)) continue;
      expected += (await evaluationTargets(c.env, u, tt)).length;
    }
    if (expected === 0) continue;
    const done = (await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM evaluations WHERE cycle_id = ? AND evaluator_id = ? AND submitted_at IS NOT NULL',
    ).bind(cy.id, u.id).first<{ n: number }>())?.n ?? 0;
    if (done < expected) evaluations.push({ id: cy.id, name: cy.name, remaining: expected - done });
  }

  return c.json({
    signatures: signatures.map((s) => ({ title: s.display_number, link: `#/meetings/${s.id}` })),
    tasks: tasks.map((t) => ({ title: t.text, due_date: t.due_date, link: `#/tasks/${t.id}` })),
    evaluations: evaluations.map((e) => ({ title: e.name, remaining: e.remaining, link: `#/evaluations/${e.id}` })),
  });
});

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

  const canAllStages = isPresident(u) || isVice(u);
  const stage = canAllStages ? (c.req.query('stage') || null) : (u.stage || null);

  const board = await boardFor(c.env, cycleId, 'students', stage);
  let comparison = null;
  if (canAllStages && !stage) {
    const sec = await boardFor(c.env, cycleId, 'students', 'secondary');
    const mid = await boardFor(c.env, cycleId, 'students', 'middle');
    comparison = { secondary: sec.overall_avg, middle: mid.overall_avg };
  }
  const prevAvg = await previousCycleAvg(c.env, cycleId, 'students', stage);
  return c.json({ cycle, stage, board, comparison, previous_avg: prevAvg });
});

// ---- لوحة تحليلات المشرفين وأعضاء الفرق لدورة (القسم ٥٫٦) ----
app.get('/staff', async (c) => {
  const u = c.get('user');
  const tt = c.req.query('target_type') || '';
  if (!['team_members', 'first_supervisors'].includes(tt)) return c.json({ error: 'الفئة غير صالحة' }, 400);
  if (!canViewResults(u, tt)) return c.json({ error: 'لا تملك صلاحية' }, 403);
  const cycleId = Number(c.req.query('cycle_id'));
  const cycle = await c.env.DB.prepare('SELECT * FROM eval_cycles WHERE id = ?').bind(cycleId).first<any>();
  if (!cycle) return c.json({ error: 'الدورة غير موجودة' }, 404);
  if (cycle.status !== 'published') return c.json({ error: 'النتائج غير منشورة' }, 409);

  // أعضاء الفرق مقيَّدون بالمرحلة (المشرف الأول يرى فريقه)؛ المشرفون الأوائل بلا مرحلة.
  let stage: string | null = null;
  if (tt === 'team_members') stage = isPresident(u) ? (c.req.query('stage') || null) : (u.stage || null);

  const board = await boardFor(c.env, cycleId, tt, stage);
  const prevAvg = await previousCycleAvg(c.env, cycleId, tt, stage);
  return c.json({ cycle, target_type: tt, stage, board, previous_avg: prevAvg });
});

async function previousCycleAvg(env: Env, cycleId: number, tt: string, stage: string | null): Promise<number | null> {
  const prev = await env.DB.prepare(
    "SELECT id FROM eval_cycles WHERE status='published' AND id < ? AND target_types LIKE ? ORDER BY id DESC LIMIT 1",
  ).bind(cycleId, '%' + tt + '%').first<any>();
  if (!prev) return null;
  return (await boardFor(env, prev.id, tt, stage)).overall_avg;
}

// جلب أهداف الفئة (طلاب/أعضاء/مشرفون) مع تقييد المرحلة إن انطبق
async function boardTargets(env: Env, targetType: string, stage: string | null): Promise<{ id: number; name: string }[]> {
  if (targetType === 'students')
    return (await env.DB.prepare(`SELECT id, name FROM students WHERE status='active' ${stage ? 'AND stage = ?' : ''}`).bind(...(stage ? [stage] : [])).all<any>()).results;
  if (targetType === 'team_members')
    return (await env.DB.prepare(`SELECT id, name FROM users WHERE role='team_member' AND is_active=1 ${stage ? 'AND stage = ?' : ''}`).bind(...(stage ? [stage] : [])).all<any>()).results;
  return (await env.DB.prepare("SELECT id, name FROM users WHERE role='first_supervisor' AND is_active=1").all<any>()).results;
}

// لوحة مؤشرات عامة لأي فئة تقييم
async function boardFor(env: Env, cycleId: number, targetType: string, stage: string | null) {
  const criteria = (await env.DB.prepare(
    'SELECT * FROM eval_criteria WHERE cycle_id = ? AND target_type = ? AND is_active = 1',
  ).bind(cycleId, targetType).all<any>()).results;

  const targets = await boardTargets(env, targetType, stage);
  const evals = (await env.DB.prepare(
    'SELECT id, target_id FROM evaluations WHERE cycle_id = ? AND target_type = ? AND submitted_at IS NOT NULL',
  ).bind(cycleId, targetType).all<any>()).results;
  const allScores = (await env.DB.prepare(
    `SELECT es.* FROM evaluation_scores es JOIN evaluations e ON e.id = es.evaluation_id
      WHERE e.cycle_id = ? AND e.target_type = ?`,
  ).bind(cycleId, targetType).all<any>()).results;
  const scoresByEval: Record<number, any[]> = {};
  allScores.forEach((s: any) => { (scoresByEval[s.evaluation_id] ||= []).push(s); });

  const results: { name: string; score: number | null }[] = [];
  const critSum: Record<number, { sum: number; n: number; name: string }> = {};
  criteria.forEach((cr: any) => { critSum[cr.id] = { sum: 0, n: 0, name: cr.name }; });

  for (const t of targets) {
    const evForT = evals.filter((e: any) => e.target_id === t.id);
    const perEval = evForT.map((e: any) => weightedForEvaluation(scoresByEval[e.id] || [], criteria)).filter((x: any): x is number => x != null);
    const overall = perEval.length ? perEval.reduce((a, b) => a + b, 0) / perEval.length : null;
    results.push({ name: t.name, score: overall });
    for (const e of evForT) for (const s of (scoresByEval[e.id] || [])) {
      if (!s.is_na && s.score != null && critSum[s.criterion_id]) { critSum[s.criterion_id].sum += s.score; critSum[s.criterion_id].n++; }
    }
  }

  const scored = results.filter((r) => r.score != null) as { name: string; score: number }[];
  const overallAvg = scored.length ? scored.reduce((a, b) => a + b.score, 0) / scored.length : null;

  const dist = { '1-2': 0, '2-3': 0, '3-4': 0, '4-5': 0 };
  scored.forEach((r) => {
    if (r.score < 2) dist['1-2']++; else if (r.score < 3) dist['2-3']++; else if (r.score < 4) dist['3-4']++; else dist['4-5']++;
  });

  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const weakest = Object.values(critSum).filter((cc) => cc.n > 0)
    .map((cc) => ({ name: cc.name, avg: cc.sum / cc.n })).sort((a, b) => a.avg - b.avg).slice(0, 3);

  return {
    total_targets: targets.length,
    evaluated: scored.length,
    completion: targets.length ? Math.round((scored.length / targets.length) * 100) : 0,
    overall_avg: overallAvg,
    distribution: dist,
    top: sorted.slice(0, 10).map((r) => ({ name: r.name, score: r.score })),
    bottom: sorted.slice(-10).reverse().map((r) => ({ name: r.name, score: r.score })),
    weakest_criteria: weakest,
  };
}

export default app;
