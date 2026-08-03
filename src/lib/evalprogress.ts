// حساب تقدّم الإدخال لكل مقيِّم في دورة (مشترك بين شاشة التقدّم وتذكيرات الإغلاق).
import type { Env } from '../types';
import { canEvaluate } from '../permissions';
import { evaluationTargets } from './evaltargets';

export interface EvaluatorProgress {
  id: number;
  name: string;
  role: string;
  expected: number;
  submitted: number;
}

export async function evaluatorProgress(
  env: Env,
  cycle: { id: number; target_types: string },
): Promise<EvaluatorProgress[]> {
  const types = cycle.target_types.split(',');
  const users = (await env.DB.prepare(
    'SELECT id, name, role, stage FROM users WHERE is_active = 1 AND deleted_at IS NULL',
  ).all<any>()).results;

  const rows: EvaluatorProgress[] = [];
  for (const usr of users) {
    let expected = 0;
    for (const tt of types) {
      if (!canEvaluate(usr, tt)) continue;
      expected += (await evaluationTargets(env, usr, tt)).length;
    }
    if (expected === 0) continue;
    const done = (await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM evaluations WHERE cycle_id = ? AND evaluator_id = ? AND submitted_at IS NOT NULL',
    ).bind(cycle.id, usr.id).first<{ n: number }>())?.n ?? 0;
    rows.push({ id: usr.id, name: usr.name, role: usr.role, expected, submitted: done });
  }
  return rows;
}
