// نقطة الدخول للـ Worker — منصة المجلس التربوي.
import { Hono } from 'hono';
import type { Env, Variables } from './types';
import { ensureBootstrap } from './lib/bootstrap';
import { rememberSiteOrigin } from './lib/webpush';

import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import councilRoutes from './routes/councils';
import meetingRoutes from './routes/meetings';
import actionRoutes from './routes/actions';
import evalRoutes from './routes/evaluations';
import studentRoutes from './routes/students';
import settingsRoutes from './routes/settings';
import notificationRoutes from './routes/notifications';
import dashboardRoutes from './routes/dashboard';
import adminRoutes from './routes/admin';
import auditRoutes from './routes/audit';
import aiRoutes from './routes/ai';
import pageRoutes from './routes/pages';
import { runDailyReminders } from './lib/reminders';
import { createBackup } from './lib/backup';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// تهيئة تلقائية عند أول تشغيل (المجالس والمستخدمون).
// تشمل الصفحات المُخدَّمة من الخادم أيضًا: عزلة جديدة قد يصلها رابط تحقّق مطبوع
// أو رابط طباعة قبل أي طلب واجهة، فتقرأ عمودًا لم تُنشئه ترقيةٌ لم تُشغَّل بعد.
// (الحارس داخل ensureBootstrap يجعل ما بعد المرة الأولى فحصًا لقيمة منطقية.)
const bootstrapFirst = async (c: any, next: any) => {
  // أصل الموقع يُعرَف من الطلب وحده، ورمز VAPID يحتاجه ليُعرّف مالك الخدمة
  rememberSiteOrigin(c.req.url);
  await ensureBootstrap(c.env);
  await next();
};
app.use('/api/*', bootstrapFirst);
app.use('/print/*', bootstrapFirst);
app.use('/verify/*', bootstrapFirst);
app.use('/ics/*', bootstrapFirst);
app.use('/file', bootstrapFirst);

// فحص الصحة
app.get('/api/health', (c) => c.json({ ok: true, app: c.env.APP_NAME }));

// المسارات
app.route('/api/auth', authRoutes);
app.route('/api/users', userRoutes);
app.route('/api/councils', councilRoutes);
app.route('/api/meetings', meetingRoutes);
app.route('/api/actions', actionRoutes);
app.route('/api/eval', evalRoutes);
app.route('/api/students', studentRoutes);
app.route('/api/settings', settingsRoutes);
app.route('/api/notifications', notificationRoutes);
app.route('/api/dashboard', dashboardRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/audit', auditRoutes);
app.route('/api/ai', aiRoutes);

// معالج أخطاء موحّد
app.onError((err, c) => {
  console.error('API error:', err);
  return c.json({ error: 'حدث خطأ داخلي في الخادم' }, 500);
});

// صفحات مُخدَّمة من الخادم: /verify، /print، /file
app.route('/', pageRoutes);

// ما عدا ذلك تُقدَّم الواجهة الأمامية عبر الأصول الثابتة (SPA fallback في wrangler.toml)
app.all('*', async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,

  // المهام المجدولة (التذكيرات اليومية): تذكير المهام قبل ٣ أيام/يوم الاستحقاق/التأخر،
  // وتذكير إغلاق دورات التقييم قبل ٣ أيام لمن لم يكمل.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    await ensureBootstrap(env);
    ctx.waitUntil((async () => {
      await runDailyReminders(env);
      await createBackup(env); // نسخة احتياطية يومية إلى R2
    })());
  },
};
