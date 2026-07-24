// أنواع مشتركة عبر المنصة

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  APP_NAME: string;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
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
  is_active: number;
}

// سياق الطلب بعد المصادقة
export type Variables = {
  user: User;
  sessionId: string;
};
