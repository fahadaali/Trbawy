// عامل الخدمة — تخزين هيكل التطبيق للفتح السريع والعمل دون اتصال جزئيًا.
// مهم: لا نُخزّن أي استجابة من /api أبدًا (بيانات حية وحسّاسة).

const CACHE = 'tarbawi-shell-v3';
const SHELL = [
  '/', '/index.html', '/css/styles.css',
  '/js/api.js', '/js/xlsx.js', '/js/ui.js', '/js/app.js',
  '/js/meetings.js', '/js/tasks.js', '/js/evaluations.js', '/js/students.js',
  '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // تجاوز كل ما هو ديناميكي أو حسّاس
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/print/')
      || url.pathname.startsWith('/verify/') || url.pathname.startsWith('/file')) return;

  // الشبكة أولًا مع رجوع للمخزَّن (يضمن أحدث كود عند توفر الاتصال)
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html'))),
  );
});
