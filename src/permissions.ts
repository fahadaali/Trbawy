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
  level: AccessLevel;        // للصلاحيات — من الدور والمرحلة الحاليّين
  windows: ServedPeriod[];   // نوافذ الاطلاع على السجلات (تشمل الفترة الجارية)
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
 * نطاق اطلاع المستخدم على مجلس:
 *   level   — من الدور والمرحلة الحاليّين، ويحكم صلاحيات الكتابة (تحرير/اعتماد/تعليق).
 *   windows — نوافذ الاطلاع على السجلات، مأخوذة من كل فترة خدمة منحته اطلاعًا على هذا
 *             المجلس (بما فيها الفترة الجارية). القاعدة الواحدة: **ترى السجل إن أُنشئ
 *             أثناء فترة كنت تملك فيها الاطلاع** — فلا أرشيف يسبق انضمامك، ولا ينقطع
 *             عنك ما كنت تراه بعد انتقالك.
 */
export async function councilScope(env: Env, u: User, council: CouncilRow): Promise<CouncilScope> {
  const full = hasFullCouncilAccess(u, council);
  if (isAdmin(u)) return { level: 'none', windows: [] };

  const rows = await env.DB.prepare(
    'SELECT role, stage, from_at, to_at FROM user_role_periods WHERE user_id = ? ORDER BY id',
  ).bind(u.id).all<any>();

  const windows: ServedPeriod[] = [];
  for (const p of rows.results) {
    if (!hasFullCouncilAccess({ role: p.role, stage: p.stage }, council)) continue;
    const from = tsOf(p.from_at);
    if (!from) continue;
    windows.push({ from, to: tsOf(p.to_at) });
  }

  // شبكة أمان: لو منحه دوره الحالي اطلاعًا ولا فترة جارية مسجَّلة (انحراف بيانات)،
  // نفتح نافذة غير محدودة بدل أن يُحرم من مجلسه.
  if (full && !windows.some((w) => w.to == null)) windows.push({ from: '0000-01-01', to: null });

  return { level: full ? 'full' : windows.length ? 'legacy' : 'none', windows };
}

/**
 * هل أُنشئ السجل داخل إحدى نوافذ اطلاع المستخدم؟
 * الميزان **وقت إنشاء السجل** (created_at) لا تاريخ انعقاد الاجتماع: العبرة بما كان
 * موجودًا في المنصة أثناء خدمته. والمقارنة نصّية على صيغة 'YYYY-MM-DD HH:MM:SS'
 * وهي مرتّبة معجميًا بنفس ترتيبها الزمني.
 */
// النوافذ نصف مفتوحة [from, to): الحدّ الأدنى داخل والأعلى خارج، فلا تتداخل فترتان
// ولا يقع سجل في فترتين. وسجل أُنشئ في لحظة الانتقال نفسها ينتمي للفترة الجديدة لا القديمة
// (دقة datetime في SQLite ثانية واحدة، فالتداخل وارد بلا هذا الضبط).
export function withinAccessWindow(createdAt: string | null | undefined, windows: ServedPeriod[]): boolean {
  const t = tsOf(createdAt);
  if (!t) return false;
  return windows.some((w) => t >= w.from && (w.to == null || t < w.to));
}

/**
 * العمل الجاري ليس أرشيفًا: المحضر غير المعتمد والبند المفتوح في مجلس يملك المستخدم
 * اطلاعًا كاملًا عليه الآن يبقى مرئيًا له ولو أُنشئ قبل انضمامه — وإلا تعذّر على من
 * تولّى مرحلة أن يعتمد محاضرها المعلّقة أو يتابع بنودها المفتوحة.
 */
const LIVE_MEETING = ['invitation', 'draft', 'awaiting_signatures'];
export const isLiveMeeting = (status?: string | null) => !!status && LIVE_MEETING.includes(status);
export const isOpenAction = (status?: string | null) => !!status && !['done', 'cancelled'].includes(status);

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
 * الاطلاع على محضر بعينه — القاعدة الدقيقة بالترتيب:
 *   1) أُنشئ داخل إحدى نوافذ اطلاعه → نعم.
 *   2) محضر غير معتمد في مجلس يملك اطلاعًا كاملًا عليه الآن → نعم (عمل جارٍ لا أرشيف).
 *   3) مسجَّل في الحضور → نعم دائمًا (لا يُحجب عن أحد ما شارك فيه أو وقّعه).
 */
export async function canViewMeeting(
  env: Env,
  u: User,
  meeting: { id: number; created_at?: string | null; status?: string | null },
  council: CouncilRow,
  scope?: CouncilScope,
): Promise<boolean> {
  const s = scope ?? (await councilScope(env, u, council));
  if (withinAccessWindow(meeting.created_at, s.windows)) return true;
  if (s.level === 'full' && isLiveMeeting(meeting.status)) return true;
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
