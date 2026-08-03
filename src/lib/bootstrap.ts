// التهيئة التلقائية عند أول تشغيل: المجالس، المستخدمون العشرة، العضويات،
// البنود الثابتة الافتراضية، وقوالب المعايير. آمنة للتكرار (idempotent).
import type { Env } from '../types';
import { hashPassword } from './crypto';
import { SCHEMA_STATEMENTS } from './schema';
import { runColumnMigrations } from './migrate';

let checkedThisIsolate = false;

export const DEFAULT_PASSWORD = '1234';

// إنشاء الجداول والفهارس ذاتيًا (CREATE ... IF NOT EXISTS) — تُغني عن تطبيق المخطط يدويًا.
// تنفيذ تسلسلي (لا batch): D1 البعيد لا يقبل عدّة عبارات DDL داخل معاملة واحدة.
async function ensureSchema(env: Env): Promise<void> {
  for (const stmt of SCHEMA_STATEMENTS) {
    await env.DB.prepare(stmt).run();
  }
}

export async function ensureBootstrap(env: Env): Promise<void> {
  if (checkedThisIsolate) return;

  // فحص سريع: إن كانت القاعدة مهيّأة ومزروعة، نخرج فورًا بلا أي تكلفة مخطط.
  try {
    const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM councils').first<{ c: number }>();
    if ((row?.c ?? 0) > 0) {
      // القاعدة قائمة — نطبّق ترقيات الأعمدة والجداول الجديدة مرة واحدة لكل isolate.
      await ensureSchema(env);
      await runColumnMigrations(env);
      checkedThisIsolate = true;
      return;
    }
  } catch {
    // جدول المجالس غير موجود بعد — ننشئ المخطط أولًا.
  }

  await ensureSchema(env);
  await runColumnMigrations(env);

  const seeded = await env.DB.prepare('SELECT COUNT(*) AS c FROM councils').first<{ c: number }>();
  if ((seeded?.c ?? 0) === 0) await seed(env);
  checkedThisIsolate = true;
}

async function seed(env: Env): Promise<void> {
  const pw = await hashPassword(DEFAULT_PASSWORD);

  // 1) المجالس
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO councils (id, name, type, number_prefix) VALUES
        (1, 'المجلس التربوي', 'educational', 'تربوي'),
        (2, 'مجلس المرحلة الثانوية', 'secondary', 'ثانوي'),
        (3, 'مجلس المرحلة المتوسطة', 'middle', 'متوسط')`,
    ),
    env.DB.prepare(`UPDATE councils SET parent_id = 1 WHERE id IN (2,3)`),
  ]);

  // 2) المستخدمون (كلمة المرور الافتراضية 1234 مع إلزام التغيير)
  const users: Array<[string, string, string, string | null]> = [
    // name, email, role, stage
    ['رئيس المجلس التربوي', 'fahad2ao@gmail.com', 'president', null],
    ['نائب الرئيس', 'vice@tarbawi.local', 'vice_president', null],
    ['مشرف الثانوي الأول', 'sec.super@tarbawi.local', 'first_supervisor', 'secondary'],
    ['مشرف المتوسط الأول', 'mid.super@tarbawi.local', 'first_supervisor', 'middle'],
    ['عضو فريق الثانوي ١', 'sec.m1@tarbawi.local', 'team_member', 'secondary'],
    ['عضو فريق الثانوي ٢', 'sec.m2@tarbawi.local', 'team_member', 'secondary'],
    ['عضو فريق المتوسط ١', 'mid.m1@tarbawi.local', 'team_member', 'middle'],
    ['عضو فريق المتوسط ٢', 'mid.m2@tarbawi.local', 'team_member', 'middle'],
    ['مدير النظام', 'admin@tarbawi.local', 'system_admin', null],
  ];

  const stmts = users.map(([name, email, role, stage]) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO users (name, email, password_hash, role, stage, must_change_password, is_active)
       VALUES (?, ?, ?, ?, ?, 1, 1)`,
    ).bind(name, email, pw, role, stage),
  );
  await env.DB.batch(stmts);

  // معرّفات المستخدمين حسب البريد
  const idOf = async (email: string) =>
    (await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: number }>())?.id!;

  const president = await idOf('fahad2ao@gmail.com');
  const vice = await idOf('vice@tarbawi.local');
  const secSuper = await idOf('sec.super@tarbawi.local');
  const midSuper = await idOf('mid.super@tarbawi.local');
  const secM1 = await idOf('sec.m1@tarbawi.local');
  const secM2 = await idOf('sec.m2@tarbawi.local');
  const midM1 = await idOf('mid.m1@tarbawi.local');
  const midM2 = await idOf('mid.m2@tarbawi.local');

  // 3) العضويات
  // المجلس التربوي: الرئيس (chair)، النائب، مشرف الثانوي الأول، مشرف المتوسط الأول
  // مجلس الثانوية: مشرف الثانوي (chair) + أعضاء الثانوي
  // مجلس المتوسط: مشرف المتوسط (chair) + أعضاء المتوسط
  const members: Array<[number, number, string]> = [
    [1, president, 'chair'],
    [1, vice, 'member'],
    [1, secSuper, 'member'],
    [1, midSuper, 'member'],
    [2, secSuper, 'chair'],
    [2, secM1, 'member'],
    [2, secM2, 'member'],
    [3, midSuper, 'chair'],
    [3, midM1, 'member'],
    [3, midM2, 'member'],
  ];
  await env.DB.batch(
    members.map(([c, u, pos]) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO council_members (council_id, user_id, position) VALUES (?, ?, ?)`,
      ).bind(c, u, pos),
    ),
  );

  // الكاتب الافتراضي = رئيس/رئيس المجلس
  await env.DB.batch([
    env.DB.prepare(`UPDATE councils SET default_writer_id = ? WHERE id = 1`).bind(president),
    env.DB.prepare(`UPDATE councils SET default_writer_id = ? WHERE id = 2`).bind(secSuper),
    env.DB.prepare(`UPDATE councils SET default_writer_id = ? WHERE id = 3`).bind(midSuper),
  ]);

  // 4) بنود ثابتة افتراضية لكل مجلس
  const fixed = ['التلاوة', 'مراجعة محضر الاجتماع السابق', 'ما يستجد من أعمال'];
  const fixedStmts: D1PreparedStatement[] = [];
  for (const cid of [1, 2, 3]) {
    fixed.forEach((title, i) =>
      fixedStmts.push(
        env.DB.prepare(
          `INSERT INTO fixed_agenda_templates (council_id, title, sort_order, is_active) VALUES (?, ?, ?, 1)`,
        ).bind(cid, title, i),
      ),
    );
  }
  await env.DB.batch(fixedStmts);

  // 5) قوالب معايير مرجعية (cycle_id = NULL) لكل فئة
  const criteria: Array<[string, string, number]> = [
    ['students', 'الالتزام والانضباط', 25],
    ['students', 'التفاعل مع الأنشطة', 25],
    ['students', 'التحصيل والمثابرة', 25],
    ['students', 'السلوك والتعاون', 25],
    ['team_members', 'الأداء المهني', 34],
    ['team_members', 'الالتزام والحضور', 33],
    ['team_members', 'التعاون وروح الفريق', 33],
    ['first_supervisors', 'القيادة والتخطيط', 34],
    ['first_supervisors', 'المتابعة والإنجاز', 33],
    ['first_supervisors', 'التواصل والتطوير', 33],
  ];
  await env.DB.batch(
    criteria.map(([tt, name, w], i) =>
      env.DB.prepare(
        `INSERT INTO eval_criteria (cycle_id, target_type, name, weight, sort_order, is_active)
         VALUES (NULL, ?, ?, ?, ?, 1)`,
      ).bind(tt, name, w, i),
    ),
  );

  // 6) صف الإعدادات
  await env.DB.prepare(
    `INSERT OR IGNORE INTO settings (id, org_name, header_text, footer_text)
     VALUES (1, 'الإدارة التربوية', 'منصة المجلس التربوي', 'وثيقة رسمية — منصة المجلس التربوي')`,
  ).run();

  // 7) فتح فترة الدور الجارية لكل مستخدم (أساس الاطلاع التاريخي عند تغيّر الدور/المرحلة)
  await env.DB.prepare(
    `INSERT INTO user_role_periods (user_id, role, stage, from_at, note)
     SELECT u.id, u.role, u.stage, u.created_at, 'إنشاء الحساب'
       FROM users u
      WHERE NOT EXISTS (SELECT 1 FROM user_role_periods p WHERE p.user_id = u.id)`,
  ).run();
}
