// عامل الخدمة — تخزين هيكل التطبيق للفتح السريع والعمل دون اتصال جزئيًا.
// مهم: لا نُخزّن أي استجابة من /api أبدًا (بيانات حية وحسّاسة).

const CACHE = 'tarbawi-shell-v10';
const SHELL = [
  '/', '/index.html', '/css/styles.css',
  '/js/api.js', '/js/xlsx.js', '/js/ui.js', '/js/ai.js', '/js/app.js',
  '/js/meetings.js', '/js/tasks.js', '/js/evaluations.js', '/js/students.js',
  '/manifest.webmanifest', '/icons/icon.svg',
  '/icons/icon-192.png?v=2', '/icons/icon-512.png?v=2', '/icons/apple-touch-icon.png?v=2',
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
  // ‎/ics ملفُ موعدٍ يتغيّر بتغيّر الموعد ويحمل جلسة صاحبه — تخزينُه يُسلّم موعدًا قديمًا
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/print/')
      || url.pathname.startsWith('/verify/') || url.pathname.startsWith('/ics/')
      || url.pathname.startsWith('/file')) return;

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

// ============================================================
// إشعارات الدفع
// ============================================================

// حمولة الدفع معمّاة ومقروءة هنا فقط. أي إخفاق في قراءتها لا يمنع عرض إشعار عام،
// فالمتصفح يُلزم عامل الخدمة بإظهار إشعار مرئي لكل رسالة دفع تصله.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'إشعار جديد' }; }
  const title = d.title || 'منصة المجلس التربوي';
  const options = {
    body: d.body || '',
    icon: '/icons/icon-192.png?v=2',
    badge: '/icons/icon-192.png?v=2',
    lang: 'ar',
    dir: 'rtl',
    tag: d.type || 'tarbawi',          // نوع واحد لا يتراكم عشرات المرات
    renotify: true,
    data: { link: d.link || '#/notifications' },
    timestamp: Date.now(),
  };
  e.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    // شارة العدد على أيقونة التطبيق في الشاشة الرئيسية
    if (typeof d.unread === 'number' && 'setAppBadge' in self.navigator) {
      try { d.unread > 0 ? await self.navigator.setAppBadge(d.unread) : await self.navigator.clearAppBadge(); } catch {}
    }
  })());
});

// النقر على الإشعار: نُركّز نافذة مفتوحة إن وُجدت بدل فتح نسخة ثانية
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || '#/notifications';
  const target = new URL('/' + (link.startsWith('#') ? link : '#/' + link), self.location.origin).href;
  e.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientList) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      await client.focus();
      if ('navigate' in client) { try { await client.navigate(target); } catch {} }
      else client.postMessage({ type: 'navigate', link });
      return;
    }
    await self.clients.openWindow(target);
  })());
});

// تدوير مفاتيح الاشتراك من المتصفح: نُعيد تسجيل الاشتراك الجديد بصمت
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    try {
      const appKey = e.oldSubscription && e.oldSubscription.options && e.oldSubscription.options.applicationServerKey;
      const sub = e.newSubscription || await self.registration.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: appKey,
      });
      await fetch('/api/notifications/push/subscribe', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON ? sub.toJSON() : sub),
      });
    } catch (err) { /* يُعاد التسجيل عند فتح التطبيق */ }
  })());
});
