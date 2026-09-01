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

// ============================================================
// الاستثناءات على مستوى الحساب
// ============================================================
//
// قواعد الأدوار أدناه هي الأصل، ولا تتغيّر. وفوقها طبقةٌ واحدة: استثناءٌ يضعه الرئيس
// على حسابٍ بعينه فيمنحه عمليةً لا يملكها دورُه أو يمنعه عمليةً يملكها.
//
// القاعدة الحاكمة في كل موضع:
//   • بلا استثناء  → السلوك كما كان قبل هذا النظام حرفًا بحرف.
//   • منعٌ صريح   → يسبق كل شيء، ولو كان دورُه يبيحه.
//   • منحٌ صريح   → يُفتح له الباب، **ويبقى النطاق** كما هو: مجالسه ومرحلته وحالة
//                    المحضر. فالاستثناء يقرّر «أيّ عملية»، لا «على ماذا».

/** القيمة الأصلية للعملية من الدور وحده (بلا سياق مجلس أو مرحلة). */
export function basePerm(u: RoleStage, key: string): boolean {
  const P = isPresident(u), V = isVice(u), F = isFirstSupervisor(u), T = isTeamMember(u), A = isAdmin(u);
  switch (key) {
    case 'meetings.view': return !A;
    case 'meetings.add': return P || F;
    case 'meetings.edit': return P || F;          // ومعهما كاتبُ المحضر المعيَّن
    case 'meetings.delete': return P;

    case 'actions.view': return !A;
    case 'actions.add': return P || F;
    case 'actions.edit': return P || F;           // والمكلَّف يتابع بنده بحكم إسناده لا بهذا المفتاح

    case 'students.view': return !A;
    case 'students.add': return P || F;
    case 'students.edit': return P || F;

    case 'evaluations.view': return !A;
    case 'evaluations.add': return P;
    case 'evaluations.edit': return !A;           // التقييم نفسه بحسب فئة المقيَّم
    case 'evaluations.delete': return P;

    case 'criteria.view': return !A;
    case 'criteria.add': case 'criteria.edit': case 'criteria.delete': return P;

    case 'files.view': return !A;
    case 'files.add': return P || F;              // ورافعُ الملف يتصرّف في ملفه بحكم رفعه
    case 'files.edit': return P || F;
    case 'files.delete': return P;

    case 'users.view': case 'users.add': case 'users.edit': case 'users.delete': return P || A;

    case 'councils.view': return !A;
    case 'councils.edit': return P || F;

    case 'settings.view': return true;
    case 'settings.edit': return P || A;

    case 'audit.view': return P || A;

    case 'backups.view': case 'backups.add': return P || A;
    case 'backups.edit': return A;                // الاستعادة لمدير النظام
    default: return false;
  }
}

/**
 * القرار النهائي لعملية: الأصل، أو الاستثناء إن وُجد.
 * `scopeOnGrant` هو ما يبقى شرطًا عند المنح الصريح (نطاق المجلس أو المرحلة).
 */
export function decide(u: User, key: string, base: boolean, scopeOnGrant = true): boolean {
  const ov = u.perms?.[key];
  if (ov === undefined) return base;
  return ov ? scopeOnGrant : false;
}

/** قرارٌ لا سياق له (شاشات الإدارة): الأصل أو الاستثناء. */
export const can = (u: User, key: string): boolean => decide(u, key, basePerm(u, key));

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
  // مدير النظام بلا اطلاع على المحتوى — إلا أن يُؤذن له صراحةً باستثناء، فيصير
  // اطلاعه حقيقيًا (والكتابة تبقى محكومة بمفاتيحها فلا تُفتح معه)
  if (isAdmin(u)) return (u as User).perms?.['meetings.view'] === true;
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
  // مدير النظام خارج المحتوى، إلا أن يُؤذن له صراحةً (يقرّره hasFullCouncilAccess)
  if (isAdmin(u) && !full) return { level: 'none', windows: [] };

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
/** القاعدة الأصلية للإنشاء بلا استثناءات — تُستعمل أساسًا لقرارات أخرى تشتقّ منها. */
export function baseCanCreateMeeting(u: RoleStage, council: CouncilRow): boolean {
  return isPresident(u)
    || (isFirstSupervisor(u) && council.type !== 'educational' && u.stage === councilStage(council.type));
}

export function canCreateMeeting(u: User, council: CouncilRow): boolean {
  return decide(u, 'meetings.add', baseCanCreateMeeting(u, council), hasFullCouncilAccess(u, council));
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
  const full = hasFullCouncilAccess(u, council);
  const base = full && (
    isPresident(u)
    || (isFirstSupervisor(u) && council.type !== 'educational' && u.stage === councilStage(council.type))
    // كاتب المحضر الفعّال (writer_id يُثبَّت عند الإنشاء بالكاتب المخصّص أو الافتراضي)
    || (meetingWriterId != null && meetingWriterId === u.id));
  return decide(u, 'meetings.edit', base, full);
}

// ---- الإلغاء (بدل الحذف) — للرئيس فقط ----
export const canCancelMeeting = (u: User) => decide(u, 'meetings.delete', isPresident(u));

// ---- التقييم ----
export const canCreateEvalCycle = (u: User) => decide(u, 'evaluations.add', isPresident(u)); // الرئيس حصراً
export const canDeleteEvalCycle = (u: User) => decide(u, 'evaluations.delete', isPresident(u));
/** إدارة دورة قائمة (تعديلها وفتحها وإغلاقها ونشر نتائجها). */
export const canManageCycle = (u: User) => decide(u, 'evaluations.edit', isPresident(u));
/** إدارة المعايير: العملية تُحدَّد لأن الاستثناء يفرّق بين الإضافة والتعديل والحذف. */
export const canManageCriteria = (u: User, action: 'add' | 'edit' | 'delete' = 'edit') =>
  decide(u, `criteria.${action}`, isPresident(u));

// إدارة سجل الطلاب: الرئيس، أو المشرف الأول لمرحلته
export function canManageStudents(u: User, stage?: 'secondary' | 'middle', action: 'add' | 'edit' = 'edit'): boolean {
  const inStage = stage == null || u.stage === stage;
  const base = isPresident(u) || (isFirstSupervisor(u) && inStage);
  // عند المنح الصريح يبقى النطاق: المشرف على مرحلته، ومن لا مرحلة له على الجميع
  return decide(u, `students.${action}`, base, isPresident(u) || inStage);
}

// من يقيّم ماذا
export function canEvaluate(u: RoleStage, targetType: string): boolean {
  const base = targetType === 'students' ? (isFirstSupervisor(u) || isTeamMember(u))
    : targetType === 'team_members' ? isFirstSupervisor(u)
      : targetType === 'first_supervisors' ? (isPresident(u) || isVice(u)) : false;
  // يُستدعى أحيانًا بصفٍّ تاريخي لا بمستخدم كامل، وحينها لا استثناءات تُقرأ
  return decide(u as User, 'evaluations.edit', base);
}

// من يرى نتائج فئة
export function canViewResults(u: RoleStage, targetType: string): boolean {
  const base = targetType === 'students' ? (isPresident(u) || isVice(u) || isFirstSupervisor(u) || isTeamMember(u))
    : targetType === 'team_members' ? (isPresident(u) || isFirstSupervisor(u))
      : targetType === 'first_supervisors' ? (isPresident(u) || isVice(u)) : false;
  return decide(u as User, 'evaluations.view', base);
}

// إدارة المستخدمين: مدير النظام أو الرئيس
export const canManageUsers = (u: User, action: 'view' | 'add' | 'edit' | 'delete' = 'edit') =>
  decide(u, `users.${action}`, isAdmin(u) || isPresident(u));

// ---- بقية شاشات الإدارة (لا سياق لها غير الدور) ----
export const canViewAudit = (u: User) => can(u, 'audit.view');
export const canViewBackups = (u: User) => can(u, 'backups.view');
export const canCreateBackup = (u: User) => can(u, 'backups.add');
export const canRestoreBackup = (u: User) => can(u, 'backups.edit');
export const canEditSettings = (u: User) => can(u, 'settings.edit');
/** تعديل بيانات المجلس (أعضاؤه وكاتبه وبنوده الثابتة) — والنطاق يبقى على مجالسه. */
export function canEditCouncil(u: User, council: CouncilRow, base: boolean): boolean {
  return decide(u, 'councils.edit', base, hasFullCouncilAccess(u, council));
}

// ============================================================
// الملفات التربوية — الأرشيف
// ============================================================
//
// لكل مجلد (ويرثه ما فيه من ملفات) مستوى وصول واحد:
//   public  — كل من يملك اطلاع الملفات.
//   council — مربوط بمجلس، فيسري عليه نموذج الاطلاع نفسه حرفًا بحرف: الاطلاع الكامل
//             يرى كل ملفات المجلس، والاطلاع التاريخي يرى ما رُفع داخل نوافذ خدمته.
//   private — خاص برافعه وحده، لا يراه غيره ولو كان رئيسًا.
//
// والكتابة فوق ذلك تحتاج مفتاحها (files.add/edit/delete)، **ويبقى النطاق**: لا يُكتب
// في مجلد مجلسٍ إلا بالاطلاع الكامل عليه الآن، ولا في الخاص إلا لصاحبه.
export type FileAccess = 'public' | 'council' | 'private';

export interface FileNode {
  access: FileAccess | string;
  council_id?: number | null;
  owner_id?: number | null;
  created_at?: string | null;
}

/** نطاق المستخدم على كل مجلس، مرةً واحدة لكل طلب (المجالس ثلاثة ثابتة). */
export async function councilScopes(env: Env, u: User): Promise<Map<number, CouncilScope>> {
  const rows = await env.DB.prepare('SELECT id, type, default_writer_id FROM councils').all<CouncilRow>();
  const map = new Map<number, CouncilScope>();
  for (const c of rows.results) map.set(c.id, await councilScope(env, u, c));
  return map;
}

/**
 * اطلاع المستخدم على مجلد أو ملف بحسب نطاقه.
 * والاطلاع التاريخي يقع على **الملفات** وحدها: يرى ما رُفع داخل نوافذ خدمته. أما
 * المجلد فحاويةٌ لا سجل، فيُرى ما دام له اطلاع على مجلسه — وإلا ظهر له ملفٌ في
 * نتيجة بحث ولم يفتح المجلد الذي يسكنه.
 */
export function canViewFileNode(
  u: User,
  node: FileNode,
  scopes: Map<number, CouncilScope>,
  kind: 'file' | 'folder' = 'file',
): boolean {
  if (!can(u, 'files.view')) return false;
  if (node.access === 'private') return node.owner_id === u.id;
  if (node.access === 'public') return true;
  const s = node.council_id != null ? scopes.get(node.council_id) : undefined;
  if (!s || s.level === 'none') return false;
  if (s.level === 'full' || kind === 'folder') return true;
  return withinAccessWindow(node.created_at, s.windows);
}

/**
 * الكتابة على مجلد أو ملف: المفتاح أولًا، ثم النطاق.
 * ورافعُ الملف يتصرّف في ملفه (تعديلًا واستبدالًا وحذفًا إلى السلة) بحكم رفعه لا
 * بالمفتاح — كما يتابع المكلَّفُ بندَه بحكم إسناده. والحذف النهائي يبقى للمفتاح وحده.
 */
export function canWriteFileNode(
  u: User,
  node: FileNode,
  action: 'add' | 'edit' | 'delete',
  scopes: Map<number, CouncilScope>,
  opts: { owner?: boolean; kind?: 'file' | 'folder' } = {},
): boolean {
  if (!canViewFileNode(u, node, scopes, opts.kind || 'file')) return false;
  // النطاق: الخاص لصاحبه، ومجلد المجلس لمن يملك اطلاعًا كاملًا عليه الآن
  const inScope = node.access === 'private'
    ? node.owner_id === u.id
    : node.access === 'council'
      ? (node.council_id != null && scopes.get(node.council_id)?.level === 'full')
      : true;
  if (!inScope) return false;
  if (opts.owner && action !== 'add') return true;
  return decide(u, `files.${action}`, basePerm(u, `files.${action}`), true);
}

/** الحذف النهائي من سلة المحذوفات — للمفتاح وحده، ولا يكفي فيه أنه رافع الملف. */
export const canPurgeFiles = (u: User) => can(u, 'files.delete');
