// إرسال البريد عبر خدمة خارجية (Resend). إن لم يُضبط المفتاح، يُكتفى بالإشعار داخل المنصة.
import type { Env } from '../types';

export async function sendEmail(env: Env, to: string, subject: string, html: string): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false; // غير مُفعّل — إشعار داخل المنصة فقط
  // مهلة قصوى حتى لا يعلّق أي طلب بسبب بطء خدمة البريد.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.MAIL_FROM || 'no-reply@tarbawi.local',
        to: [to],
        subject,
        html: `<div dir="rtl" style="font-family:Tahoma,sans-serif">${html}</div>`,
      }),
      signal: ctl.signal,
    });
    return res.ok;
  } catch (e) {
    console.error('email failed (non-fatal)', e);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
