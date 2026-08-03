// مصفوفة الصلاحيات — مترجمة من الوثيقة (القسم ٣) إلى دوال قابلة للاستدعاء.
//
// نموذج الاطلاع على ثلاث درجات (يُضبط عليه كل مسار قراءة):
//   full   — اطلاع كامل مشتق من الدور والمرحلة الحاليّين (قراءة + بقية الصلاحيات).
//   legacy — اطلاع تاريخي للقراءة فقط: من خدم مرحلة سابقًا يرى محاضرها المؤرّخة داخل
//            فترة خدمته وحدها، ولا يرى ما استُجدّ بعد انتقاله.
//   none   — لا اطلاع، ما لم يكن مسجَّلًا شخصيًا في السجل (حاضر في المحضر أو مسؤول عن البند).
import type { Env, User, CouncilType, Role, Stage } from './types';

export interface CouncilRow {
  id: number;
  type: CouncilType;
  default_writer_id: number | null;
}

/** الحد الأدنى المطلوب لتقرير الاطلاع — يقبل المستخدم الحالي أو صفًا تاريخيًا من فترات الأدوار. */
export interface RoleStage {
  role: Role | string;
  stage: Stage | string | null;
}

export type AccessLevel = 'none' | 'legacy' | 'full';
export interface ServedPeriod {
  from: string;         // طابع زمني كامل — بداية الخدمة
  to: string | null;    // طابع زمني كامل، NULL = فترة جارية
}
export interface CouncilScope {
  level: AccessLevel;
  periods: ServedPeriod[];   // فترات الاطلاع التاريخي (تُملأ مع legacy فقط)
}

export const isPresident = (u: RoleStage) => u.role === 'president';
export const isVice = (u: RoleStage) => u.role === 'vice_president';
export const isFirstSupervisor = (u: RoleStage) => u.role === 'first_supervisor';
export const isTeamMember = (u: RoleStage) => u.role === 'team_member';
export const isAdmin = (u: RoleStage) => u.role === 'system_admin';

// المرحلة المرتبطة بنوع المجلس (educational يخدم الجميع)
export function councilStage(type: CouncilType): 'secondary' | 'middle' | null {
  if (type === 'secondary') return 'secondary';
  if (type === 'middle') return 'middle';
  return null;
}

// ---- الاطلاع الكامل (الدور والمرحلة الحاليّان) ----
// الرئيس والنائب: كل المجالس. المشرف الأول: التربوي (عضو فيه) + مجلس مرحلته.
// عضو الفريق: مجلس مرحلته فقط. مدير النظام: بلا صلاحية على المحتوى.
export function hasFullCouncilAccess(u: RoleStage, council: CouncilRow): boolean {
  if (isAdmin(u)) return false;
  if (isPresident(u) || isVice(u)) return true;
  const stage = councilStage(council.type);
  if (isFirstSupervisor(u)) return council.type === 'educational' || u.stage === stage;
  if (isTeamMember(u)) return council.type !== 'educational' && u.stage === stage;
  return false;
}

const tsOf = (ts: string | null | undefined): string | null => (ts ? String(ts) : null);

/**
 * درجة اطلاع المستخدم على مجلس، مع فترات الاطلاع التاريخي إن وُجدت.
 * الفترات تُقرأ من user_role_periods: كل فترة كان دورها/مرحلتها يمنح اطلاعًا كاملًا على هذا المجلس.
 */
export async function councilScope(env: Env, u: User, council: CouncilRow): Promise<CouncilScope> {
  if (hasFullCouncilAccess(u, council)) return { level: 'full', periods: [] };
  if (isAdmin(u)) return { level: 'none', periods: [] };

  const rows = await env.DB.prepare(
    'SELECT role, stage, from_at, to_at FROM user_role_periods WHERE user_id = ? ORDER BY id',
  ).bind(u.id).all<any>();

  const periods: ServedPeriod[] = [];
  for (const p of rows.results) {
    if (!hasFullCouncilAccess({ role: p.role, stage: p.stage }, council)) continue;
    const from = tsOf(p.from_at);
    if (!from) continue;
    periods.push({ from, to: tsOf(p.to_at) });
  }
  return periods.length ? { level: 'legacy', periods } : { level: 'none', periods: [] };
}

/**
 * الاطلاع التاريخي = الأرشيف كما كان لحظة انتقاله، لا نافذة زمنية ضيّقة.
 * الميزان هو **وقت إنشاء السجل** (created_at) لا تاريخ انعقاد الاجتماع: فكل ما كان
 * موجودًا في المنصة أثناء خدمته يبقى مرئيًا له (لأنه كان يراه فعلًا)، وكل ما أُنشئ
 * بعد انتقاله محجوب عنه ولو كان مؤرَّخًا بتاريخ سابق. ومن شارك في محضر يراه دائمًا
 * بقاعدة السجل الشخصي مهما كان تاريخه.
 * المقارنة نصّية على صيغة 'YYYY-MM-DD HH:MM:SS' وهي مرتّبة معجميًا بنفس ترتيبها الزمني.
 */
export function withinServedArchive(createdAt: string | null | undefined, periods: ServedPeriod[]): boolean {
  const t = tsOf(createdAt);
  if (!t) return false;
  return periods.some((p) => p.to == null || t <= p.to);
}

// ---- الاطلاع على المجلس (وجوده في القوائم) ----
// يشمل الاطلاع التاريخي للقراءة — والتقييد الفعلي يكون على مستوى المحضر/البند.
export async function canViewCouncil(env: Env, u: User, council: CouncilRow): Promise<boolean> {
  return (await councilScope(env, u, council)).level !== 'none';
}

/** هل المستخدم مسجَّل حاضرًا/معتذرًا/غائبًا في هذا المحضر؟ (سجل شخصي يبقى مرئيًا له دائمًا) */
export async function isMeetingAttendee(env: Env, meetingId: number, userId: number): Promise<boolean> {
  const r = await env.DB.prepare(
    'SELECT 1 FROM meeting_attendees WHERE meeting_id = ? AND user_id = ? AND is_guest = 0',
  ).bind(meetingId, userId).first();
  return !!r;
}

/**
 * الاطلاع على محضر بعينه — القاعدة الدقيقة:
 *   1) اطلاع كامل على المجلس → نعم.
 *   2) اطلاع تاريخي والمحضر أُنشئ قبل انتقاله → نعم (قراءة فقط).
 *   3) مسجَّل في الحضور → نعم دائمًا (لا يُحجب عن أحد ما شارك فيه أو وقّعه).
 */
export async function canViewMeeting(
  env: Env,
  u: User,
  meeting: { id: number; created_at?: string | null },
  council: CouncilRow,
  scope?: CouncilScope,
): Promise<boolean> {
  const s = scope ?? (await councilScope(env, u, council));
  if (s.level === 'full') return true;
  if (s.level === 'legacy' && withinServedArchive(meeting.created_at, s.periods)) return true;
  return await isMeetingAttendee(env, meeting.id, u.id);
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
// الرئيس، مشرف المرحلة، أو من عُيّن كاتباً لهذا المحضر — ويشترط في الجميع اطلاع كامل حالي
// على المجلس، فمن انتقل عن مرحلة لا يحرّر محاضرها ولو بقي مسجَّلًا ككاتب لها.
export function canEditDraft(
  u: User,
  council: CouncilRow,
  meetingWriterId: number | null,
): boolean {
  if (!hasFullCouncilAccess(u, council)) return false;
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
export function canEvaluate(u: RoleStage, targetType: string): boolean {
  if (targetType === 'students') return isFirstSupervisor(u) || isTeamMember(u);
  if (targetType === 'team_members') return isFirstSupervisor(u);
  if (targetType === 'first_supervisors') return isPresident(u) || isVice(u);
  return false;
}

// من يرى نتائج فئة
export function canViewResults(u: RoleStage, targetType: string): boolean {
  if (targetType === 'students') return isPresident(u) || isVice(u) || isFirstSupervisor(u) || isTeamMember(u);
  if (targetType === 'team_members') return isPresident(u) || isFirstSupervisor(u);
  if (targetType === 'first_supervisors') return isPresident(u) || isVice(u);
  return false;
}

// إدارة المستخدمين: مدير النظام أو الرئيس
export const canManageUsers = (u: User) => isAdmin(u) || isPresident(u);
