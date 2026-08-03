// تعداد الأهداف التي يقيّمها مستخدم في فئة معيّنة (مشترك بين التقييم والتذكيرات).
// المستخدمون المعلَّقون والمحذوفون مستبعدون من كل القوائم.
import type { Env, User } from '../types';
import { isPresident, isVice } from '../permissions';

const ACTIVE = 'is_active = 1 AND deleted_at IS NULL';

export async function evaluationTargets(env: Env, u: User, targetType: string): Promise<{ id: number; name: string }[]> {
  if (targetType === 'students') {
    if (!u.stage) return [];
    return (await env.DB.prepare("SELECT id, name FROM students WHERE stage = ? AND status = 'active' ORDER BY name").bind(u.stage).all<any>()).results;
  }
  if (targetType === 'team_members') {
    if (!u.stage) return [];
    // لا يقيّم المرء نفسه ولو كان ضمن الفئة
    return (await env.DB.prepare(`SELECT id, name FROM users WHERE role = 'team_member' AND stage = ? AND ${ACTIVE} AND id != ? ORDER BY name`).bind(u.stage, u.id).all<any>()).results;
  }
  if (targetType === 'first_supervisors') {
    return (await env.DB.prepare(`SELECT id, name FROM users WHERE role = 'first_supervisor' AND ${ACTIVE} AND id != ? ORDER BY name`).bind(u.id).all<any>()).results;
  }
  return [];
}

// نطاق الاطلاع على النتائج (أوسع من نطاق التقييم: الرئيس/النائب يريان الكل).
// قاعدة «المُقيَّم لا يرى نتيجته» تُطبَّق باستبعاد المستخدم نفسه من قوائم النتائج،
// فلا تنكشف نتيجته القديمة عليه لو تغيّر دوره إلى دور يرى تلك الفئة.
export async function resultTargets(env: Env, u: User, tt: string): Promise<{ id: number; name: string }[]> {
  if (tt === 'students') {
    // الرئيس/النائب: الكل. المشرف/العضو: مرحلته.
    if (isPresident(u) || isVice(u)) {
      return (await env.DB.prepare("SELECT id, name FROM students WHERE status='active' ORDER BY stage, name").all<any>()).results;
    }
    return (await env.DB.prepare("SELECT id, name FROM students WHERE stage=? AND status='active' ORDER BY name").bind(u.stage).all<any>()).results;
  }
  if (tt === 'team_members') {
    if (isPresident(u)) return (await env.DB.prepare(`SELECT id, name FROM users WHERE role='team_member' AND ${ACTIVE} AND id != ? ORDER BY name`).bind(u.id).all<any>()).results;
    return (await env.DB.prepare(`SELECT id, name FROM users WHERE role='team_member' AND stage=? AND ${ACTIVE} AND id != ? ORDER BY name`).bind(u.stage, u.id).all<any>()).results;
  }
  if (tt === 'first_supervisors') {
    return (await env.DB.prepare(`SELECT id, name FROM users WHERE role='first_supervisor' AND ${ACTIVE} AND id != ? ORDER BY name`).bind(u.id).all<any>()).results;
  }
  return [];
}
