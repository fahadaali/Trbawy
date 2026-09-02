// بصمة النشر — المعرّف الذي يتغيّر مع كل نشرة، ويُختم في عامل الخدمة عند تقديمه.
//
// المتصفح لا يرى «تحديثًا» إلا إذا تغيّرت بايتات `sw.js`. وختمُ البصمة في خطّ النشر
// وحده لا يكفي: المنصة قد تُنشر من غيره (ربطُ Cloudflare بالمستودع مباشرةً، أو
// `wrangler deploy` من جهاز)، وحينها يبقى الملف كما هو وتمرّ النشرة بلا أن يُكتشف
// تحديثُها. فتُختم البصمة **عند تقديم الملف** لا عند بنائه، فتعمل من أي طريق نُشرت.
//
// ومصدرها بالترتيب:
//   ١) معرّف نسخة الـWorker من ربط version_metadata — يتغيّر مع كل نشرة بلا استثناء.
//   ٢) بصمةٌ من محتوى ملفات الواجهة نفسها — لا تحتاج ربطًا، وتتغيّر متى تغيّر ملفٌ منها.
//   ٣) وإلا تُترك كما هي، فيبقى السلوك كما كان قبل هذا كله.
import type { Env } from '../types';

// ملفات الواجهة التي يقع فيها التغيير — بصمتُها تكفي للكشف عن نشرةٍ جديدة
const FINGERPRINT_FILES = [
  '/index.html', '/js/app.js', '/js/ui.js', '/js/api.js', '/js/meetings.js',
  '/js/tasks.js', '/js/evaluations.js', '/js/students.js', '/js/files.js',
  '/js/viewer.js', '/js/ai.js', '/js/xlsx.js', '/css/styles.css',
];

let cached: string | null = null;

async function fingerprintOf(env: Env, origin: string): Promise<string | null> {
  const parts: string[] = [];
  for (const path of FINGERPRINT_FILES) {
    try {
      const res = await env.ASSETS.fetch(new Request(origin + path));
      if (!res.ok) continue;
      // الوسم كافٍ ولا يُحمّلنا قراءة الملفات كلها؛ وبلا وسمٍ نأخذ طولَه
      const tag = res.headers.get('etag') || res.headers.get('content-length');
      if (tag) { parts.push(path + '=' + tag); continue; }
      parts.push(path + '#' + (await res.text()).length);
    } catch { /* ملفٌ غير موجود — لا يدخل البصمة */ }
  }
  if (!parts.length) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')));
  return [...new Uint8Array(digest)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** بصمة هذه النشرة — تُحسب مرة واحدة لكل عزلة. */
export async function buildStamp(env: Env, origin: string): Promise<string | null> {
  if (cached) return cached;
  const id = env.CF_VERSION_METADATA?.id;
  if (id) { cached = String(id).replace(/-/g, '').slice(0, 12); return cached; }
  cached = await fingerprintOf(env, origin);
  return cached;
}
