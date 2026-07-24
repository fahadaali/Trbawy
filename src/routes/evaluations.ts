// وحدة التقييم: الدورات، المعايير، النماذج، آلية المتوسط المرجّح، والنافذة التفصيلية.
import { Hono } from 'hono';
import type { Env, Variables, User } from '../types';
import { audit } from '../lib/audit';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import {
  canCreateEvalCycle, canManageCriteria, canEvaluate, canViewResults, isPresident, isVice,
} from '../permissions';
import { weightedForEvaluation } from '../lib/evalcalc';
import { evaluationTargets } from '../lib/evaltargets';
import { evaluatorProgress } from '../lib/evalprogress';
import { csvCell, parseCsv } from '../lib/csv';
import { notifyMany } from '../lib/notify';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', requireAuth, requirePasswordChanged);

const TARGET_TYPES = ['students', 'team_members', 'first_supervisors'];

// ============ المعايير (قوالب مرجعية: cycle_id = NULL) ============
app.get('/criteria', async (c) => {
  const tt = c.req.query('target_type');
  const rows = await c.env.DB.prepare(
    `SELECT * FROM eval_criteria WHERE cycle_id IS NULL ${tt ? 'AND target_type = ?' : ''} ORDER BY target_type, sort_order`,
  ).bind(...(tt ? [tt] : [])).all();
  return c.json({ criteria: rows.results });
});

app.post('/criteria', async (c) => {
  if (!canManageCriteria(c.get('user'))) return c.json({ error: 'لا تملك صلاحية' }, 403);
  const b = await c.req.json().catch(() => ({}));
  if (!TARGET_TYPES.includes(b.target_type)) return c.json({ error: 'الفئة غير صالحة' }, 400);
  if (!b.name) return c.json({ error: 'اسم المعيار مطلوب' }, 400);
  const max = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) AS m FROM eval_criteria WHERE cycle_id IS NULL AND target_type = ?',
  ).bind(b.target_type).first<{ m: number }>();
  const res = await c.env.DB.prepare(
    'INSERT INTO eval_criteria (cycle_id, target_type, name, description, weight, sort_order, is_active) VALUES (NULL, ?, ?, ?, ?, ?, 1)',
  ).bind(b.target_type, b.name, b.description || null, Number(b.weight) || 0, (max?.m ?? -1) + 1).run();
  return c.json({ id: res.meta.last_row_id }, 201);
});

app.patch('/criteria/:id', async (c) => {
  if (!canManageCriteria(c.get('user'))) return c.json({ error: 'لا تملك صلاحية' }, 403);
  const id = Number(c.req.param('id'));
  const cur = await c.env.DB.prepare('SELECT * FROM eval_criteria WHERE id = ? AND cycle_id IS NULL').bind(id).first<any>();
  if (!cur) return c.json({ error: 'المعيار غير موجود' }, 404);
  const b = await c.req.json().catch(() => ({}));
  await c.env.DB.prepare(
    'UPDATE eval_criteria SET name=?, description=?, weight=?, is_active=? WHERE id=?',
  ).bind(
    b.name ?? cur.name, b.description ?? cur.description,
    b.weight != null ? Number(b.weight) : cur.weight,
    b.is_active != null ? (b.is_active ? 1 : 0) : cur.is_active, id,
  ).run();
  return c.json({ ok: true });
});

app.delete('/criteria/:id', async (c) => {
  if (!canManageCriteria(c.get('user'))) return c.json({ error: 'لا تملك صلاحية' }, 403);
  await c.env.DB.prepare('DELETE FROM eval_criteria WHERE id = ? AND cycle_id IS NULL').bind(Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});

// تصدير المعايير CSV (يفتح في Excel)
app.get('/criteria/export', async (c) => {
  const rows = await c.env.DB.prepare('SELECT target_type, name, description, weight FROM eval_criteria WHERE cycle_id IS NULL ORDER BY target_type, sort_order').all<any>();
  const header = 'target_type,name,description,weight';
  const body = rows.results.map((r) => [r.target_type, r.name, r.description || '', r.weight].map(csvCell).join(',')).join('\n');
  return new Response('﻿' + header + '\n' + body, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="criteria.csv"' },
  });
});

// استيراد المعايير من CSV (يستبدل قوالب الفئات الواردة في الملف)
app.post('/criteria/import', async (c) => {
  if (!canManageCriteria(c.get('user'))) return c.json({ error: 'لا تملك صلاحية' }, 403);
  const commit = c.req.query('commit') === '1';
  const { csv } = await c.req.json().catch(() => ({}));
  if (!csv) return c.json({ error: 'لا توجد بيانات' }, 400);
  const rows = parseCsv(csv);
  if (rows.length < 2) return c.json({ error: 'الملف فارغ' }, 400);
  const header = rows[0].map((h) => h.trim());
  const ci = { tt: header.indexOf('target_type'), name: header.indexOf('name'), desc: header.indexOf('description'), weight: header.indexOf('weight') };
  if (ci.tt < 0 || ci.name < 0 || ci.weight < 0) return c.json({ error: 'الأعمدة الإلزامية: target_type, name, weight' }, 400);

  const report: any[] = [];
  const valid: any[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const tt = (r[ci.tt] || '').trim();
    const name = (r[ci.name] || '').trim();
    const weight = Number((r[ci.weight] || '').trim());
    const errors: string[] = [];
    if (!TARGET_TYPES.includes(tt)) errors.push('الفئة غير صالحة');
    if (!name) errors.push('الاسم ناقص');
    if (isNaN(weight) || weight < 0 || weight > 100) errors.push('الوزن غير صالح');
    const rec = { target_type: tt, name, description: ci.desc >= 0 ? (r[ci.desc] || '').trim() : '', weight };
    report.push({ row: i + 1, ...rec, errors });
    if (!errors.length) valid.push(rec);
  }

  if (!commit) return c.json({ preview: true, valid: valid.length, invalid: report.filter((r) => r.errors.length).length, report });

  // استبدال قوالب الفئات الواردة
  const affected = [...new Set(valid.map((v) => v.target_type))];
  for (const tt of affected) await c.env.DB.prepare('DELETE FROM eval_criteria WHERE cycle_id IS NULL AND target_type = ?').bind(tt).run();
  let order: Record<string, number> = {};
  if (valid.length) await c.env.DB.batch(valid.map((v) => {
    const o = (order[v.target_type] = (order[v.target_type] ?? -1) + 1);
    return c.env.DB.prepare('INSERT INTO eval_criteria (cycle_id, target_type, name, description, weight, sort_order, is_active) VALUES (NULL, ?, ?, ?, ?, ?, 1)')
      .bind(v.target_type, v.name, v.description || null, v.weight, o);
  }));
  await audit(c.env, { userId: c.get('user').id, action: 'import_criteria', entityType: 'eval_criteria', newValue: { inserted: valid.length } });
  return c.json({ committed: true, inserted: valid.length });
});

// ============ الدورات ============
app.post('/cycles', async (c) => {
  if (!canCreateEvalCycle(c.get('user'))) return c.json({ error: 'إنشاء الدورات للرئيس حصراً' }, 403);
  const b = await c.req.json().catch(() => ({}));
  if (!b.name || !b.start_date || !b.end_date) return c.json({ error: 'الاسم والفترة مطلوبة' }, 400);
  const types = (Array.isArray(b.target_types) ? b.target_types : []).filter((t: string) => TARGET_TYPES.includes(t));
  if (!types.length) return c.json({ error: 'حدد فئة واحدة على الأقل' }, 400);
  const res = await c.env.DB.prepare(
    `INSERT INTO eval_cycles (name, start_date, end_date, status, target_types, created_by) VALUES (?, ?, ?, 'draft', ?, ?)`,
  ).bind(b.name, b.start_date, b.end_date, types.join(','), c.get('user').id).run();
  await audit(c.env, { userId: c.get('user').id, action: 'create_cycle', entityType: 'eval_cycle', entityId: res.meta.last_row_id, newValue: { name: b.name, types } });
  return c.json({ id: res.meta.last_row_id }, 201);
});

app.get('/cycles', async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM eval_cycles ORDER BY id DESC').all<any>();
  return c.json({ cycles: rows.results });
});

app.get('/cycles/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const cycle = await c.env.DB.prepare('SELECT * FROM eval_cycles WHERE id = ?').bind(id).first<any>();
  if (!cycle) return c.json({ error: 'الدورة غير موجودة' }, 404);
  const u = c.get('user');
  const types: string[] = cycle.target_types.split(',');
  // ما الذي يقيّمه هذا المستخدم في هذه الدورة
  const iEvaluate = types.filter((t) => canEvaluate(u, t));
  return c.json({ cycle, target_types: types, i_evaluate: iEvaluate, is_president: isPresident(u) });
});

// تحوّلات حالة الدورة
app.post('/cycles/:id/status', async (c) => {
  if (!canCreateEvalCycle(c.get('user'))) return c.json({ error: 'للرئيس حصراً' }, 403);
  const id = Number(c.req.param('id'));
  const { action } = await c.req.json().catch(() => ({}));
  const cycle = await c.env.DB.prepare('SELECT * FROM eval_cycles WHERE id = ?').bind(id).first<any>();
  if (!cycle) return c.json({ error: 'الدورة غير موجودة' }, 404);
  const types: string[] = cycle.target_types.split(',');

  let ns: string | null = null;
  if (action === 'open' && cycle.status === 'draft') {
    // تحقق من مجموع الأوزان = 100 لكل فئة، ثم انسخ المعايير داخل الدورة
    for (const tt of types) {
      const sum = await c.env.DB.prepare(
        'SELECT COALESCE(SUM(weight),0) AS s, COUNT(*) AS n FROM eval_criteria WHERE cycle_id IS NULL AND target_type = ? AND is_active = 1',
      ).bind(tt).first<{ s: number; n: number }>();
      if (!sum || sum.n === 0) return c.json({ error: `لا توجد معايير مفعّلة للفئة: ${tt}` }, 400);
      if (Math.round(sum.s) !== 100) return c.json({ error: `مجموع أوزان معايير «${tt}» = ${sum.s}%، ويجب أن يكون 100%` }, 400);
    }
    // نسخ المعايير (تثبيت التاريخ)
    for (const tt of types) {
      const tmpl = await c.env.DB.prepare(
        'SELECT * FROM eval_criteria WHERE cycle_id IS NULL AND target_type = ? AND is_active = 1 ORDER BY sort_order',
      ).bind(tt).all<any>();
      await c.env.DB.batch(tmpl.results.map((cr) =>
        c.env.DB.prepare(
          'INSERT INTO eval_criteria (cycle_id, target_type, name, description, weight, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)',
        ).bind(id, tt, cr.name, cr.description, cr.weight, cr.sort_order)));
    }
    ns = 'open';
  } else if (action === 'close' && cycle.status === 'open') ns = 'closed';
  else if (action === 'publish' && cycle.status === 'closed') ns = 'published';
  else return c.json({ error: 'تحوّل غير صالح' }, 400);

  await c.env.DB.prepare('UPDATE eval_cycles SET status = ? WHERE id = ?').bind(ns, id).run();
  // إشعار المقيّمين عند الفتح (بريد + داخل المنصة)
  if (ns === 'open') {
    const evaluators = await c.env.DB.prepare(
      "SELECT id FROM users WHERE is_active = 1 AND role IN ('president','vice_president','first_supervisor','team_member')",
    ).all<{ id: number }>();
    await notifyMany(c.env, evaluators.results.map((e) => e.id), {
      type: 'cycle_open', title: 'فتح دورة تقييم', body: cycle.name, link: `#/evaluations/${id}`,
    });
  }
  // إشعار أصحاب الصلاحية عند نشر النتائج
  if (ns === 'published') {
    const viewers = await c.env.DB.prepare(
      "SELECT id, role FROM users WHERE is_active = 1",
    ).all<{ id: number; role: string }>();
    const eligible = viewers.results.filter((v) => types.some((tt) => canViewResults({ role: v.role } as any, tt)));
    await notifyMany(c.env, eligible.map((v) => v.id), {
      type: 'results_published', title: 'نشر نتائج دورة تقييم', body: cycle.name, link: `#/evaluations/${id}`,
    });
  }
  await audit(c.env, { userId: c.get('user').id, action: 'cycle_' + action, entityType: 'eval_cycle', entityId: id, newValue: { status: ns } });
  return c.json({ ok: true, status: ns });
});

// معايير الدورة (المنسوخة) أو القوالب إن كانت مسودة
async function cycleCriteria(env: Env, cycleId: number, targetType: string, cycleStatus: string) {
  const useCycle = cycleStatus !== 'draft';
  const rows = await env.DB.prepare(
    `SELECT * FROM eval_criteria WHERE ${useCycle ? 'cycle_id = ?' : 'cycle_id IS NULL'} AND target_type = ? AND is_active = 1 ORDER BY sort_order`,
  ).bind(...(useCycle ? [cycleId, targetType] : [targetType])).all<any>();
  return rows.results;
}

// ============ الأهداف التي يقيّمها المستخدم ============
app.get('/cycles/:id/targets', async (c) => {
  const id = Number(c.req.param('id'));
  const tt = c.req.query('target_type') || '';
  const cycle = await c.env.DB.prepare('SELECT * FROM eval_cycles WHERE id = ?').bind(id).first<any>();
  if (!cycle) return c.json({ error: 'الدورة غير موجودة' }, 404);
  const u = c.get('user');
  if (!canEvaluate(u, tt)) return c.json({ error: 'لا تقيّم هذه الفئة' }, 403);

  const targets = await evaluationTargets(c.env, u, tt);
  // ما تم تسليمه
  const submitted = await c.env.DB.prepare(
    'SELECT target_id, submitted_at FROM evaluations WHERE cycle_id = ? AND evaluator_id = ? AND target_type = ?',
  ).bind(id, u.id, tt).all<any>();
  const map: Record<number, string> = {};
  submitted.results.forEach((s: any) => { map[s.target_id] = s.submitted_at; });
  return c.json({ targets: targets.map((t) => ({ ...t, submitted: !!map[t.id], submitted_at: map[t.id] || null })), cycle_status: cycle.status });
});

// نموذج تقييم هدف معيّن
app.get('/cycles/:id/form', async (c) => {
  const id = Number(c.req.param('id'));
  const tt = c.req.query('target_type') || '';
  const targetId = Number(c.req.query('target_id'));
  const cycle = await c.env.DB.prepare('SELECT * FROM eval_cycles WHERE id = ?').bind(id).first<any>();
  if (!cycle) return c.json({ error: 'الدورة غير موجودة' }, 404);
  const u = c.get('user');
  if (!canEvaluate(u, tt)) return c.json({ error: 'لا تقيّم هذه الفئة' }, 403);
  // الهدف يجب أن يكون ضمن نطاق تقييم المستخدم (منع كشف أسماء مرحلة أخرى)
  const allowedTargets = await evaluationTargets(c.env, u, tt);
  if (!allowedTargets.some((t) => t.id === targetId)) return c.json({ error: 'الهدف خارج نطاق تقييمك' }, 403);

  const criteria = await cycleCriteria(c.env, id, tt, cycle.status);
  const evalRow = await c.env.DB.prepare(
    'SELECT * FROM evaluations WHERE cycle_id = ? AND evaluator_id = ? AND target_type = ? AND target_id = ?',
  ).bind(id, u.id, tt, targetId).first<any>();
  let scores: any[] = [];
  if (evalRow) {
    const s = await c.env.DB.prepare('SELECT * FROM evaluation_scores WHERE evaluation_id = ?').bind(evalRow.id).all();
    scores = s.results;
  }
  const target = await targetName(c.env, tt, targetId);
  return c.json({ cycle, criteria, existing: evalRow, scores, target, editable: cycle.status === 'open' });
});

async function targetName(env: Env, tt: string, id: number): Promise<string> {
  if (tt === 'students') return (await env.DB.prepare('SELECT name FROM students WHERE id = ?').bind(id).first<any>())?.name || '';
  return (await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(id).first<any>())?.name || '';
}

// حفظ/تسليم تقييم
app.put('/cycles/:id/evaluate', async (c) => {
  const id = Number(c.req.param('id'));
  const cycle = await c.env.DB.prepare('SELECT * FROM eval_cycles WHERE id = ?').bind(id).first<any>();
  if (!cycle) return c.json({ error: 'الدورة غير موجودة' }, 404);
  if (cycle.status !== 'open') return c.json({ error: 'الدورة ليست مفتوحة للإدخال' }, 409);
  const u = c.get('user');
  const b = await c.req.json().catch(() => ({}));
  const tt = b.target_type;
  if (!canEvaluate(u, tt)) return c.json({ error: 'لا تقيّم هذه الفئة' }, 403);
  const targetId = Number(b.target_id);

  // تحقق أن الهدف ضمن نطاق المقيّم
  const allowed = await evaluationTargets(c.env, u, tt);
  if (!allowed.some((t) => t.id === targetId)) return c.json({ error: 'الهدف خارج نطاق تقييمك' }, 403);

  // upsert evaluation
  let evalRow = await c.env.DB.prepare(
    'SELECT id FROM evaluations WHERE cycle_id = ? AND evaluator_id = ? AND target_type = ? AND target_id = ?',
  ).bind(id, u.id, tt, targetId).first<any>();
  let evalId: number;
  if (evalRow) {
    evalId = evalRow.id;
    await c.env.DB.prepare("UPDATE evaluations SET submitted_at = datetime('now'), general_note = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(b.general_note || null, evalId).run();
    await c.env.DB.prepare('DELETE FROM evaluation_scores WHERE evaluation_id = ?').bind(evalId).run();
  } else {
    const res = await c.env.DB.prepare(
      "INSERT INTO evaluations (cycle_id, evaluator_id, target_type, target_id, submitted_at, general_note) VALUES (?, ?, ?, ?, datetime('now'), ?)",
    ).bind(id, u.id, tt, targetId, b.general_note || null).run();
    evalId = res.meta.last_row_id as number;
  }
  const scores = Array.isArray(b.scores) ? b.scores : [];
  if (scores.length) {
    await c.env.DB.batch(scores.map((s: any) =>
      c.env.DB.prepare(
        'INSERT INTO evaluation_scores (evaluation_id, criterion_id, score, is_na, note) VALUES (?, ?, ?, ?, ?)',
      ).bind(evalId, Number(s.criterion_id), s.is_na ? null : Number(s.score), s.is_na ? 1 : 0, s.note || null)));
  }
  await audit(c.env, { userId: u.id, action: 'submit_evaluation', entityType: 'evaluation', entityId: evalId, newValue: { cycle: id, tt, targetId } });
  return c.json({ ok: true });
});

// ============ التقدّم (للرئيس) ============
app.get('/cycles/:id/progress', async (c) => {
  if (!isPresident(c.get('user'))) return c.json({ error: 'للرئيس حصراً' }, 403);
  const id = Number(c.req.param('id'));
  const cycle = await c.env.DB.prepare('SELECT * FROM eval_cycles WHERE id = ?').bind(id).first<any>();
  if (!cycle) return c.json({ error: 'الدورة غير موجودة' }, 404);
  const progress = await evaluatorProgress(c.env, cycle);
  return c.json({ progress });
});

// ============ النتائج (بعد النشر) ============
app.get('/cycles/:id/results', async (c) => {
  const id = Number(c.req.param('id'));
  const tt = c.req.query('target_type') || '';
  const cycle = await c.env.DB.prepare('SELECT * FROM eval_cycles WHERE id = ?').bind(id).first<any>();
  if (!cycle) return c.json({ error: 'الدورة غير موجودة' }, 404);
  const u = c.get('user');
  if (!canViewResults(u, tt)) return c.json({ error: 'لا تملك صلاحية الاطلاع على نتائج هذه الفئة' }, 403);
  if (cycle.status !== 'published') return c.json({ error: 'النتائج غير منشورة بعد' }, 409);

  const criteria = await cycleCriteria(c.env, id, tt, cycle.status);
  const targets = await resultTargets(c.env, u, tt);

  // كل التقييمات لهذه الفئة
  const evals = await c.env.DB.prepare(
    'SELECT id, evaluator_id, target_id FROM evaluations WHERE cycle_id = ? AND target_type = ? AND submitted_at IS NOT NULL',
  ).bind(id, tt).all<any>();
  const allScores = await c.env.DB.prepare(
    `SELECT es.* FROM evaluation_scores es JOIN evaluations e ON e.id = es.evaluation_id
      WHERE e.cycle_id = ? AND e.target_type = ?`,
  ).bind(id, tt).all<any>();
  const scoresByEval: Record<number, any[]> = {};
  allScores.results.forEach((s: any) => { (scoresByEval[s.evaluation_id] ||= []).push(s); });

  const results = targets.map((t) => {
    const evForTarget = evals.results.filter((e: any) => e.target_id === t.id);
    const perEval = evForTarget.map((e: any) => weightedForEvaluation(scoresByEval[e.id] || [], criteria)).filter((x): x is number => x != null);
    const overall = perEval.length ? perEval.reduce((a, b) => a + b, 0) / perEval.length : null;
    // متوسط كل معيار عبر المقيّمين
    const perCriterion = criteria.map((cr) => {
      const vals: number[] = [];
      for (const e of evForTarget) {
        const s = (scoresByEval[e.id] || []).find((x: any) => x.criterion_id === cr.id);
        if (s && !s.is_na && s.score != null) vals.push(s.score);
      }
      return { criterion_id: cr.id, name: cr.name, avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, count: vals.length };
    });
    return { target_id: t.id, name: t.name, overall, evaluators: perEval.length, per_criterion: perCriterion };
  });
  return c.json({ criteria, results, cycle });
});

async function resultTargets(env: Env, u: User, tt: string): Promise<{ id: number; name: string }[]> {
  if (tt === 'students') {
    // الرئيس/النائب: الكل. المشرف/العضو: مرحلته.
    if (isPresident(u) || isVice(u)) {
      return (await env.DB.prepare("SELECT id, name FROM students WHERE status='active' ORDER BY stage, name").all<any>()).results;
    }
    return (await env.DB.prepare("SELECT id, name FROM students WHERE stage=? AND status='active' ORDER BY name").bind(u.stage).all<any>()).results;
  }
  if (tt === 'team_members') {
    if (isPresident(u)) return (await env.DB.prepare("SELECT id, name FROM users WHERE role='team_member' AND is_active=1 ORDER BY name").all<any>()).results;
    return (await env.DB.prepare("SELECT id, name FROM users WHERE role='team_member' AND stage=? AND is_active=1 ORDER BY name").bind(u.stage).all<any>()).results;
  }
  if (tt === 'first_supervisors') {
    return (await env.DB.prepare("SELECT id, name FROM users WHERE role='first_supervisor' AND is_active=1 ORDER BY name").all<any>()).results;
  }
  return [];
}

// النافذة التفصيلية: تقييم كل مقيّم لبند معيّن لهدف معيّن
app.get('/cycles/:id/detail', async (c) => {
  const id = Number(c.req.param('id'));
  const tt = c.req.query('target_type') || '';
  const targetId = Number(c.req.query('target_id'));
  const criterionId = Number(c.req.query('criterion_id'));
  const cycle = await c.env.DB.prepare('SELECT * FROM eval_cycles WHERE id = ?').bind(id).first<any>();
  if (!cycle) return c.json({ error: 'الدورة غير موجودة' }, 404);
  const u = c.get('user');
  if (!canViewResults(u, tt)) return c.json({ error: 'لا تملك صلاحية' }, 403);
  if (cycle.status !== 'published') return c.json({ error: 'غير منشورة' }, 409);
  // الهدف يجب أن يكون ضمن نطاق اطلاع المستخدم (منع تسريب نتائج مرحلة أخرى)
  const scoped = await resultTargets(c.env, u, tt);
  if (!scoped.some((t) => t.id === targetId)) return c.json({ error: 'الهدف خارج نطاقك' }, 403);

  const rows = await c.env.DB.prepare(
    `SELECT us.name AS evaluator, es.score, es.is_na, es.note
       FROM evaluation_scores es
       JOIN evaluations e ON e.id = es.evaluation_id
       JOIN users us ON us.id = e.evaluator_id
      WHERE e.cycle_id = ? AND e.target_type = ? AND e.target_id = ? AND es.criterion_id = ?
      ORDER BY us.name`,
  ).bind(id, tt, targetId, criterionId).all();
  return c.json({ entries: rows.results });
});

// مدخلات المقيّم نفسه (قسم منفصل)
app.get('/cycles/:id/my-inputs', async (c) => {
  const id = Number(c.req.param('id'));
  const tt = c.req.query('target_type') || '';
  const u = c.get('user');
  const cycle = await c.env.DB.prepare('SELECT * FROM eval_cycles WHERE id = ?').bind(id).first<any>();
  if (!cycle) return c.json({ error: 'الدورة غير موجودة' }, 404);
  const criteria = await cycleCriteria(c.env, id, tt, cycle.status);
  const evals = await c.env.DB.prepare(
    'SELECT id, target_id FROM evaluations WHERE cycle_id = ? AND evaluator_id = ? AND target_type = ?',
  ).bind(id, u.id, tt).all<any>();
  const out = [];
  for (const e of evals.results) {
    const s = await c.env.DB.prepare('SELECT * FROM evaluation_scores WHERE evaluation_id = ?').bind(e.id).all<any>();
    const w = weightedForEvaluation(s.results, criteria);
    out.push({ target_id: e.target_id, name: await targetName(c.env, tt, e.target_id), weighted: w });
  }
  return c.json({ criteria, my_inputs: out });
});

export default app;
