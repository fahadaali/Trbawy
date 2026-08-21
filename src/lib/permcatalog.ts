// فهرس صلاحيات المنصة: كل عملية يملك الرئيس أن يستثني فيها حسابًا بعينه.
//
// الفهرس مرجعٌ واحد للخادم والواجهة معًا. وقاعدته: **لا يُعرض في الفهرس إلا ما
// يُفحص فعلًا في الخادم.** خانةٌ تُعرض ولا تُنفَّذ أسوأ من غيابها: تعد بما لا يقع.
// ولذلك تُعلَّم الخانات التي لا عملية لها (`false`) فتظهر «غير متاحة» لا فارغة.

export type PermAction = 'view' | 'add' | 'edit' | 'delete';

export interface PermRow {
  key: string;              // مفتاح الوحدة (meetings…)
  label: string;            // اسمها للعرض
  hint?: string;            // ما يعنيه الاستثناء هنا
  actions: Partial<Record<PermAction, string | false>>;  // نصّ الخانة، أو false = لا عملية
}

export const PERM_ROWS: PermRow[] = [
  {
    key: 'meetings', label: 'المحاضر والدعوات',
    hint: 'النطاق يبقى بحسب مجالس المستخدم ومرحلته. وكاتبُ المحضر المعيَّن يحرّر محضره بحكم تعيينه',
    actions: { view: 'اطلاع', add: 'إنشاء دعوة', edit: 'تحرير المسودة', delete: 'إلغاء المحضر' },
  },
  {
    key: 'actions', label: 'القرارات والتوصيات والمهام',
    hint: 'الحذف غير موجود في المنصة — البند يُلغى بحالته. والمكلَّف يتابع بنده بحكم إسناده إليه',
    actions: { view: 'اطلاع', add: 'إضافة بند', edit: 'تعديل ومتابعة', delete: false },
  },
  {
    key: 'students', label: 'سجل الطلاب',
    hint: 'الطالب لا يُحذف — تتغيّر حالته (منقول · منسحب · متخرج)',
    actions: { view: 'اطلاع', add: 'إضافة واستيراد', edit: 'تعديل ونقل', delete: false },
  },
  {
    key: 'evaluations', label: 'دورات التقييم',
    actions: { view: 'اطلاع على النتائج', add: 'إنشاء دورة', edit: 'التقييم وإدارة الدورة', delete: 'حذف دورة' },
  },
  {
    key: 'criteria', label: 'معايير التقييم وأوزانها',
    actions: { view: 'اطلاع', add: 'إضافة معيار', edit: 'تعديل واستيراد', delete: 'حذف معيار' },
  },
  {
    key: 'users', label: 'المستخدمون والصلاحيات',
    actions: { view: 'اطلاع', add: 'إضافة مستخدم', edit: 'تعديل ونقل وتعليق', delete: 'حذف مستخدم' },
  },
  {
    key: 'councils', label: 'المجالس وأعضاؤها',
    hint: 'المجالس ثابتة لا تُضاف ولا تُحذف — يُعدَّل أعضاؤها وكاتبها وبنودها الثابتة',
    actions: { view: 'اطلاع', add: false, edit: 'الأعضاء والكاتب والبنود الثابتة', delete: false },
  },
  {
    key: 'settings', label: 'الهوية البصرية والإعدادات',
    actions: { view: 'اطلاع', add: false, edit: 'تعديل', delete: false },
  },
  {
    key: 'audit', label: 'سجل التدقيق',
    actions: { view: 'اطلاع', add: false, edit: false, delete: false },
  },
  {
    key: 'backups', label: 'النسخ الاحتياطية',
    hint: 'الاستعادة تُعيد القاعدة إلى لحظة سابقة — أخطرُ ما في المنصة',
    actions: { view: 'اطلاع', add: 'إنشاء نسخة', edit: 'استعادة نسخة', delete: false },
  },
];

/** كل المفاتيح الصالحة، بصيغة `module.action`. */
export const PERM_KEYS: string[] = PERM_ROWS.flatMap((r) =>
  (Object.entries(r.actions) as [PermAction, string | false][])
    .filter(([, v]) => v !== false)
    .map(([a]) => `${r.key}.${a}`));

export const isPermKey = (k: unknown): k is string => typeof k === 'string' && PERM_KEYS.includes(k);
