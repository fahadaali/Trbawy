// تعداد الأهداف التي يقيّمها مستخدم في فئة معيّنة (مشترك بين التقييم والتذكيرات).
import type { Env, User } from '../types';

export async function evaluationTargets(env: Env, u: User, targetType: string): Promise<{ id: number; name: string }[]> {
  if (targetType === 'students') {
    if (!u.stage) return [];
    return (await env.DB.prepare("SELECT id, name FROM students WHERE stage = ? AND status = 'active' ORDER BY name").bind(u.stage).all<any>()).results;
  }
  if (targetType === 'team_members') {
    if (!u.stage) return [];
    return (await env.DB.prepare("SELECT id, name FROM users WHERE role = 'team_member' AND stage = ? AND is_active = 1 ORDER BY name").bind(u.stage).all<any>()).results;
  }
  if (targetType === 'first_supervisors') {
    return (await env.DB.prepare("SELECT id, name FROM users WHERE role = 'first_supervisor' AND is_active = 1 ORDER BY name").all<any>()).results;
  }
  return [];
}
