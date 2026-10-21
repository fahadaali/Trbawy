// الملفات التربوية — أرشيف المنصة: مجلدات ملوّنة، تاقات، أعوام، رفع واستبدال
// وتنزيل، سجل تعديل لكل ملف، وسلة محذوفات. الاطلاع محكوم بمستوى المجلد ونموذج
// اطلاع المنصة نفسه (كامل/تاريخي) على مجالسه.
import { Hono } from 'hono';
import type { Env, Variables, User } from '../types';
import { audit } from '../lib/audit';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import {
  councilScopes, canViewFileNode, canWriteFileNode, canPurgeFiles, can,
  type CouncilScope, type FileAccess,
} from '../permissions';
import {
  MAX_FILE_BYTES, MAX_LARGE_FILE_BYTES, UPLOAD_PART_BYTES, extOf, categoryOf, mimeFor, inlineAllowed, newFileKey, dropObject,
  logFileEvent, visibilityClause, canOpenArchive, folderPath, folderTreeIds, isDescendant,
  getFolder, tagsFor, setTags, type FolderRow,
} from '../lib/filestore';
import { getSettings } from './settings';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', requireAuth, requirePasswordChanged);

const ACCESS_LEVELS: FileAccess[] = ['public', 'council', 'private'];
const NAME_MAX = 160;
const FILES_PAGE = 1000;
const DENY = (c: any, msg = 'لا تملك صلاحية') => c.json({ error: msg }, 403);

/** نصّ مقبول: بلا محارف تحكّم، بفراغ واحد، ومحدود الطول. */
function cleanText(raw: unknown, max = NAME_MAX): string {
  return String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** اسم مقبول: كنصّ، وفواصل المسار تُبدَّل حتى لا يوهم الاسمُ بمسار. */
function cleanName(raw: unknown): string {
  return cleanText(String(raw ?? '').replace(/[\\/]+/g, '_'));
}

/** نطاق كيان جديد: يرثه من مجلده، وفي الجذر يُؤخذ مما طلبه المستخدم. */
function resolveAccess(parent: FolderRow | null, body: any, u: User) {
  if (parent) return { access: parent.access, council_id: parent.council_id, owner_id: parent.owner_id };
  const access: FileAccess = ACCESS_LEVELS.includes(body?.access) ? body.access : 'public';
  const councilId = access === 'council' ? Number(body?.council_id) || null : null;
  // الخاص يبقى لصاحبه ولو أنشأه لغيره — والمالك في العام والمجلس لا أثر له في الاطلاع
  return { access, council_id: councilId, owner_id: u.id };
}

interface Ctx { u: User; scopes: Map<number, CouncilScope>; }
async function ctxOf(c: any): Promise<Ctx> {
  const u = c.get('user') as User;
  return { u, scopes: await councilScopes(c.env, u) };
}

// ============================================================
// البيانات المرجعية: التاقات، المجالس، الأعوام، وصلاحياتي
// ============================================================
app.get('/meta', async (c) => {
  const { u, scopes } = await ctxOf(c);
  if (!canOpenArchive(u)) return DENY(c, 'لا تملك صلاحية الاطلاع على الملفات');

  const tags = (await c.env.DB.prepare('SELECT id, name, color FROM file_tags ORDER BY name').all<any>()).results;
  const councils = (await c.env.DB.prepare('SELECT id, name, type FROM councils ORDER BY id').all<any>()).results
    .map((cl: any) => ({ ...cl, level: scopes.get(cl.id)?.level || 'none' }))
    .filter((cl: any) => cl.level !== 'none');

  const settings = await getSettings(c.env);
  const yearRows = await c.env.DB.prepare(
    `SELECT DISTINCT academic_year AS y FROM files WHERE academic_year IS NOT NULL AND academic_year <> ''
     UNION SELECT DISTINCT academic_year FROM file_folders WHERE academic_year IS NOT NULL AND academic_year <> ''`,
  ).all<any>();
  const years = [...new Set([
    ...(settings.current_academic_year ? [settings.current_academic_year] : []),
    ...yearRows.results.map((r: any) => r.y),
  ])].sort().reverse();

  const vis = visibilityClause(u, scopes, 'f');
  const stats = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(f.size), 0) AS bytes FROM files f
      WHERE f.deleted_at IS NULL AND ${vis.sql}`,
  ).bind(...vis.binds).first<any>();

  return c.json({
    tags, councils, years,
    current_year: settings.current_academic_year || null,
    max_bytes: MAX_FILE_BYTES,
    max_large_bytes: MAX_LARGE_FILE_BYTES,
    stats: { files: stats?.n || 0, bytes: stats?.bytes || 0 },
    perms: {
      add: can(u, 'files.add'), edit: can(u, 'files.edit'),
      delete: can(u, 'files.delete'), purge: canPurgeFiles(u),
    },
  });
});

// ============================================================
// التاقات
// ============================================================
app.post('/tags', async (c) => {
  const u = c.get('user');
  if (!can(u, 'files.add') && !can(u, 'files.edit')) return DENY(c);
  const b = await c.req.json().catch(() => ({}));
  const name = cleanText(b.name, 40);
  if (!name) return c.json({ error: 'اسم التاق مطلوب' }, 400);
  const color = /^#[0-9a-f]{6}$/i.test(String(b.color || '')) ? b.color : '#1f6f54';
  const exists = await c.env.DB.prepare('SELECT id FROM file_tags WHERE name = ?').bind(name).first<any>();
  if (exists) return c.json({ error: 'التاق موجود مسبقاً', id: exists.id }, 409);
  const res = await c.env.DB.prepare('INSERT INTO file_tags (name, color, created_by) VALUES (?, ?, ?)')
    .bind(name, color, u.id).run();
  return c.json({ id: res.meta.last_row_id, name, color }, 201);
});

app.patch('/tags/:id', async (c) => {
  const u = c.get('user');
  if (!can(u, 'files.edit')) return DENY(c);
  const id = Number(c.req.param('id'));
  const cur = await c.env.DB.prepare('SELECT * FROM file_tags WHERE id = ?').bind(id).first<any>();
  if (!cur) return c.json({ error: 'التاق غير موجود' }, 404);
  const b = await c.req.json().catch(() => ({}));
  const name = b.name !== undefined ? cleanText(b.name, 40) || cur.name : cur.name;
  const color = /^#[0-9a-f]{6}$/i.test(String(b.color || '')) ? b.color : cur.color;
  await c.env.DB.prepare('UPDATE file_tags SET name = ?, color = ? WHERE id = ?').bind(name, color, id).run();
  return c.json({ ok: true });
});

app.delete('/tags/:id', async (c) => {
  const u = c.get('user');
  if (!can(u, 'files.delete')) return DENY(c);
  const id = Number(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM file_tag_links WHERE tag_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM file_tags WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

// ============================================================
// التصفّح والبحث
// ============================================================
// بلا مرشّحات: محتوى المجلد الحالي (مجلدات ثم ملفات).
// مع بحث أو تاق أو عام أو نوع: يعمّ الأرشيف كله بما يراه المستخدم.
app.get('/', async (c) => {
  const { u, scopes } = await ctxOf(c);
  if (!canOpenArchive(u)) return DENY(c, 'لا تملك صلاحية الاطلاع على الملفات');

  const q = (c.req.query('q') || '').trim();
  const tag = Number(c.req.query('tag')) || 0;
  const year = (c.req.query('year') || '').trim();
  const type = (c.req.query('type') || '').trim();
  const trash = c.req.query('trash') === '1';
  const folderId = Number(c.req.query('folder')) || null;
  const searching = !!(q || tag || year || type);
  // الملفات صفحاتٌ من ألف — مجلدٌ استُورد من أرشيفٍ كبير قد يفوقها، فتُطلب التالية بإزاحتها
  const offset = Math.max(0, Number(c.req.query('offset')) || 0);

  // المجلد الحالي: لا يُفتح إلا لمن يراه
  let folder: FolderRow | null = null;
  if (folderId && !trash) {
    folder = await getFolder(c.env, folderId);
    if (!folder || folder.deleted_at) return c.json({ error: 'المجلد غير موجود' }, 404);
    if (!canViewFileNode(u, folder, scopes, 'folder')) return DENY(c);
  }

  const fVis = visibilityClause(u, scopes, 'f');
  const dVis = visibilityClause(u, scopes, 'd', { windows: false });

  // ---- المجلدات ----
  const dWhere = [dVis.sql];
  const dBinds = [...dVis.binds];
  dWhere.push(trash ? 'd.deleted_at IS NOT NULL' : 'd.deleted_at IS NULL');
  if (!trash && !searching) {
    dWhere.push(folderId ? 'd.parent_id = ?' : 'd.parent_id IS NULL');
    if (folderId) dBinds.push(folderId);
  }
  if (q) { dWhere.push('d.name LIKE ?'); dBinds.push('%' + q + '%'); }
  if (year) { dWhere.push('d.academic_year = ?'); dBinds.push(year); }
  if (tag) {
    dWhere.push("EXISTS (SELECT 1 FROM file_tag_links l WHERE l.tag_id = ? AND l.entity_type = 'folder' AND l.entity_id = d.id)");
    dBinds.push(tag);
  }
  // مرشّح النوع يخصّ الملفات وحدها — فلا مجلدات مع نوع محدَّد
  const folders = type ? { results: [] as any[] } : await c.env.DB.prepare(
    `SELECT d.*, cl.name AS council_name, us.name AS owner_name,
            (SELECT COUNT(*) FROM files x WHERE x.folder_id = d.id AND x.deleted_at IS NULL) AS file_count,
            (SELECT COUNT(*) FROM file_folders y WHERE y.parent_id = d.id AND y.deleted_at IS NULL) AS folder_count
       FROM file_folders d
       LEFT JOIN councils cl ON cl.id = d.council_id
       LEFT JOIN users us ON us.id = d.created_by
      WHERE ${dWhere.join(' AND ')}
      ORDER BY d.name LIMIT 2000`,
  ).bind(...dBinds).all<any>();

  // ---- الملفات ----
  const fWhere = [fVis.sql];
  const fBinds = [...fVis.binds];
  fWhere.push(trash ? 'f.deleted_at IS NOT NULL' : 'f.deleted_at IS NULL');
  if (!trash && !searching) {
    fWhere.push(folderId ? 'f.folder_id = ?' : 'f.folder_id IS NULL');
    if (folderId) fBinds.push(folderId);
  }
  if (q) { fWhere.push('(f.name LIKE ? OR f.description LIKE ?)'); fBinds.push('%' + q + '%', '%' + q + '%'); }
  if (year) { fWhere.push('f.academic_year = ?'); fBinds.push(year); }
  if (tag) {
    fWhere.push("EXISTS (SELECT 1 FROM file_tag_links l WHERE l.tag_id = ? AND l.entity_type = 'file' AND l.entity_id = f.id)");
    fBinds.push(tag);
  }
  const files = await c.env.DB.prepare(
    `SELECT f.*, cl.name AS council_name, us.name AS uploader_name, d.name AS folder_name
       FROM files f
       LEFT JOIN councils cl ON cl.id = f.council_id
       LEFT JOIN users us ON us.id = f.uploaded_by
       LEFT JOIN file_folders d ON d.id = f.folder_id
      WHERE ${fWhere.join(' AND ')}
      ORDER BY f.name, f.id LIMIT ${FILES_PAGE} OFFSET ?`,
  ).bind(...fBinds, offset).all<any>();

  const fileRows = files.results
    .map((r: any) => ({ ...r, category: categoryOf(r.ext || extOf(r.name)) }))
    .filter((r: any) => !type || r.category === type);

  const fileTags = await tagsFor(c.env, 'file', fileRows.map((r: any) => r.id));
  const folderTags = await tagsFor(c.env, 'folder', folders.results.map((r: any) => r.id));

  const decorate = (r: any, tags: Record<number, any[]>, kind: 'file' | 'folder') => {
    const owner = (kind === 'file' ? r.uploaded_by : r.created_by) === u.id;
    return {
      ...r,
      r2_key: undefined,
      tags: tags[r.id] || [],
      can_edit: canWriteFileNode(u, r, 'edit', scopes, { owner, kind }),
      can_delete: canWriteFileNode(u, r, 'delete', scopes, { owner, kind }),
    };
  };

  return c.json({
    folder,
    path: folderId && !trash ? await folderPath(c.env, folderId) : [],
    folders: folders.results.map((r: any) => decorate(r, folderTags, 'folder')),
    files: fileRows.map((r: any) => decorate(r, fileTags, 'file')),
    can_add: folder
      ? canWriteFileNode(u, folder, 'add', scopes, { kind: 'folder' })
      : can(u, 'files.add'),
    searching,
    more_files: files.results.length === FILES_PAGE,
  });
});

// ============================================================
// المجلدات
// ============================================================
/** شجرة المجلدات التي يكتب فيها المستخدم — لقوائم النقل. */
app.get('/folders/tree', async (c) => {
  const { u, scopes } = await ctxOf(c);
  if (!canOpenArchive(u)) return DENY(c, 'لا تملك صلاحية الاطلاع على الملفات');
  const vis = visibilityClause(u, scopes, 'd', { windows: false });
  const rows = await c.env.DB.prepare(
    `SELECT d.id, d.name, d.parent_id, d.access, d.council_id, d.owner_id, d.created_by
       FROM file_folders d WHERE d.deleted_at IS NULL AND ${vis.sql} ORDER BY d.name LIMIT 1000`,
  ).bind(...vis.binds).all<any>();
  const folders = rows.results
    .filter((r: any) => canWriteFileNode(u, r, 'add', scopes, { owner: r.created_by === u.id, kind: 'folder' }))
    .map((r: any) => ({ id: r.id, name: r.name, parent_id: r.parent_id, access: r.access }));
  return c.json({ folders, root: can(u, 'files.add') });
});

app.post('/folders', async (c) => {
  const { u, scopes } = await ctxOf(c);
  const b = await c.req.json().catch(() => ({}));
  const name = cleanName(b.name);
  if (!name) return c.json({ error: 'اسم المجلد مطلوب' }, 400);

  const parent = b.parent_id ? await getFolder(c.env, Number(b.parent_id)) : null;
  if (b.parent_id && (!parent || parent.deleted_at)) return c.json({ error: 'المجلد الأعلى غير موجود' }, 404);
  const scope = resolveAccess(parent, b, u);
  if (scope.access === 'council' && !scope.council_id) return c.json({ error: 'اختر المجلس' }, 400);
  if (!canWriteFileNode(u, scope as any, 'add', scopes, { kind: 'folder' })) return DENY(c, 'لا تملك صلاحية الإنشاء هنا');

  const color = /^#[0-9a-f]{6}$/i.test(String(b.color || '')) ? b.color : null;
  const year = cleanText(b.academic_year, 20) || parent?.academic_year || null;
  const res = await c.env.DB.prepare(
    `INSERT INTO file_folders (name, parent_id, color, access, council_id, owner_id, academic_year, description, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(name, parent?.id ?? null, color, scope.access, scope.council_id, scope.owner_id,
    year, cleanText(b.description, 500) || null, u.id).run();

  const id = Number(res.meta.last_row_id);
  if (Array.isArray(b.tags)) await setTags(c.env, 'folder', id, b.tags);
  await logFileEvent(c.env, { entityType: 'folder', entityId: id, action: 'create', actorId: u.id, newValue: { name, access: scope.access } });
  await audit(c.env, { userId: u.id, action: 'create_file_folder', entityType: 'file_folder', entityId: id, newValue: { name, access: scope.access } });
  return c.json({ id }, 201);
});

app.patch('/folders/:id', async (c) => {
  const { u, scopes } = await ctxOf(c);
  const id = Number(c.req.param('id'));
  const cur = await getFolder(c.env, id);
  if (!cur || cur.deleted_at) return c.json({ error: 'المجلد غير موجود' }, 404);
  if (!canWriteFileNode(u, cur, 'edit', scopes, { owner: cur.created_by === u.id, kind: 'folder' })) return DENY(c);

  const b = await c.req.json().catch(() => ({}));
  const name = b.name !== undefined ? (cleanName(b.name) || cur.name) : cur.name;
  const color = b.color !== undefined
    ? (/^#[0-9a-f]{6}$/i.test(String(b.color || '')) ? b.color : null) : cur.color;
  const year = b.academic_year !== undefined ? (cleanText(b.academic_year, 20) || null) : cur.academic_year;
  const desc = b.description !== undefined ? (cleanText(b.description, 500) || null) : cur.description;

  // النقل: الهدف مجلدٌ يكتب فيه، ولا يكون من ذرّية المجلد نفسه
  let parentId = cur.parent_id;
  if (b.parent_id !== undefined) {
    const target = b.parent_id === null || b.parent_id === '' ? null : await getFolder(c.env, Number(b.parent_id));
    if (b.parent_id && (!target || target.deleted_at)) return c.json({ error: 'المجلد الهدف غير موجود' }, 404);
    if (target && (target.id === id || await isDescendant(c.env, id, target.id)))
      return c.json({ error: 'لا يمكن نقل المجلد إلى داخل نفسه' }, 400);
    if (target && !canWriteFileNode(u, target, 'add', scopes, { kind: 'folder' })) return DENY(c, 'لا تملك صلاحية النقل إلى هذا المجلد');
    if (!target && !can(u, 'files.add')) return DENY(c, 'لا تملك صلاحية النقل إلى الجذر');
    parentId = target?.id ?? null;
  }

  // تغيير النطاق: من الجذر فقط أو بموافقة الهدف — ثم يسري على كل ما تحته
  let access = cur.access, councilId = cur.council_id, ownerId = cur.owner_id;
  const movedTo = parentId !== cur.parent_id && parentId != null ? await getFolder(c.env, parentId) : null;
  if (movedTo) { access = movedTo.access; councilId = movedTo.council_id; ownerId = movedTo.owner_id; }
  else if (b.access !== undefined && parentId == null && ACCESS_LEVELS.includes(b.access)) {
    access = b.access;
    councilId = access === 'council' ? (Number(b.council_id) || cur.council_id) : null;
    ownerId = access === 'private' ? u.id : cur.owner_id;
    if (access === 'council' && !councilId) return c.json({ error: 'اختر المجلس' }, 400);
    if (!canWriteFileNode(u, { access, council_id: councilId, owner_id: ownerId }, 'edit', scopes, { kind: 'folder' }))
      return DENY(c, 'لا تملك صلاحية النقل إلى هذا النطاق');
  }

  await c.env.DB.prepare(
    `UPDATE file_folders SET name=?, parent_id=?, color=?, academic_year=?, description=?,
       access=?, council_id=?, owner_id=?, updated_at=datetime('now') WHERE id=?`,
  ).bind(name, parentId, color, year, desc, access, councilId, ownerId, id).run();

  if (access !== cur.access || councilId !== cur.council_id || ownerId !== cur.owner_id)
    await cascadeAccess(c.env, id, access, councilId, ownerId);
  if (Array.isArray(b.tags)) await setTags(c.env, 'folder', id, b.tags);

  const changes: string[] = [];
  if (name !== cur.name) changes.push('rename');
  if (parentId !== cur.parent_id) changes.push('move');
  if (color !== cur.color) changes.push('color');
  if (year !== cur.academic_year) changes.push('year');
  if (access !== cur.access || councilId !== cur.council_id) changes.push('access');
  if (Array.isArray(b.tags)) changes.push('tags');
  for (const ch of changes) {
    await logFileEvent(c.env, {
      entityType: 'folder', entityId: id, action: ch as any, actorId: u.id,
      oldValue: { name: cur.name, parent_id: cur.parent_id, color: cur.color, academic_year: cur.academic_year, access: cur.access },
      newValue: { name, parent_id: parentId, color, academic_year: year, access },
    });
  }
  await audit(c.env, { userId: u.id, action: 'update_file_folder', entityType: 'file_folder', entityId: id, oldValue: cur, newValue: { name, access } });
  return c.json({ ok: true });
});

/** سريان نطاق المجلد على كل ما تحته من مجلدات وملفات (النطاق لا يتجزّأ). */
async function cascadeAccess(env: Env, rootId: number, access: string, councilId: number | null, ownerId: number) {
  const ids = await folderTreeIds(env, rootId);
  const marks = ids.map(() => '?').join(',');
  await env.DB.prepare(
    `UPDATE file_folders SET access=?, council_id=?, owner_id=?, updated_at=datetime('now') WHERE id IN (${marks})`,
  ).bind(access, councilId, ownerId, ...ids).run();
  await env.DB.prepare(
    `UPDATE files SET access=?, council_id=?, owner_id=?, updated_at=datetime('now') WHERE folder_id IN (${marks})`,
  ).bind(access, councilId, ownerId, ...ids).run();
}

// حذف مجلد إلى السلة — هو وكل ما تحته
app.delete('/folders/:id', async (c) => {
  const { u, scopes } = await ctxOf(c);
  const id = Number(c.req.param('id'));
  const cur = await getFolder(c.env, id);
  if (!cur || cur.deleted_at) return c.json({ error: 'المجلد غير موجود' }, 404);
  if (!canWriteFileNode(u, cur, 'delete', scopes, { owner: cur.created_by === u.id, kind: 'folder' })) return DENY(c);

  const ids = await folderTreeIds(c.env, id);
  const marks = ids.map(() => '?').join(',');
  await c.env.DB.prepare(
    `UPDATE file_folders SET deleted_at=datetime('now'), deleted_by=? WHERE id IN (${marks}) AND deleted_at IS NULL`,
  ).bind(u.id, ...ids).run();
  await c.env.DB.prepare(
    `UPDATE files SET deleted_at=datetime('now'), deleted_by=? WHERE folder_id IN (${marks}) AND deleted_at IS NULL`,
  ).bind(u.id, ...ids).run();

  await logFileEvent(c.env, { entityType: 'folder', entityId: id, action: 'trash', actorId: u.id, oldValue: { name: cur.name } });
  await audit(c.env, { userId: u.id, action: 'trash_file_folder', entityType: 'file_folder', entityId: id, oldValue: { name: cur.name } });
  return c.json({ ok: true, folders: ids.length });
});

// استعادة مجلد من السلة (هو وما تحته، ويعود إلى الجذر إن كان أعلاه محذوفًا)
app.post('/folders/:id/restore', async (c) => {
  const { u, scopes } = await ctxOf(c);
  const id = Number(c.req.param('id'));
  const cur = await getFolder(c.env, id);
  if (!cur || !cur.deleted_at) return c.json({ error: 'المجلد غير موجود في السلة' }, 404);
  if (!canWriteFileNode(u, cur, 'delete', scopes, { owner: cur.created_by === u.id, kind: 'folder' })) return DENY(c);

  const parent = cur.parent_id ? await getFolder(c.env, cur.parent_id) : null;
  const parentId = parent && !parent.deleted_at ? parent.id : null;
  const ids = await folderTreeIds(c.env, id);
  const marks = ids.map(() => '?').join(',');
  await c.env.DB.prepare(`UPDATE file_folders SET deleted_at=NULL, deleted_by=NULL, parent_id=CASE WHEN id=? THEN ? ELSE parent_id END WHERE id IN (${marks})`)
    .bind(id, parentId, ...ids).run();
  await c.env.DB.prepare(`UPDATE files SET deleted_at=NULL, deleted_by=NULL WHERE folder_id IN (${marks})`).bind(...ids).run();
  await logFileEvent(c.env, { entityType: 'folder', entityId: id, action: 'restore', actorId: u.id });
  return c.json({ ok: true });
});

// حذف نهائي لمجلد من السلة — يمحو ملفاته من R2
app.delete('/folders/:id/purge', async (c) => {
  const { u, scopes } = await ctxOf(c);
  if (!canPurgeFiles(u)) return DENY(c, 'الحذف النهائي يحتاج صلاحية حذف الملفات');
  const id = Number(c.req.param('id'));
  const cur = await getFolder(c.env, id);
  if (!cur || !cur.deleted_at) return c.json({ error: 'المجلد غير موجود في السلة' }, 404);
  if (!canViewFileNode(u, cur, scopes, 'folder')) return DENY(c);

  const ids = await folderTreeIds(c.env, id);
  const marks = ids.map(() => '?').join(',');
  const rows = await c.env.DB.prepare(`SELECT id, r2_key FROM files WHERE folder_id IN (${marks})`).bind(...ids).all<any>();
  for (const r of rows.results) await dropObject(c.env, r.r2_key);
  await c.env.DB.prepare(`DELETE FROM files WHERE folder_id IN (${marks})`).bind(...ids).run();
  await c.env.DB.prepare(`DELETE FROM file_folders WHERE id IN (${marks})`).bind(...ids).run();
  await audit(c.env, { userId: u.id, action: 'purge_file_folder', entityType: 'file_folder', entityId: id, oldValue: { name: cur.name, files: rows.results.length } });
  return c.json({ ok: true, files: rows.results.length });
});

app.get('/folders/:id/history', async (c) => {
  const { u, scopes } = await ctxOf(c);
  const id = Number(c.req.param('id'));
  const cur = await getFolder(c.env, id);
  if (!cur) return c.json({ error: 'المجلد غير موجود' }, 404);
  if (!canViewFileNode(u, cur, scopes, 'folder')) return DENY(c);
  return c.json({ events: await historyOf(c.env, 'folder', id) });
});

// ============================================================
// الملفات
// ============================================================

/** رفع ملف جديد. الجسم بايتات خام، والبيانات الوصفية في الاستعلام. */
app.put('/upload', async (c) => {
  const { u, scopes } = await ctxOf(c);
  const name = cleanName(c.req.query('name') || '') || 'ملف';
  const folderId = Number(c.req.query('folder')) || null;
  const folder = folderId ? await getFolder(c.env, folderId) : null;
  if (folderId && (!folder || folder.deleted_at)) return c.json({ error: 'المجلد غير موجود' }, 404);

  const scope = resolveAccess(folder, {
    access: c.req.query('access'), council_id: c.req.query('council_id'),
  }, u);
  if (scope.access === 'council' && !scope.council_id) return c.json({ error: 'اختر المجلس' }, 400);
  if (!canWriteFileNode(u, scope as any, 'add', scopes, { kind: folder ? 'folder' : 'file' })) return DENY(c, 'لا تملك صلاحية الرفع هنا');

  const declared = Number(c.req.header('content-length') || 0);
  if (declared > MAX_FILE_BYTES) return c.json({ error: `حجم الملف يتجاوز الحد (${MAX_FILE_BYTES / 1048576} م.ب)` }, 413);
  const body = await c.req.arrayBuffer();
  if (!body.byteLength) return c.json({ error: 'الملف فارغ' }, 400);
  if (body.byteLength > MAX_FILE_BYTES) return c.json({ error: `حجم الملف يتجاوز الحد (${MAX_FILE_BYTES / 1048576} م.ب)` }, 413);

  const ext = extOf(name);
  const mime = mimeFor(ext, c.req.header('content-type'));
  const key = newFileKey(name);
  await c.env.FILES.put(key, body, { httpMetadata: { contentType: mime } });

  const year = cleanText(c.req.query('year'), 20) || folder?.academic_year || null;
  // فشل التسجيل بعد الكتابة يترك كائنًا يتيمًا في التخزين لا يراه أحد ولا يُحذف — نمحوه
  let res;
  try {
    res = await c.env.DB.prepare(
      `INSERT INTO files (folder_id, name, r2_key, mime, ext, size, access, council_id, owner_id,
                          academic_year, description, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(folder?.id ?? null, name, key, mime, ext, body.byteLength, scope.access, scope.council_id,
      scope.owner_id, year, cleanText(c.req.query('description'), 500) || null, u.id).run();
  } catch (e) {
    await dropObject(c.env, key);
    throw e;
  }

  const id = Number(res.meta.last_row_id);
  const tags = (c.req.query('tags') || '').split(',').map(Number).filter(Boolean);
  if (tags.length) await setTags(c.env, 'file', id, tags);
  await logFileEvent(c.env, { entityType: 'file', entityId: id, action: 'upload', actorId: u.id, newValue: { name, size: body.byteLength } });
  await audit(c.env, { userId: u.id, action: 'upload_file', entityType: 'file', entityId: id, newValue: { name, size: body.byteLength, folder_id: folder?.id ?? null } });
  return c.json({ id, name, size: body.byteLength, category: categoryOf(ext) }, 201);
});

// ============================================================
// استيراد مجلد كامل (أرشيف zip من قوقل درايف أو مجلد من الجهاز)
// ============================================================
// الأرشيف يُفكّ في المتصفح ملفًا ملفًا، فلا يمرّ كاملًا عبر الـWorker مهما كبر. والخادم
// يبني له شجرة المجلدات دفعةً واحدة، ثم تُرفع الملفات بمسار الرفع المعتاد (والكبيرة
// منها مجزّأة). وإعادة استيراد الأرشيف نفسه تدمج فيه ولا تكرّره: المجلد القائم بالاسم
// نفسه تحت الأب نفسه يُعاد استخدامه، والملف القائم بالاسم نفسه يُتخطّى إن طُلب ذلك.

const MAX_IMPORT_PATHS = 2000;
const MAX_IMPORT_DEPTH = 20;

/**
 * يُنشئ ما نقص من مسارات المجلدات تحت مجلدٍ هدف (أو الجذر) ويُرجع معرّف كل مسار.
 * المسار أسماءٌ مفصولة بـ«/» نسبةً إلى الهدف. والمجلدات الجديدة ترث نطاق الهدف.
 */
app.post('/folders/ensure-paths', async (c) => {
  const { u, scopes } = await ctxOf(c);
  const b = await c.req.json().catch(() => ({}));
  const paths: string[] = Array.isArray(b.paths) ? b.paths.map((p: unknown) => String(p ?? '')) : [];
  if (!paths.length) return c.json({ map: {} });
  if (paths.length > MAX_IMPORT_PATHS) return c.json({ error: `أكثر من ${MAX_IMPORT_PATHS} مجلد في طلب واحد` }, 400);

  const target = b.parent_id ? await getFolder(c.env, Number(b.parent_id)) : null;
  if (b.parent_id && (!target || target.deleted_at)) return c.json({ error: 'المجلد الهدف غير موجود' }, 404);
  const scope = resolveAccess(target, b, u);
  if (scope.access === 'council' && !scope.council_id) return c.json({ error: 'اختر المجلس' }, 400);
  if (!canWriteFileNode(u, scope as any, 'add', scopes, { kind: 'folder' })) return DENY(c, 'لا تملك صلاحية الإنشاء هنا');
  const year = cleanText(b.academic_year, 20) || target?.academic_year || null;

  // المسارات مقسّمة أسماءً نظيفة، ومرتّبة بالعمق فيُنشأ الأب قبل ابنه
  const split = [...new Set(paths)]
    .map((p) => ({ raw: p, parts: p.split('/').map(cleanName).filter(Boolean) }))
    .filter((p) => p.parts.length);
  if (split.some((p) => p.parts.length > MAX_IMPORT_DEPTH))
    return c.json({ error: `عمق المجلدات يتجاوز ${MAX_IMPORT_DEPTH} مستوى` }, 400);
  const maxDepth = Math.max(0, ...split.map((p) => p.parts.length));

  // أبناء كل أب بأسمائهم — يُقرأ مرة لكل أب، والمحذوف في السلة لا يُعاد استخدامه
  const children = new Map<string, Map<string, number>>();
  const childrenOf = async (parentId: number | null) => {
    const k = String(parentId ?? 'root');
    let m = children.get(k);
    if (m) return m;
    m = new Map();
    const rows = (await c.env.DB.prepare(
      `SELECT id, name, access, council_id, owner_id FROM file_folders
        WHERE ${parentId == null ? 'parent_id IS NULL' : 'parent_id = ?'} AND deleted_at IS NULL`,
    ).bind(...(parentId == null ? [] : [parentId])).all<any>()).results;
    // في الجذر لا يُدمج إلا في مجلدٍ بالنطاق نفسه — فلا يقع ملفٌ عام في مجلدٍ خاصٍّ بغيره
    for (const r of rows) {
      if (parentId == null && (r.access !== scope.access || r.council_id !== scope.council_id
        || (r.access === 'private' && r.owner_id !== u.id))) continue;
      if (!m.has(r.name)) m.set(r.name, r.id);
    }
    children.set(k, m);
    return m;
  };

  const idOf = new Map<string, number>(); // المسار النظيف ← المعرّف
  let created = 0;
  for (let depth = 1; depth <= maxDepth; depth++) {
    const level = new Map<string, { parentId: number | null; name: string }>();
    for (const p of split) {
      if (p.parts.length < depth) continue;
      const key = p.parts.slice(0, depth).join('/');
      if (idOf.has(key) || level.has(key)) continue;
      const parentId = depth === 1 ? (target?.id ?? null) : idOf.get(p.parts.slice(0, depth - 1).join('/'))!;
      const name = p.parts[depth - 1];
      const existing = (await childrenOf(parentId)).get(name);
      if (existing) idOf.set(key, existing);
      else level.set(key, { parentId, name });
    }
    const pending = [...level.entries()];
    for (let i = 0; i < pending.length; i += 50) {
      const chunk = pending.slice(i, i + 50);
      const res = await c.env.DB.batch(chunk.map(([, f]) => c.env.DB.prepare(
        `INSERT INTO file_folders (name, parent_id, access, council_id, owner_id, academic_year, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(f.name, f.parentId, scope.access, scope.council_id, scope.owner_id, year, u.id)));
      const events: D1PreparedStatement[] = [];
      chunk.forEach(([key, f], j) => {
        const id = Number(res[j].meta.last_row_id);
        idOf.set(key, id);
        (children.get(String(f.parentId ?? 'root')) || new Map()).set(f.name, id);
        events.push(c.env.DB.prepare(
          `INSERT INTO file_events (entity_type, entity_id, action, actor_id, new_value)
           VALUES ('folder', ?, 'import', ?, ?)`,
        ).bind(id, u.id, JSON.stringify({ name: f.name, access: scope.access })));
      });
      await c.env.DB.batch(events);
      created += chunk.length;
    }
  }

  const map: Record<string, number> = {};
  for (const p of split) map[p.raw] = idOf.get(p.parts.join('/'))!;
  return c.json({ map, created });
});

/** أسماء الملفات القائمة في مجلدات — لتخطّي الموجود عند استئناف استيرادٍ انقطع. */
app.post('/existing-names', async (c) => {
  const { u, scopes } = await ctxOf(c);
  const b = await c.req.json().catch(() => ({}));
  const ids: (number | null)[] = (Array.isArray(b.folder_ids) ? b.folder_ids : [])
    .slice(0, MAX_IMPORT_PATHS + 1).map((x: unknown) => (x == null || x === 0 ? null : Number(x)));
  const out: Record<string, string[]> = {};
  const vis = visibilityClause(u, scopes, 'f');
  for (const id of [...new Set(ids)]) {
    const rows = (await c.env.DB.prepare(
      `SELECT f.name FROM files f
        WHERE ${id == null ? 'f.folder_id IS NULL' : 'f.folder_id = ?'} AND f.deleted_at IS NULL AND ${vis.sql}`,
    ).bind(...(id == null ? [] : [id]), ...vis.binds).all<{ name: string }>()).results;
    out[String(id ?? 0)] = rows.map((r) => r.name);
  }
  return c.json({ names: out });
});

/** سطرٌ واحد في سجل التدقيق يلخّص الاستيراد كله — بدل سطرٍ لكل ملفٍ من آلاف. */
app.post('/import-log', async (c) => {
  const u = c.get('user');
  if (!can(u, 'files.add')) return DENY(c);
  const b = await c.req.json().catch(() => ({}));
  const n = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));
  const summary = {
    source: cleanText(b.source, 300), folders: n(b.folders), files: n(b.files),
    bytes: n(b.bytes), skipped: n(b.skipped), failed: n(b.failed),
  };
  const folderId = Number(b.folder_id) || null;
  if (folderId) await logFileEvent(c.env, { entityType: 'folder', entityId: folderId, action: 'import', actorId: u.id, newValue: summary });
  await audit(c.env, { userId: u.id, action: 'import_zip_archive', entityType: 'file_folder', entityId: folderId ?? undefined, newValue: summary });
  return c.json({ ok: true });
});

// ============================================================
// الرفع المجزّأ للملفات الكبيرة (R2 multipart)
// ============================================================
// بدءٌ يقرّر الصلاحية والوجهة ويحفظهما، ثم قطعٌ تُرفع كلٌّ في طلب، ثم إتمامٌ يسجّل الملف.
// فلا يمرّ الملف كاملًا عبر الـWorker، ولا يُكمل رفعًا إلا من بدأه.

app.post('/upload/multipart', async (c) => {
  const { u, scopes } = await ctxOf(c);
  const b = await c.req.json().catch(() => ({}));
  const name = cleanName(b.name) || 'ملف';
  const size = Number(b.size) || 0;
  if (size <= 0) return c.json({ error: 'الملف فارغ' }, 400);
  if (size > MAX_LARGE_FILE_BYTES)
    return c.json({ error: `حجم الملف يتجاوز الحد (${MAX_LARGE_FILE_BYTES / 1073741824} ج.ب)` }, 413);

  const folderId = Number(b.folder) || null;
  const folder = folderId ? await getFolder(c.env, folderId) : null;
  if (folderId && (!folder || folder.deleted_at)) return c.json({ error: 'المجلد غير موجود' }, 404);
  const scope = resolveAccess(folder, b, u);
  if (scope.access === 'council' && !scope.council_id) return c.json({ error: 'اختر المجلس' }, 400);
  if (!canWriteFileNode(u, scope as any, 'add', scopes, { kind: folder ? 'folder' : 'file' })) return DENY(c, 'لا تملك صلاحية الرفع هنا');

  const key = newFileKey(name);
  const mime = mimeFor(extOf(name), b.type);
  const mp = await c.env.FILES.createMultipartUpload(key, { httpMetadata: { contentType: mime } });
  await c.env.DB.prepare(
    `INSERT INTO file_uploads (upload_id, r2_key, name, size, folder_id, access, council_id, owner_id, academic_year, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(mp.uploadId, key, name, size, folder?.id ?? null, scope.access, scope.council_id, scope.owner_id,
    cleanText(b.year, 20) || folder?.academic_year || null, u.id).run();
  return c.json({ upload_id: mp.uploadId, part_bytes: UPLOAD_PART_BYTES }, 201);
});

async function ownUpload(c: any, uploadId: string) {
  const row = await c.env.DB.prepare('SELECT * FROM file_uploads WHERE upload_id = ?').bind(uploadId).first();
  return row && row.user_id === c.get('user').id ? row : null;
}

app.put('/upload/multipart/:uploadId/:part', async (c) => {
  const row: any = await ownUpload(c, c.req.param('uploadId'));
  if (!row) return c.json({ error: 'عملية الرفع غير موجودة' }, 404);
  const part = Number(c.req.param('part'));
  if (!Number.isInteger(part) || part < 1 || part > 10000) return c.json({ error: 'رقم القطعة غير صالح' }, 400);
  const declared = Number(c.req.header('content-length') || 0);
  if (declared > UPLOAD_PART_BYTES * 2) return c.json({ error: 'القطعة أكبر من المسموح' }, 413);
  const body = await c.req.arrayBuffer();
  if (!body.byteLength || body.byteLength > UPLOAD_PART_BYTES * 2) return c.json({ error: 'القطعة فارغة أو أكبر من المسموح' }, 400);
  const mp = c.env.FILES.resumeMultipartUpload(row.r2_key, row.upload_id);
  const up = await mp.uploadPart(part, body);
  return c.json({ part: up.partNumber, etag: up.etag });
});

app.post('/upload/multipart/:uploadId/complete', async (c) => {
  const u = c.get('user');
  const row: any = await ownUpload(c, c.req.param('uploadId'));
  if (!row) return c.json({ error: 'عملية الرفع غير موجودة' }, 404);
  const b = await c.req.json().catch(() => ({}));
  const parts = (Array.isArray(b.parts) ? b.parts : [])
    .map((p: any) => ({ partNumber: Number(p.part), etag: String(p.etag || '') }))
    .filter((p: any) => p.partNumber > 0 && p.etag)
    .sort((x: any, y: any) => x.partNumber - y.partNumber);
  if (!parts.length) return c.json({ error: 'لا قطع مرفوعة' }, 400);

  const mp = c.env.FILES.resumeMultipartUpload(row.r2_key, row.upload_id);
  const obj = await mp.complete(parts);
  // الحجم الفعلي من التخزين لا مما أعلنه المتصفح — وما جاوز الحد يُمحى
  if (obj.size > MAX_LARGE_FILE_BYTES || obj.size !== row.size) {
    await dropObject(c.env, row.r2_key);
    await c.env.DB.prepare('DELETE FROM file_uploads WHERE upload_id = ?').bind(row.upload_id).run();
    return c.json({ error: 'حجم الملف المرفوع لا يطابق المُعلَن — أعد المحاولة' }, 400);
  }

  const ext = extOf(row.name);
  let res;
  try {
    res = await c.env.DB.prepare(
      `INSERT INTO files (folder_id, name, r2_key, mime, ext, size, access, council_id, owner_id,
                          academic_year, description, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(row.folder_id, row.name, row.r2_key, mimeFor(ext, obj.httpMetadata?.contentType), ext, obj.size,
      row.access, row.council_id, row.owner_id, row.academic_year, cleanText(b.description, 500) || null, u.id).run();
  } catch (e) {
    await dropObject(c.env, row.r2_key);
    throw e;
  }
  await c.env.DB.prepare('DELETE FROM file_uploads WHERE upload_id = ?').bind(row.upload_id).run();

  const id = Number(res.meta.last_row_id);
  const tags = (Array.isArray(b.tags) ? b.tags : []).map(Number).filter(Boolean);
  if (tags.length) await setTags(c.env, 'file', id, tags);
  await logFileEvent(c.env, { entityType: 'file', entityId: id, action: 'upload', actorId: u.id, newValue: { name: row.name, size: obj.size } });
  await audit(c.env, { userId: u.id, action: 'upload_file', entityType: 'file', entityId: id, newValue: { name: row.name, size: obj.size, folder_id: row.folder_id } });
  return c.json({ id, name: row.name, size: obj.size, category: categoryOf(ext) }, 201);
});

app.delete('/upload/multipart/:uploadId', async (c) => {
  const row: any = await ownUpload(c, c.req.param('uploadId'));
  if (!row) return c.json({ ok: true });
  try { await c.env.FILES.resumeMultipartUpload(row.r2_key, row.upload_id).abort(); } catch { /* انتهت أو أُلغيت */ }
  await c.env.DB.prepare('DELETE FROM file_uploads WHERE upload_id = ?').bind(row.upload_id).run();
  return c.json({ ok: true });
});

/** استبدال محتوى ملف قائم — الإصدار يعلو، ويُسجَّل الحدث، وتُمحى النسخة السابقة. */
app.put('/:id/replace', async (c) => {
  const { u, scopes } = await ctxOf(c);
  const id = Number(c.req.param('id'));
  const cur = await loadFile(c.env, id);
  if (!cur || cur.deleted_at) return c.json({ error: 'الملف غير موجود' }, 404);
  if (!canWriteFileNode(u, cur, 'edit', scopes, { owner: cur.uploaded_by === u.id })) return DENY(c);

  const declared = Number(c.req.header('content-length') || 0);
  if (declared > MAX_FILE_BYTES) return c.json({ error: `حجم الملف يتجاوز الحد (${MAX_FILE_BYTES / 1048576} م.ب)` }, 413);
  const body = await c.req.arrayBuffer();
  if (!body.byteLength) return c.json({ error: 'الملف فارغ' }, 400);
  if (body.byteLength > MAX_FILE_BYTES) return c.json({ error: `حجم الملف يتجاوز الحد (${MAX_FILE_BYTES / 1048576} م.ب)` }, 413);

  const sentName = cleanName(c.req.query('name') || '');
  const ext = extOf(sentName) || cur.ext;
  const mime = mimeFor(ext, c.req.header('content-type'));
  const key = newFileKey(sentName || cur.name);
  await c.env.FILES.put(key, body, { httpMetadata: { contentType: mime } });

  // الاسم المعروض يبقى إلا أن يتغيّر الامتداد، فيتبعه الاسم كي لا يكذب على القارئ
  const name = ext !== cur.ext && sentName ? sentName : cur.name;
  try {
    await c.env.DB.prepare(
      `UPDATE files SET r2_key=?, mime=?, ext=?, size=?, name=?, version=version+1,
         replaced_at=datetime('now'), replaced_by=?, updated_at=datetime('now') WHERE id=?`,
    ).bind(key, mime, ext, body.byteLength, name, u.id, id).run();
  } catch (e) {
    // النسخة الجديدة لم تُسجَّل: نمحوها ونُبقي القائمة كما هي بدل ملفٍ بلا سجل
    await dropObject(c.env, key);
    throw e;
  }
  await dropObject(c.env, cur.r2_key);

  await logFileEvent(c.env, {
    entityType: 'file', entityId: id, action: 'replace', actorId: u.id,
    oldValue: { name: cur.name, size: cur.size, version: cur.version },
    newValue: { name, size: body.byteLength, version: cur.version + 1 },
    note: cleanText(c.req.query('note'), 300) || null,
  });
  await audit(c.env, { userId: u.id, action: 'replace_file', entityType: 'file', entityId: id, oldValue: { size: cur.size, version: cur.version }, newValue: { size: body.byteLength, version: cur.version + 1 } });
  return c.json({ ok: true, version: cur.version + 1, size: body.byteLength });
});

/** تعديل البيانات الوصفية: الاسم، المجلد، العام، الوصف، التاقات. */
app.patch('/:id', async (c) => {
  const { u, scopes } = await ctxOf(c);
  const id = Number(c.req.param('id'));
  const cur = await loadFile(c.env, id);
  if (!cur || cur.deleted_at) return c.json({ error: 'الملف غير موجود' }, 404);
  if (!canWriteFileNode(u, cur, 'edit', scopes, { owner: cur.uploaded_by === u.id })) return DENY(c);

  const b = await c.req.json().catch(() => ({}));
  // إعادة التسمية لا تغيّر المحتوى، فالامتداد يبقى ملازمًا للاسم
  let name = cur.name;
  if (b.name !== undefined) {
    name = cleanName(b.name) || cur.name;
    if (cur.ext && extOf(name) !== cur.ext) name = `${name}.${cur.ext}`;
  }
  const year = b.academic_year !== undefined ? (cleanText(b.academic_year, 20) || null) : cur.academic_year;
  const desc = b.description !== undefined ? (cleanText(b.description, 500) || null) : cur.description;

  let folderId = cur.folder_id;
  let access = cur.access, councilId = cur.council_id, ownerId = cur.owner_id;
  if (b.folder_id !== undefined) {
    const target = b.folder_id === null || b.folder_id === '' ? null : await getFolder(c.env, Number(b.folder_id));
    if (b.folder_id && (!target || target.deleted_at)) return c.json({ error: 'المجلد الهدف غير موجود' }, 404);
    if (target && !canWriteFileNode(u, target, 'add', scopes, { kind: 'folder' })) return DENY(c, 'لا تملك صلاحية النقل إلى هذا المجلد');
    if (!target && !can(u, 'files.add')) return DENY(c, 'لا تملك صلاحية النقل إلى الجذر');
    folderId = target?.id ?? null;
    // الملف يرث نطاق مجلده الجديد، وفي الجذر يبقى على نطاقه
    if (target) { access = target.access; councilId = target.council_id; ownerId = target.owner_id; }
  }

  await c.env.DB.prepare(
    `UPDATE files SET name=?, folder_id=?, academic_year=?, description=?,
       access=?, council_id=?, owner_id=?, updated_at=datetime('now') WHERE id=?`,
  ).bind(name, folderId, year, desc, access, councilId, ownerId, id).run();
  if (Array.isArray(b.tags)) await setTags(c.env, 'file', id, b.tags);

  const changed: string[] = [];
  if (name !== cur.name) changed.push('rename');
  if (folderId !== cur.folder_id) changed.push('move');
  if (year !== cur.academic_year) changed.push('year');
  if (desc !== cur.description) changed.push('description');
  if (Array.isArray(b.tags)) changed.push('tags');
  for (const ch of changed) {
    await logFileEvent(c.env, {
      entityType: 'file', entityId: id, action: ch as any, actorId: u.id,
      oldValue: { name: cur.name, folder_id: cur.folder_id, academic_year: cur.academic_year },
      newValue: { name, folder_id: folderId, academic_year: year },
    });
  }
  if (changed.length) await audit(c.env, { userId: u.id, action: 'update_file', entityType: 'file', entityId: id, oldValue: { name: cur.name }, newValue: { name, folder_id: folderId } });
  return c.json({ ok: true });
});

// حذف إلى السلة
app.delete('/:id', async (c) => {
  const { u, scopes } = await ctxOf(c);
  const id = Number(c.req.param('id'));
  const cur = await loadFile(c.env, id);
  if (!cur || cur.deleted_at) return c.json({ error: 'الملف غير موجود' }, 404);
  if (!canWriteFileNode(u, cur, 'delete', scopes, { owner: cur.uploaded_by === u.id })) return DENY(c);
  await c.env.DB.prepare("UPDATE files SET deleted_at=datetime('now'), deleted_by=? WHERE id=?").bind(u.id, id).run();
  await logFileEvent(c.env, { entityType: 'file', entityId: id, action: 'trash', actorId: u.id, oldValue: { name: cur.name } });
  await audit(c.env, { userId: u.id, action: 'trash_file', entityType: 'file', entityId: id, oldValue: { name: cur.name } });
  return c.json({ ok: true });
});

app.post('/:id/restore', async (c) => {
  const { u, scopes } = await ctxOf(c);
  const id = Number(c.req.param('id'));
  const cur = await loadFile(c.env, id);
  if (!cur || !cur.deleted_at) return c.json({ error: 'الملف غير موجود في السلة' }, 404);
  if (!canWriteFileNode(u, cur, 'delete', scopes, { owner: cur.uploaded_by === u.id })) return DENY(c);
  // مجلده قد يكون في السلة — فيعود الملف إلى الجذر بدل أن يختفي في مجلد محذوف
  const folder = cur.folder_id ? await getFolder(c.env, cur.folder_id) : null;
  const folderId = folder && !folder.deleted_at ? folder.id : null;
  await c.env.DB.prepare('UPDATE files SET deleted_at=NULL, deleted_by=NULL, folder_id=? WHERE id=?').bind(folderId, id).run();
  await logFileEvent(c.env, { entityType: 'file', entityId: id, action: 'restore', actorId: u.id });
  return c.json({ ok: true, folder_id: folderId });
});

app.delete('/:id/purge', async (c) => {
  const { u, scopes } = await ctxOf(c);
  if (!canPurgeFiles(u)) return DENY(c, 'الحذف النهائي يحتاج صلاحية حذف الملفات');
  const id = Number(c.req.param('id'));
  const cur = await loadFile(c.env, id);
  if (!cur || !cur.deleted_at) return c.json({ error: 'الملف غير موجود في السلة' }, 404);
  if (!canViewFileNode(u, cur, scopes)) return DENY(c);
  await dropObject(c.env, cur.r2_key);
  await c.env.DB.prepare('DELETE FROM files WHERE id = ?').bind(id).run();
  await audit(c.env, { userId: u.id, action: 'purge_file', entityType: 'file', entityId: id, oldValue: { name: cur.name } });
  return c.json({ ok: true });
});

app.get('/:id/history', async (c) => {
  const { u, scopes } = await ctxOf(c);
  const id = Number(c.req.param('id'));
  const cur = await loadFile(c.env, id);
  if (!cur) return c.json({ error: 'الملف غير موجود' }, 404);
  if (!canViewFileNode(u, cur, scopes)) return DENY(c);
  return c.json({ file: { ...cur, r2_key: undefined }, events: await historyOf(c.env, 'file', id) });
});

// ---- تقديم المحتوى: معاينة داخل المنصة (raw) أو تنزيل ----
app.get('/:id/raw', (c) => serveFile(c, false));
// الاسم في آخر المسار للعرض وحده: مستعرض PDF في المتصفح يكتب آخر جزء من الرابط
// عنوانًا للنافذة، فبدونه يقرأ المستخدم «raw» مكان اسم ملفه. والتصريح يبقى على المعرّف.
app.get('/:id/raw/:name', (c) => serveFile(c, false));
app.get('/:id/download', (c) => serveFile(c, true));

async function serveFile(c: any, forceDownload: boolean): Promise<Response> {
  const { u, scopes } = await ctxOf(c);
  const id = Number(c.req.param('id'));
  const cur = await loadFile(c.env, id);
  if (!cur) return c.json({ error: 'الملف غير موجود' }, 404);
  if (!canViewFileNode(u, cur, scopes)) return DENY(c);

  const mime = cur.mime || mimeFor(cur.ext || '');
  const inline = !forceDownload && inlineAllowed(mime);

  // طلب مجزَّأ (Range) — يحتاجه تشغيل الفيديو والصوت والتنقّل داخلهما
  const rangeHeader = c.req.header('range');
  let obj: R2ObjectBody | null;
  let start = 0, end = 0, partial = false;
  if (rangeHeader) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (m) {
      partial = true;
      if (m[1] === '' && m[2] !== '') {
        obj = await c.env.FILES.get(cur.r2_key, { range: { suffix: Number(m[2]) } });
      } else {
        start = Number(m[1] || 0);
        end = m[2] ? Number(m[2]) : 0;
        obj = await c.env.FILES.get(cur.r2_key, {
          range: end ? { offset: start, length: end - start + 1 } : { offset: start },
        });
      }
    } else {
      obj = await c.env.FILES.get(cur.r2_key);
    }
  } else {
    obj = await c.env.FILES.get(cur.r2_key);
  }
  if (!obj) return c.json({ error: 'الملف غير موجود في التخزين' }, 404);

  const headers = new Headers();
  headers.set('Content-Type', mime);
  headers.set('Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(cur.name)}`);
  // ملفٌ مرفوع يُقدَّم من أصل المنصة نفسه: نمنع تخمين النوع، ونعزله في صندوق
  // بلا سكربتات ولا موارد خارجية، فلا يُنفَّذ محتوًى مرفوع في سياق الجلسة.
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', "default-src 'none'; img-src data: blob:; media-src blob:; style-src 'unsafe-inline'; sandbox");
  headers.set('Cache-Control', 'private, max-age=300');
  headers.set('Accept-Ranges', 'bytes');

  const total = obj.size;
  if (partial && obj.range) {
    const r: any = obj.range;
    const from = r.offset ?? (total - (r.suffix ?? 0));
    const len = r.length ?? (r.suffix ?? total - from);
    headers.set('Content-Range', `bytes ${from}-${from + len - 1}/${total}`);
    headers.set('Content-Length', String(len));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('Content-Length', String(total));
  return new Response(obj.body, { headers });
}

// ---- أدوات داخلية ----
async function loadFile(env: Env, id: number): Promise<any | null> {
  if (!id) return null;
  return await env.DB.prepare('SELECT * FROM files WHERE id = ?').bind(id).first<any>();
}

async function historyOf(env: Env, type: 'file' | 'folder', id: number) {
  const rows = await env.DB.prepare(
    `SELECT e.*, u.name AS actor_name FROM file_events e
       LEFT JOIN users u ON u.id = e.actor_id
      WHERE e.entity_type = ? AND e.entity_id = ? ORDER BY e.id DESC LIMIT 200`,
  ).bind(type, id).all<any>();
  return rows.results.map((r: any) => ({
    ...r,
    old_value: r.old_value ? JSON.parse(r.old_value) : null,
    new_value: r.new_value ? JSON.parse(r.new_value) : null,
  }));
}

export default app;
