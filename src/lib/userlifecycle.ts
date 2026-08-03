// دورة حياة المستخدم: تغيير الدور/المرحلة، التعليق، الحذف الأرشيفي، الحذف النهائي، والاستعادة.
//
// المبدأ الحاكم: السجل الرسمي لا يُمسّ. محضر مُعتمد وموقّع، وتقييم مُسلَّم، وسجل تدقيق —
// كلها تبقى كما هي مهما تغيّر وضع المستخدم. ما يتغيّر هو الصلاحيات المستقبلية والارتباطات
// التشغيلية (العضوية، الكتابة، المهام المفتوحة). ولكل عملية تقرير أثر يُعرض قبل التنفيذ.
import type { Env, User, Role, Stage } from '../types';
import {
  hasFullCouncilAccess, councilStage, withinServedArchive,
  type CouncilRow, type ServedPeriod, type RoleStage,
} from '../permissions';
import { audit } from './audit';
import { notify } from './notify';

export type LifecycleAction = 'suspend' | 'reactivate' | 'delete' | 'purge' | 'restore' | 'role_change';

export interface Note { code: string; message: string }

export interface CouncilImpact {
  id: number;
  name: string;
  type: string;
  is_member: boolean;
  position: string | null;
  is_default_writer: boolean;
  access_before: 'full' | 'legacy' | 'none';
  access_after: 'full' | 'legacy' | 'none';
  meetings_total: number;
  visible_before: number;
  visible_after: number;
}

export interface Impact {
  action: LifecycleAction;
  user: Record<string, unknown>;
  next: { role: Role; stage: Stage } | null;
  councils: CouncilImpact[];
  records: {
    meetings_created: number;
    meetings_written: number;
    meetings_approved: number;
    meetings_attended: number;
    signatures: number;
    actions_completed: number;
    evaluations_given: number;
    evaluations_received: number;
    audit_entries: number;
  };
  pending_signatures: { id: number; display_number: string; council_name: string }[];
  open_actions: { id: number; display_number: string; text: string; due_date: string | null; sole: boolean }[];
  editable_as_writer: { id: number; display_number: string; council_id: number }[];
  chair_of: { id: number; name: string }[];
  default_writer_of: { id: number; name: string }[];
  open_cycles: number;
  blockers: Note[];
  warnings: Note[];
  effects: string[];
  can_purge: boolean;
  requires_transfer: boolean;
}

const STAGE_AR: Record<string, string> = { secondary: 'الثانوية', middle: 'المتوسطة' };
const ROLE_AR: Record<string, string> = {
  president: 'رئيس المجلس التربوي',
  vice_president: 'نائب الرئيس',
  first_supervisor: 'المشرف الأول',
  team_member: 'عضو الفريق',
  system_admin: 'مدير النظام',
};
export const roleAr = (r: string) => ROLE_AR[r] || r;
export const stageAr = (s: string | null | undefined) => (s ? STAGE_AR[s] || s : 'بلا مرحلة');

/** الأدوار التي لا تُقيَّد بمرحلة — تُفرَض فيها المرحلة NULL لمنع حالات غير متّسقة. */
export function normalizeStage(role: string, stage: Stage): Stage {
  if (role === 'first_supervisor' || role === 'team_member') return stage;
  return null;
}

export async function loadUserRow(env: Env, id: number): Promise<any | null> {
  return await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<any>();
}

async function councils(env: Env): Promise<(CouncilRow & { name: string })[]> {
  return (await env.DB.prepare('SELECT id, name, type, default_writer_id FROM councils ORDER BY id')
    .all<any>()).results;
}

async function rolePeriods(env: Env, userId: number): Promise<{ role: string; stage: string | null; from: string; to: string | null }[]> {
  const rows = await env.DB.prepare(
    'SELECT role, stage, from_at, to_at FROM user_role_periods WHERE user_id = ? ORDER BY id',
  ).bind(userId).all<any>();
  return rows.results.map((p: any) => ({
    role: p.role, stage: p.stage,
    from: String(p.from_at),
    to: p.to_at ? String(p.to_at) : null,
  }));
}

/** عدد المحاضر المرئية لمالك دور/مرحلة معيّنين مع فترات تاريخية محددة. */
function visibleCount(
  meetings: { council_id: number; created_at: string }[],
  councilId: number,
  level: 'full' | 'legacy' | 'none',
  periods: ServedPeriod[],
): number {
  const inCouncil = meetings.filter((m) => m.council_id === councilId);
  if (level === 'full') return inCouncil.length;
  if (level === 'none') return 0;
  return inCouncil.filter((m) => withinServedArchive(m.created_at, periods)).length;
}

function levelFor(
  who: RoleStage,
  council: CouncilRow,
  periods: { role: string; stage: string | null; from: string; to: string | null }[],
): { level: 'full' | 'legacy' | 'none'; periods: ServedPeriod[] } {
  if (hasFullCouncilAccess(who, council)) return { level: 'full', periods: [] };
  const served = periods
    .filter((p) => hasFullCouncilAccess({ role: p.role, stage: p.stage }, council))
    .map((p) => ({ from: p.from, to: p.to }));
  return served.length ? { level: 'legacy', periods: served } : { level: 'none', periods: [] };
}

// ============================================================
// تقرير الأثر — يُستدعى قبل التنفيذ (معاينة) وبعد التحقق (تنفيذ)
// ============================================================
export async function computeImpact(
  env: Env,
  actor: User,
  target: any,
  action: LifecycleAction,
  opts: { role?: Role; stage?: Stage; transferTo?: number | null; force?: boolean } = {},
): Promise<Impact> {
  const blockers: Note[] = [];
  const warnings: Note[] = [];
  const effects: string[] = [];

  const next = action === 'role_change'
    ? { role: (opts.role || target.role) as Role, stage: normalizeStage(opts.role || target.role, (opts.stage ?? target.stage) as Stage) }
    : null;

  const allCouncils = await councils(env);
  const periods = await rolePeriods(env, target.id);
  const allMeetings = (await env.DB.prepare(
    "SELECT council_id, created_at FROM meetings WHERE status != 'cancelled'",
  ).all<any>()).results as { council_id: number; created_at: string }[];

  // العضوية والصفة
  const memberships = (await env.DB.prepare(
    `SELECT cm.council_id, cm.position, co.name, co.type FROM council_members cm
       JOIN councils co ON co.id = cm.council_id WHERE cm.user_id = ?`,
  ).bind(target.id).all<any>()).results;
  const memberOf = new Map<number, any>(memberships.map((m: any) => [m.council_id, m]));

  // فترات ما بعد التغيير: تُقفل الفترة الجارية اليوم وتُفتح فترة جديدة
  const now = (await env.DB.prepare("SELECT datetime('now') AS d").first<{ d: string }>())!.d;
  const periodsAfter = next
    ? periods.map((p) => (p.to == null ? { ...p, to: now } : p))
    : periods;

  const councilImpacts: CouncilImpact[] = [];
  const lostCouncils: (CouncilRow & { name: string })[] = [];
  const gainedCouncils: (CouncilRow & { name: string })[] = [];

  for (const co of allCouncils) {
    const before = levelFor(target, co, periods);
    // بعد الحذف/التعليق لا اطلاع إطلاقًا (لا دخول أصلًا)
    const after = action === 'delete' || action === 'purge' || action === 'suspend'
      ? { level: 'none' as const, periods: [] as ServedPeriod[] }
      : next
        ? levelFor(next, co, periodsAfter)
        : before;

    if (before.level === 'full' && after.level !== 'full') lostCouncils.push(co);
    if (before.level !== 'full' && after.level === 'full') gainedCouncils.push(co);

    const mem = memberOf.get(co.id);
    councilImpacts.push({
      id: co.id, name: co.name, type: co.type,
      is_member: !!mem, position: mem?.position ?? null,
      is_default_writer: co.default_writer_id === target.id,
      access_before: before.level, access_after: after.level,
      meetings_total: allMeetings.filter((m) => m.council_id === co.id).length,
      visible_before: visibleCount(allMeetings, co.id, before.level, before.periods),
      visible_after: visibleCount(allMeetings, co.id, after.level, after.periods),
    });
  }

  // ---- السجلات التاريخية المرتبطة به ----
  const one = async (sql: string, ...binds: any[]) =>
    (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())?.n ?? 0;

  const records = {
    meetings_created: await one('SELECT COUNT(*) AS n FROM meetings WHERE created_by = ?', target.id),
    meetings_written: await one('SELECT COUNT(*) AS n FROM meetings WHERE writer_id = ?', target.id),
    meetings_approved: await one('SELECT COUNT(*) AS n FROM meetings WHERE approved_by = ?', target.id),
    meetings_attended: await one('SELECT COUNT(*) AS n FROM meeting_attendees WHERE user_id = ? AND is_guest = 0', target.id),
    signatures: await one('SELECT COUNT(*) AS n FROM meeting_attendees WHERE user_id = ? AND signed_at IS NOT NULL', target.id),
    actions_completed: await one('SELECT COUNT(*) AS n FROM action_items WHERE completed_by = ?', target.id),
    evaluations_given: await one('SELECT COUNT(*) AS n FROM evaluations WHERE evaluator_id = ?', target.id),
    evaluations_received: await one(
      "SELECT COUNT(*) AS n FROM evaluations WHERE target_type IN ('team_members','first_supervisors') AND target_id = ?", target.id),
    audit_entries: await one('SELECT COUNT(*) AS n FROM audit_log WHERE user_id = ?', target.id),
  };

  // ---- التواقيع المعلّقة (توقف اعتماد المحاضر) ----
  const pendingSignatures = (await env.DB.prepare(
    `SELECT m.id, m.display_number, co.name AS council_name
       FROM meeting_attendees ma JOIN meetings m ON m.id = ma.meeting_id
       JOIN councils co ON co.id = m.council_id
      WHERE ma.user_id = ? AND ma.is_guest = 0 AND ma.attendance_status = 'present'
        AND ma.signed_at IS NULL AND ma.signature_override = 0
        AND m.status = 'awaiting_signatures'`,
  ).bind(target.id).all<any>()).results;

  // ---- المهام والقرارات المفتوحة المسندة إليه ----
  const openActions = (await env.DB.prepare(
    `SELECT a.id, a.display_number, a.text, a.due_date, a.council_id,
            (SELECT COUNT(*) FROM action_assignees x WHERE x.action_item_id = a.id) AS n_assignees
       FROM action_items a JOIN action_assignees aa ON aa.action_item_id = a.id
      WHERE aa.user_id = ? AND a.status NOT IN ('done','cancelled')
      ORDER BY a.due_date IS NULL, a.due_date`,
  ).bind(target.id).all<any>()).results
    .map((a: any) => ({
      id: a.id, display_number: a.display_number, text: a.text,
      due_date: a.due_date, council_id: a.council_id, sole: a.n_assignees <= 1,
    }));
  const soleActions = openActions.filter((a: any) => a.sole);

  // ---- محاضر قيد التحرير هو كاتبها ----
  const editableAsWriter = (await env.DB.prepare(
    `SELECT id, display_number, council_id FROM meetings
      WHERE writer_id = ? AND status IN ('invitation','draft')`,
  ).bind(target.id).all<any>()).results;

  const chairOf = councilImpacts.filter((c) => c.position === 'chair').map((c) => ({ id: c.id, name: c.name }));
  const defaultWriterOf = councilImpacts.filter((c) => c.is_default_writer).map((c) => ({ id: c.id, name: c.name }));
  const openCycles = await one("SELECT COUNT(*) AS n FROM eval_cycles WHERE status = 'open'");

  // ---- بصمة الحذف النهائي ----
  const footprint = Object.values(records).reduce((a, b) => a + b, 0)
    - records.audit_entries // سجل التدقيق وحده لا يمنع الحذف النهائي (يُفصل عن الحساب مع حفظ لقطة)
    + openActions.length + defaultWriterOf.length
    + await one('SELECT COUNT(*) AS n FROM action_assignees WHERE user_id = ?', target.id)
    + await one('SELECT COUNT(*) AS n FROM action_attachments WHERE uploaded_by = ?', target.id)
    + await one('SELECT COUNT(*) AS n FROM meeting_attachments WHERE uploaded_by = ?', target.id)
    + await one('SELECT COUNT(*) AS n FROM meeting_comments WHERE user_id = ?', target.id)
    + await one('SELECT COUNT(*) AS n FROM student_transfers WHERE moved_by = ?', target.id)
    + await one('SELECT COUNT(*) AS n FROM eval_cycles WHERE created_by = ?', target.id);
  const canPurge = footprint === 0;

  // ============================================================
  // الموانع والتحذيرات لكل عملية
  // ============================================================
  const isSelf = actor.id === target.id;
  const activePeers = async (role: string) => await one(
    'SELECT COUNT(*) AS n FROM users WHERE role = ? AND is_active = 1 AND deleted_at IS NULL AND id != ?',
    role, target.id);

  if (action !== 'reactivate' && action !== 'restore') {
    if (isSelf) blockers.push({ code: 'self', message: 'لا يمكنك تنفيذ هذه العملية على حسابك أنت.' });
    if (target.role === 'president' && (action !== 'role_change' || next?.role !== 'president')) {
      if ((await activePeers('president')) === 0)
        blockers.push({ code: 'last_president', message: 'هذا هو رئيس المجلس الوحيد النشط — عيّن رئيسًا آخر أولاً، وإلا تعطّل اعتماد محاضر المجلس التربوي وإنشاء دورات التقييم.' });
    }
    if (target.role === 'system_admin' && (action !== 'role_change' || next?.role !== 'system_admin')) {
      if ((await activePeers('system_admin')) === 0)
        blockers.push({ code: 'last_admin', message: 'هذا هو مدير النظام الوحيد النشط — عيّن مديرًا آخر أولاً.' });
    }
  }

  // ---- تغيير الدور/المرحلة ----
  if (action === 'role_change') {
    const changedRole = next!.role !== target.role;
    const changedStage = (next!.stage ?? null) !== (target.stage ?? null);
    if (!changedRole && !changedStage) {
      warnings.push({ code: 'noop', message: 'لا تغيير في الدور أو المرحلة.' });
    }

    // فراغ اعتماد: مرحلة تفقد مشرفها الأول ولديها محاضر لم تُعتمد
    if (target.role === 'first_supervisor' && target.stage &&
        (next!.role !== 'first_supervisor' || next!.stage !== target.stage)) {
      const peers = await one(
        `SELECT COUNT(*) AS n FROM users WHERE role = 'first_supervisor' AND stage = ?
           AND is_active = 1 AND deleted_at IS NULL AND id != ?`, target.stage, target.id);
      if (peers === 0) {
        const stuck = await one(
          `SELECT COUNT(*) AS n FROM meetings m JOIN councils co ON co.id = m.council_id
            WHERE co.type = ? AND m.status IN ('invitation','draft','awaiting_signatures')`, target.stage);
        const msg = `ستبقى مرحلة ${stageAr(target.stage)} بلا مشرف أول` +
          (stuck ? ` ولديها ${stuck} محضرًا غير معتمد سيتعذّر اعتماده وإقفاله.` : ' (لا محاضر معلّقة حاليًا).');
        if (stuck) blockers.push({ code: 'approval_gap', message: msg });
        else warnings.push({ code: 'approval_gap', message: msg });
      }
    }

    // رئاسة مجلس ستُفقد
    const losingChair = chairOf.filter((ch) => lostCouncils.some((lc) => lc.id === ch.id));
    if (losingChair.length && !opts.transferTo) {
      blockers.push({
        code: 'chair_vacancy',
        message: `المستخدم رئيس ${losingChair.map((c) => `«${c.name}»`).join('، ')} — حدّد من يخلفه في الرئاسة قبل التغيير.`,
      });
    }

    for (const co of lostCouncils) effects.push(`إزالة العضوية من «${co.name}» وسحب الاطلاع الكامل عليه.`);
    for (const co of gainedCouncils) effects.push(`إضافة العضوية في «${co.name}» ومنح الاطلاع الكامل عليه (بما فيه أرشيفه).`);
    if (defaultWriterOf.some((d) => lostCouncils.some((lc) => lc.id === d.id)))
      effects.push('إلغاء تعيينه كاتبًا افتراضيًا للمجالس التي فقد الاطلاع عليها.');
    if (editableAsWriter.length)
      effects.push(`تفريغ خانة الكاتب في ${editableAsWriter.length} محضرًا قيد التحرير في المجالس المفقودة (تُعاد الكتابة لمن يُعيَّن لاحقًا).`);
    effects.push('إقفال فترة الدور الحالية وفتح فترة جديدة — فيبقى له اطلاع قراءة على أرشيف مرحلته السابقة كما هو لحظة الانتقال، ولا يرى ما يُنشأ فيها بعده.');
    effects.push('إنهاء جلساته المفتوحة ليُعاد تحميل صلاحياته من جديد.');

    if (openActions.length)
      warnings.push({ code: 'open_actions', message: `يبقى مسؤولًا عن ${openActions.length} بندًا مفتوحًا في مجالسه السابقة، ويستطيع متابعتها وإنجازها لأنه مسجَّل مسؤولًا عنها.` });
    if (pendingSignatures.length)
      warnings.push({ code: 'pending_signatures', message: `عليه ${pendingSignatures.length} توقيعًا معلّقًا — يبقى قادرًا على التوقيع لأنه مسجَّل في الحضور.` });
    if (openCycles && (target.role !== next!.role || target.stage !== next!.stage))
      warnings.push({ code: 'open_cycle', message: 'توجد دورة تقييم مفتوحة: ستتغيّر قائمة من يقيّمهم ومن يقيّمونه فورًا، وتبقى مدخلاته السابقة مسجّلة كما هي.' });
  }

  // ---- التعليق ----
  if (action === 'suspend') {
    effects.push('منع الدخول فورًا وإنهاء كل جلساته المفتوحة.');
    effects.push('استبعاده من دورات التقييم (كمقيِّم وكمُقيَّم) ومن مرشّحي التفويض ومن التذكيرات.');
    effects.push('بقاء عضويته في المجالس ومهامه المفتوحة وتواقيعه كما هي — يستعيدها فور رفع التعليق.');
    if (openActions.length)
      warnings.push({ code: 'open_actions', message: `${openActions.length} بندًا مفتوحًا مسندًا إليه سيتوقف تقدّمه (${soleActions.length} منها لا مسؤول غيره). انقلها إلى غيره إن كان التعليق طويلًا.` });
    if (pendingSignatures.length)
      blockers.push({ code: 'pending_signatures', message: `${pendingSignatures.length} محضرًا بانتظار توقيعه لن يُعتمد ما دام معلّقًا: ${pendingSignatures.map((m: any) => m.display_number).join('، ')} — استخدم «تجاوز التوقيع» بسبب مسجَّل، أو أكّد التعليق مع علمك بذلك.` });
    if (chairOf.length)
      warnings.push({ code: 'chair', message: `هو رئيس ${chairOf.map((c) => `«${c.name}»`).join('، ')} — تنبيهات تأخر المهام في هذه المجالس لن تصل أحدًا.` });
  }

  if (action === 'reactivate') {
    effects.push('إعادة الدخول والصلاحيات كما كانت قبل التعليق (نفس الدور والمرحلة والعضويات).');
    effects.push('عودته إلى دورات التقييم المفتوحة وإلى التذكيرات اليومية.');
  }

  // ---- الحذف الأرشيفي ----
  if (action === 'delete') {
    effects.push('منع الدخول نهائيًا وإخفاؤه من كل القوائم والاختيارات.');
    effects.push('الإبقاء على اسمه في كل سجل رسمي: المحاضر التي أنشأها أو كتبها أو اعتمدها، حضوره وتواقيعه، تقييماته، ومرفقاته — لا يُمسّ شيء منها.');
    effects.push('إزالته من عضوية كل المجالس وإلغاء تعيينه كاتبًا افتراضيًا.');
    effects.push(`تحرير بريده (${target.email}) ليصبح قابلًا لإنشاء حساب جديد به.`);
    effects.push('حذف إشعاراته وجلساته.');
    if (openActions.length) {
      effects.push(opts.transferTo
        ? `نقل ${openActions.length} بندًا مفتوحًا إلى المستخدم المحدَّد.`
        : `رفع إسناده عن ${openActions.length} بندًا مفتوحًا.`);
      if (soleActions.length && !opts.transferTo)
        blockers.push({ code: 'orphan_actions', message: `${soleActions.length} بندًا مفتوحًا لا مسؤول عنه غيره وسيبقى بلا مسؤول: ${soleActions.slice(0, 5).map((a: any) => a.display_number).join('، ')}${soleActions.length > 5 ? '…' : ''} — حدّد من ينتقل إليه.` });
    }
    if (pendingSignatures.length)
      blockers.push({ code: 'pending_signatures', message: `${pendingSignatures.length} محضرًا بانتظار توقيعه: ${pendingSignatures.map((m: any) => m.display_number).join('، ')} — لن يُعتمد إلا بتجاوز التوقيع من الرئيس بسبب مسجَّل. نفّذ التجاوز أولًا أو أكّد الحذف.` });
    if (chairOf.length)
      blockers.push({ code: 'chair_vacancy', message: `هو رئيس ${chairOf.map((c) => `«${c.name}»`).join('، ')} — حدّد من يخلفه، وإلا بقي المجلس بلا رئيس.` });
    if (records.evaluations_given || records.evaluations_received)
      warnings.push({ code: 'evaluations', message: `تقييماته محفوظة (${records.evaluations_given} أعطاها و${records.evaluations_received} تلقّاها) وتبقى ضمن نتائج الدورات المنشورة، لكنه يختفي من قوائم الدورات المفتوحة.` });
    warnings.push({ code: 'reversible', message: 'الحذف الأرشيفي قابل للاستعادة: يعود الحساب معلَّقًا وتُعاد عضوياته يدويًا.' });
  }

  // ---- الحذف النهائي ----
  if (action === 'purge') {
    if (!canPurge)
      blockers.push({ code: 'has_footprint', message: 'لا يجوز الحذف النهائي: للمستخدم أثر في السجلات الرسمية (محاضر أو حضور أو تواقيع أو مهام أو تقييمات). استخدم الحذف الأرشيفي ليبقى السجل سليمًا.' });
    effects.push('إزالة صف المستخدم من قاعدة البيانات نهائيًا بلا رجعة.');
    effects.push(`فصل ${records.audit_entries} قيدًا في سجل التدقيق عن الحساب مع حفظ لقطة بالاسم والبريد والدور في قيد الحذف.`);
  }

  if (action === 'restore') {
    effects.push('إلغاء الحذف وإعادة الحساب في وضع «معلَّق» — يلزم تفعيله يدويًا بعد مراجعة دوره.');
    effects.push('استعادة بريده الأصلي إن لم يكن مستخدمًا لحساب آخر.');
    warnings.push({ code: 'memberships', message: 'عضويات المجالس لا تُستعاد تلقائيًا — أعِد إضافته للمجالس المطلوبة.' });
  }

  return {
    action,
    user: {
      id: target.id, name: target.name, email: target.deleted_email || target.email,
      role: target.role, stage: target.stage, is_active: target.is_active,
      deleted_at: target.deleted_at ?? null,
      role_ar: roleAr(target.role), stage_ar: target.stage ? stageAr(target.stage) : null,
    },
    next: next ? { ...next } : null,
    councils: councilImpacts,
    records,
    pending_signatures: pendingSignatures,
    open_actions: openActions,
    editable_as_writer: editableAsWriter,
    chair_of: chairOf,
    default_writer_of: defaultWriterOf,
    open_cycles: openCycles,
    blockers: opts.force ? [] : blockers,
    warnings: opts.force ? [...warnings, ...blockers] : warnings,
    effects,
    can_purge: canPurge,
    requires_transfer: blockers.some((b) => b.code === 'orphan_actions' || b.code === 'chair_vacancy'),
  };
}

// ============================================================
// التنفيذ
// ============================================================

async function endCurrentPeriod(env: Env, userId: number): Promise<void> {
  await env.DB.prepare(
    "UPDATE user_role_periods SET to_at = datetime('now') WHERE user_id = ? AND to_at IS NULL",
  ).bind(userId).run();
}

async function openPeriod(env: Env, userId: number, role: string, stage: Stage, actorId: number, note: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO user_role_periods (user_id, role, stage, changed_by, note) VALUES (?, ?, ?, ?, ?)',
  ).bind(userId, role, stage ?? null, actorId, note).run();
}

async function killSessions(env: Env, userId: number): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}

/** نقل البنود المفتوحة من مستخدم إلى آخر (أو رفع الإسناد عند عدم تحديد بديل). */
async function moveOpenActions(env: Env, fromId: number, toId: number | null): Promise<number> {
  const rows = (await env.DB.prepare(
    `SELECT a.id FROM action_items a JOIN action_assignees aa ON aa.action_item_id = a.id
      WHERE aa.user_id = ? AND a.status NOT IN ('done','cancelled')`,
  ).bind(fromId).all<{ id: number }>()).results;
  for (const r of rows) {
    if (toId) {
      await env.DB.prepare('INSERT OR IGNORE INTO action_assignees (action_item_id, user_id) VALUES (?, ?)')
        .bind(r.id, toId).run();
    }
    await env.DB.prepare('DELETE FROM action_assignees WHERE action_item_id = ? AND user_id = ?')
      .bind(r.id, fromId).run();
  }
  return rows.length;
}

/** تسليم رئاسة المجالس التي يرأسها إلى خلف محدَّد. */
async function handOverChair(env: Env, fromId: number, toId: number, councilIds: number[]): Promise<void> {
  for (const cid of councilIds) {
    await env.DB.prepare(
      `INSERT INTO council_members (council_id, user_id, position) VALUES (?, ?, 'chair')
       ON CONFLICT(council_id, user_id) DO UPDATE SET position = 'chair'`,
    ).bind(cid, toId).run();
    await env.DB.prepare('DELETE FROM council_members WHERE council_id = ? AND user_id = ?')
      .bind(cid, fromId).run();
  }
}

/** إبطال تعيينه كاتبًا افتراضيًا وكاتبًا لمحاضر ما زالت قيد التحرير في مجالس محددة. */
async function releaseWriting(env: Env, userId: number, councilIds: number[]): Promise<void> {
  for (const cid of councilIds) {
    await env.DB.prepare('UPDATE councils SET default_writer_id = NULL WHERE id = ? AND default_writer_id = ?')
      .bind(cid, userId).run();
    // المحاضر غير المعتمدة تُفرَّغ من الكاتب ليُعيَّن غيره؛ المعتمدة والمؤرشفة يبقى كاتبها في السجل.
    await env.DB.prepare(
      `UPDATE meetings SET writer_id = NULL, updated_at = datetime('now')
        WHERE council_id = ? AND writer_id = ? AND status IN ('invitation','draft','awaiting_signatures')`,
    ).bind(cid, userId).run();
  }
}

export async function applyRoleChange(
  env: Env, actor: User, target: any, next: { role: Role; stage: Stage },
  opts: { transferTo?: number | null; note?: string } = {},
): Promise<string[]> {
  const done: string[] = [];
  const allCouncils = await councils(env);
  const after = { role: next.role, stage: next.stage };

  const lost = allCouncils.filter((co) => hasFullCouncilAccess(target, co) && !hasFullCouncilAccess(after, co));
  const gained = allCouncils.filter((co) => !hasFullCouncilAccess(target, co) && hasFullCouncilAccess(after, co));

  // 1) سجل الفترات (أساس الاطلاع التاريخي)
  await endCurrentPeriod(env, target.id);
  await openPeriod(env, target.id, next.role, next.stage, actor.id, opts.note || 'تغيير الدور/المرحلة');

  // 2) بيانات المستخدم
  await env.DB.prepare(
    "UPDATE users SET role = ?, stage = ?, updated_at = datetime('now') WHERE id = ?",
  ).bind(next.role, next.stage ?? null, target.id).run();

  // 3) تسليم الرئاسة قبل إزالة العضوية
  const chairLost = (await env.DB.prepare(
    "SELECT council_id FROM council_members WHERE user_id = ? AND position = 'chair'",
  ).bind(target.id).all<{ council_id: number }>()).results
    .map((r) => r.council_id).filter((cid) => lost.some((c) => c.id === cid));
  if (chairLost.length && opts.transferTo) {
    await handOverChair(env, target.id, opts.transferTo, chairLost);
    done.push(`سُلِّمت رئاسة ${chairLost.length} مجلسًا إلى المستخدم المحدَّد.`);
  }

  // 4) العضوية والكتابة في المجالس المفقودة
  for (const co of lost) {
    await env.DB.prepare('DELETE FROM council_members WHERE council_id = ? AND user_id = ?')
      .bind(co.id, target.id).run();
  }
  await releaseWriting(env, target.id, lost.map((c) => c.id));
  if (lost.length) done.push(`أُزيلت عضويته من: ${lost.map((c) => c.name).join('، ')}.`);

  // 5) العضوية في المجالس المكتسبة — رئيسًا إن كان مشرفًا أول لمجلس مرحلته وليس للمجلس رئيس
  for (const co of gained) {
    const wantsChair = next.role === 'first_supervisor' && councilStage(co.type) === next.stage;
    const hasChair = await env.DB.prepare(
      "SELECT 1 FROM council_members WHERE council_id = ? AND position = 'chair'",
    ).bind(co.id).first();
    const position = wantsChair && !hasChair ? 'chair' : 'member';
    await env.DB.prepare(
      `INSERT INTO council_members (council_id, user_id, position) VALUES (?, ?, ?)
       ON CONFLICT(council_id, user_id) DO UPDATE SET position = excluded.position`,
    ).bind(co.id, target.id, position).run();
  }
  if (gained.length) done.push(`أُضيف إلى: ${gained.map((c) => c.name).join('، ')}.`);

  // 6) جلسات جديدة بصلاحيات جديدة
  await killSessions(env, target.id);
  done.push('أُنهيت جلساته المفتوحة.');

  await notify(env, {
    userId: target.id, type: 'role_changed', title: 'تغيير دورك في المنصة',
    body: `أصبح دورك: ${roleAr(next.role)}${next.stage ? ' — ' + stageAr(next.stage) : ''}. تبقى لك صلاحية الاطلاع على محاضر مرحلتك السابقة خلال فترة خدمتك فيها.`,
    link: '#/dashboard',
  });

  await audit(env, {
    userId: actor.id, action: 'change_user_role', entityType: 'user', entityId: target.id,
    oldValue: { role: target.role, stage: target.stage },
    newValue: { role: next.role, stage: next.stage, lost: lost.map((c) => c.name), gained: gained.map((c) => c.name), effects: done },
  });
  return done;
}

export async function applySuspension(
  env: Env, actor: User, target: any, reason: string | null, opts: { transferTo?: number | null } = {},
): Promise<string[]> {
  const done: string[] = [];
  await env.DB.prepare(
    "UPDATE users SET is_active = 0, suspended_at = datetime('now'), suspended_reason = ?, updated_at = datetime('now') WHERE id = ?",
  ).bind(reason || null, target.id).run();
  await killSessions(env, target.id);
  done.push('عُلِّق الحساب وأُنهيت جلساته.');

  if (opts.transferTo) {
    const n = await moveOpenActions(env, target.id, opts.transferTo);
    if (n) done.push(`نُقل ${n} بندًا مفتوحًا إلى المستخدم المحدَّد.`);
  }

  await audit(env, {
    userId: actor.id, action: 'suspend_user', entityType: 'user', entityId: target.id,
    oldValue: { is_active: target.is_active }, newValue: { is_active: 0, reason: reason || null, effects: done },
  });
  return done;
}

export async function applyReactivation(env: Env, actor: User, target: any): Promise<string[]> {
  await env.DB.prepare(
    "UPDATE users SET is_active = 1, suspended_at = NULL, suspended_reason = NULL, updated_at = datetime('now') WHERE id = ?",
  ).bind(target.id).run();
  await audit(env, {
    userId: actor.id, action: 'reactivate_user', entityType: 'user', entityId: target.id,
    oldValue: { is_active: 0, reason: target.suspended_reason ?? null }, newValue: { is_active: 1 },
  });
  await notify(env, {
    userId: target.id, type: 'account_reactivated', title: 'رُفع التعليق عن حسابك',
    body: 'عادت صلاحياتك كما كانت.', link: '#/dashboard',
  });
  return ['رُفع التعليق وعادت الصلاحيات كما كانت.'];
}

export async function applySoftDelete(
  env: Env, actor: User, target: any, opts: { transferTo?: number | null; reason?: string | null } = {},
): Promise<string[]> {
  const done: string[] = [];

  // لقطة العضويات قبل إزالتها (تُحفظ في التدقيق لتسهيل الاستعادة)
  const memberships = (await env.DB.prepare(
    'SELECT council_id, position FROM council_members WHERE user_id = ?',
  ).bind(target.id).all<any>()).results;

  // تسليم الرئاسة إن حُدِّد خلف
  const chairs = memberships.filter((m: any) => m.position === 'chair').map((m: any) => m.council_id);
  if (chairs.length && opts.transferTo) {
    await handOverChair(env, target.id, opts.transferTo, chairs);
    done.push(`سُلِّمت رئاسة ${chairs.length} مجلسًا إلى المستخدم المحدَّد.`);
  }

  const moved = await moveOpenActions(env, target.id, opts.transferTo ?? null);
  if (moved) done.push(opts.transferTo ? `نُقل ${moved} بندًا مفتوحًا إلى المستخدم المحدَّد.` : `رُفع الإسناد عن ${moved} بندًا مفتوحًا.`);

  const allCouncils = await councils(env);
  await releaseWriting(env, target.id, allCouncils.map((c) => c.id));
  await env.DB.prepare('DELETE FROM council_members WHERE user_id = ?').bind(target.id).run();
  await env.DB.prepare('DELETE FROM notifications WHERE user_id = ?').bind(target.id).run();
  await killSessions(env, target.id);
  await endCurrentPeriod(env, target.id);
  done.push('أُزيلت عضوياته وإشعاراته وجلساته، وأُلغي تعيينه كاتبًا.');

  // تحرير البريد مع حفظ الأصلي — ليُعاد استخدامه في حساب جديد
  const freed = `deleted:${target.id}:${target.email}`;
  await env.DB.prepare(
    `UPDATE users SET deleted_at = datetime('now'), deleted_by = ?, deleted_email = ?, email = ?,
       is_active = 0, updated_at = datetime('now') WHERE id = ?`,
  ).bind(actor.id, target.email, freed, target.id).run();
  done.push(`حُرِّر البريد ${target.email} لإعادة الاستخدام.`);
  done.push('بقيت المحاضر والتواقيع والتقييمات وسجل التدقيق باسمه كما هي.');

  await audit(env, {
    userId: actor.id, action: 'delete_user', entityType: 'user', entityId: target.id,
    oldValue: {
      name: target.name, email: target.email, role: target.role, stage: target.stage,
      memberships,
    },
    newValue: { deleted: true, transfer_to: opts.transferTo ?? null, reason: opts.reason ?? null, effects: done },
  });
  return done;
}

export async function applyRestore(env: Env, actor: User, target: any): Promise<string[]> {
  const done: string[] = [];
  const original = target.deleted_email || target.email;
  const taken = await env.DB.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?')
    .bind(original, target.id).first();
  const email = taken ? target.email : original;
  if (taken) done.push(`البريد الأصلي ${original} صار مستخدمًا لحساب آخر — بقي البريد المؤقّت، غيّره يدويًا.`);

  await env.DB.prepare(
    `UPDATE users SET deleted_at = NULL, deleted_by = NULL, deleted_email = NULL, email = ?,
       is_active = 0, suspended_at = datetime('now'), suspended_reason = 'أُعيد بعد حذف — بانتظار التفعيل',
       updated_at = datetime('now') WHERE id = ?`,
  ).bind(email, target.id).run();
  await openPeriod(env, target.id, target.role, target.stage, actor.id, 'استعادة بعد حذف');
  done.push('أُعيد الحساب في وضع «معلَّق» — فعّله بعد مراجعة دوره وعضوياته.');

  await audit(env, {
    userId: actor.id, action: 'restore_user', entityType: 'user', entityId: target.id,
    newValue: { email, effects: done },
  });
  return done;
}

export async function applyPurge(env: Env, actor: User, target: any): Promise<string[]> {
  await audit(env, {
    userId: actor.id, action: 'purge_user', entityType: 'user', entityId: target.id,
    oldValue: {
      id: target.id, name: target.name, email: target.deleted_email || target.email,
      role: target.role, stage: target.stage, created_at: target.created_at,
    },
    newValue: { purged: true },
  });
  // فصل قيود التدقيق عن الحساب (اللقطة أعلاه تحفظ هويته)
  await env.DB.prepare('UPDATE audit_log SET user_id = NULL WHERE user_id = ?').bind(target.id).run();
  await env.DB.prepare('DELETE FROM council_members WHERE user_id = ?').bind(target.id).run();
  await env.DB.prepare('DELETE FROM action_assignees WHERE user_id = ?').bind(target.id).run();
  await env.DB.prepare('DELETE FROM notifications WHERE user_id = ?').bind(target.id).run();
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id).run();
  await env.DB.prepare('DELETE FROM user_role_periods WHERE user_id = ?').bind(target.id).run();
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(target.id).run();
  return ['حُذف الحساب نهائيًا من قاعدة البيانات مع حفظ لقطة هويته في سجل التدقيق.'];
}
