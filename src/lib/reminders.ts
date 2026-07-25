// التذكيرات اليومية المجدولة (Cron): المهام والدورات.
import type { Env } from '../types';
import { notify } from './notify';
import { evaluatorProgress } from './evalprogress';

// منع التكرار: هل أُرسل إشعار بنفس النوع لنفس المستخدم والرابط اليوم؟
async function alreadySentToday(env: Env, userId: number, type: string, link: string): Promise<boolean> {
  const r = await env.DB.prepare(
    "SELECT 1 FROM notifications WHERE user_id = ? AND type = ? AND link = ? AND date(created_at) = date('now')",
  ).bind(userId, type, link).first();
  return !!r;
}

async function assigneesOf(env: Env, actionId: number): Promise<number[]> {
  const r = await env.DB.prepare('SELECT user_id FROM action_assignees WHERE action_item_id = ?').bind(actionId).all<{ user_id: number }>();
  return r.results.map((x) => x.user_id);
}

export async function runDailyReminders(env: Env): Promise<void> {
  await taskReminders(env);
  await cycleClosingReminders(env);
}

async function taskReminders(env: Env): Promise<void> {
  // المهام غير المنجزة ذات تاريخ استحقاق
  const tasks = (await env.DB.prepare(
    `SELECT id, display_number, text, due_date, council_id FROM action_items
      WHERE type = 'task' AND status NOT IN ('done','cancelled') AND due_date IS NOT NULL`,
  ).all<any>()).results;

  const today = (await env.DB.prepare("SELECT date('now') AS d").first<{ d: string }>())!.d;
  const in3 = (await env.DB.prepare("SELECT date('now','+3 day') AS d").first<{ d: string }>())!.d;

  for (const t of tasks) {
    const link = `#/tasks/${t.id}`;
    let type: string | null = null, title = '';
    if (t.due_date === in3) { type = 'task_due_3'; title = 'تذكير: مهمة تستحق بعد ٣ أيام'; }
    else if (t.due_date === today) { type = 'task_due_today'; title = 'تذكير: مهمة تستحق اليوم'; }
    else if (t.due_date < today) { type = 'task_overdue'; title = 'تنبيه: مهمة متأخرة'; }
    if (!type) continue;

    const assignees = await assigneesOf(env, t.id);
    for (const uid of assignees) {
      if (await alreadySentToday(env, uid, type, link)) continue;
      await notify(env, { userId: uid, type, title, body: `${t.display_number} — ${t.text}`, link });
    }
    // عند التأخر: إشعار رئيس المجلس أيضاً
    if (type === 'task_overdue') {
      const chair = await env.DB.prepare(
        "SELECT user_id FROM council_members WHERE council_id = ? AND position = 'chair'",
      ).bind(t.council_id).first<{ user_id: number }>();
      if (chair && !(await alreadySentToday(env, chair.user_id, 'task_overdue_chair', link))) {
        await notify(env, { userId: chair.user_id, type: 'task_overdue_chair', title: 'تنبيه: مهمة متأخرة في مجلسك', body: `${t.display_number} — ${t.text}`, link });
      }
    }
  }
}

async function cycleClosingReminders(env: Env): Promise<void> {
  const in3 = (await env.DB.prepare("SELECT date('now','+3 day') AS d").first<{ d: string }>())!.d;
  // دورات مفتوحة تُغلق بعد ٣ أيام
  const cycles = (await env.DB.prepare(
    "SELECT id, name, end_date, target_types FROM eval_cycles WHERE status = 'open' AND end_date = ?",
  ).bind(in3).all<any>()).results;
  if (!cycles.length) return;

  for (const cy of cycles) {
    // من لم يكمل الإدخال بعد
    const progress = await evaluatorProgress(env, cy);
    for (const p of progress) {
      if (p.submitted >= p.expected) continue;
      const link = `#/evaluations/${cy.id}`;
      if (await alreadySentToday(env, p.id, 'cycle_closing', link)) continue;
      await notify(env, {
        userId: p.id, type: 'cycle_closing', title: 'تذكير: إغلاق دورة التقييم بعد ٣ أيام',
        body: `${cy.name} — أكملتَ ${p.submitted} من ${p.expected}`, link,
      });
    }
  }
}
