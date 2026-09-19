// المتابعة المالية — الحركة المالية (صرف · إيراد) ومرفقات إثباتها، والعهدة المالية.
//
// الحركة سجلٌّ في مجلس، فيسري عليها نموذج الاطلاع نفسه حرفًا بحرف: الاطلاع الكامل
// يرى حركات مجلسه كلها، والتاريخي يرى ما سُجّل داخل نوافذ خدمته وحدها. والكتابة
// تحتاج مفتاحها (finance.add/edit/delete) ويبقى النطاق: لا يُكتب في مجلس إلا
// بالاطلاع الكامل عليه الآن.
//
// والعهدة طلبٌ يُرفع على مستوى المجلس التربوي أو مجلس مرحلة، ويقرّره صاحبُ الاعتماد
// في ذلك المجلس نفسه الذي يعتمد محاضره. وقبولُه **يُنشئ حركة إيراد بمبلغه المقبول**
// فتصير العهدة رصيدًا في الصفحة يُصرف منه، ويُربط كل صرفٍ منها بها.
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables, User } from '../types';
import { audit } from '../lib/audit';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import {
  can, canWriteFinance, canDecideCustody, canRequestCustody,
  councilScope, withinAccessWindow, hasFullCouncilAccess, isAdmin,
  type CouncilRow, type CouncilScope,
} from '../permissions';
import { getCouncil } from '../lib/meetings';
import { notifyMany } from '../lib/notify';
import { dropObject } from '../lib/filestore';
import {
  FINANCE_KINDS, MAX_FIN_ATTACH_BYTES, custodySpent, financeAttachmentCheck, financeKey,
  money, parseAmount, parseDate, summaryOf, summaryOfRows, type FinanceKind,
} from '../lib/finance';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', requireAuth, requirePasswordChanged);

type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

const CUSTODY_OPEN = 'pending';
const MAX_STATEMENT = 400;
const MAX_NOTE = 1000;

const trimTo = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max);

/** نطاق المستخدم على المجالس الثلاثة — قراءةٌ واحدة يُبنى عليها كل قرار في الطلب. */
async function scopesOf(env: Env, u: User): Promise<Map<number, { council: CouncilRow; name: string; scope: CouncilScope }>> {
  const rows = (await env.DB.prepare(
    'SELECT id, name, type, default_writer_id FROM councils ORDER BY id',
  ).all<any>()).results;
  const map = new Map<number, { council: CouncilRow; name: string; scope: CouncilScope }>();
  for (const r of rows) {
    const council: CouncilRow = { id: r.id, type: r.type, default_writer_id: r.default_writer_id };
    map.set(r.id, { council, name: r.name, scope: await councilScope(env, u, council) });
  }
  return map;
}

/** المجالس التي يملك المستخدم اطلاعًا عليها (كاملًا كان أو تاريخيًا). */
const visibleCouncilIds = (
  scopes: Map<number, { scope: CouncilScope }>,
): number[] => [...scopes.entries()].filter(([, v]) => v.scope.level !== 'none').map(([id]) => id);

/**
 * هل يرى هذا المستخدم هذا السجل؟ الاطلاع الكامل يرى مجلسه كله، والتاريخي ما أُنشئ
 * داخل نوافذ خدمته. وطالبُ العهدة يرى طلبه دائمًا (سجلٌّ شخصي كسجل الحضور).
 */
function visibleRecord(
  scope: CouncilScope | undefined,
  createdAt: string | null | undefined,
  personal = false,
): boolean {
  if (personal) return true;
  if (!scope || scope.level === 'none') return false;
  if (scope.level === 'full') return true;
  return withinAccessWindow(createdAt, scope.windows);
}

/**
 * رفعُ إثبات على حركة: من يحرّر حركات المجلس، ومعه مَن سجّلها ومَن هو مسؤولٌ عنها —
 * وهؤلاء بشرط اطلاعٍ كامل على المجلس الآن، فمن انتقل عنه لا يُضيف إلى سجلٍّ تركه.
 * تُستدعى من القائمة (لتقرير ما يُعرض) ومن مسار الرفع (لتقرير ما يقع) — قاعدةٌ واحدة.
 */
function canAttachToEntry(u: User, council: CouncilRow, entry: { created_by: number; owner_id: number | null }): boolean {
  if (canWriteFinance(u, council, 'edit')) return true;
  if (!hasFullCouncilAccess(u, council) || !can(u, 'finance.view')) return false;
  return entry.created_by === u.id || entry.owner_id === u.id;
}

/** جهةُ الاعتماد في مجلس — من تُرفع إليه طلبات عهدته (للإشعار). */
async function approversOf(env: Env, council: CouncilRow): Promise<number[]> {
  const sql = council.type === 'educational'
    ? "SELECT id FROM users WHERE role = 'president' AND is_active = 1 AND deleted_at IS NULL"
    : `SELECT id FROM users WHERE role = 'first_supervisor' AND stage = ?
         AND is_active = 1 AND deleted_at IS NULL`;
  const st = council.type === 'educational'
    ? env.DB.prepare(sql)
    : env.DB.prepare(sql).bind(council.type === 'secondary' ? 'secondary' : 'middle');
  return (await st.all<{ id: number }>()).results.map((r) => r.id);
}

const ATTACH_JSON = `(SELECT json_group_array(json_object(
    'id', fa.id, 'name', fa.file_name, 'mime', fa.mime, 'size', fa.size))
   FROM finance_attachments fa WHERE fa.entry_id = f.id)`;

const ENTRY_COLS = `f.id, f.council_id, f.kind, f.statement, f.amount, f.entry_date, f.owner_id,
  f.custody_id, f.source, f.note, f.created_by, f.created_at, f.updated_at,
  co.name AS council_name, co.type AS council_type,
  ow.name AS owner_name, ow.color AS owner_color,
  cr.name AS created_by_name,
  cu.purpose AS custody_purpose,
  ${ATTACH_JSON} AS attachments`;

const ENTRY_JOINS = `FROM finance_entries f
  JOIN councils co ON co.id = f.council_id
  LEFT JOIN users ow ON ow.id = f.owner_id
  LEFT JOIN users cr ON cr.id = f.created_by
  LEFT JOIN finance_custodies cu ON cu.id = f.custody_id`;

// ============================================================
// بيانات الشاشة: المجالس التي يكتب فيها ومن يجوز أن يكون مسؤولًا
// ============================================================
app.get('/meta', async (c) => {
  const u = c.get('user');
  if (!can(u, 'finance.view')) return c.json({ error: 'لا تملك صلاحية الاطلاع على المتابعة المالية' }, 403);
  const scopes = await scopesOf(c.env, u);

  const councils = [];
  for (const [id, v] of scopes) {
    if (v.scope.level === 'none') continue;
    // المسؤول عن الحركة: أعضاء ذلك المجلس، ومعهم صاحبُ الطلب نفسه ولو لم يكن مسجَّلًا
    const members = (await c.env.DB.prepare(
      `SELECT us.id, us.name, us.role, us.stage, us.color
         FROM council_members cm JOIN users us ON us.id = cm.user_id
        WHERE cm.council_id = ? AND us.is_active = 1 AND us.deleted_at IS NULL
          AND us.role != 'system_admin'
        ORDER BY CASE us.role WHEN 'president' THEN 1 WHEN 'vice_president' THEN 2
                              WHEN 'first_supervisor' THEN 3 ELSE 4 END, us.name`,
    ).bind(id).all<any>()).results;
    if (!isAdmin(u) && hasFullCouncilAccess(u, v.council) && !members.some((m) => m.id === u.id)) {
      const self = await c.env.DB.prepare('SELECT id, name, role, stage, color FROM users WHERE id = ?')
        .bind(u.id).first<any>();
      if (self) members.unshift(self);
    }
    councils.push({
      id, name: v.name, type: v.council.type, level: v.scope.level,
      can_add: canWriteFinance(u, v.council, 'add'),
      can_edit: canWriteFinance(u, v.council, 'edit'),
      can_delete: canWriteFinance(u, v.council, 'delete'),
      can_request: canRequestCustody(u, v.council),
      can_decide: canDecideCustody(u, v.council),
      members,
    });
  }

  return c.json({ councils, max_bytes: MAX_FIN_ATTACH_BYTES });
});

// ============================================================
// العهدة المالية
// ============================================================

/** صفٌّ واحد معروض: يُضاف إليه رصيده وما يملكه المستخدم عليه. */
function custodyOut(row: any, u: User, council: CouncilRow, spent: number) {
  const approved = row.status === 'approved' ? money(row.approved_amount ?? row.amount) : null;
  return {
    ...row,
    approved_amount: approved,
    spent: approved == null ? 0 : spent,
    remaining: approved == null ? null : money(approved - spent),
    can_decide: row.status === CUSTODY_OPEN && canDecideCustody(u, council),
    can_cancel: row.status === CUSTODY_OPEN && row.requested_by === u.id,
  };
}

app.get('/custodies', async (c) => {
  const u = c.get('user');
  if (!can(u, 'finance.view')) return c.json({ error: 'لا تملك صلاحية الاطلاع على المتابعة المالية' }, 403);
  const scopes = await scopesOf(c.env, u);
  const ids = visibleCouncilIds(scopes);
  if (!ids.length) return c.json({ custodies: [] });

  const where: string[] = [`cu.council_id IN (${ids.map(() => '?').join(',')})`];
  const binds: any[] = [...ids];
  const councilId = Number(c.req.query('council_id')) || null;
  if (councilId) { where.push('cu.council_id = ?'); binds.push(councilId); }
  const status = c.req.query('status');
  if (status && ['pending', 'approved', 'rejected', 'cancelled'].includes(status)) {
    where.push('cu.status = ?'); binds.push(status);
  }

  const rows = (await c.env.DB.prepare(
    `SELECT cu.*, co.name AS council_name, co.type AS council_type,
            rq.name AS requested_by_name, rq.color AS requested_by_color,
            dc.name AS decided_by_name
       FROM finance_custodies cu
       JOIN councils co ON co.id = cu.council_id
       LEFT JOIN users rq ON rq.id = cu.requested_by
       LEFT JOIN users dc ON dc.id = cu.decided_by
      WHERE ${where.join(' AND ')}
      ORDER BY cu.status = 'pending' DESC, cu.id DESC LIMIT 300`,
  ).bind(...binds).all<any>()).results;

  const visible = rows.filter((r) =>
    visibleRecord(scopes.get(r.council_id)?.scope, r.created_at, r.requested_by === u.id));
  const spent = await custodySpent(c.env, visible.filter((r) => r.status === 'approved').map((r) => r.id));

  return c.json({
    custodies: visible.map((r) =>
      custodyOut(r, u, scopes.get(r.council_id)!.council, spent.get(r.id) ?? 0)),
  });
});

// ---- طلب عهدة ----
app.post('/custodies', async (c) => {
  const u = c.get('user');
  const b = await c.req.json().catch(() => ({}));
  const councilId = Number(b.council_id);
  const council = councilId ? await getCouncil(c.env, councilId) : null;
  if (!council) return c.json({ error: 'المجلس غير موجود' }, 404);
  if (!canRequestCustody(u, council))
    return c.json({ error: 'لا تملك صلاحية طلب عهدة على هذا المستوى' }, 403);

  const amount = parseAmount(b.amount);
  if (amount == null) return c.json({ error: 'المبلغ المطلوب غير صالح' }, 400);
  const purpose = trimTo(b.purpose, MAX_STATEMENT);
  if (!purpose) return c.json({ error: 'بيان العهدة مطلوب' }, 400);
  const neededBy = parseDate(b.needed_by);

  const res = await c.env.DB.prepare(
    `INSERT INTO finance_custodies (council_id, amount, purpose, needed_by, status, requested_by)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
  ).bind(council.id, amount, purpose, neededBy, u.id).run();
  const id = res.meta.last_row_id as number;

  // ترفع إلى جهة الاعتماد — ومن طلب لنفسه لا يُشعَر بما كتبه بيده
  const approvers = (await approversOf(c.env, council)).filter((x) => x !== u.id);
  if (approvers.length) {
    await notifyMany(c.env, approvers, {
      type: 'custody_requested',
      title: 'طلب عهدة مالية',
      body: `${u.name}: ${purpose}`,
      link: '#/finance?custody',
    });
  }
  await audit(c.env, {
    userId: u.id, action: 'request_custody', entityType: 'finance_custody', entityId: id,
    newValue: { council_id: council.id, amount, purpose, needed_by: neededBy },
  });
  return c.json({ id }, 201);
});

// ---- قبول أو رفض طلب عهدة ----
// القبول يُنشئ حركة إيراد بالمبلغ المقبول ويربطها بالطلب، فتنعكس العهدة على الحركة
// المالية في اللحظة نفسها. والرفض قرارٌ مسجَّل بسببه لا حذفًا للطلب.
app.post('/custodies/:id/decision', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT * FROM finance_custodies WHERE id = ?').bind(id).first<any>();
  if (!row) return c.json({ error: 'الطلب غير موجود' }, 404);
  const council = await getCouncil(c.env, row.council_id);
  if (!council) return c.json({ error: 'المجلس غير موجود' }, 404);
  if (!canDecideCustody(u, council)) return c.json({ error: 'قرار العهدة لجهة اعتماد هذا المجلس' }, 403);
  if (row.status !== CUSTODY_OPEN) return c.json({ error: 'الطلب قد فُصل فيه مسبقًا' }, 409);

  const b = await c.req.json().catch(() => ({}));
  const approve = b.decision === 'approve';
  const note = trimTo(b.note, MAX_NOTE) || null;
  if (!approve && b.decision !== 'reject') return c.json({ error: 'القرار غير معروف' }, 400);

  if (!approve) {
    await c.env.DB.prepare(
      `UPDATE finance_custodies SET status = 'rejected', decided_by = ?, decided_at = datetime('now'),
              decision_note = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(u.id, note, id).run();
    await notifyMany(c.env, [row.requested_by].filter((x) => x !== u.id), {
      type: 'custody_rejected', title: 'رُفض طلب العهدة',
      body: note ? `${row.purpose} — ${note}` : row.purpose, link: '#/finance?custody',
    });
    await audit(c.env, {
      userId: u.id, action: 'reject_custody', entityType: 'finance_custody', entityId: id,
      oldValue: { status: row.status }, newValue: { status: 'rejected', note },
    });
    return c.json({ ok: true, status: 'rejected' });
  }

  // القبول قد يقلّ عن المطلوب — وما لم يُذكر فهو المطلوب كما هو
  const approved = b.amount === undefined || b.amount === null || b.amount === ''
    ? money(row.amount) : parseAmount(b.amount);
  if (approved == null) return c.json({ error: 'المبلغ المقبول غير صالح' }, 400);

  const today = (await c.env.DB.prepare("SELECT date('now') AS d").first<{ d: string }>())!.d;
  const entryRes = await c.env.DB.prepare(
    `INSERT INTO finance_entries (council_id, kind, statement, amount, entry_date, owner_id,
       custody_id, source, note, created_by)
     VALUES (?, 'income', ?, ?, ?, ?, ?, 'custody', ?, ?)`,
  ).bind(
    row.council_id, `عهدة مالية: ${row.purpose}`, approved, today, row.requested_by, id, note, u.id,
  ).run();
  const entryId = entryRes.meta.last_row_id as number;

  // القرارُ وإيرادُه واقعةٌ واحدة: إخفاق التسجيل بعد إنشاء الحركة يترك إيرادًا بلا قرار
  // يفسّره ورصيدًا لا يقابله شيء، فتُسحب الحركة ويُردّ الطلب معلّقًا كما كان.
  try {
    await c.env.DB.prepare(
      `UPDATE finance_custodies SET status = 'approved', approved_amount = ?, decided_by = ?,
              decided_at = datetime('now'), decision_note = ?, entry_id = ?, updated_at = datetime('now')
        WHERE id = ?`,
    ).bind(approved, u.id, note, entryId, id).run();
  } catch (e) {
    console.error('custody approval failed after income entry — rolling back', e);
    await c.env.DB.prepare('DELETE FROM finance_entries WHERE id = ?').bind(entryId).run();
    return c.json({ error: 'تعذّر تسجيل قبول العهدة — لم يقع شيء، أعد المحاولة' }, 500);
  }

  await notifyMany(c.env, [row.requested_by].filter((x) => x !== u.id), {
    type: 'custody_approved', title: 'قُبل طلب العهدة',
    body: `${row.purpose} — ${approved} ر.س`, link: '#/finance?custody',
  });
  await audit(c.env, {
    userId: u.id, action: 'approve_custody', entityType: 'finance_custody', entityId: id,
    oldValue: { status: row.status, amount: row.amount },
    newValue: { status: 'approved', approved_amount: approved, entry_id: entryId, note },
  });
  return c.json({ ok: true, status: 'approved', entry_id: entryId, approved_amount: approved });
});

// ---- سحب الطلب (لصاحبه، ما دام معلّقًا) ----
app.post('/custodies/:id/cancel', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT * FROM finance_custodies WHERE id = ?').bind(id).first<any>();
  if (!row) return c.json({ error: 'الطلب غير موجود' }, 404);
  if (row.requested_by !== u.id) return c.json({ error: 'الطلب يسحبه صاحبه' }, 403);
  if (row.status !== CUSTODY_OPEN) return c.json({ error: 'الطلب قد فُصل فيه مسبقًا' }, 409);
  await c.env.DB.prepare(
    "UPDATE finance_custodies SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?",
  ).bind(id).run();
  await audit(c.env, {
    userId: u.id, action: 'cancel_custody', entityType: 'finance_custody', entityId: id,
    oldValue: { status: row.status }, newValue: { status: 'cancelled' },
  });
  return c.json({ ok: true });
});

// ============================================================
// مرفقات الإثبات — تُسجَّل قبل المسارات ذات المعرّف كي لا يبتلعها `/:id`
// ============================================================

type Guard<T> = { error: Response } | T;
const denied = <T>(g: Guard<T>): g is { error: Response } => 'error' in (g as any);

async function attachmentGuard(c: Ctx, attId: number): Promise<Guard<{ row: any; council: CouncilRow }>> {
  const u = c.get('user');
  const row = await c.env.DB.prepare(
    `SELECT fa.*, f.council_id, f.created_at AS entry_created_at
       FROM finance_attachments fa JOIN finance_entries f ON f.id = fa.entry_id
      WHERE fa.id = ?`,
  ).bind(attId).first<any>();
  if (!row) return { error: c.json({ error: 'المرفق غير موجود' }, 404) };
  if (!can(u, 'finance.view')) return { error: c.json({ error: 'لا تملك صلاحية' }, 403) };
  const council = await getCouncil(c.env, row.council_id);
  if (!council) return { error: c.json({ error: 'المجلس غير موجود' }, 404) };
  const scope = await councilScope(c.env, u, council);
  if (!visibleRecord(scope, row.entry_created_at))
    return { error: c.json({ error: 'لا تملك صلاحية الاطلاع' }, 403) };
  return { row, council };
}

async function serveAttachment(c: Ctx, attId: number, download: boolean) {
  const g = await attachmentGuard(c, attId);
  if (denied(g)) return g.error;
  const obj = await c.env.FILES.get(g.row.r2_key);
  if (!obj) return c.json({ error: 'الملف غير موجود' }, 404);
  const mime = g.row.mime || 'application/octet-stream';
  return new Response(obj.body, {
    headers: {
      'Content-Type': mime,
      // المعاينة داخل المنصة تحتاج inline. وملفٌ مرفوع يُقدَّم من أصل المنصة نفسه،
      // فنمنع تخمين النوع ونعزله في صندوق بلا سكربتات (السياسة نفسها في أرشيف الملفات).
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(g.row.file_name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src data: blob:; media-src blob:; style-src 'unsafe-inline'; sandbox",
      'Cache-Control': 'private, max-age=300',
    },
  });
}

app.get('/attachments/:attId/raw', (c) => serveAttachment(c, Number(c.req.param('attId')), false));
app.get('/attachments/:attId/raw/:name', (c) => serveAttachment(c, Number(c.req.param('attId')), false));
app.get('/attachments/:attId/download', (c) => serveAttachment(c, Number(c.req.param('attId')), true));

app.delete('/attachments/:attId', async (c) => {
  const u = c.get('user');
  const attId = Number(c.req.param('attId'));
  const g = await attachmentGuard(c, attId);
  if (denied(g)) return g.error;
  // المرفق يتبع حركته: من يحرّرها يحذف إثباتها، ورافعُه يسحب ما رفعه
  if (!canWriteFinance(u, g.council, 'edit') && g.row.uploaded_by !== u.id)
    return c.json({ error: 'لا تملك صلاحية حذف هذا المرفق' }, 403);
  await c.env.DB.prepare('DELETE FROM finance_attachments WHERE id = ?').bind(attId).run();
  await dropObject(c.env, g.row.r2_key);
  await audit(c.env, {
    userId: u.id, action: 'delete_finance_attachment', entityType: 'finance_entry',
    entityId: g.row.entry_id, oldValue: { file_name: g.row.file_name },
  });
  return c.json({ ok: true });
});

// ============================================================
// الحركة المالية
// ============================================================
app.get('/', async (c) => {
  const u = c.get('user');
  if (!can(u, 'finance.view')) return c.json({ error: 'لا تملك صلاحية الاطلاع على المتابعة المالية' }, 403);
  const scopes = await scopesOf(c.env, u);
  const ids = visibleCouncilIds(scopes);
  const empty = { entries: [], summary: { income: 0, expense: 0, balance: 0, count: 0 }, partial_summary: false };
  if (!ids.length) return c.json(empty);

  const where: string[] = [`f.council_id IN (${ids.map(() => '?').join(',')})`];
  const binds: any[] = [...ids];
  const councilId = Number(c.req.query('council_id')) || null;
  if (councilId) { where.push('f.council_id = ?'); binds.push(councilId); }
  const kind = c.req.query('kind');
  if (kind && FINANCE_KINDS.includes(kind as FinanceKind)) { where.push('f.kind = ?'); binds.push(kind); }
  const from = parseDate(c.req.query('from'));
  if (from) { where.push('f.entry_date >= ?'); binds.push(from); }
  const to = parseDate(c.req.query('to'));
  if (to) { where.push('f.entry_date <= ?'); binds.push(to); }
  const custodyId = Number(c.req.query('custody_id')) || null;
  if (custodyId) { where.push('f.custody_id = ?'); binds.push(custodyId); }
  const q = (c.req.query('q') || '').trim();
  if (q) {
    const like = '%' + q + '%';
    where.push('(f.statement LIKE ? OR f.note LIKE ? OR ow.name LIKE ?)');
    binds.push(like, like, like);
  }

  // الاطلاع التاريخي يحصر الصفوف بنوافذ الخدمة، فلا يصحّ أن يصف المجموعُ ما لا يُرى.
  // فحيث كان اطلاعُه كاملًا على كل مجلس داخل الاستعلام يُجمَع له في القاعدة (يصف كل ما
  // طابق الشرط لا صفحةً محدودة منه)، وحيث دخله مجلسٌ اطلاعُه عليه تاريخيّ يُجمَع له
  // مما رآه هو — ويُعلَم ذلك في الاستجابة (partial_summary) فتقوله الشاشة صراحةً.
  const queried = councilId ? [councilId] : ids;
  const partial = queried.some((id) => scopes.get(id)?.scope.level === 'legacy');
  const whereSql = 'WHERE ' + where.join(' AND ');

  const rows = (await c.env.DB.prepare(
    `SELECT ${ENTRY_COLS} ${ENTRY_JOINS} ${whereSql}
      ORDER BY f.entry_date DESC, f.id DESC LIMIT 500`,
  ).bind(...binds).all<any>()).results;

  const visible = rows.filter((r) => visibleRecord(scopes.get(r.council_id)?.scope, r.created_at));
  const out = visible.map((r) => {
    const council = scopes.get(r.council_id)!.council;
    // حركة العهدة تتبع طلبها: لا تُحرَّر ولا تُحذف بيدٍ، فقرارها هو قرارُه
    const manual = r.source === 'manual';
    return {
      ...r,
      amount: money(r.amount),
      attachments: JSON.parse(r.attachments || '[]'),
      can_edit: manual && canWriteFinance(u, council, 'edit'),
      can_delete: manual && canWriteFinance(u, council, 'delete'),
      can_attach: canAttachToEntry(u, council, r),
    };
  });

  const summary = partial
    ? summaryOfRows(out)
    : await summaryOf(c.env, ENTRY_JOINS, whereSql, binds);

  return c.json({ entries: out, summary, partial_summary: partial });
});

/** فحص مشترك لإنشاء حركة أو تعديلها: المجلس والعهدة والمسؤول. */
async function validateEntry(
  c: Ctx, u: User, b: any, current?: any,
): Promise<{ error: Response } | { council: CouncilRow; data: any }> {
  const councilId = Number(b.council_id ?? current?.council_id);
  const council = councilId ? await getCouncil(c.env, councilId) : null;
  if (!council) return { error: c.json({ error: 'المجلس غير موجود' }, 404) };

  const kind: string = b.kind ?? current?.kind;
  if (!FINANCE_KINDS.includes(kind as FinanceKind))
    return { error: c.json({ error: 'نوع الحركة غير معروف — صرف أو إيراد' }, 400) };

  const amount = b.amount === undefined && current ? money(current.amount) : parseAmount(b.amount);
  if (amount == null) return { error: c.json({ error: 'المبلغ غير صالح' }, 400) };

  const statement = b.statement === undefined && current
    ? current.statement : trimTo(b.statement, MAX_STATEMENT);
  if (!statement) return { error: c.json({ error: 'بيان الحركة مطلوب' }, 400) };

  const entryDate = b.entry_date === undefined && current
    ? current.entry_date : parseDate(b.entry_date);
  if (!entryDate) return { error: c.json({ error: 'تاريخ الحركة مطلوب (YYYY-MM-DD)' }, 400) };

  // المسؤول: عضوٌ في مجلس الحركة أو صاحبُ اطلاعٍ كامل عليه — لا اسم من خارجه
  let ownerId: number | null = b.owner_id === undefined && current
    ? current.owner_id : (Number(b.owner_id) || null);
  if (ownerId) {
    const ok = await c.env.DB.prepare(
      `SELECT 1 FROM users us
        WHERE us.id = ? AND us.is_active = 1 AND us.deleted_at IS NULL AND us.role != 'system_admin'
          AND (us.id = ? OR EXISTS (SELECT 1 FROM council_members cm
                                     WHERE cm.council_id = ? AND cm.user_id = us.id))`,
    ).bind(ownerId, u.id, council.id).first();
    if (!ok) return { error: c.json({ error: 'المسؤول المختار ليس من هذا المجلس' }, 400) };
  }

  // الصرف من عهدة: عهدةٌ مقبولة في المجلس نفسه، ولا يتجاوز الصرفُ رصيدَها المتبقي
  const rawCustody = b.custody_id === undefined && current ? current.custody_id : b.custody_id;
  const custodyId = Number(rawCustody) || null;
  if (custodyId) {
    if (kind !== 'expense')
      return { error: c.json({ error: 'الربط بعهدة يكون على حركة صرف' }, 400) };
    const cu = await c.env.DB.prepare('SELECT * FROM finance_custodies WHERE id = ?')
      .bind(custodyId).first<any>();
    if (!cu || cu.status !== 'approved')
      return { error: c.json({ error: 'العهدة غير موجودة أو غير مقبولة' }, 400) };
    if (cu.council_id !== council.id)
      return { error: c.json({ error: 'العهدة على مستوى مجلس آخر' }, 400) };
    const spent = (await custodySpent(c.env, [custodyId])).get(custodyId) ?? 0;
    const already = current && current.custody_id === custodyId ? money(current.amount) : 0;
    const remaining = money(money(cu.approved_amount ?? cu.amount) - money(spent - already));
    if (amount > remaining) {
      return {
        error: c.json({
          error: `المبلغ يتجاوز رصيد العهدة المتبقي (${remaining} ر.س) — اطلب عهدة أخرى أو سجّل الفرق حركةً مستقلة`,
        }, 409),
      };
    }
  }

  return {
    council,
    data: {
      council_id: council.id, kind, statement, amount, entry_date: entryDate,
      owner_id: ownerId, custody_id: custodyId,
      note: b.note === undefined && current ? current.note : (trimTo(b.note, MAX_NOTE) || null),
    },
  };
}

app.post('/', async (c) => {
  const u = c.get('user');
  const b = await c.req.json().catch(() => ({}));
  const v = await validateEntry(c, u, b);
  if ('error' in v) return v.error;
  if (!canWriteFinance(u, v.council, 'add'))
    return c.json({ error: 'لا تملك صلاحية إضافة حركة في هذا المجلس' }, 403);

  const d = v.data;
  const res = await c.env.DB.prepare(
    `INSERT INTO finance_entries (council_id, kind, statement, amount, entry_date, owner_id,
       custody_id, source, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)`,
  ).bind(d.council_id, d.kind, d.statement, d.amount, d.entry_date, d.owner_id, d.custody_id, d.note, u.id).run();
  const id = res.meta.last_row_id as number;

  await audit(c.env, {
    userId: u.id, action: 'create_finance_entry', entityType: 'finance_entry', entityId: id, newValue: d,
  });
  return c.json({ id }, 201);
});

app.patch('/:id', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT * FROM finance_entries WHERE id = ?').bind(id).first<any>();
  if (!row) return c.json({ error: 'الحركة غير موجودة' }, 404);
  if (row.source === 'custody')
    return c.json({ error: 'حركة العهدة تتبع طلبها — لا تُحرَّر بيدٍ' }, 409);

  const b = await c.req.json().catch(() => ({}));
  const v = await validateEntry(c, u, b, row);
  if ('error' in v) return v.error;
  // النقل بين المجالس يحتاج صلاحية التحرير في الطرفين
  const source = await getCouncil(c.env, row.council_id);
  if (!source || !canWriteFinance(u, source, 'edit') || !canWriteFinance(u, v.council, 'edit'))
    return c.json({ error: 'لا تملك صلاحية تعديل هذه الحركة' }, 403);

  const d = v.data;
  await c.env.DB.prepare(
    `UPDATE finance_entries SET council_id = ?, kind = ?, statement = ?, amount = ?, entry_date = ?,
            owner_id = ?, custody_id = ?, note = ?, updated_at = datetime('now')
      WHERE id = ?`,
  ).bind(d.council_id, d.kind, d.statement, d.amount, d.entry_date, d.owner_id, d.custody_id, d.note, id).run();

  await audit(c.env, {
    userId: u.id, action: 'update_finance_entry', entityType: 'finance_entry', entityId: id,
    oldValue: {
      kind: row.kind, statement: row.statement, amount: row.amount, entry_date: row.entry_date,
      owner_id: row.owner_id, custody_id: row.custody_id,
    },
    newValue: d,
  });
  return c.json({ ok: true });
});

app.delete('/:id', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT * FROM finance_entries WHERE id = ?').bind(id).first<any>();
  if (!row) return c.json({ error: 'الحركة غير موجودة' }, 404);
  if (row.source === 'custody')
    return c.json({ error: 'حركة العهدة تتبع طلبها — لا تُحذف بيدٍ' }, 409);
  const council = await getCouncil(c.env, row.council_id);
  if (!council || !canWriteFinance(u, council, 'delete'))
    return c.json({ error: 'لا تملك صلاحية حذف هذه الحركة' }, 403);

  // كائنات R2 أولًا ثم الصفوف: ملفٌّ بقي بلا صفٍّ يشير إليه أهون من صفٍّ يعد بملف ذهب
  const atts = (await c.env.DB.prepare('SELECT r2_key FROM finance_attachments WHERE entry_id = ?')
    .bind(id).all<{ r2_key: string }>()).results;
  for (const a of atts) await dropObject(c.env, a.r2_key);
  await c.env.DB.prepare('DELETE FROM finance_attachments WHERE entry_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM finance_entries WHERE id = ?').bind(id).run();

  await audit(c.env, {
    userId: u.id, action: 'delete_finance_entry', entityType: 'finance_entry', entityId: id,
    oldValue: { kind: row.kind, statement: row.statement, amount: row.amount, entry_date: row.entry_date },
  });
  return c.json({ ok: true });
});

// ---- رفع مرفق إثبات (صورة أو PDF) ----
app.put('/:id/attachments', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT * FROM finance_entries WHERE id = ?').bind(id).first<any>();
  if (!row) return c.json({ error: 'الحركة غير موجودة' }, 404);
  const council = await getCouncil(c.env, row.council_id);
  if (!council) return c.json({ error: 'المجلس غير موجود' }, 404);
  if (!canAttachToEntry(u, council, row))
    return c.json({ error: 'لا تملك صلاحية رفع مرفق لهذه الحركة' }, 403);

  const name = (c.req.query('name') || '').trim();
  if (!name) return c.json({ error: 'اسم الملف مطلوب' }, 400);
  const check = financeAttachmentCheck(name, c.req.header('content-type'));
  if (!check.ok) return c.json({ error: check.error }, 400);

  const body = await c.req.arrayBuffer();
  if (!body.byteLength) return c.json({ error: 'الملف فارغ' }, 400);
  if (body.byteLength > MAX_FIN_ATTACH_BYTES)
    return c.json({ error: 'الملف أكبر من الحد المسموح (١٥ م.ب)' }, 413);

  const key = financeKey(id, name);
  await c.env.FILES.put(key, body, { httpMetadata: { contentType: check.mime } });
  const res = await c.env.DB.prepare(
    `INSERT INTO finance_attachments (entry_id, r2_key, file_name, mime, size, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(id, key, name.slice(-200), check.mime, body.byteLength, u.id).run();

  await audit(c.env, {
    userId: u.id, action: 'add_finance_attachment', entityType: 'finance_entry', entityId: id,
    newValue: { file_name: name, size: body.byteLength },
  });
  return c.json({
    id: res.meta.last_row_id, name: name.slice(-200), mime: check.mime, size: body.byteLength,
  }, 201);
});

export default app;
