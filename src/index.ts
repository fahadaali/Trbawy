// نقطة الدخول للـ Worker — منصة المجلس التربوي.
import { Hono } from 'hono';
import type { Env, Variables } from './types';
import { ensureBootstrap } from './lib/bootstrap';

import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import councilRoutes from './routes/councils';
import meetingRoutes from './routes/meetings';
import auditRoutes from './routes/audit';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// تهيئة تلقائية عند أول تشغيل (المجالس والمستخدمون)
app.use('/api/*', async (c, next) => {
  await ensureBootstrap(c.env);
  await next();
});

// فحص الصحة
app.get('/api/health', (c) => c.json({ ok: true, app: c.env.APP_NAME }));

// المسارات
app.route('/api/auth', authRoutes);
app.route('/api/users', userRoutes);
app.route('/api/councils', councilRoutes);
app.route('/api/meetings', meetingRoutes);
app.route('/api/audit', auditRoutes);

// معالج أخطاء موحّد
app.onError((err, c) => {
  console.error('API error:', err);
  return c.json({ error: 'حدث خطأ داخلي في الخادم' }, 500);
});

// ما عدا /api/* تُقدَّم الواجهة الأمامية عبر الأصول الثابتة (SPA fallback في wrangler.toml)
app.all('*', async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,

  // المهام المجدولة (التذكيرات اليومية) — تُفعَّل في مرحلة الإشعارات.
  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext) {
    await ensureBootstrap(env);
    // TODO (المرحلة ٧): إرسال تذكيرات المهام وإغلاق الدورات.
  },
};
