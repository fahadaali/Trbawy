// الهوية البصرية وإعدادات المنصة + رفع الشعار/العلامة المائية + توقيع المستخدم.
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { audit } from '../lib/audit';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import { canManageUsers } from '../permissions';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', requireAuth, requirePasswordChanged);

export async function getSettings(env: Env) {
  const s = await env.DB.prepare('SELECT * FROM settings WHERE id = 1').first<any>();
  return s || { org_name: 'الإدارة التربوية', header_text: 'منصة المجلس التربوي', footer_text: '', primary_color: '#1f6f54', font_family: 'Tajawal' };
}

// قراءة الإعدادات (لأي مستخدم)
app.get('/', async (c) => c.json({ settings: await getSettings(c.env) }));

// تحديث الهوية البصرية (الرئيس/مدير النظام)
app.patch('/', async (c) => {
  if (!canManageUsers(c.get('user'))) return c.json({ error: 'لا تملك صلاحية' }, 403);
  const b = await c.req.json().catch(() => ({}));
  const cur = await getSettings(c.env);
  const f = {
    org_name: b.org_name ?? cur.org_name,
    header_text: b.header_text ?? cur.header_text,
    footer_text: b.footer_text ?? cur.footer_text,
    primary_color: b.primary_color ?? cur.primary_color,
    font_family: b.font_family ?? cur.font_family,
    // السنة الدراسية الحالية — تُختم على كل محضر ودورة تقييم جديدة
    current_academic_year: (b.current_academic_year ?? cur.current_academic_year) || null,
  };
  await c.env.DB.prepare(
    `INSERT INTO settings (id, org_name, header_text, footer_text, primary_color, font_family, current_academic_year, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET org_name=excluded.org_name, header_text=excluded.header_text,
       footer_text=excluded.footer_text, primary_color=excluded.primary_color,
       font_family=excluded.font_family, current_academic_year=excluded.current_academic_year,
       updated_at=datetime('now')`,
  ).bind(f.org_name, f.header_text, f.footer_text, f.primary_color, f.font_family, f.current_academic_year).run();
  await audit(c.env, { userId: c.get('user').id, action: 'update_settings', entityType: 'settings', entityId: 1, newValue: f });
  return c.json({ ok: true });
});

// رفع الشعار / العلامة المائية (R2)
app.put('/asset/:kind', async (c) => {
  if (!canManageUsers(c.get('user'))) return c.json({ error: 'لا تملك صلاحية' }, 403);
  const kind = c.req.param('kind');
  if (!['logo', 'watermark'].includes(kind)) return c.json({ error: 'نوع غير صالح' }, 400);
  const body = await c.req.arrayBuffer();
  if (!body.byteLength) return c.json({ error: 'الملف فارغ' }, 400);
  const ext = (c.req.query('ext') || 'png').replace(/[^a-z0-9]/gi, '');
  const key = `branding/${kind}.${ext}`;
  await c.env.FILES.put(key, body, { httpMetadata: { contentType: c.req.header('content-type') || 'image/png' } });
  const col = kind === 'logo' ? 'logo_key' : 'watermark_key';
  await c.env.DB.prepare(`UPDATE settings SET ${col} = ? WHERE id = 1`).bind(key).run();
  return c.json({ ok: true, key });
});

// رفع توقيع المستخدم الشخصي
app.put('/my-signature', async (c) => {
  const u = c.get('user');
  const body = await c.req.arrayBuffer();
  if (!body.byteLength) return c.json({ error: 'الملف فارغ' }, 400);
  const key = `signatures/user_${u.id}.png`;
  await c.env.FILES.put(key, body, { httpMetadata: { contentType: c.req.header('content-type') || 'image/png' } });
  await c.env.DB.prepare('UPDATE users SET signature_image = ? WHERE id = ?').bind(key, u.id).run();
  await audit(c.env, { userId: u.id, action: 'upload_signature', entityType: 'user', entityId: u.id });
  return c.json({ ok: true });
});

// عرض توقيعي الحالي (للمستخدم نفسه فقط)
app.get('/my-signature', async (c) => {
  const u = c.get('user');
  const row = await c.env.DB.prepare('SELECT signature_image FROM users WHERE id = ?')
    .bind(u.id).first<{ signature_image: string | null }>();
  if (!row?.signature_image) return c.json({ error: 'لا يوجد توقيع' }, 404);
  const obj = await c.env.FILES.get(row.signature_image);
  if (!obj) return c.json({ error: 'الملف غير موجود' }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(obj.body, { headers });
});

// حذف توقيعي (يعود الختم الافتراضي المُولَّد من الاسم)
app.delete('/my-signature', async (c) => {
  const u = c.get('user');
  const row = await c.env.DB.prepare('SELECT signature_image FROM users WHERE id = ?')
    .bind(u.id).first<{ signature_image: string | null }>();
  if (row?.signature_image) { try { await c.env.FILES.delete(row.signature_image); } catch { /* الملف قد يكون محذوفًا */ } }
  await c.env.DB.prepare('UPDATE users SET signature_image = NULL WHERE id = ?').bind(u.id).run();
  await audit(c.env, { userId: u.id, action: 'delete_signature', entityType: 'user', entityId: u.id });
  return c.json({ ok: true });
});

export default app;

// جلب أصل من R2 (يُستخدم من صفحات الطباعة أيضاً)
export async function serveAsset(env: Env, key: string): Promise<Response> {
  const obj = await env.FILES.get(key);
  if (!obj) return new Response('غير موجود', { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'private, max-age=300');
  return new Response(obj.body, { headers });
}
