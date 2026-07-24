// مصفوفة الصلاحيات — مترجمة من الوثيقة (القسم ٣) إلى دوال قابلة للاستدعاء.
import type { Env, User, CouncilType } from './types';

export interface CouncilRow {
  id: number;
  type: CouncilType;
  default_writer_id: number | null;
}

export const isPresident = (u: User) => u.role === 'president';
export const isVice = (u: User) => u.role === 'vice_president';
export const isFirstSupervisor = (u: User) => u.role === 'first_supervisor';
export const isTeamMember = (u: User) => u.role === 'team_member';
export const isAdmin = (u: User) => u.role === 'system_admin';

// المرحلة المرتبطة بنوع المجلس (educational يخدم الجميع) — تُستخدم داخليًا فقط
function councilStage(type: CouncilType): 'secondary' | 'middle' | null {
  if (type === 'secondary') return 'secondary';
  if (type === 'middle') return 'middle';
  return null;
}

// ---- الاطلاع على المحاضر ----
// الرئيس والنائب: كل المجالس. المشرف الأول: التربوي (عضو فيه) + مجلس مرحلته.
// عضو الفريق: مجلس مرحلته فقط.
export async function canViewCouncil(_env: Env, u: User, council: CouncilRow): Promise<boolean> {
  if (isPresident(u) || isVice(u)) return true;
  if (isAdmin(u)) return false; // مدير النظام بلا صلاحية على المحتوى
  const stage = councilStage(council.type);
  if (isFirstSupervisor(u)) {
    if (council.type === 'educational') return true; // عضو في التربوي
    return u.stage === stage;
  }
  if (isTeamMember(u)) {
    return council.type !== 'educational' && u.stage === stage;
  }
  return false;
}

// ---- إنشاء دعوة/محضر ----
// التربوي: الرئيس فقط. مجلس المرحلة: الرئيس أو مشرف تلك المرحلة.
export function canCreateMeeting(u: User, council: CouncilRow): boolean {
  if (isPresident(u)) return true;
  if (isFirstSupervisor(u) && council.type !== 'educational') {
    return u.stage === councilStage(council.type);
  }
  return false;
}

// ---- تعيين كاتب المحضر ---- (نفس صلاحية الإنشاء)
export const canAssignWriter = canCreateMeeting;

// ---- اعتماد وإقفال المحضر (جهة الاعتماد الوحيدة لكل مجلس) ----
// المجلس التربوي: الرئيس فقط. مجلس كل مرحلة: مشرفها الأول فقط (الرئيس لا يعتمد محاضر المراحل).
export function canApproveMeeting(u: User, council: CouncilRow): boolean {
  if (council.type === 'educational') return isPresident(u);
  if (isFirstSupervisor(u)) return u.stage === councilStage(council.type);
  return false;
}

// ---- تحرير المسودة ----
// الرئيس، مشرف المرحلة، أو من عُيّن كاتباً لهذا المحضر.
export function canEditDraft(
  u: User,
  council: CouncilRow,
  meetingWriterId: number | null,
): boolean {
  if (isPresident(u)) return true;
  if (isFirstSupervisor(u) && council.type !== 'educational' && u.stage === councilStage(council.type))
    return true;
  // كاتب المحضر الفعّال (writer_id يُثبَّت عند الإنشاء بالكاتب المخصّص أو الافتراضي)
  if (meetingWriterId != null && meetingWriterId === u.id) return true;
  return false;
}

// ---- الإلغاء (بدل الحذف) — للرئيس فقط ----
export const canCancelMeeting = (u: User) => isPresident(u);

// ---- التقييم ----
export const canCreateEvalCycle = (u: User) => isPresident(u); // الرئيس حصراً
export const canManageCriteria = (u: User) => isPresident(u);

// إدارة سجل الطلاب: الرئيس، أو المشرف الأول لمرحلته
export function canManageStudents(u: User, stage?: 'secondary' | 'middle'): boolean {
  if (isPresident(u)) return true;
  if (isFirstSupervisor(u)) return stage == null || u.stage === stage;
  return false;
}

// من يقيّم ماذا
export function canEvaluate(u: User, targetType: string): boolean {
  if (targetType === 'students') return isFirstSupervisor(u) || isTeamMember(u);
  if (targetType === 'team_members') return isFirstSupervisor(u);
  if (targetType === 'first_supervisors') return isPresident(u) || isVice(u);
  return false;
}

// من يرى نتائج فئة
export function canViewResults(u: User, targetType: string): boolean {
  if (targetType === 'students') return isPresident(u) || isVice(u) || isFirstSupervisor(u) || isTeamMember(u);
  if (targetType === 'team_members') return isPresident(u) || isFirstSupervisor(u);
  if (targetType === 'first_supervisors') return isPresident(u) || isVice(u);
  return false;
}

// إدارة المستخدمين: مدير النظام أو الرئيس
export const canManageUsers = (u: User) => isAdmin(u) || isPresident(u);
