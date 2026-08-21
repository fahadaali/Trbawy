// عامل الخدمة — تخزين هيكل التطبيق للفتح السريع والعمل دون اتصال جزئيًا.
// مهم: لا نُخزّن أي استجابة من /api أبدًا (بيانات حية وحسّاسة).

const CACHE = 'tarbawi-shell-v6';
const SHELL = [
  '/', '/index.html', '/css/styles.css',
  '/js/api.js', '/js/xlsx.js', '/js/ui.js', '/js/ai.js', '/js/app.js',
  '/js/meetings.js', '/js/tasks.js', '/js/evaluations.js', '/js/students.js',
  '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png',
];

// مهلة الشبكة: بعدها نُقدّم النسخة المخزَّنة بدل ترك الصفحة معلّقة.
// (شبكة الجوال قد تتصل ولا تستجيب — والانتظار الصامت يعني تطبيقًا لا يفتح.)
const NET_TIMEOUT = 4000;

self.addEventListener('install', (e) => {
  // كل أصل على حدة: فشل واحد لا يُسقط التخزين كله (addAll ترفض الدفعة بأكملها)
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(SHELL.map((u) => c.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// الصفحة تطلب تفعيل النسخة الجديدة فورًا بعد تنزيلها
self.addEventListener('message', (e) => { if (e.data === 'skip-waiting') self.skipWaiting(); });

function timedFetch(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), NET_TIMEOUT);
    fetch(request).then((r) => { clearTimeout(timer); resolve(r); },
      (err) => { clearTimeout(timer); reject(err); });
  });
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // تجاوز كل ما هو ديناميكي أو حسّاس
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/print/')
      || url.pathname.startsWith('/verify/') || url.pathname.startsWith('/file')) return;

  // الشبكة أولًا (بمهلة) مع رجوع للمخزَّن — يضمن أحدث كود عند توفر الاتصال
  e.respondWith((async () => {
    try {
      const res = await timedFetch(e.request);
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      }
      return res;
    } catch {
      const hit = await caches.match(e.request);
      if (hit) return hit;
      // هيكل التطبيق يصلح بديلًا للتنقّل وحده — لا لملف سكربت أو نمط،
      // فإرجاع HTML مكان JS يكسر الصفحة بصمت.
      if (e.request.mode === 'navigate') {
        const shell = await caches.match('/index.html');
        if (shell) return shell;
      }
      return new Response('غير متصل', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
