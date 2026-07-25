// تعداد الأهداف التي يقيّمها مستخدم في فئة معيّنة (مشترك بين التقييم والتذكيرات).
import type { Env, User } from '../types';
import { isPresident, isVice } from '../permissions';

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

// نطاق الاطلاع على النتائج (أوسع من نطاق التقييم: الرئيس/النائب يريان الكل).
export async function resultTargets(env: Env, u: User, tt: string): Promise<{ id: number; name: string }[]> {
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
