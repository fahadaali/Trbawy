// أدوات أرشيف الملفات التربوية: الأنواع والامتدادات، مفاتيح R2، شرط الاطلاع في
// الاستعلامات، وسجل الأحداث لكل ملف ومجلد.
import type { Env, User } from '../types';
import type { CouncilScope, FileAccess } from '../permissions';
import { can, isAdmin } from '../permissions';

/** أقصى حجم للملف الواحد — الرفع يمرّ عبر الـ Worker فيبقى ضمن حدّ الطلب. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

// ---- الامتدادات والأنواع ----
const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', heic: 'image/heic', avif: 'image/avif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', oga: 'audio/ogg', aac: 'audio/aac',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', tsv: 'text/tab-separated-values',
  json: 'application/json', xml: 'application/xml', html: 'text/html', htm: 'text/html',
  zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
};

/** صنف العرض — عليه يدور اختيار المستعرض في الواجهة وتصفية النوع. */
export type FileCategory = 'pdf' | 'image' | 'video' | 'audio' | 'doc' | 'sheet' | 'slide' | 'text' | 'archive' | 'other';

const CATEGORY_BY_EXT: Record<string, FileCategory> = {
  pdf: 'pdf',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', bmp: 'image', heic: 'image', avif: 'image',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', mkv: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', ogg: 'audio', oga: 'audio', aac: 'audio',
  doc: 'doc', docx: 'doc', rtf: 'doc', odt: 'doc',
  xls: 'sheet', xlsx: 'sheet', xlsm: 'sheet', csv: 'sheet', tsv: 'sheet', ods: 'sheet',
  ppt: 'slide', pptx: 'slide', odp: 'slide',
  txt: 'text', md: 'text', json: 'text', xml: 'text', html: 'text', htm: 'text', log: 'text',
  zip: 'archive', rar: 'archive', '7z': 'archive', gz: 'archive', tar: 'archive',
};

export const extOf = (name: string): string => {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || '').trim());
  return m ? m[1].toLowerCase() : '';
};

export const categoryOf = (ext: string): FileCategory => CATEGORY_BY_EXT[ext] || 'other';

/** نوع المحتوى: الامتداد أولًا (أوثق مما يرسله المتصفح)، ثم ما أرسله، ثم ثنائي عام. */
export function mimeFor(ext: string, sent?: string | null): string {
  if (MIME_BY_EXT[ext]) return MIME_BY_EXT[ext];
  const s = String(sent || '').split(';')[0].trim().toLowerCase();
  if (s && s !== 'application/octet-stream') return s;
  return 'application/octet-stream';
}

/**
 * هل يُقدَّم هذا النوع داخل الصفحة (inline)؟
 * الملفات التي يفسّرها المتصفح كمستند (HTML وما شابه) تُقدَّم تنزيلًا دائمًا حتى لا
 * يُنفَّذ محتوى مرفوع على أصل المنصة نفسه. وما عداه محميّ فوق ذلك بترويسة sandbox.
 */
export function inlineAllowed(mime: string): boolean {
  const m = mime.toLowerCase();
  if (m.startsWith('text/html') || m.includes('xhtml')) return false;
  return m.startsWith('image/') || m.startsWith('video/') || m.startsWith('audio/')
    || m === 'application/pdf' || m.startsWith('text/');
}

/** اسم آمن داخل مفتاح R2 — الاسم المعروض يبقى في القاعدة كما كتبه المستخدم. */
export function safeKeyName(name: string): string {
  const base = String(name || 'file').replace(/[\\/]+/g, '_').replace(/[^\p{L}\p{N}._-]+/gu, '_');
  return base.slice(-90) || 'file';
}

/** مفتاح جديد في R2 — فريد بذاته فلا يدهس استبدالٌ نسخةً قائمة قبل تسجيلها. */
export function newFileKey(name: string): string {
  const rand = crypto.randomUUID().slice(0, 8);
  return `files/${Date.now()}_${rand}_${safeKeyName(name)}`;
}

/** حذف كائن من R2 بلا إسقاط العملية إن كان مفقودًا أصلًا. */
export async function dropObject(env: Env, key: string | null | undefined): Promise<void> {
  if (!key) return;
  try { await env.FILES.delete(key); } catch { /* محذوف مسبقًا أو غير موجود */ }
}

// ---- سجل الأحداث (سجل التعديل والاستبدال) ----
export type FileEventAction =
  | 'upload' | 'replace' | 'rename' | 'move' | 'tags' | 'year' | 'description'
  | 'access' | 'color' | 'create' | 'trash' | 'restore' | 'purge' | 'download';

export async function logFileEvent(env: Env, e: {
  entityType: 'file' | 'folder';
  entityId: number;
  action: FileEventAction;
  actorId: number;
  oldValue?: unknown;
  newValue?: unknown;
  note?: string | null;
}): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO file_events (entity_type, entity_id, action, actor_id, old_value, new_value, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      e.entityType, e.entityId, e.action, e.actorId,
      e.oldValue === undefined ? null : JSON.stringify(e.oldValue),
      e.newValue === undefined ? null : JSON.stringify(e.newValue),
      e.note ?? null,
    ).run();
  } catch (err) {
    console.error('file event log failed', err);
  }
}

// ---- شرط الاطلاع داخل الاستعلامات ----
/**
 * يبني شرط SQL يحصر الصفوف فيما يراه المستخدم:
 *   العام للجميع · الخاص لصاحبه · مجلد المجلس بحسب نطاقه (الكامل كله، والتاريخي
 *   ما أُنشئ داخل نوافذ خدمته). وهو ترجمةٌ حرفية لـ canViewFileNode إلى SQL.
 */
export function visibilityClause(
  u: User,
  scopes: Map<number, CouncilScope>,
  alias: string,
  opts: { windows?: boolean } = {},
): { sql: string; binds: any[] } {
  const parts: string[] = [`${alias}.access = 'public'`];
  const binds: any[] = [];
  parts.push(`(${alias}.access = 'private' AND ${alias}.owner_id = ?)`);
  binds.push(u.id);

  for (const [councilId, scope] of scopes) {
    if (scope.level === 'none') continue;
    if (scope.level === 'full' || opts.windows === false) {
      parts.push(`(${alias}.access = 'council' AND ${alias}.council_id = ?)`);
      binds.push(councilId);
      continue;
    }
    // اطلاع تاريخي: نوافذ الخدمة نصف مفتوحة [from, to) كما في بقية المنصة
    const winSql: string[] = [];
    const winBinds: any[] = [];
    for (const w of scope.windows) {
      if (w.to == null) { winSql.push(`${alias}.created_at >= ?`); winBinds.push(w.from); }
      else { winSql.push(`(${alias}.created_at >= ? AND ${alias}.created_at < ?)`); winBinds.push(w.from, w.to); }
    }
    if (!winSql.length) continue;
    parts.push(`(${alias}.access = 'council' AND ${alias}.council_id = ? AND (${winSql.join(' OR ')}))`);
    binds.push(councilId, ...winBinds);
  }

  return { sql: '(' + parts.join(' OR ') + ')', binds };
}

/** هل يملك المستخدم اطلاعًا على الأرشيف أصلًا؟ (مدير النظام خارج المحتوى ما لم يُستثنَ) */
export const canOpenArchive = (u: User): boolean => (isAdmin(u) ? u.perms?.['files.view'] === true : can(u, 'files.view'));

// ---- المجلدات: السلسلة والذرّية ----
export interface FolderRow {
  id: number;
  name: string;
  parent_id: number | null;
  color: string | null;
  access: FileAccess;
  council_id: number | null;
  owner_id: number;
  academic_year: string | null;
  description: string | null;
  created_by: number;
  created_at: string;
  deleted_at: string | null;
}

export async function getFolder(env: Env, id: number): Promise<FolderRow | null> {
  if (!id) return null;
  return await env.DB.prepare('SELECT * FROM file_folders WHERE id = ?').bind(id).first<FolderRow>();
}

/** سلسلة المجلدات من الجذر إلى المجلد (لمسار التنقّل) — بحدٍّ يقي من دورة بيانات. */
export async function folderPath(env: Env, id: number | null): Promise<FolderRow[]> {
  const chain: FolderRow[] = [];
  let cur = id;
  for (let i = 0; cur && i < 24; i++) {
    const row = await getFolder(env, cur);
    if (!row) break;
    chain.unshift(row);
    cur = row.parent_id;
  }
  return chain;
}

/** المجلد وكل ما تحته (لحذف الشجرة أو استعادتها). */
export async function folderTreeIds(env: Env, rootId: number): Promise<number[]> {
  const ids = [rootId];
  let frontier = [rootId];
  for (let depth = 0; depth < 24 && frontier.length; depth++) {
    const marks = frontier.map(() => '?').join(',');
    const rows = await env.DB.prepare(`SELECT id FROM file_folders WHERE parent_id IN (${marks})`)
      .bind(...frontier).all<{ id: number }>();
    frontier = rows.results.map((r) => r.id).filter((x) => !ids.includes(x));
    ids.push(...frontier);
  }
  return ids;
}

/** هل الهدف داخل شجرة المجلد نفسه؟ (نقل مجلد إلى أحد أحفاده يقطع الشجرة) */
export async function isDescendant(env: Env, folderId: number, maybeChildId: number): Promise<boolean> {
  return (await folderTreeIds(env, folderId)).includes(maybeChildId);
}

/** تاقات مجموعة كيانات دفعةً واحدة: { entityId: [{id,name,color}] } */
export async function tagsFor(env: Env, type: 'file' | 'folder', ids: number[]): Promise<Record<number, any[]>> {
  const out: Record<number, any[]> = {};
  if (!ids.length) return out;
  const marks = ids.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT l.entity_id, t.id, t.name, t.color FROM file_tag_links l
       JOIN file_tags t ON t.id = l.tag_id
      WHERE l.entity_type = ? AND l.entity_id IN (${marks})
      ORDER BY t.name`,
  ).bind(type, ...ids).all<any>();
  for (const r of rows.results) (out[r.entity_id] ||= []).push({ id: r.id, name: r.name, color: r.color });
  return out;
}

/** ضبط تاقات كيان على القائمة المُمرَّرة (تُهمَل المعرّفات غير الموجودة). */
export async function setTags(env: Env, type: 'file' | 'folder', id: number, tagIds: number[]): Promise<void> {
  await env.DB.prepare('DELETE FROM file_tag_links WHERE entity_type = ? AND entity_id = ?').bind(type, id).run();
  const clean = [...new Set(tagIds.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (!clean.length) return;
  await env.DB.batch(clean.map((t) =>
    env.DB.prepare('INSERT OR IGNORE INTO file_tag_links (tag_id, entity_type, entity_id) VALUES (?, ?, ?)')
      .bind(t, type, id)));
}
