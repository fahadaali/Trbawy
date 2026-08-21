// تسليم إشعارات الدفع لأجهزة المستخدمين المشتركة.
// الإشعار داخل المنصة يبقى المصدر الموثوق؛ والدفع أفضل-جهد: أي إخفاق يُتجاوَز
// ولا يُعطّل العملية التي أطلقته.
import type { Env } from '../types';
import { getVapidKeys, sendPush, type PushSubscriptionKeys } from './webpush';

export interface PushMessage {
  title: string;
  body?: string;
  link?: string;      // مسار داخل التطبيق (#/meetings/12)
  type?: string;      // نوع الإشعار — يُستعمل وسمًا يمنع تراكم النسخ
  unread?: number;    // لتحديث شارة أيقونة التطبيق
}

interface SubRow extends PushSubscriptionKeys { id: number; user_id: number }

/**
 * حصيلة محاولة التسليم. الدفع أفضل-جهد لمن لا يعنيه أمره (المُطلِقات العادية
 * تتجاهلها)، لكنه يعني «الإشعار التجريبي» الذي وظيفته كلها أن يقول ما جرى:
 * إعلانُ النجاح دائمًا يترك المستخدم أمام زرّ «لا يحدث عنده شيء».
 */
export interface PushDelivery {
  subscriptions: number;   // أجهزة مسجَّلة وُجدت
  sent: number;            // قبلتها خدمة الدفع
  failed: number;          // رفضتها أو تعذّر الوصول
  gone: number;            // اشتراك منتهٍ حُذف (٤٠٤/٤١٠)
  reason?: 'no-users' | 'no-subscriptions' | 'no-keys' | 'error';
}
const EMPTY = (reason: PushDelivery['reason']): PushDelivery =>
  ({ subscriptions: 0, sent: 0, failed: 0, gone: 0, reason });

/** إرسال إشعار دفع إلى كل أجهزة مجموعة مستخدمين. */
export async function pushToUsers(env: Env, userIds: number[], msg: PushMessage): Promise<PushDelivery> {
  const ids = [...new Set(userIds.filter((n) => Number.isFinite(n)))];
  if (!ids.length) return EMPTY('no-users');
  try {
    // نبدأ بالاشتراكات: بلا جهاز مسجَّل لا داعي لقراءة المفاتيح (أو توليدها) أصلًا
    const placeholders = ids.map(() => '?').join(',');
    const subs = (await env.DB.prepare(
      `SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id IN (${placeholders})`,
    ).bind(...ids).all<SubRow>()).results;
    if (!subs.length) return EMPTY('no-subscriptions');

    const keys = await getVapidKeys(env);
    if (!keys) return { ...EMPTY('no-keys'), subscriptions: subs.length };

    // عدد غير المقروء لكل مستخدم — يُحدِّث شارة أيقونة التطبيق على الشاشة الرئيسية
    const unreadRows = (await env.DB.prepare(
      `SELECT user_id, COUNT(*) AS n FROM notifications
        WHERE user_id IN (${placeholders}) AND is_read = 0 GROUP BY user_id`,
    ).bind(...ids).all<{ user_id: number; n: number }>()).results;
    const unread = new Map(unreadRows.map((r) => [r.user_id, r.n]));

    const results = await Promise.allSettled(subs.map((s) => sendPush(keys, s, {
      title: msg.title,
      body: msg.body || '',
      link: msg.link || '#/notifications',
      type: msg.type || 'general',
      unread: msg.unread ?? unread.get(s.user_id) ?? 0,
    })));

    // تنظيف الاشتراكات الباطلة (جهاز أُزيل التطبيق منه أو انتهت صلاحيته)
    const gone: number[] = [];
    const failed: number[] = [];
    results.forEach((r, i) => {
      if (r.status !== 'fulfilled') { failed.push(subs[i].id); return; }
      if (r.value.gone) gone.push(subs[i].id);
      else if (!r.value.ok) failed.push(subs[i].id);
    });
    const stmts = [];
    if (gone.length) {
      stmts.push(env.DB.prepare(`DELETE FROM push_subscriptions WHERE id IN (${gone.map(() => '?').join(',')})`).bind(...gone));
    }
    if (failed.length) {
      // إخفاق متكرّر (١٠ مرات) = اشتراك ميّت عمليًا
      stmts.push(env.DB.prepare(
        `UPDATE push_subscriptions SET fail_count = fail_count + 1 WHERE id IN (${failed.map(() => '?').join(',')})`,
      ).bind(...failed));
      stmts.push(env.DB.prepare('DELETE FROM push_subscriptions WHERE fail_count >= 10'));
    }
    const okIds = subs.filter((_, i) => results[i].status === 'fulfilled' && (results[i] as any).value.ok).map((s) => s.id);
    if (okIds.length) {
      stmts.push(env.DB.prepare(
        `UPDATE push_subscriptions SET last_used_at = datetime('now'), fail_count = 0
          WHERE id IN (${okIds.map(() => '?').join(',')})`,
      ).bind(...okIds));
    }
    if (stmts.length) await env.DB.batch(stmts);
    return { subscriptions: subs.length, sent: okIds.length, failed: failed.length, gone: gone.length };
  } catch (e) {
    console.error('push notify failed (non-fatal)', e);
    return EMPTY('error');
  }
}
