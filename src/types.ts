// أنواع مشتركة عبر المنصة

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  APP_NAME: string;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  // إشعارات الدفع (VAPID) — إن لم تُضبط كأسرار وُلِّدت مرة وحُفظت في الإعدادات
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  // Workers AI — قد يكون غير مُهيّأ (تُعطَّل مزايا الذكاء الاصطناعي عندها بلطف)
  AI?: { run: (model: string, input: any) => Promise<any> };
}

export type Role =
  | 'president'         // رئيس المجلس التربوي
  | 'vice_president'    // النائب
  | 'first_supervisor' // المشرف الأول
  | 'team_member'      // عضو الفريق
  | 'system_admin';    // مدير النظام

export type Stage = 'secondary' | 'middle' | null;

export type CouncilType = 'educational' | 'secondary' | 'middle';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  stage: Stage;
  signature_image: string | null;
  must_change_password: number;
  is_active: number;          // 0 = معلَّق
  deleted_at?: string | null; // محذوف أرشيفيًا — لا دخول ولا ظهور في القوائم
}

// سياق الطلب بعد المصادقة
export type Variables = {
  user: User;
  sessionId: string;
};
