// سجل التدقيق الشامل — يُستدعى عند كل عملية حساسة.
import type { Env } from '../types';

export async function audit(
  env: Env,
  opts: {
    userId?: number | null;
    action: string;
    entityType?: string;
    entityId?: number | null;
    oldValue?: unknown;
    newValue?: unknown;
    ip?: string | null;
  },
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_value, new_value, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        opts.userId ?? null,
        opts.action,
        opts.entityType ?? null,
        opts.entityId ?? null,
        opts.oldValue == null ? null : JSON.stringify(opts.oldValue),
        opts.newValue == null ? null : JSON.stringify(opts.newValue),
        opts.ip ?? null,
      )
      .run();
  } catch (e) {
    // لا نُفشل العملية الأساسية بسبب فشل التدقيق، لكن نسجّل في اللوق.
    console.error('audit failed', e);
  }
}
