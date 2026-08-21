// سجل الطلاب: الإدارة، النقل، الاستيراد/التصدير (CSV)، والسجل التاريخي.
import { Hono } from 'hono';
import type { Env, Variables, User } from '../types';
import { audit } from '../lib/audit';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import { canManageStudents, can, isPresident, isVice } from '../permissions';
import { weightedForEvaluation } from '../lib/evalcalc';
import { csvCell, parseCsv, colOf, matchAlias, toEnDigits } from '../lib/csv';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', requireAuth, requirePasswordChanged);

const STAGES = ['secondary', 'middle'];
const STATUSES = ['active', 'transferred', 'withdrawn', 'graduated'];

// ما يُكتب في ملف الاستيراد مكان القيمة القياسية — عربيًّا كان أو إنجليزيًّا
const STAGE_ALIASES: Record<string, string[]> = {
  secondary: ['ثانوي', 'ثانوية', 'الثانوية', 'المرحلة الثانوية', 'sec'],
  middle: ['متوسط', 'متوسطة', 'المتوسطة', 'المرحلة المتوسطة', 'mid', 'intermediate'],
};
const STATUS_ALIASES: Record<string, string[]> = {
  active: ['نشط', 'نشطة', 'على رأس العمل', 'مستمر'],
  transferred: ['منقول', 'منقولة', 'نقل'],
  withdrawn: ['منسحب', 'منسحبة', 'انسحاب'],
  graduated: ['متخرج', 'متخرجة', 'خريج', 'تخرج'],
};

// نطاق الاطلاع على الطلاب
function studentScopeStage(u: User): 'secondary' | 'middle' | 'all' | null {
  // الاستثناء يقرّر أصل الاطلاع، والمرحلة تبقى نطاقه
  if (!can(u, 'students.view')) return null;
  if (isPresident(u) || isVice(u)) return 'all';
  if (u.role === 'first_supervisor' || u.role === 'team_member') return (u.stage as any) || null;
  return (u.stage as any) || 'all';
}

// ---- قائمة الطلاب ----
app.get('/', async (c) => {
  const u = c.get('user');
  const scope = studentScopeStage(u);
  if (!scope) return c.json({ error: 'لا تملك صلاحية الاطلاع على سجل الطلاب' }, 403);

  const where: string[] = [];
  const binds: any[] = [];
  if (scope !== 'all') { where.push('stage = ?'); binds.push(scope); }
  const stage = c.req.query('stage');
  if (stage && scope === 'all') { where.push('stage = ?'); binds.push(stage); }
  const status = c.req.query('status');
  if (status) { where.push('status = ?'); binds.push(status); }
  const grade = c.req.query('grade');
  if (grade) { where.push('grade = ?'); binds.push(grade); }
  const q = c.req.query('q');
  if (q) { where.push('(name LIKE ? OR national_id LIKE ?)'); binds.push('%' + q + '%', '%' + q + '%'); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const rows = await c.env.DB.prepare(
    `SELECT * FROM students ${whereSql} ORDER BY stage, grade, class, name LIMIT 2000`,
  ).bind(...binds).all();
  return c.json({ students: rows.results });
});

// ---- إنشاء ----
app.post('/', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  if (!STAGES.includes(b.stage)) return c.json({ error: 'المرحلة غير صالحة' }, 400);
  if (!canManageStudents(c.get('user'), b.stage, 'add')) return c.json({ error: 'لا تملك صلاحية' }, 403);
  if (!b.national_id || !b.name) return c.json({ error: 'رقم الهوية والاسم مطلوبان' }, 400);
  const exists = await c.env.DB.prepare('SELECT 1 FROM students WHERE national_id = ?').bind(String(b.national_id)).first();
  if (exists) return c.json({ error: 'رقم الهوية مكرر' }, 409);
  const res = await c.env.DB.prepare(
    `INSERT INTO students (national_id, name, stage, grade, class, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(String(b.national_id), b.name, b.stage, b.grade || null, b.class || null, STATUSES.includes(b.status) ? b.status : 'active', b.notes || null).run();
  await audit(c.env, { userId: c.get('user').id, action: 'create_student', entityType: 'student', entityId: res.meta.last_row_id, newValue: { national_id: b.national_id, name: b.name } });
  return c.json({ id: res.meta.last_row_id }, 201);
});

// ---- تعديل ----
app.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const cur = await c.env.DB.prepare('SELECT * FROM students WHERE id = ?').bind(id).first<any>();
  if (!cur) return c.json({ error: 'الطالب غير موجود' }, 404);
  if (!canManageStudents(c.get('user'), cur.stage, 'edit')) return c.json({ error: 'لا تملك صلاحية' }, 403);
  const b = await c.req.json().catch(() => ({}));
  await c.env.DB.prepare(
    `UPDATE students SET name=?, grade=?, class=?, status=?, notes=?, updated_at=datetime('now') WHERE id=?`,
  ).bind(
    b.name ?? cur.name, b.grade ?? cur.grade, b.class ?? cur.class,
    STATUSES.includes(b.status) ? b.status : cur.status, b.notes ?? cur.notes, id,
  ).run();
  await audit(c.env, { userId: c.get('user').id, action: 'update_student', entityType: 'student', entityId: id, oldValue: cur, newValue: b });
  return c.json({ ok: true });
});

// ---- النقل بين المرحلتين (مع الاحتفاظ بالسجل التاريخي) ----
app.post('/:id/transfer', async (c) => {
  const id = Number(c.req.param('id'));
  const cur = await c.env.DB.prepare('SELECT * FROM students WHERE id = ?').bind(id).first<any>();
  if (!cur) return c.json({ error: 'الطالب غير موجود' }, 404);
  // النقل يتطلب صلاحية على المرحلتين — نقصره على الرئيس أو مشرف المرحلة الحالية والهدف
  const { to_stage, note } = await c.req.json().catch(() => ({}));
  if (!STAGES.includes(to_stage)) return c.json({ error: 'المرحلة الهدف غير صالحة' }, 400);
  const u = c.get('user');
  if (!isPresident(u) && !(u.role === 'first_supervisor' && (u.stage === cur.stage || u.stage === to_stage)))
    return c.json({ error: 'لا تملك صلاحية النقل' }, 403);
  if (cur.stage === to_stage) return c.json({ error: 'الطالب في هذه المرحلة أصلاً' }, 400);

  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE students SET stage=?, status='active', updated_at=datetime('now') WHERE id=?").bind(to_stage, id),
    c.env.DB.prepare('INSERT INTO student_transfers (student_id, from_stage, to_stage, moved_by, note) VALUES (?, ?, ?, ?, ?)')
      .bind(id, cur.stage, to_stage, u.id, note || null),
  ]);
  await audit(c.env, { userId: u.id, action: 'transfer_student', entityType: 'student', entityId: id, oldValue: { stage: cur.stage }, newValue: { stage: to_stage } });
  return c.json({ ok: true });
});

// ---- قالب الاستيراد ----
// قالب يُنزَّل ويُعبَّأ. صفوفه بيانات تمثيلية تُحذف وتُكتب مكانها الحقيقية —
// وُضعت لتُري المستخدم القيم المقبولة في كل عمود بدل أن يخمّنها.
const STUDENT_TEMPLATE_ROWS = [
  ['1010101010', 'عبدالله محمد الغامدي', 'secondary', 'أول ثانوي', 'أ', 'active', ''],
  ['1020202020', 'سارة أحمد القحطاني', 'secondary', 'ثالث ثانوي', 'ب', 'active', 'متفوقة'],
  ['1030303030', 'خالد سعد المطيري', 'middle', 'ثاني متوسط', 'أ', 'active', ''],
  ['1040404040', 'نورة عبدالعزيز الدوسري', 'middle', 'ثالث متوسط', 'ج', 'transferred', 'نُقلت إلى مدرسة أخرى'],
];

app.get('/template', async () => {
  const header = 'national_id,name,stage,grade,class,status,notes';
  const body = STUDENT_TEMPLATE_ROWS.map((r) => r.map(csvCell).join(',')).join('\n');
  // الأعمدة الإلزامية: national_id, name, stage — والمرحلة secondary أو middle
  // (وتُقبل «ثانوي» و«متوسط»)، والحالة active/transferred/withdrawn/graduated.
  return new Response('﻿' + header + '\n' + body + '\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="students_template.csv"',
      'Cache-Control': 'no-store',
    },
  });
});

// ---- تصدير ----
app.get('/export', async (c) => {
  const u = c.get('user');
  const scope = studentScopeStage(u);
  if (!scope) return c.json({ error: 'لا تملك صلاحية' }, 403);
  const rows = await c.env.DB.prepare(
    `SELECT national_id, name, stage, grade, class, status, notes FROM students ${scope !== 'all' ? 'WHERE stage = ?' : ''} ORDER BY stage, name`,
  ).bind(...(scope !== 'all' ? [scope] : [])).all<any>();
  const header = 'national_id,name,stage,grade,class,status,notes';
  const body = rows.results.map((r) => [r.national_id, r.name, r.stage, r.grade, r.class, r.status, r.notes].map(csvCell).join(',')).join('\n');
  return new Response('﻿' + header + '\n' + body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="students.csv"' } });
});

// ---- الاستيراد (معاينة أو تنفيذ) — تقرير أخطاء صفاً بصف ----
app.post('/import', async (c) => {
  const u = c.get('user');
  const commit = c.req.query('commit') === '1';
  const body = await c.req.json().catch(() => ({}));
  const csv = body.csv || '';
  if (!csv) return c.json({ error: 'لا توجد بيانات' }, 400);

  const rows = parseCsv(csv);
  if (rows.length < 2) return c.json({ error: 'الملف فارغ أو بلا صفوف بيانات' }, 400);
  const header = rows[0].map((h) => h.trim());
  // تُقبل الترويسة بالإنجليزية كما في القالب، أو بالعربية لمن ترجمها في إكسل
  const cols = {
    national_id: colOf(header, ['national_id', 'id', 'رقم الهوية', 'الهوية', 'رقم الهوية الوطنية', 'السجل المدني']),
    name: colOf(header, ['name', 'الاسم', 'اسم الطالب']),
    stage: colOf(header, ['stage', 'المرحلة']),
    grade: colOf(header, ['grade', 'الصف']),
    class: colOf(header, ['class', 'الفصل', 'الشعبة']),
    status: colOf(header, ['status', 'الحالة']),
    notes: colOf(header, ['notes', 'ملاحظات', 'ملاحظة']),
  };
  if (cols.national_id < 0 || cols.name < 0 || cols.stage < 0)
    return c.json({ error: 'الأعمدة الإلزامية مفقودة: national_id (رقم الهوية) · name (الاسم) · stage (المرحلة)' }, 400);

  // أرقام الهوية الموجودة
  const existing = new Set((await c.env.DB.prepare('SELECT national_id FROM students').all<any>()).results.map((r: any) => r.national_id));
  const seen = new Set<string>();
  const report: any[] = [];
  const valid: any[] = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    // الهوية تُطبَّع: أرقام هندية إلى لاتينية، وتُزال المسافات والشرطات — وإلا
    // بدا الرقم نفسه رقمين مختلفين فأفلت التكرار من الفحص
    const nid = toEnDigits((r[cols.national_id] || '').trim()).replace(/[\s-]/g, '');
    const name = (r[cols.name] || '').trim();
    const rawStage = (r[cols.stage] || '').trim();
    const stage = matchAlias(rawStage, STAGE_ALIASES);
    const errors: string[] = [];
    if (!nid) errors.push('رقم الهوية ناقص');
    else if (!/^\d+$/.test(nid)) errors.push('رقم الهوية يجب أن يكون أرقامًا');
    if (!name) errors.push('الاسم ناقص');
    if (!stage) errors.push('المرحلة غير صالحة (secondary/ثانوي أو middle/متوسط)');
    if (nid && (existing.has(nid) || seen.has(nid))) errors.push('رقم هوية مكرر');
    if (stage && !canManageStudents(u, stage as any, 'add')) errors.push('لا تملك صلاحية على هذه المرحلة');
    if (nid) seen.add(nid);
    const rec = {
      national_id: nid, name, stage,
      grade: cols.grade >= 0 ? (r[cols.grade] || '').trim() : '',
      class: cols.class >= 0 ? (r[cols.class] || '').trim() : '',
      status: (cols.status >= 0 && matchAlias((r[cols.status] || '').trim(), STATUS_ALIASES)) || 'active',
      notes: cols.notes >= 0 ? (r[cols.notes] || '').trim() : '',
    };
    report.push({ row: i + 1, ...rec, errors });
    if (!errors.length) valid.push(rec);
  }

  if (!commit) {
    return c.json({ preview: true, total: rows.length - 1, valid: valid.length, invalid: report.filter((r) => r.errors.length).length, report });
  }

  // تنفيذ الصفوف الصحيحة فقط
  if (valid.length) {
    await c.env.DB.batch(valid.map((v) =>
      c.env.DB.prepare('INSERT INTO students (national_id, name, stage, grade, class, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(v.national_id, v.name, v.stage, v.grade || null, v.class || null, v.status, v.notes || null)));
  }
  await audit(c.env, { userId: u.id, action: 'import_students', entityType: 'student', newValue: { inserted: valid.length } });
  return c.json({ committed: true, inserted: valid.length, skipped: report.filter((r) => r.errors.length).length, report });
});

// ---- السجل التاريخي للطالب ----
app.get('/:id/history', async (c) => {
  const id = Number(c.req.param('id'));
  const student = await c.env.DB.prepare('SELECT * FROM students WHERE id = ?').bind(id).first<any>();
  if (!student) return c.json({ error: 'الطالب غير موجود' }, 404);
  const u = c.get('user');
  const scope = studentScopeStage(u);
  if (!scope || (scope !== 'all' && scope !== student.stage))
    return c.json({ error: 'لا تملك صلاحية' }, 403);

  const { timeline, alert } = await buildStudentTimeline(c.env, student);

  const transfers = (await c.env.DB.prepare('SELECT * FROM student_transfers WHERE student_id = ? ORDER BY moved_at').bind(id).all()).results;
  return c.json({ student, timeline, alert, transfers });
});

async function targetOverall(env: Env, cycleId: number, targetId: number, criteria: any[]): Promise<number | null> {
  const evals = (await env.DB.prepare(
    "SELECT id FROM evaluations WHERE cycle_id = ? AND target_type = 'students' AND target_id = ? AND submitted_at IS NOT NULL",
  ).bind(cycleId, targetId).all<any>()).results;
  const vals: number[] = [];
  for (const e of evals) {
    const s = (await env.DB.prepare('SELECT * FROM evaluation_scores WHERE evaluation_id = ?').bind(e.id).all<any>()).results;
    const w = weightedForEvaluation(s, criteria);
    if (w != null) vals.push(w);
  }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

// متوسط مجموعة (صف/مرحلة) في دورة
async function groupAverage(env: Env, cycleId: number, criteria: any[], stage: string, grade: string | null, cls: string | null): Promise<number | null> {
  const where = ['stage = ?'];
  const binds: any[] = [stage];
  if (grade) { where.push('grade = ?'); binds.push(grade); }
  if (cls) { where.push('class = ?'); binds.push(cls); }
  const students = (await env.DB.prepare(`SELECT id FROM students WHERE ${where.join(' AND ')}`).bind(...binds).all<any>()).results;
  const vals: number[] = [];
  for (const st of students) {
    const o = await targetOverall(env, cycleId, st.id, criteria);
    if (o != null) vals.push(o);
  }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

// بناء الخط الزمني لنتائج الطالب وتنبيهه (مشترك بين السجل التاريخي وبطاقة التقرير)
export async function buildStudentTimeline(env: Env, student: any) {
  const cycles = await env.DB.prepare(
    `SELECT DISTINCT cy.id, cy.name, cy.end_date FROM eval_cycles cy
       JOIN evaluations e ON e.cycle_id = cy.id
      WHERE cy.status = 'published' AND e.target_type = 'students' AND e.target_id = ?
      ORDER BY cy.end_date, cy.id`,
  ).bind(student.id).all<any>();

  const timeline: any[] = [];
  for (const cy of cycles.results) {
    const criteria = (await env.DB.prepare(
      "SELECT * FROM eval_criteria WHERE cycle_id = ? AND target_type = 'students' AND is_active = 1",
    ).bind(cy.id).all<any>()).results;
    const studentScore = await targetOverall(env, cy.id, student.id, criteria);
    const classAvg = await groupAverage(env, cy.id, criteria, student.stage, student.grade, student.class);
    const stageAvg = await groupAverage(env, cy.id, criteria, student.stage, null, null);
    timeline.push({ cycle_id: cy.id, name: cy.name, end_date: cy.end_date, score: studentScore, class_avg: classAvg, stage_avg: stageAvg });
  }

  const scored = timeline.filter((t) => t.score != null);
  const last = scored[scored.length - 1];
  const prev = scored[scored.length - 2];
  const alert = last ? (last.score < 3 ? 'low' : (prev && last.score < prev.score - 0.3 ? 'declining' : null)) : null;
  return { timeline, alert };
}

export default app;
