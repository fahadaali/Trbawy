// التطبيق الرئيسي (SPA) — منصة المجلس التربوي.
// المرحلة ١: المصادقة، الهيكل العربي، إدارة المستخدمين والمجالس، سجل التدقيق.

const State = { user: null, pendingShown: false, aiEnabled: false };
const app = () => document.getElementById('app');

// ============ نقطة البدء ============
async function boot() {
  try {
    const { user } = await API.get('/auth/me');
    State.user = user;
  } catch {
    State.user = null;
  }
  if (State.user) { await applyBranding(); await loadAiStatus(); Push.syncSilently(); }
  window.addEventListener('hashchange', route);
  route();
}

// هل مزايا الذكاء الاصطناعي مُهيّأة على هذا النشر؟ (تُخفى أزرارها عند التعطيل)
async function loadAiStatus() {
  try { State.aiEnabled = !!(await API.get('/ai/status')).enabled; }
  catch { State.aiEnabled = false; }
}

// تطبيق الهوية البصرية (اللون الأساسي والخط) على الواجهة
async function applyBranding(settings) {
  try {
    const s = settings || (await API.get('/settings')).settings;
    if (!s) return;
    State.settings = s;
    const root = document.documentElement;
    if (s.primary_color) {
      root.style.setProperty('--primary', s.primary_color);
      root.style.setProperty('--primary-dark', shadeColor(s.primary_color, -18));
      root.style.setProperty('--primary-light', shadeColor(s.primary_color, 88));
    }
    if (s.font_family) {
      root.style.setProperty('--font', `'${s.font_family}', 'Segoe UI', Tahoma, system-ui, sans-serif`);
      loadWebFont(s.font_family);
    }
  } catch { /* الهوية البصرية غير حرجة — نتجاهل الفشل */ }
}

// تفتيح/تغميق لون hex بنسبة مئوية (موجب = أفتح)
function shadeColor(hex, pct) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
    Math.max(0, Math.min(255, Math.round(pct >= 0 ? v + (255 - v) * (pct / 100) : v * (1 + pct / 100)))));
  return '#' + ch.map((v) => v.toString(16).padStart(2, '0')).join('');
}

// تحميل خط الويب المطلوب مرة واحدة
function loadWebFont(family) {
  const id = 'font-' + family.replace(/\s+/g, '-');
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id; link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;500;700;800&display=swap`;
  document.head.appendChild(link);
}

// ============ التوجيه ============
function route() {
  const u = State.user;
  if (!u) return renderLogin();
  if (u.must_change_password) return renderChangePassword(true);

  // المسار قبل «؟» فقط: التبويبات تمرَّر كاستعلام (#/tasks?perf) وتقرؤه شاشتها بنفسها،
  // فلو دخل الاستعلام في اسم العرض لم يُطابق أي شاشة وسقط كل شيء إلى الرئيسية.
  const hash = location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard';
  const [view, ...rest] = hash.split('/');
  renderShell(view, rest);
}

function nav(path) { location.hash = '#/' + path; }

// ============ تسجيل الدخول ============
function renderLogin() {
  app().innerHTML = `
    <div class="auth-wrap">
      <form class="auth-card" id="loginForm">
        <img class="auth-logo" src="/icons/icon.svg" alt="" />
        <h1>منصة المجلس التربوي</h1>
        <p class="sub">إدارة محاضر الاجتماعات والتقييمات التربوية</p>
        <div id="loginErr"></div>
        <div class="field">
          <label>البريد الإلكتروني</label>
          <input type="email" id="email" autocomplete="username" required dir="ltr" style="text-align:right" />
        </div>
        <div class="field">
          <label>كلمة المرور</label>
          <input type="password" id="password" autocomplete="current-password" required />
        </div>
        <button class="btn btn-block" type="submit">تسجيل الدخول</button>
      </form>
    </div>`;
  document.getElementById('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    document.getElementById('loginErr').innerHTML = '';
    try {
      const { user } = await API.post('/auth/login', {
        email: document.getElementById('email').value,
        password: document.getElementById('password').value,
      });
      State.user = user;
      State.pendingShown = false;
      if (!user.must_change_password) { await applyBranding(); await loadAiStatus(); }
      location.hash = '#/dashboard';
      route();
    } catch (err) {
      document.getElementById('loginErr').innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
      btn.disabled = false;
    }
  };
}

// ============ إلزام تغيير كلمة المرور ============
function renderChangePassword(forced) {
  app().innerHTML = `
    <div class="auth-wrap">
      <form class="auth-card" id="cpForm">
        <div class="auth-logo">${icon('key', 30)}</div>
        <h1>${forced ? 'تغيير كلمة المرور' : 'تحديث كلمة المرور'}</h1>
        <p class="sub">${forced ? 'يجب تغيير كلمة المرور الافتراضية قبل المتابعة' : ''}</p>
        <div id="cpErr"></div>
        ${forced ? '' : `<div class="field"><label>كلمة المرور الحالية</label><input type="password" id="cur" required /></div>`}
        <div class="field">
          <label>كلمة المرور الجديدة</label>
          <input type="password" id="np1" required minlength="6" />
          <div class="hint">٦ أحرف على الأقل</div>
        </div>
        <div class="field">
          <label>تأكيد كلمة المرور</label>
          <input type="password" id="np2" required minlength="6" />
        </div>
        <button class="btn btn-block" type="submit">حفظ</button>
      </form>
    </div>`;
  document.getElementById('cpForm').onsubmit = async (e) => {
    e.preventDefault();
    const np1 = document.getElementById('np1').value;
    const np2 = document.getElementById('np2').value;
    const errBox = document.getElementById('cpErr');
    if (np1 !== np2) { errBox.innerHTML = `<div class="form-error">كلمتا المرور غير متطابقتين</div>`; return; }
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      const body = { new_password: np1 };
      if (!forced) body.current_password = document.getElementById('cur').value;
      await API.post('/auth/change-password', body);
      State.user.must_change_password = 0;
      toast('تم تغيير كلمة المرور بنجاح', 'ok');
      location.hash = '#/dashboard';
      route();
    } catch (err) {
      errBox.innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
      btn.disabled = false;
    }
  };
}

// ============ الهيكل العام ============
const NAV = [
  { group: 'الرئيسية', items: [
    { key: 'dashboard', label: 'الصفحة الرئيسية', ico: 'home', roles: '*' },
  ]},
  { group: 'العمل التربوي', items: [
    { key: 'meetings', label: 'المحاضر', ico: 'meetings', perm: 'meetings.view', roles: ['president','vice_president','first_supervisor','team_member'] },
    { key: 'tasks', label: 'المهام', ico: 'tasks', perm: 'actions.view', roles: ['president','vice_president','first_supervisor','team_member'] },
    { key: 'evaluations', label: 'التقييم', ico: 'evaluations', perm: 'evaluations.view', roles: ['president','vice_president','first_supervisor','team_member'] },
    { key: 'students', label: 'سجل الطلاب', ico: 'students', perm: 'students.view', roles: ['president','vice_president','first_supervisor','team_member'] },
  ]},
  { group: 'الإدارة', items: [
    { key: 'users', label: 'المستخدمون', ico: 'users', perm: 'users.view', roles: ['president','system_admin'] },
    { key: 'councils', label: 'المجالس', ico: 'councils', perm: 'councils.view', roles: ['president','vice_president','first_supervisor','team_member'] },
    { key: 'branding', label: 'الهوية البصرية', ico: 'branding', perm: 'settings.edit', roles: ['president','system_admin'] },
    { key: 'notifications', label: 'الإشعارات', ico: 'bell', roles: '*' },
    { key: 'audit', label: 'سجل التدقيق', ico: 'audit', perm: 'audit.view', roles: ['president','system_admin'] },
    { key: 'backups', label: 'النسخ الاحتياطي', ico: 'backups', perm: 'backups.view', roles: ['president','system_admin'] },
  ]},
];

// وجهةٌ تُعرض إن أباحها الدور، أو أباحها استثناءٌ على هذا الحساب — والاستثناء
// يسبق الدور في الاتجاهين: يفتح ما أغلقه ويغلق ما فتحه.
function canSee(item) {
  const byRole = item.roles === '*' || item.roles.includes(State.user.role);
  if (!item.perm) return byRole;
  const ov = (State.user.perms || {})[item.perm];
  return ov === undefined ? byRole : ov;
}

/** هل يملك المستخدم الحالي هذه العملية؟ (الاستثناء أولًا، وإلا فالأصل المُمرَّر) */
function may(key, base) {
  const ov = (State.user && State.user.perms || {})[key];
  return ov === undefined ? base : ov;
}

// ---- القائمة الجانبية على الجوال (ستارة + قفل تمرير الخلفية) ----
function toggleDrawer(force) {
  const sb = document.getElementById('sidebar');
  const sc = document.getElementById('drawerScrim');
  if (!sb) return;
  const open = force === undefined ? !sb.classList.contains('open') : force;
  sb.classList.toggle('open', open);
  if (sc) sc.classList.toggle('show', open);
  document.body.style.overflow = open ? 'hidden' : '';
}
function closeDrawer() { toggleDrawer(false); }

// ---- شريط التبويب السفلي: أهم أربع وجهات + «المزيد» يفتح القائمة ----
function tabbarHtml(view) {
  const items = NAV.flatMap((g) => g.items).filter(canSee);
  const primary = ['dashboard', 'meetings', 'tasks', 'evaluations', 'students', 'users']
    .map((k) => items.find((i) => i.key === k)).filter(Boolean).slice(0, 4);
  if (!primary.length) return '';
  const short = { dashboard: 'الرئيسية', meetings: 'المحاضر', tasks: 'المهام', evaluations: 'التقييم', students: 'الطلاب', users: 'المستخدمون' };
  return `<nav class="tabbar" aria-label="تنقّل سريع">
    ${primary.map((it) => `<a href="#/${it.key}" class="${view === it.key ? 'active' : ''}">
      ${icon(it.ico, 21)}<span>${short[it.key] || it.label}</span></a>`).join('')}
    <button type="button" id="tabMore" aria-label="المزيد">${icon('menu', 21)}<span>المزيد</span></button>
  </nav>`;
}

function renderShell(view, rest) {
  const u = State.user;
  const navHtml = NAV.map((g) => {
    const items = g.items.filter(canSee);
    if (!items.length) return '';
    return `<div class="nav-group-title">${g.group}</div>` + items.map((it) =>
      `<a href="#/${it.key}" class="${view === it.key ? 'active' : ''}"><span class="ico">${icon(it.ico)}</span>${it.label}</a>`
    ).join('');
  }).join('');

  app().innerHTML = `
    <div class="layout">
      <div class="drawer-scrim" id="drawerScrim"></div>
      <aside class="sidebar" id="sidebar">
        <div class="brand"><img class="mark" src="/icons/icon.svg" alt="" /><div class="name">المجلس التربوي<small>منصة المحاضر والتقييم</small></div></div>
        <nav class="nav">${navHtml}</nav>
        <div class="nav-group-title only-mobile">حسابي</div>
        <div class="nav only-mobile" style="flex:0">
          <a href="#" id="profileBtnM"><span class="ico">${icon('pen', 18)}</span>توقيعي</a>
          <a href="#" id="devicesBtnM"><span class="ico">${icon('key', 18)}</span>أجهزتي</a>
          <a href="#" id="pwBtnM"><span class="ico">${icon('lock', 18)}</span>تغيير كلمة المرور</a>
        </div>
        <div class="userbox">
          <div class="av">${esc(initials(u.name))}</div>
          <div class="meta"><b>${esc(u.name)}</b><span>${esc(ROLE_AR[u.role] || u.role)}${u.stage ? ' — ' + STAGE_AR[u.stage] : ''}</span></div>
          <button class="btn-ghost btn-sm" id="logoutBtn" title="خروج">${icon('logout', 16)}</button>
        </div>
      </aside>
      <div class="main">
        <div class="topbar">
          <button class="menu-toggle" id="menuToggle">${icon('menu', 18)}</button>
          <h2 id="pageTitle"></h2>
          <div class="gsearch">
            <input id="gsInput" placeholder="بحث شامل…" autocomplete="off" />
            <div id="gsResults" class="gsearch-results" style="display:none"></div>
          </div>
          <div class="spacer"></div>
          <div class="bell-wrap">
            <button class="btn-ghost btn-sm" id="bellBtn">${icon('bell', 18)}<span id="notifBadge" class="notif-count" hidden></span></button>
            <div id="notifPanel" class="notif-panel" style="display:none"></div>
          </div>
          <button class="btn-ghost btn-sm only-mobile" id="gsMobileBtn" aria-label="بحث">${icon('search', 18)}</button>
          <button class="btn-ghost btn-sm only-desktop" id="profileBtn">توقيعي</button>
          <button class="btn-ghost btn-sm only-desktop" id="devicesBtn">${icon('key', 16)} أجهزتي</button>
          <button class="btn-ghost btn-sm only-desktop" id="pwBtn">تغيير كلمة المرور</button>
        </div>
        <div class="content" id="content"><div class="spinner"></div></div>
      </div>
      ${tabbarHtml(view)}
    </div>`;

  document.getElementById('logoutBtn').onclick = async () => {
    try { await API.post('/auth/logout'); } catch {}
    State.user = null; State.pendingShown = false; document.querySelectorAll('.pending-pop').forEach((el) => el.remove());
    location.hash = ''; route();
  };
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = (e) => { e.preventDefault(); fn(); }; };
  on('pwBtn', () => renderChangePassword(false));
  on('pwBtnM', () => { closeDrawer(); renderChangePassword(false); });
  on('profileBtn', () => profileSignature());
  on('profileBtnM', () => { closeDrawer(); profileSignature(); });
  on('devicesBtn', () => myDevicesDialog());
  on('devicesBtnM', () => { closeDrawer(); myDevicesDialog(); });
  on('menuToggle', () => toggleDrawer());
  on('drawerScrim', () => closeDrawer());
  on('gsMobileBtn', () => openMobileSearch());
  on('tabMore', () => toggleDrawer());
  // اختيار وجهة من القائمة يغلقها — وإلا بقيت الستارة فوق الصفحة الجديدة
  document.querySelectorAll('#sidebar .nav a[href^="#/"]').forEach((a) => a.addEventListener('click', closeDrawer));
  setupNotifications();
  setupGlobalSearch();
  initMobile();
  PullRefresh.init(refreshCurrentView);

  // تنبيه العناصر المنتظرة — مرة واحدة عند فتح الصفحة/الدخول
  if (!State.pendingShown) { State.pendingShown = true; setTimeout(showPendingPopup, 500); }

  const handler = VIEWS[view] || VIEWS.dashboard;
  State.view = view; State.rest = rest;     // ليعرف سحبُ التحديث ما يُعيد بناءه
  handler(rest);
}

/**
 * إعادة بناء الشاشة الحالية — وهو ما يفعله سحبُ الشاشة للتحديث.
 * نُعيد بناء الشاشة وحدها لا الهيكل: إعادة بناء الهيكل تُغلق ما فُتح وتُعيد ضبط
 * الشريط والتبويب بلا داعٍ. وشارة الإشعارات تُحدَّث معها لأنها أول ما يُنتظر تجدّده.
 */
async function refreshCurrentView() {
  const handler = VIEWS[State.view] || VIEWS.dashboard;
  await Promise.allSettled([
    Promise.resolve().then(() => handler(State.rest || [])),
    refreshNotifBadge(),
  ]);
}

// ---- تنبيه منبثق عائم بالعناصر التي تنتظر المستخدم ----
async function showPendingPopup() {
  let d;
  try { d = await API.get('/dashboard/pending'); } catch { return; }
  const items = [];
  (d.signatures || []).forEach((s) => items.push({ ic: 'pen', bg: '#f8f0da', color: '#b9770e', label: 'محضر بانتظار توقيعك', name: s.title, link: s.link }));
  (d.evaluations || []).forEach((e) => items.push({ ic: 'evaluations', bg: '#e7f2ee', color: 'var(--primary)', label: 'دورة تقييم مفتوحة' + (e.remaining ? ` — متبقٍ ${arNum(e.remaining)}` : ''), name: e.title, link: e.link }));
  (d.tasks || []).forEach((t) => items.push({ ic: 'tasks', bg: '#eef1f0', color: '#556', label: 'مهمة عليك' + (t.due_date ? ` — تستحق ${t.due_date}` : ''), name: t.title, link: t.link }));
  if (!items.length) return;

  document.querySelectorAll('.pending-pop').forEach((el) => el.remove());
  const pop = document.createElement('div');
  pop.className = 'pending-pop';
  pop.innerHTML = `
    <div class="pp-head">${icon('bell', 18)}<b>لديك ${arNum(items.length)} عنصرًا بانتظارك</b><button class="x" aria-label="إغلاق">&times;</button></div>
    <div class="pp-body">${items.map((it, i) => `
      <button class="pp-item" data-i="${i}">
        <span class="ic" style="background:${it.bg};color:${it.color}">${icon(it.ic, 18)}</span>
        <span class="tx"><b>${esc(it.name || '—')}</b><span>${esc(it.label)}</span></span>
        <span class="go">‹</span>
      </button>`).join('')}</div>`;
  document.body.appendChild(pop);
  requestAnimationFrame(() => pop.classList.add('show'));
  // يُغلق بالزر، أو بالنقر خارجه، أو تلقائيًا بعد ١٢ ثانية — حتى لا يحجب محتوى الصفحة
  let autoTimer = null;
  const close = () => {
    clearTimeout(autoTimer);
    document.removeEventListener('mousedown', onOutside, true);
    pop.classList.remove('show');
    setTimeout(() => pop.remove(), 250);
  };
  function onOutside(e) { if (!pop.contains(e.target)) close(); }
  autoTimer = setTimeout(close, 12000);
  setTimeout(() => document.addEventListener('mousedown', onOutside, true), 300);
  pop.querySelector('.x').onclick = close;
  pop.querySelectorAll('.pp-item').forEach((b) => b.onclick = () => { location.hash = items[b.dataset.i].link; close(); });
}

// ---- البحث الشامل ----
function setupGlobalSearch() {
  const inp = document.getElementById('gsInput');
  const box = document.getElementById('gsResults');
  if (!inp) return;
  let timer = null;

  const hide = () => { box.style.display = 'none'; };
  const run = async () => {
    const q = inp.value.trim();
    if (q.length < 2) return hide();
    box.style.display = 'block';
    box.innerHTML = '<div class="spinner" style="margin:18px auto"></div>';
    let d;
    try { d = await API.get('/dashboard/search?q=' + encodeURIComponent(q)); }
    catch { return hide(); }
    const group = (title, items, ic) => items.length ? `
      <div class="gs-group">${esc(title)}</div>
      ${items.map((it) => `<a class="gs-item" href="${esc(it.link)}">
        <span class="gs-ic">${icon(ic, 16)}</span>
        <span class="gs-tx"><b>${esc(it.title)}</b><span>${esc(it.sub || '')}</span></span></a>`).join('')}` : '';
    const html = group('المحاضر', d.meetings, 'meetings')
      + group('القرارات والمهام', d.actions, 'tasks')
      + group('الطلاب', d.students, 'students');
    box.innerHTML = html || '<div class="empty" style="padding:20px">لا نتائج</div>';
    box.querySelectorAll('.gs-item').forEach((a) => a.onclick = () => { hide(); inp.value = ''; });
  };

  inp.oninput = () => { clearTimeout(timer); timer = setTimeout(run, 250); };
  inp.onkeydown = (e) => { if (e.key === 'Escape') { hide(); inp.blur(); } };
  inp.onclick = (e) => e.stopPropagation();
  box.onclick = (e) => e.stopPropagation();
  if (!State.gsBound) {
    State.gsBound = true;
    document.addEventListener('click', () => {
      const b = document.getElementById('gsResults');
      if (b) b.style.display = 'none';
    });
  }
}

// ---- الإشعارات (الجرس) ----
async function refreshNotifBadge() {
  try {
    const { unread } = await API.get('/notifications');
    setAppBadge(unread);                     // شارة أيقونة التطبيق على الشاشة الرئيسية
    const b = document.getElementById('notifBadge');
    if (!b) return;
    b.textContent = unread > 0 ? arNum(unread) : '';
    b.hidden = !(unread > 0);
  } catch {}
}

function setupNotifications() {
  const bell = document.getElementById('bellBtn');
  const panel = document.getElementById('notifPanel');
  if (!bell) return;
  bell.onclick = async (e) => {
    e.stopPropagation();
    if (panel.style.display === 'block') { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    panel.innerHTML = '<div class="spinner" style="margin:20px auto"></div>';
    try {
      const { notifications } = await API.get('/notifications');
      panel.innerHTML = `<div style="padding:10px;border-bottom:1px solid var(--border);display:flex;align-items:center">
          <b style="flex:1">الإشعارات</b><button class="btn-ghost btn-sm" id="markAll">تعليم الكل كمقروء</button></div>
        <div id="pushRow" style="padding:9px 12px;border-bottom:1px solid var(--border);background:#fbfdfc"></div>
        ${notifications.length ? notifications.map((n) => `
          <a href="${esc(n.link || '#')}" data-nid="${n.id}" style="display:block;padding:10px 12px;border-bottom:1px solid #f0f2f1;${n.is_read ? '' : 'background:#f0f7f4'}">
            <b style="font-size:13px">${esc(n.title)}</b>
            <div class="muted" style="font-size:12px">${esc(n.body || '')}</div>
            <div class="muted" style="font-size:11px">${fmtDateTime(n.created_at)}</div></a>`).join('')
          : '<div class="empty" style="padding:24px">لا إشعارات</div>'}`;
      renderPushRow(panel.querySelector('#pushRow'));
      panel.querySelector('#markAll').onclick = async (ev) => { ev.preventDefault(); ev.stopPropagation(); await API.post('/notifications/read-all'); panel.style.display = 'none'; refreshNotifBadge(); };
      panel.querySelectorAll('[data-nid]').forEach((a) => a.onclick = async () => { try { await API.post(`/notifications/${a.dataset.nid}/read`); } catch {} refreshNotifBadge(); });
    } catch (err) { panel.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  };
  // مستمع وحيد يُسجَّل مرة واحدة لعمر الصفحة (setupNotifications تُستدعى عند كل تنقّل)
  if (!State.outsideClickBound) {
    State.outsideClickBound = true;
    document.addEventListener('click', () => {
      const p = document.getElementById('notifPanel');
      if (p) p.style.display = 'none';
    });
  }
  panel.onclick = (e) => e.stopPropagation();
  refreshNotifBadge();
}

// ---- بطاقة إشعارات الأجهزة في شاشة الإشعارات ----
// آخر إخفاق للإشعار التجريبي يبقى معروضًا في البطاقة: التنبيه المنبثق يزول قبل أن
// يُقرأ، والسطر التقني هو ما يُنقل عند طلب المساعدة.
let lastPushFail = null;

async function renderPushCard() {
  const box = document.getElementById('pushBody');
  if (!box) return;
  const st = await Push.state();
  let devices = [];
  try { devices = (await API.get('/notifications/push/devices')).devices; } catch {}

  const banner = {
    on: ['tag-green', 'الإشعارات مفعّلة على هذا الجهاز — ستصلك تنبيهات المحاضر والتوقيعات والمهام حتى والتطبيق مغلق.'],
    off: ['tag-gold', 'الإشعارات غير مفعّلة على هذا الجهاز.'],
    denied: ['tag-red', 'حجبتَ الإشعارات لهذا الموقع. فعّلها من إعدادات المتصفح (إعدادات الموقع ← الإشعارات) ثم أعد المحاولة.'],
    unsupported: ['tag-gray', 'هذا المتصفح لا يدعم إشعارات الدفع.'],
    'ios-install': ['tag-gold', 'على iPhone تصل الإشعارات للتطبيق المضاف إلى الشاشة الرئيسية فقط: افتح قائمة المشاركة في Safari ← «إضافة إلى الشاشة الرئيسية»، ثم افتح التطبيق من الأيقونة وفعّل الإشعارات من هنا.'],
  }[st.state] || ['tag-gray', ''];

  const devRows = devices.map((d) => `<tr>
      <td>${esc(deviceName(d.user_agent))}${d.is_standalone ? ' <span class="tag tag-green">تطبيق مثبَّت</span>' : ''}
        ${st.endpoint === d.endpoint ? ' <span class="tag tag-gold">هذا الجهاز</span>' : ''}</td>
      <td>${fmtDateTime(d.created_at)}</td>
      <td>${d.last_used_at ? fmtDateTime(d.last_used_at) : '<span class="muted">—</span>'}</td>
    </tr>`).join('');

  box.innerHTML = `
    <div class="tag ${banner[0]}" style="display:block;padding:10px;line-height:1.8">${esc(banner[1])}</div>
    <div class="row mt">
      ${st.state === 'on'
        ? `<button class="btn-ghost btn-sm" id="pcOff">إيقاف الإشعارات على هذا الجهاز</button>
           <button class="btn btn-sm" id="pcTest">${icon('bell', 15)} إشعار تجريبي</button>`
        : st.state === 'off' ? `<button class="btn btn-sm" id="pcOn">${icon('bell', 15)} تفعيل الإشعارات على هذا الجهاز</button>` : ''}
    </div>
    ${lastPushFail ? `<div class="tag tag-red" style="display:block;padding:10px;line-height:1.8;margin-top:10px">
        ${esc(lastPushFail.error)}
        ${lastPushFail.detail ? `<div style="font-size:12px;margin-top:6px;opacity:.85;direction:ltr;text-align:left">${esc(lastPushFail.detail)}</div>` : ''}
        ${lastPushFail.code === 'stale' ? '<div class="row mt"><button class="btn btn-sm" id="pcFix">أعِد تسجيل هذا الجهاز</button></div>' : ''}
      </div>` : ''}
    ${devices.length ? `<h4 class="mt" style="font-size:14px">الأجهزة المسجَّلة (${arNum(devices.length)})</h4>
      <table class="tbl"><thead><tr><th>الجهاز</th><th>سُجِّل</th><th>آخر إشعار</th></tr></thead><tbody>${devRows}</tbody></table>`
      : '<p class="muted mt">لا توجد أجهزة مسجَّلة بعد.</p>'}`;

  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on('pcOn', async () => {
    try { await Push.enable(); toast('فُعّلت الإشعارات على هذا الجهاز', 'ok'); } catch (err) { toast(err.message, 'err'); }
    renderPushCard();
  });
  on('pcOff', async () => {
    try { await Push.disable(); toast('أُوقفت الإشعارات على هذا الجهاز', 'ok'); } catch (err) { toast(err.message, 'err'); }
    renderPushCard();
  });
  on('pcTest', async (e) => {
    // حالة انتظار ظاهرة: طلبٌ صامت لثانيتين يبدو كزرّ معطوب
    const btn = e.currentTarget, html = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner spinner-inline"></span> جارٍ الإرسال…';
    try {
      const r = await API.post('/notifications/push/test');
      lastPushFail = null;
      toast(r.sent > 1 ? `أُرسل الإشعار إلى ${arNum(r.sent)} أجهزة — إن لم يصلك خلال ثوانٍ فراجع إعدادات الإشعارات في نظامك`
        : 'أُرسل الإشعار — إن لم يصلك خلال ثوانٍ فراجع إعدادات الإشعارات في نظامك', 'ok');
    } catch (err) {
      toast(err.message, 'err');
      // السبب يبقى في البطاقة بعد ذهاب التنبيه، ومعه زرّ العلاج إن كان التسجيل بطل
      lastPushFail = { error: err.message, detail: err.data && err.data.detail, code: err.data && err.data.code };
    } finally { btn.disabled = false; btn.innerHTML = html; }
    // الاشتراك المنتهي يُحذف في الخادم، وآخر إشعار يتحدّث عند النجاح
    renderPushCard();
  });
  on('pcFix', async (e) => {
    const btn = e.currentTarget, html = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner spinner-inline"></span> جارٍ إعادة التسجيل…';
    try {
      await Push.reregister();
      lastPushFail = null;
      toast('أُعيد تسجيل هذا الجهاز — جرّب «إشعار تجريبي» الآن', 'ok');
    } catch (err) {
      toast(err.message, 'err');
    } finally { btn.disabled = false; btn.innerHTML = html; }
    renderPushCard();
  });
}

// اسم مقروء للجهاز من ترويسة المتصفح
function deviceName(ua) {
  const s = String(ua || '');
  const os = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android'
    : /Mac OS X/.test(s) ? 'Mac' : /Windows/.test(s) ? 'Windows' : /Linux/.test(s) ? 'Linux' : 'جهاز';
  // الترتيب مقصود: ترويسة Edge وOpera تذكران Chrome أيضًا، فالفحص عنهما أولًا
  // وإلا سُمّي كل متصفح مبنيّ على Chromium «Chrome».
  const br = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera'
    : /CriOS|Chrome/.test(s) ? 'Chrome' : /FxiOS|Firefox/.test(s) ? 'Firefox'
      : /Safari/.test(s) ? 'Safari' : '';
  return br ? `${os} · ${br}` : os;
}

// ---- إشعارات هذا الجهاز: سطر مختصر داخل لوحة الجرس ----
async function renderPushRow(box) {
  if (!box) return;
  const st = await Push.state();
  const texts = {
    on: ['إشعارات هذا الجهاز مفعّلة', 'إيقاف'],
    off: ['فعّل إشعارات هذا الجهاز', 'تفعيل'],
    denied: ['الإشعارات محجوبة من إعدادات المتصفح', ''],
    unsupported: ['هذا المتصفح لا يدعم إشعارات الدفع', ''],
    'ios-install': ['على iPhone: أضف المنصة إلى الشاشة الرئيسية لتفعيل الإشعارات', ''],
  };
  const [label, btn] = texts[st.state] || texts.off;
  box.innerHTML = `<div style="display:flex;align-items:center;gap:8px">
      <span style="flex:1;font-size:12.5px;color:${st.state === 'on' ? 'var(--success)' : 'var(--muted)'}">${esc(label)}</span>
      ${btn ? `<button class="btn-ghost btn-sm" id="pushToggle">${btn}</button>` : ''}
    </div>`;
  const t = box.querySelector('#pushToggle');
  if (t) t.onclick = async (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    t.disabled = true;
    try {
      if (st.state === 'on') { await Push.disable(); toast('أُوقفت إشعارات هذا الجهاز', 'ok'); }
      else { await Push.enable(); toast('فُعّلت إشعارات هذا الجهاز', 'ok'); }
    } catch (err) { toast(err.message, 'err'); }
    renderPushRow(box);
  };
}

// عامل الخدمة يطلب فتح رابط الإشعار حين لا يستطيع التنقّل بنفسه
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'navigate' && e.data.link) {
      location.hash = e.data.link.startsWith('#') ? e.data.link : '#/' + e.data.link;
    }
  });
}

function setTitle(t) { const el = document.getElementById('pageTitle'); if (el) el.textContent = t; }
function content() { return document.getElementById('content'); }

// عرض خطأ في منطقة المحتوى (تُستخدم من كل العروض عند فشل الجلب)
function renderError(err) {
  if (err && err.status === 401) { State.user = null; return route(); }
  content().innerHTML = `<div class="card"><div class="empty"><div class="ico">${icon('warning', 42)}</div><p>${esc(err && err.message ? err.message : 'حدث خطأ')}</p></div></div>`;
}

// ============ العروض ============
const VIEWS = {};

// ---- الصفحة الرئيسية ----
VIEWS.dashboard = async () => {
  setTitle('الصفحة الرئيسية');
  const u = State.user;
  content().innerHTML = `
    <div class="card"><div class="card-body">
      <h3 style="margin-bottom:6px">مرحباً، ${esc(u.name)}</h3>
      <p class="muted">${esc(ROLE_AR[u.role] || u.role)}${u.stage ? ' — المرحلة ' + STAGE_AR[u.stage] : ''}</p>
    </div></div>
    <div id="dashCards" class="grid grid-4 mt"><div class="spinner"></div></div>
    <div id="dashUpcoming" class="mt"></div>
    <div id="dashCommit" class="mt"></div>
    <div id="dashRecent" class="mt"></div>`;
  let s;
  try { s = await API.get('/dashboard/summary'); } catch (err) { return renderError(err); }
  // قد يغادر المستخدم الصفحة قبل وصول البيانات
  if (!document.getElementById('dashCards')) return;
  document.getElementById('dashCards').innerHTML = `
    <div class="stat" style="cursor:pointer" onclick="nav('tasks')"><div class="v">${arNum(s.my_tasks)}</div><div class="l">مهامي المفتوحة</div></div>
    <div class="stat" style="cursor:pointer" onclick="nav('meetings')"><div class="v">${arNum(s.awaiting_signature)}</div><div class="l">محاضر بانتظار توقيعي</div></div>
    <div class="stat" style="cursor:pointer" onclick="nav('evaluations')"><div class="v">${arNum(s.open_cycles)}</div><div class="l">دورات تقييم مفتوحة</div></div>
    <div class="stat" style="cursor:pointer" onclick="nav('meetings')"><div class="v">${arNum((s.upcoming_meetings || []).length)}</div><div class="l">اجتماعات قادمة</div></div>`;
  renderUpcoming(s.upcoming_meetings || []);
  renderCommitmentCard();
  document.getElementById('dashRecent').innerHTML = s.recent_meetings.length ? `
    <div class="card"><div class="card-head"><h3>آخر المحاضر</h3></div>
      <table class="tbl"><thead><tr><th>الرقم</th><th>العنوان</th><th>الحالة</th></tr></thead>
      <tbody>${s.recent_meetings.map((m) => `<tr style="cursor:pointer" onclick="nav('meetings/${m.id}')">
        <td dir="ltr" style="text-align:right"><b>${esc(m.display_number)}</b></td><td>${esc(m.title || '—')}</td>
        <td>${statusTag(m.status, MEETING_STATUS_AR, MEETING_STATUS_COLOR)}</td></tr>`).join('')}</tbody></table></div>` : '';
};

/**
 * بطاقة الاجتماعات القادمة — الموعد الذي جُدول في المنصة يُرى قبل أن يأتي،
 * ومعه زرٌّ يضعه في تقويم الجهاز.
 */
function renderUpcoming(list) {
  const box = document.getElementById('dashUpcoming');
  if (!box) return;
  if (!list.length) { box.innerHTML = ''; return; }
  box.innerHTML = `
    <div class="card"><div class="card-head"><h3>الاجتماعات القادمة</h3><div class="spacer"></div>
      <span class="muted" style="font-size:13px">${arCount(list.length, ['اجتماع واحد', 'اجتماعان', 'اجتماعات', 'اجتماعًا'])}</span></div>
      <table class="tbl"><thead><tr><th>اليوم والتاريخ</th><th>الوقت</th><th>الاجتماع</th><th>المكان</th><th>التقويم</th></tr></thead>
      <tbody>${list.map((m, i) => `<tr>
        <td><b>${esc(dayNameAr(m.greg_date))}</b> ${fmtDate(m.greg_date)}</td>
        <td class="nb">${m.start_time ? `${fmtTime(m.start_time)}${m.end_time ? ' — ' + fmtTime(m.end_time) : ''}` : '<span class="muted">غير محدّد</span>'}</td>
        <td style="cursor:pointer" onclick="nav('meetings/${m.id}')">
          <b dir="ltr" style="display:inline-block">${esc(m.display_number)}</b>
          ${m.title ? '<div>' + esc(m.title) + '</div>' : ''}</td>
        <td>${esc(m.location || (m.location_type === 'remote' ? 'عن بُعد' : '—'))}</td>
        <td><button class="btn-ghost btn-sm" data-cal="${i}">${icon('calendar2', 15)} أضِف</button></td>
      </tr>`).join('')}</tbody></table></div>`;
  box.querySelectorAll('[data-cal]').forEach((b) => {
    b.onclick = () => {
      const m = list[Number(b.dataset.cal)];
      Calendar.open(m, COUNCIL_TYPE_AR[m.council_type] || m.council_name);
    };
  });
}

// بطاقة التزامي بالمهام: نسبة الإنجاز ودقة التوقيت والتأخير المسجَّل — مؤشرات
// التقييم نفسها التي تظهر في لوحة «الالتزام والأداء».
async function renderCommitmentCard() {
  const box = document.getElementById('dashCommit');
  if (!box) return;
  let d;
  try { d = await API.get('/actions/stats?user_id=' + State.user.id); } catch { return; }
  if (!document.getElementById('dashCommit')) return;
  const o = d.overall;
  if (!o.total) return;
  const tone = (v) => (v >= 80 ? 'stat-ok' : v >= 50 ? 'stat-warn' : 'stat-bad');
  box.innerHTML = `
    <div class="card"><div class="card-head"><h3>التزامي بالبنود المُسندة إليّ</h3>
      <div class="spacer"></div>
      <button class="btn-ghost btn-sm" onclick="location.hash='#/tasks?perf';VIEWS.tasks()">لوحة الالتزام</button></div>
      <div class="card-body grid grid-4">
        <div class="stat ${tone(o.completion_rate)}"><div class="v">${arNum(o.completion_rate)}٪</div><div class="l">نسبة الإنجاز</div>
          <div class="s">${arNum(o.done)} من ${arNum(o.total)}</div></div>
        <div class="stat ${tone(o.timeliness)}"><div class="v">${arNum(o.timeliness)}٪</div><div class="l">دقة التوقيت</div>
          <div class="s">${arNum(o.on_time)} في الموعد · ${arNum(o.late)} متأخرة</div></div>
        <div class="stat ${o.overdue ? 'stat-bad' : 'stat-ok'}"><div class="v">${arNum(o.overdue)}</div><div class="l">متأخرة الآن</div>
          <div class="s">${arNum(o.stalled)} متعثرة</div></div>
        <div class="stat ${o.delay_max ? 'stat-bad' : 'stat-ok'}"><div class="v">${arNum(o.delay_max)}</div><div class="l">أطول تأخير</div>
          <div class="s">${o.late ? `متوسط ${arNum(o.delay_avg)} يوم على ${arCount(o.late, ['بند واحد', 'بندين', 'بنود', 'بندًا'])}` : 'لا بند أُنجز متأخرًا'}</div></div>
      </div></div>`;
}

// العروض المتخصّصة تُعرَّف في وحداتها:
// VIEWS.meetings → meetings.js | VIEWS.tasks → tasks.js
// VIEWS.evaluations → evaluations.js | VIEWS.students → students.js

// ---- المستخدمون ----
// كل عملية تغيّر وضع المستخدم تمرّ بتقرير أثر يُعرض قبل التنفيذ: ماذا سيحدث،
// ما الموانع، وما الذي يبقى محفوظًا. لا تنفيذ صامت.
const ACCESS_AR = { full: 'اطلاع كامل', legacy: 'اطلاع تاريخي — قراءة فقط', none: 'لا اطلاع' };
const ACCESS_TAG = { full: 'tag-green', legacy: 'tag-gold', none: 'tag-gray' };
const ACTION_AR = {
  suspend: 'تعليق الحساب', reactivate: 'رفع التعليق', delete: 'حذف المستخدم',
  purge: 'حذف نهائي', restore: 'استعادة المستخدم', role_change: 'تغيير الدور أو المرحلة',
};
let USERS_SHOW_DELETED = false;

// لوحة ألوان التمييز — مطابقة لـ PERSON_PALETTE في الخادم (src/lib/people.ts).
// بعيدة عن ألوان الحالة (أخضر منجَز، ذهبي جارٍ، أحمر متأخر) حتى لا يختلط لون
// الشخص بلون حالة البند.
const PERSON_PALETTE = [
  '#2c6e9b', '#7a4fa3', '#b0468a', '#0f766e', '#b45309', '#4d7c0f',
  '#9d174d', '#1e40af', '#6d28d9', '#0e7490', '#7c2d12', '#475569',
];

VIEWS.users = async () => {
  setTitle('المستخدمون والصلاحيات');
  content().innerHTML = '<div class="spinner"></div>';
  let data;
  try { data = await API.get('/users' + (USERS_SHOW_DELETED ? '?include_deleted=1' : '')); }
  catch (err) { return renderError(err); }

  const rows = data.users.map((u) => {
    const state = u.deleted_at
      ? '<span class="tag tag-gray">محذوف</span>'
      : (u.is_active ? '<span class="tag tag-green">نشط</span>' : '<span class="tag tag-gold">معلَّق</span>')
        + (u.must_change_password ? ' <span class="tag tag-gold">لم يغيّر كلمته</span>' : '');
    const acts = u.deleted_at
      ? `<button class="btn-ghost btn-sm" data-restore="${u.id}">استعادة</button>
         <button class="btn-ghost btn-sm" data-purge="${u.id}">حذف نهائي</button>`
      : `<button class="btn-ghost btn-sm" data-edit="${u.id}">تعديل</button>
         <button class="btn-ghost btn-sm" data-reset="${u.id}">إعادة تعيين</button>
         <button class="btn-ghost btn-sm" data-toggle="${u.id}">${u.is_active ? 'تعليق' : 'تفعيل'}</button>
         <button class="btn-ghost btn-sm" data-history="${u.id}">سجل الأدوار</button>
         <button class="btn-ghost btn-sm" data-del="${u.id}">حذف</button>`;
    return `
      <tr${u.deleted_at ? ' style="opacity:.6"' : ''}>
        <td><button class="linky" data-perms="${u.id}" title="صلاحيات هذا الحساب">${personChips([{ n: u.name, c: u.color }])}</button></td>
        <td dir="ltr" style="text-align:right">${esc(u.email)}</td>
        <td>${esc(ROLE_AR[u.role] || u.role)}</td>
        <td>${u.stage ? esc(STAGE_AR[u.stage]) : '—'}</td>
        <td>${state}${u.suspended_reason && !u.deleted_at ? `<div class="muted" style="font-size:12px">${esc(u.suspended_reason)}</div>` : ''}</td>
        <td class="row">${acts}</td>
      </tr>`;
  }).join('');

  content().innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3>المستخدمون (${arNum(data.users.length)})</h3>
        <div class="spacer"></div>
        <label class="muted" style="font-size:13px;display:flex;align-items:center;gap:6px">
          <input type="checkbox" id="showDeleted" ${USERS_SHOW_DELETED ? 'checked' : ''} /> إظهار المحذوفين
        </label>
        <button class="btn btn-sm" id="addUser">+ مستخدم جديد</button>
      </div>
      <table class="tbl">
        <thead><tr><th>الاسم</th><th>البريد</th><th>الدور</th><th>المرحلة</th><th>الحالة</th><th>إجراءات</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  const find = (id) => data.users.find((x) => x.id == id);
  document.getElementById('showDeleted').onchange = (e) => { USERS_SHOW_DELETED = e.target.checked; VIEWS.users(); };
  document.getElementById('addUser').onclick = () => userForm(null, data.users);
  content().querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => userForm(find(b.dataset.edit), data.users));
  content().querySelectorAll('[data-reset]').forEach((b) => b.onclick = () => resetUserPassword(b.dataset.reset));
  content().querySelectorAll('[data-history]').forEach((b) => b.onclick = () => roleHistoryModal(find(b.dataset.history)));
  content().querySelectorAll('[data-toggle]').forEach((b) => {
    const u = find(b.dataset.toggle);
    b.onclick = () => userAction(u, u.is_active ? 'suspend' : 'reactivate');
  });
  content().querySelectorAll('[data-del]').forEach((b) => b.onclick = () => userAction(find(b.dataset.del), 'delete'));
  content().querySelectorAll('[data-restore]').forEach((b) => b.onclick = () => userAction(find(b.dataset.restore), 'restore'));
  content().querySelectorAll('[data-purge]').forEach((b) => b.onclick = () => userAction(find(b.dataset.purge), 'purge'));
  content().querySelectorAll('[data-perms]').forEach((b) => b.onclick = () => permissionsModal(find(b.dataset.perms)));
};

// ---- نافذة صلاحيات حساب ----
//
// الصفوف عمليات المنصة، والأعمدة أفعالها الأربعة. المعروض هو **الحاصل**: أصلُ
// الدور ما لم يُستثنَ. وكل خانة تخالف أصلها تُعلَّم، فيُقرأ الاستثناء بنظرة.
// ولا يُرسل إلى الخادم إلا ما تغيّر، فالحفظ لا يكتب استثناءً لم يقصده أحد.
async function permissionsModal(user) {
  if (!user) return;
  let d;
  try { d = await API.get(`/users/${user.id}/permissions`); } catch (err) { return toast(err.message, 'err'); }
  const ACTS = [['view', 'عرض'], ['add', 'إضافة'], ['edit', 'تعديل'], ['delete', 'حذف']];
  const state = { ...d.effective };            // ما يراه المستخدم الآن
  const cellId = (k) => 'pm_' + k.replace('.', '_');

  const body = `
    <p class="hint" style="margin-bottom:10px">
      استثناءٌ على هذا الحساب وحده — <b>لا يغيّر قواعد الصلاحيات في المنصة</b>.
      الخانة المعلَّمة <span class="tag tag-gold">استثناء</span> تخالف ما يقتضيه الدور
      (${esc(ROLE_AR[d.user.role] || d.user.role)}${d.user.stage ? ' — ' + esc(STAGE_AR[d.user.stage]) : ''}).
      والنطاق يبقى كما هو: مجالس المستخدم ومرحلته وحالة المحضر.
    </p>
    <div class="t-scroll"><table class="tbl perms-tbl"><thead><tr><th>العملية</th>
      ${ACTS.map(([, l]) => `<th class="center">${l}</th>`).join('')}</tr></thead>
      <tbody>${d.rows.map((r) => `<tr>
        <td><b>${esc(r.label)}</b>${r.hint ? `<div class="muted" style="font-size:11.5px">${esc(r.hint)}</div>` : ''}</td>
        ${ACTS.map(([a]) => {
          const label = r.actions[a];
          const k = `${r.key}.${a}`;
          if (label === false || label === undefined) return '<td class="center muted" title="لا توجد هذه العملية في المنصة">—</td>';
          return `<td class="center"><label class="pm-cell" title="${esc(label)}">
            <input type="checkbox" data-k="${k}" ${state[k] ? 'checked' : ''} />
            <span class="pm-flag" id="${cellId(k)}">${state[k] !== d.base[k] ? '<span class="tag tag-gold">استثناء</span>' : ''}</span>
          </label></td>`;
        }).join('')}
      </tr>`).join('')}</tbody></table></div>`;

  const { overlay, close } = openModal({
    title: `صلاحيات: ${user.name}`,
    body,
    buttons: [
      { label: 'حفظ', onClick: async (cl, ov) => {
        // نرسل ما تغيّر فقط: القيمة الجديدة، أو null لإعادة الخانة إلى أصلها
        const payload = {};
        Object.keys(d.effective).forEach((k) => {
          if (state[k] === d.effective[k]) return;
          payload[k] = state[k] === d.base[k] ? null : state[k];
        });
        if (!Object.keys(payload).length) { cl(); return toast('لا تغييرات'); }
        try {
          await API.put(`/users/${user.id}/permissions`, { overrides: payload });
          cl();
          toast('حُفظت صلاحيات الحساب', 'ok');
        } catch (err) { toast(err.message, 'err'); }
      } },
      { label: 'إغلاق', class: 'btn-ghost', onClick: (cl) => cl() },
    ],
  });

  const paint = (k) => {
    const box = overlay.querySelector(`input[data-k="${k}"]`);
    if (box) box.checked = !!state[k];
    const flag = overlay.querySelector('#' + cellId(k));
    if (flag) flag.innerHTML = state[k] !== d.base[k] ? '<span class="tag tag-gold">استثناء</span>' : '';
  };
  overlay.querySelectorAll('input[data-k]').forEach((box) => {
    box.onchange = () => {
      const k = box.dataset.k;
      const [mod, act] = k.split('.');
      state[k] = box.checked;
      // الاطلاع شرط ما بعده: منحُ فعلٍ يمنح العرض معه، ومنعُ العرض يمنع الأفعال
      if (act === 'view' && !box.checked) {
        ['add', 'edit', 'delete'].forEach((a) => {
          const kk = `${mod}.${a}`;
          if (kk in state && state[kk]) { state[kk] = false; paint(kk); }
        });
      } else if (act !== 'view' && box.checked) {
        const kv = `${mod}.view`;
        if (kv in state && !state[kv]) { state[kv] = true; paint(kv); }
      }
      paint(k);
    };
  });
}

// ---- تقرير الأثر ----
function impactHtml(im) {
  const li = (arr, cls) => arr.map((n) => `<li class="${cls}">${esc(n.message || n)}</li>`).join('');

  const councilRows = im.councils.map((c) => `
    <tr>
      <td>${esc(c.name)}</td>
      <td><span class="tag ${ACCESS_TAG[c.access_before]}">${ACCESS_AR[c.access_before]}</span></td>
      <td><span class="tag ${ACCESS_TAG[c.access_after]}">${ACCESS_AR[c.access_after]}</span></td>
      <td>${arNum(c.visible_before)} ← ${arNum(c.visible_after)} من ${arNum(c.meetings_total)}</td>
      <td>${c.is_member ? (c.position === 'chair' ? 'رئيس المجلس' : 'عضو') : '—'}${c.is_default_writer ? ' · كاتب افتراضي' : ''}</td>
    </tr>`).join('');

  const r = im.records;
  const kept = [
    ['محاضر أنشأها', r.meetings_created], ['محاضر كتبها', r.meetings_written],
    ['محاضر اعتمدها', r.meetings_approved], ['محاضر حضرها', r.meetings_attended],
    ['تواقيع', r.signatures], ['بنود أنجزها', r.actions_completed],
    ['تقييمات أعطاها', r.evaluations_given], ['تقييمات تلقّاها', r.evaluations_received],
    ['قيود تدقيق', r.audit_entries],
  ].filter(([, n]) => n > 0);

  return `
    ${im.next ? `<p class="muted">من <b>${esc(ROLE_AR[im.user.role] || im.user.role)}${im.user.stage ? ' — ' + esc(STAGE_AR[im.user.stage]) : ''}</b>
       إلى <b>${esc(ROLE_AR[im.next.role] || im.next.role)}${im.next.stage ? ' — ' + esc(STAGE_AR[im.next.stage]) : ''}</b></p>` : ''}

    ${im.blockers.length ? `<div class="form-error"><b>موانع يجب معالجتها:</b><ul>${li(im.blockers, '')}</ul></div>` : ''}
    ${im.warnings.length ? `<div class="card" style="border-color:var(--gold,#b8860b);padding:10px;margin:8px 0">
        <b>تنبيهات:</b><ul>${li(im.warnings, '')}</ul></div>` : ''}

    <h4 style="margin:12px 0 6px">ما سيحدث</h4>
    <ul>${im.effects.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>

    <h4 style="margin:12px 0 6px">أثر الاطلاع على المجالس</h4>
    <table class="tbl"><thead><tr>
      <th>المجلس</th><th>قبل</th><th>بعد</th><th>محاضر مرئية</th><th>الصفة</th>
    </tr></thead><tbody>${councilRows}</tbody></table>

    ${kept.length ? `<h4 style="margin:12px 0 6px">سجلات تبقى محفوظة باسمه</h4>
      <p class="muted">${kept.map(([l, n]) => `${l}: ${arNum(n)}`).join(' · ')}</p>` : ''}

    ${im.open_actions.length ? `<h4 style="margin:12px 0 6px">بنود مفتوحة مسندة إليه (${arNum(im.open_actions.length)})</h4>
      <ul>${im.open_actions.slice(0, 8).map((a) => `<li>${esc(a.display_number)} — ${esc(a.text)}${a.sole ? ' <span class="tag tag-gold">لا مسؤول غيره</span>' : ''}</li>`).join('')}</ul>` : ''}

    ${im.pending_signatures.length ? `<h4 style="margin:12px 0 6px">محاضر بانتظار توقيعه</h4>
      <ul>${im.pending_signatures.map((m) => `<li>${esc(m.display_number)} — ${esc(m.council_name)}</li>`).join('')}</ul>` : ''}`;
}

async function transferOptions(userId) {
  try {
    const d = await API.get(`/users/${userId}/transfer-candidates`);
    return d.candidates.map((c) => `<option value="${c.id}">${esc(c.name)} — ${esc(ROLE_AR[c.role] || c.role)}${c.stage ? ' (' + esc(STAGE_AR[c.stage]) + ')' : ''}</option>`).join('');
  } catch { return ''; }
}

// يعرض الأثر ثم ينفّذ العملية بعد التأكيد. params لتغيير الدور: {role, stage, name}
async function userAction(user, action, params = {}, preloaded) {
  let im = preloaded;
  if (!im) {
    const qs = new URLSearchParams({ action });
    ['role', 'stage', 'transfer_to'].forEach((k) => { if (params[k]) qs.set(k, params[k]); });
    try { im = (await API.get(`/users/${user.id}/impact?${qs.toString()}`)).impact; }
    catch (err) { return toast(err.message, 'err'); }
  }

  const needsTransfer = ['delete', 'suspend', 'role_change'].includes(action)
    && (im.open_actions.length > 0 || im.chair_of.length > 0);
  const opts = needsTransfer ? await transferOptions(user.id) : '';

  const { close } = openModal({
    title: `${ACTION_AR[action]} — ${user.name}`,
    body: `
      <div id="uaErr"></div>
      ${impactHtml(im)}
      ${needsTransfer ? `<div class="field mt"><label>نقل المهام المفتوحة والرئاسة إلى</label>
        <select id="ua_transfer"><option value="">— بلا نقل —</option>${opts}</select></div>` : ''}
      ${action === 'suspend' ? '<div class="field"><label>سبب التعليق (يُسجَّل في التدقيق)</label><input id="ua_reason" /></div>' : ''}
      ${im.blockers.length ? `<label class="row" style="gap:6px;margin-top:10px">
        <input type="checkbox" id="ua_force" /> <span>أتحمّل مسؤولية التنفيذ رغم الموانع أعلاه (يُسجَّل في التدقيق)</span></label>` : ''}`,
    buttons: [
      { label: 'تنفيذ', class: action === 'purge' || action === 'delete' ? 'btn-danger' : '', onClick: async (cl, ov) => {
        const transferTo = ov.querySelector('#ua_transfer')?.value || null;
        const force = !!ov.querySelector('#ua_force')?.checked;
        const reason = ov.querySelector('#ua_reason')?.value || null;
        try {
          let res;
          if (action === 'role_change') {
            res = await API.patch('/users/' + user.id, {
              name: params.name ?? user.name, role: params.role, stage: params.stage,
              transfer_to: transferTo ? Number(transferTo) : null, force,
            });
          } else if (action === 'suspend') {
            res = await API.patch('/users/' + user.id, {
              is_active: false, suspend_reason: reason,
              transfer_to: transferTo ? Number(transferTo) : null, force,
            });
          } else if (action === 'reactivate') {
            res = await API.patch('/users/' + user.id, { is_active: true });
          } else if (action === 'restore') {
            res = await API.post(`/users/${user.id}/restore`);
          } else {
            const q = new URLSearchParams();
            if (action === 'purge') q.set('purge', '1');
            if (transferTo) q.set('transfer_to', transferTo);
            if (force) q.set('force', '1');
            res = await API.del(`/users/${user.id}?${q.toString()}`);
          }
          cl();
          effectsModal(ACTION_AR[action], res.effects || []);
          VIEWS.users();
        } catch (err) {
          // 409 مع تقرير أثر محدَّث: أعِد فتح النافذة عليه
          if (err.code === 'BLOCKED' && err.data && err.data.impact) {
            cl();
            return userAction(user, action, params, err.data.impact);
          }
          ov.querySelector('#uaErr').innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
        }
      }},
      { label: 'إلغاء', class: 'btn-ghost', onClick: (cl) => cl() },
    ],
  });
  return close;
}

function effectsModal(title, effects) {
  if (!effects.length) return toast('تم التنفيذ', 'ok');
  openModal({
    title: `تم: ${title}`,
    body: `<ul>${effects.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`,
    buttons: [{ label: 'حسناً', onClick: (cl) => cl() }],
  });
}

async function roleHistoryModal(user) {
  let d;
  try { d = await API.get(`/users/${user.id}/role-history`); }
  catch (err) { return toast(err.message, 'err'); }
  const rows = d.periods.map((p) => `
    <tr>
      <td>${esc(ROLE_AR[p.role] || p.role)}</td>
      <td>${p.stage ? esc(STAGE_AR[p.stage]) : '—'}</td>
      <td>${esc(String(p.from_at).slice(0, 10))}</td>
      <td>${p.to_at ? esc(String(p.to_at).slice(0, 10)) : '<span class="tag tag-green">جارية</span>'}</td>
      <td>${esc(p.note || '—')}</td>
    </tr>`).join('');
  openModal({
    title: `سجل الأدوار — ${user.name}`,
    body: `<p class="muted">القاعدة: يرى السجل إن أُنشئ أثناء فترة كان يملك فيها الاطلاع — فلا أرشيف يسبق انضمامه، ولا ينقطع عنه ما رآه بعد انتقاله.</p>
      <table class="tbl"><thead><tr><th>الدور</th><th>المرحلة</th><th>من</th><th>إلى</th><th>ملاحظة</th></tr></thead>
      <tbody>${rows}</tbody></table>`,
    buttons: [{ label: 'إغلاق', onClick: (cl) => cl() }],
  });
}

function userForm(existing, allUsers) {
  const isEdit = !!existing;
  // الألوان المحجوزة لغير هذا المستخدم: نُعلِّمها حتى لا يتكرّر لونان فيضيع
  // الغرض من التمييز السريع.
  const taken = new Set((allUsers || [])
    .filter((u) => !u.deleted_at && (!existing || u.id !== existing.id))
    .map((u) => String(u.color || '').toLowerCase()));
  const roleOpts = Object.entries(ROLE_AR).map(([v, l]) =>
    `<option value="${v}" ${existing && existing.role === v ? 'selected' : ''}>${l}</option>`).join('');
  const body = `
    <div id="ufErr"></div>
    <div class="field"><label>الاسم</label><input id="uf_name" value="${existing ? esc(existing.name) : ''}" /></div>
    <div class="field"><label>البريد الإلكتروني</label>
      <input id="uf_email" type="email" dir="ltr" style="text-align:right" value="${existing ? esc(existing.email) : ''}" ${isEdit ? 'disabled' : ''} /></div>
    <div class="row-2">
      <div class="field"><label>الدور</label><select id="uf_role">${roleOpts}</select></div>
      <div class="field"><label>المرحلة</label>
        <select id="uf_stage">
          <option value="">— لا ينطبق —</option>
          <option value="secondary" ${existing && existing.stage === 'secondary' ? 'selected' : ''}>الثانوية</option>
          <option value="middle" ${existing && existing.stage === 'middle' ? 'selected' : ''}>المتوسطة</option>
        </select></div>
    </div>
    <div class="field"><label>لون التمييز</label>
      <div class="swatches" id="uf_colors">
        ${PERSON_PALETTE.map((c) => `<button type="button" class="swatch${existing && (existing.color || '').toLowerCase() === c ? ' on' : ''}${taken.has(c) ? ' taken' : ''}"
          data-color="${c}" style="background:${c}" title="${taken.has(c) ? 'مستعمل لشخص آخر' : 'لون متاح'}"></button>`).join('')}
      </div>
      <p class="hint">لون ثابت للشخص في كل المحاضر وكل المجالس — يميّز مهامه بلمحة بصر.
        الدائرة المعلَّمة بنقطة لونٌ مستعمل لشخص آخر.</p>
      <div class="mt"><span class="muted" style="font-size:12px">معاينة:</span>
        <span id="uf_preview">${personChips([{ n: existing ? existing.name : 'الاسم', c: existing && existing.color }])}</span></div>
    </div>
    ${isEdit ? '<p class="hint">تغيير الدور أو المرحلة يعرض تقرير أثر قبل التنفيذ. التعليق والحذف من أزرار الصف.</p>'
             : '<p class="hint">سيُنشأ الحساب بكلمة المرور الافتراضية <b>1234</b> مع إلزام التغيير عند أول دخول.</p>'}`;

  const modal = openModal({
    title: isEdit ? 'تعديل مستخدم' : 'مستخدم جديد',
    body,
    buttons: [
      { label: 'حفظ', onClick: async (cl, ov) => {
        const name = ov.querySelector('#uf_name').value.trim();
        const role = ov.querySelector('#uf_role').value;
        const stage = ov.querySelector('#uf_stage').value || null;
        const picked = ov.querySelector('#uf_colors .swatch.on');
        const color = picked ? picked.dataset.color : null;
        try {
          if (!isEdit) {
            await API.post('/users', { name, role, stage, color, email: ov.querySelector('#uf_email').value.trim() });
            cl(); toast('تم الحفظ', 'ok'); VIEWS.users();
            return;
          }
          // اللون يُحفظ أولًا: تغيير الدور يفتح تقرير الأثر ويغادر هذا النموذج
          if (color && color !== (existing.color || '')) await API.patch('/users/' + existing.id, { color });
          if (role !== existing.role || (stage || null) !== (existing.stage || null)) {
            cl();
            return userAction(existing, 'role_change', { role, stage, name });
          }
          await API.patch('/users/' + existing.id, { name });
          cl(); toast('تم الحفظ', 'ok'); VIEWS.users();
        } catch (err) {
          ov.querySelector('#ufErr').innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
        }
      }},
      { label: 'إلغاء', class: 'btn-ghost', onClick: (cl) => cl() },
    ],
  });

  // اختيار اللون: واحد فقط، مع معاينة حيّة للشارة كما ستظهر في المحاضر
  const scope = (modal && modal.overlay) || document;
  const preview = () => {
    const on = scope.querySelector('#uf_colors .swatch.on');
    const nameEl = scope.querySelector('#uf_name');
    scope.querySelector('#uf_preview').innerHTML =
      personChips([{ n: (nameEl && nameEl.value.trim()) || 'الاسم', c: on && on.dataset.color }]);
  };
  scope.querySelectorAll('#uf_colors .swatch').forEach((b) => {
    b.onclick = () => {
      scope.querySelectorAll('#uf_colors .swatch').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      preview();
    };
  });
  const nameInput = scope.querySelector('#uf_name');
  if (nameInput) nameInput.addEventListener('input', preview);
}

function resetUserPassword(id) {
  confirmModal('إعادة تعيين كلمة المرور', 'ستُعاد كلمة المرور إلى الافتراضية (1234) ويُلزَم المستخدم بتغييرها. متابعة؟',
    async () => {
      try { await API.post('/users/' + id + '/reset-password'); toast('تمت إعادة التعيين — كلمة المرور: 1234', 'ok'); }
      catch (err) { toast(err.message, 'err'); }
    });
}

// ---- المجالس ----
VIEWS.councils = async () => {
  setTitle('المجالس');
  content().innerHTML = '<div class="spinner"></div>';
  let data;
  try { data = await API.get('/councils'); }
  catch (err) { return renderError(err); }

  // شبكة فارغة بلا رسالة تعني شاشة بيضاء بلا تفسير — ومدير النظام مثلًا لا عضوية
  // له في أي مجلس فلا يرى شيئًا. نُبيّن السبب بدل الصمت.
  content().innerHTML = data.councils.length
    ? `<div class="grid grid-3">${data.councils.map((c) => `
    <div class="card"><div class="card-body">
      <div class="tag tag-green" style="margin-bottom:10px">${esc(COUNCIL_TYPE_AR[c.type] || c.type)}</div>
      <h3 style="margin-bottom:4px">${esc(c.name)}</h3>
      <p class="muted" style="font-size:13px">بادئة الترقيم: ${esc(c.number_prefix)}</p>
      <button class="btn-ghost btn-sm mt" data-view="${c.id}">التفاصيل والأعضاء</button>
    </div></div>`).join('')}</div>`
    : `<div class="card"><div class="empty"><div class="ico">${icon('councils', 42)}</div>
        <p>لا مجالس ضمن اطلاعك</p>
        <p class="muted" style="font-size:13px">الاطلاع على المجلس يكون بعضويته أو رئاسته.
          ${State.user.role === 'system_admin' ? 'مدير النظام يدير الحسابات والهوية والنسخ الاحتياطي، ولا يطّلع على محتوى المجالس.' : 'راجع رئيس المجلس لإضافتك عضوًا.'}</p>
      </div></div>`;

  content().querySelectorAll('[data-view]').forEach((b) =>
    b.onclick = () => councilDetail(b.dataset.view));
};

async function councilDetail(id) {
  let d;
  try { d = await API.get('/councils/' + id); }
  catch (err) { return toast(err.message, 'err'); }
  // يطابق canAssignWriter/canCreateMeeting في الخادم (بما فيه فحص المرحلة)
  const canAssign = canCreateForCouncil(d.council);

  const canManageMembers = State.user.role === 'president';
  let allUsers = [];
  if (canManageMembers) { try { allUsers = (await API.get('/users')).users; } catch {} }
  const memberIds = new Set(d.members.map((m) => m.user_id));
  const addableUsers = allUsers.filter((u) => u.is_active && !memberIds.has(u.id));

  const memberRows = d.members.map((m) => `
    <tr><td><b>${esc(m.name)}</b></td><td>${esc(ROLE_AR[m.role] || m.role)}</td>
    <td>${m.position === 'chair' ? '<span class="tag tag-gold">رئيس المجلس</span>' : 'عضو'}
        ${d.council.default_writer_id === m.user_id ? '<span class="tag tag-green">كاتب افتراضي</span>' : ''}</td>
    <td>${canManageMembers ? `<button class="btn-ghost btn-sm" data-delmem="${m.user_id}">إزالة</button>` : ''}</td></tr>`).join('');

  const addMemberHtml = canManageMembers ? `
    <div class="row mt">
      <select id="cd_newmem" style="flex:1;padding:8px 11px;border:1px solid var(--border);border-radius:8px">
        <option value="">— اختر مستخدمًا —</option>${addableUsers.map((u) => `<option value="${u.id}">${esc(u.name)} (${esc(ROLE_AR[u.role] || u.role)})</option>`).join('')}</select>
      <select id="cd_newpos" style="padding:8px 11px;border:1px solid var(--border);border-radius:8px"><option value="member">عضو</option><option value="chair">رئيس المجلس</option></select>
      <button class="btn btn-sm" id="cd_addmem">إضافة عضو</button>
    </div>` : '';

  const writerOpts = d.members.map((m) =>
    `<option value="${m.user_id}" ${d.council.default_writer_id === m.user_id ? 'selected' : ''}>${esc(m.name)}</option>`).join('');

  const fixedRows = d.fixed_items.map((f) =>
    `<li>${esc(f.title)} ${canAssign ? `<button class="btn-ghost btn-sm" data-delfix="${f.id}">حذف</button>` : ''}</li>`).join('');

  openModal({
    title: d.council.name,
    body: `
      <h4 style="margin-bottom:8px">الأعضاء</h4>
      <table class="tbl"><thead><tr><th>الاسم</th><th>الدور</th><th>الصفة</th><th></th></tr></thead><tbody>${memberRows}</tbody></table>
      ${addMemberHtml}
      ${canAssign ? `
      <div class="field mt"><label>الكاتب الافتراضي للمحاضر</label>
        <select id="cd_writer"><option value="">— بدون —</option>${writerOpts}</select>
        <div class="hint">كاتب المحضر يحرّر المسودة فقط ولا يعتمد.</div>
      </div>` : ''}
      <h4 class="mt" style="margin-bottom:8px">البنود الثابتة</h4>
      <ul style="padding-inline-start:18px;line-height:2">${fixedRows || '<li class="muted">لا توجد بنود</li>'}</ul>
      ${canAssign ? `<div class="row mt"><input id="cd_fix" placeholder="بند ثابت جديد" style="flex:1;padding:9px 12px;border:1px solid var(--border);border-radius:8px" />
        <button class="btn btn-sm" id="cd_addfix">إضافة</button></div>` : ''}`,
    buttons: canAssign ? [
      { label: 'حفظ الكاتب', onClick: async (cl, ov) => {
        try {
          await API.put('/councils/' + id + '/default-writer', { writer_id: ov.querySelector('#cd_writer').value ? Number(ov.querySelector('#cd_writer').value) : null });
          cl(); toast('تم حفظ الكاتب الافتراضي', 'ok');
        } catch (err) { toast(err.message, 'err'); }
      }},
      { label: 'إغلاق', class: 'btn-ghost', onClick: (cl) => cl() },
    ] : [{ label: 'إغلاق', class: 'btn-ghost', onClick: (cl) => cl() }],
  });

  if (canAssign) {
    const addFix = document.getElementById('cd_addfix');
    if (addFix) addFix.onclick = async () => {
      const title = document.getElementById('cd_fix').value.trim();
      if (!title) return;
      try { await API.post('/councils/' + id + '/fixed-items', { title }); document.querySelector('.modal-overlay').remove(); councilDetail(id); }
      catch (err) { toast(err.message, 'err'); }
    };
    document.querySelectorAll('[data-delfix]').forEach((b) =>
      b.onclick = async () => {
        try { await API.del('/councils/' + id + '/fixed-items/' + b.dataset.delfix); document.querySelector('.modal-overlay').remove(); councilDetail(id); }
        catch (err) { toast(err.message, 'err'); }
      });
  }

  if (canManageMembers) {
    const addMem = document.getElementById('cd_addmem');
    if (addMem) addMem.onclick = async () => {
      const uid = document.getElementById('cd_newmem').value;
      if (!uid) return toast('اختر مستخدمًا', 'err');
      try { await API.post('/councils/' + id + '/members', { user_id: Number(uid), position: document.getElementById('cd_newpos').value }); document.querySelector('.modal-overlay').remove(); councilDetail(id); }
      catch (err) { toast(err.message, 'err'); }
    };
    document.querySelectorAll('[data-delmem]').forEach((b) =>
      b.onclick = async () => {
        try { await API.del('/councils/' + id + '/members/' + b.dataset.delmem); document.querySelector('.modal-overlay').remove(); councilDetail(id); }
        catch (err) { toast(err.message, 'err'); }
      });
  }
}

// ---- شاشة الإشعارات الكاملة ----
const NOTIF_TYPE_AR = {
  '': 'كل الأنواع', meeting_invitation: 'دعوة اجتماع', meeting_rescheduled: 'تغيير موعد',
  meeting_tomorrow: 'اجتماع غدًا', meeting_today: 'اجتماع اليوم', awaiting_signature: 'بانتظار توقيع',
  meeting_approved: 'اعتماد محضر', action_assigned: 'إسناد مهمة', task_due_3: 'تذكير قبل ٣ أيام',
  task_due_today: 'تستحق اليوم', task_overdue: 'مهمة متأخرة', task_overdue_chair: 'تأخر في مجلسك',
  cycle_open: 'فتح دورة', cycle_closing: 'اقتراب إغلاق دورة', results_published: 'نشر نتائج',
};
let notifOffset = 0;

VIEWS.notifications = async () => {
  setTitle('الإشعارات');
  notifOffset = 0;
  content().innerHTML = `
    <div class="card" id="pushCard"><div class="card-head"><h3>${icon('bell', 17)} إشعارات الأجهزة</h3></div>
      <div class="card-body" id="pushBody"><div class="spinner"></div></div></div>
    <div class="card mt"><div class="card-head"><h3>الإشعارات</h3><div class="spacer"></div>
      <select id="nfType" style="padding:8px 11px;border:1px solid var(--border);border-radius:8px">
        ${Object.entries(NOTIF_TYPE_AR).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <label class="check-inline"><input type="checkbox" id="nfUnread" /> غير المقروء فقط</label>
      <button class="btn-ghost btn-sm" id="nfApply">تصفية</button>
      <button class="btn-ghost btn-sm" id="nfReadAll">تعليم الكل كمقروء</button></div>
      <div id="nfList" class="card-body"></div>
      <div class="card-body center"><button class="btn-ghost btn-sm" id="nfMore">تحميل المزيد</button></div>
    </div>`;

  renderPushCard();

  const load = async (reset) => {
    if (reset) { notifOffset = 0; document.getElementById('nfList').innerHTML = ''; }
    const p = new URLSearchParams({ limit: '30', offset: String(notifOffset) });
    if (document.getElementById('nfType').value) p.set('type', document.getElementById('nfType').value);
    if (document.getElementById('nfUnread').checked) p.set('unread', '1');
    let d;
    try { d = await API.get('/notifications?' + p.toString()); } catch (err) { return renderError(err); }
    const html = d.notifications.map((n) => `
      <a href="${esc(n.link || '#')}" data-nid="${n.id}" style="display:flex;gap:12px;align-items:flex-start;padding:12px;border-bottom:1px solid #f0f2f1;${n.is_read ? '' : 'background:#f0f7f4'}">
        <span style="flex:1">
          <b style="font-size:14px">${esc(n.title)}</b>
          <div class="muted" style="font-size:13px">${esc(n.body || '')}</div>
          <div class="muted" style="font-size:11px">${esc(NOTIF_TYPE_AR[n.type] || n.type)} · ${fmtDateTime(n.created_at)}</div>
        </span>${n.is_read ? '' : '<span class="tag tag-green">جديد</span>'}</a>`).join('');
    document.getElementById('nfList').insertAdjacentHTML('beforeend',
      html || (notifOffset === 0 ? '<div class="empty"><div class="ico">' + icon('bell', 42) + '</div><p>لا إشعارات</p></div>' : ''));
    notifOffset += d.notifications.length;
    document.getElementById('nfMore').style.display = d.notifications.length < 30 ? 'none' : 'inline-flex';
    document.querySelectorAll('#nfList [data-nid]').forEach((a) => a.onclick = async () => {
      try { await API.post(`/notifications/${a.dataset.nid}/read`); } catch {} refreshNotifBadge();
    });
  };
  document.getElementById('nfApply').onclick = () => load(true);
  document.getElementById('nfMore').onclick = () => load(false);
  document.getElementById('nfReadAll').onclick = async () => {
    try { await API.post('/notifications/read-all'); toast('تم', 'ok'); refreshNotifBadge(); load(true); }
    catch (err) { toast(err.message, 'err'); }
  };
  load(true);
};

// ---- سجل التدقيق ----
const AUDIT_ENTITIES = { '': 'كل الكيانات', meeting: 'محضر', action_item: 'قرار/مهمة', evaluation: 'تقييم', eval_cycle: 'دورة تقييم', student: 'طالب', user: 'مستخدم', council: 'مجلس', settings: 'الإعدادات', backup: 'نسخة احتياطية' };
let auditOffset = 0;

VIEWS.audit = async () => {
  setTitle('سجل التدقيق');
  auditOffset = 0;
  content().innerHTML = `
    <div class="card"><div class="card-head"><h3>سجل التدقيق</h3><div class="spacer"></div>
      <select id="auEntity" style="padding:8px 11px;border:1px solid var(--border);border-radius:8px">${Object.entries(AUDIT_ENTITIES).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <input id="auAction" placeholder="نوع العملية (مثل: approve_meeting)" dir="ltr" style="width:230px;text-align:right;padding:8px 11px;border:1px solid var(--border);border-radius:8px" />
      <button class="btn-ghost btn-sm" id="auApply">تصفية</button></div>
      <table class="tbl"><thead><tr><th>الوقت</th><th>المستخدم</th><th>العملية</th><th>الكيان</th><th>IP</th><th></th></tr></thead>
        <tbody id="auBody"></tbody></table>
      <div class="card-body center"><button class="btn-ghost btn-sm" id="auMore">تحميل المزيد</button></div>
    </div>`;
  const load = async (reset) => {
    if (reset) { auditOffset = 0; document.getElementById('auBody').innerHTML = ''; }
    const ent = document.getElementById('auEntity').value;
    const act = document.getElementById('auAction').value.trim();
    let data;
    try { data = await API.get(`/audit?limit=50&offset=${auditOffset}${ent ? '&entity_type=' + ent : ''}${act ? '&action=' + encodeURIComponent(act) : ''}`); }
    catch (err) { return renderError(err); }
    const rows = data.entries.map((e) => `<tr>
      <td>${fmtDateTime(e.timestamp)}</td><td>${esc(e.user_name || '—')}</td>
      <td><span class="tag tag-gray">${esc(e.action)}</span></td>
      <td>${esc(AUDIT_ENTITIES[e.entity_type] || e.entity_type || '')} ${e.entity_id ? '#' + arNum(e.entity_id) : ''}</td>
      <td dir="ltr" style="text-align:right" class="muted">${esc(e.ip || '—')}</td>
      <td>${(e.old_value || e.new_value) ? `<button class="btn-ghost btn-sm" data-det='${encodeURIComponent(JSON.stringify({ o: e.old_value, n: e.new_value }))}'>تفاصيل</button>` : ''}</td>
    </tr>`).join('');
    document.getElementById('auBody').insertAdjacentHTML('beforeend', rows || (auditOffset === 0 ? '<tr><td colspan="6" class="center muted">لا سجلات</td></tr>' : ''));
    auditOffset += data.entries.length;
    document.getElementById('auMore').style.display = data.entries.length < 50 ? 'none' : 'inline-flex';
    document.querySelectorAll('#auBody [data-det]').forEach((b) => b.onclick = () => {
      const d = JSON.parse(decodeURIComponent(b.dataset.det));
      openModal({ title: 'تفاصيل العملية', body: `<h4>قبل</h4><pre style="background:#f4f6f5;padding:10px;border-radius:8px;overflow:auto;direction:ltr;font-size:12px">${esc(d.o || '—')}</pre><h4 class="mt">بعد</h4><pre style="background:#f4f6f5;padding:10px;border-radius:8px;overflow:auto;direction:ltr;font-size:12px">${esc(d.n || '—')}</pre>`, buttons: [{ label: 'إغلاق', class: 'btn-ghost', onClick: (cl) => cl() }] });
    });
  };
  document.getElementById('auApply').onclick = () => load(true);
  onEnter('auAction', () => load(true));
  document.getElementById('auMore').onclick = () => load(false);
  load(true);
};

// ---- النسخ الاحتياطي ----
VIEWS.backups = async () => {
  setTitle('النسخ الاحتياطي');
  content().innerHTML = '<div class="spinner"></div>';
  let data;
  try { data = await API.get('/admin/backups'); } catch (err) { return renderError(err); }
  content().innerHTML = `
    <div class="card"><div class="card-head"><h3>النسخ الاحتياطية</h3><div class="spacer"></div>
      <button class="btn btn-sm" id="bkNow">إنشاء نسخة الآن</button></div>
    <div class="card-body">
      <p class="muted">تُنشأ نسخة احتياطية تلقائية يومياً وتُخزَّن في R2. يمكن إنشاء نسخة يدوية وتنزيلها.</p>
      <table class="tbl mt"><thead><tr><th>الملف</th><th>الحجم</th><th>التاريخ</th><th></th></tr></thead>
        <tbody>${data.backups.map((b) => `<tr><td dir="ltr" style="text-align:right">${esc(b.key.split('/').pop())}</td>
          <td>${arNum((b.size / 1024).toFixed(1))} ك.ب</td><td>${fmtDateTime(b.uploaded)}</td>
          <td><a class="btn-ghost btn-sm" href="/api/admin/backups/download?key=${encodeURIComponent(b.key)}">تنزيل</a>
            ${isSysAdmin() ? `<button class="btn-danger btn-sm" data-restore="${esc(b.key)}">استعادة</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="center muted">لا نسخ بعد</td></tr>'}</tbody></table>
      ${isSysAdmin() ? '<p class="hint mt">الاستعادة تستبدل كل البيانات الحالية بمحتوى النسخة، وتُنشئ نسخة وقائية تلقائياً قبل التنفيذ.</p>' : ''}
    </div></div>

    <div class="card mt"><div class="card-head"><h3>${icon('key', 16)} الجلسات النشطة</h3><div class="spacer"></div>
      <button class="btn-ghost btn-sm" id="sesReload">تحديث</button></div>
      <div class="card-body"><div id="sesBox"><div class="spinner"></div></div></div></div>`;

  document.getElementById('bkNow').onclick = async () => {
    try { await API.post('/admin/backups'); toast('تم إنشاء النسخة', 'ok'); VIEWS.backups(); } catch (err) { toast(err.message, 'err'); }
  };
  content().querySelectorAll('[data-restore]').forEach((b) => b.onclick = () => restoreBackupDialog(b.dataset.restore));
  document.getElementById('sesReload').onclick = loadSessions;
  loadSessions();
};

const isSysAdmin = () => State.user && State.user.role === 'system_admin';

// جدول الجلسات النشطة مع الإنهاء عن بُعد
async function loadSessions() {
  const box = document.getElementById('sesBox');
  if (!box) return;
  box.innerHTML = '<div class="spinner"></div>';
  let data;
  try { data = await API.get('/admin/sessions'); }
  catch (err) { box.innerHTML = `<div class="form-error">${esc(err.message)}</div>`; return; }
  box.innerHTML = `<p class="muted">تنتهي الجلسة تلقائياً بعد ٨ ساعات خمول. يمكنك إنهاء أي جلسة فوراً.</p>
    <table class="tbl mt"><thead><tr><th>المستخدم</th><th>آخر نشاط</th><th>البداية</th><th>العنوان</th><th>الجهاز</th><th></th></tr></thead>
      <tbody>${data.sessions.map((x) => `<tr>
        <td><b>${esc(x.user_name)}</b>${x.is_current ? ' <span class="tag tag-green">جلستك</span>' : ''}</td>
        <td>${fmtDateTime(x.last_active)}</td><td>${fmtDateTime(x.created_at)}</td>
        <td dir="ltr" style="text-align:right">${esc(x.ip || '—')}</td>
        <td class="muted" style="font-size:12px">${esc(shortUa(x.user_agent))}</td>
        <td>${x.is_current ? '' : `<button class="btn-danger btn-sm" data-kill="${esc(x.id)}">إنهاء</button>`}</td></tr>`).join('')
        || '<tr><td colspan="6" class="center muted">لا جلسات</td></tr>'}</tbody></table>`;
  box.querySelectorAll('[data-kill]').forEach((b) => b.onclick = () =>
    confirmModal('إنهاء الجلسة', 'سيُسجَّل خروج هذا المستخدم فوراً من الجهاز المحدَّد. متابعة؟', async () => {
      try { await API.del('/admin/sessions/' + encodeURIComponent(b.dataset.kill)); toast('أُنهيت الجلسة', 'ok'); loadSessions(); }
      catch (err) { toast(err.message, 'err'); }
    }, { danger: true }));
}

// اسم مختصر للمتصفح/النظام من ترويسة user-agent
function shortUa(ua) {
  if (!ua) return '—';
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iOS/i.test(ua) ? 'iOS'
    : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : '';
  const br = /Edg\//i.test(ua) ? 'Edge' : /OPR\//i.test(ua) ? 'Opera' : /Chrome\//i.test(ua) ? 'Chrome'
    : /Firefox\//i.test(ua) ? 'Firefox' : /Safari\//i.test(ua) ? 'Safari' : '';
  // تعذّر التعرّف (أداة سطر أوامر مثلاً): نعرض الترويسة مختصرة كما هي
  if (!br && !os) return ua.length > 34 ? ua.slice(0, 34) + '…' : ua;
  return [br, os].filter(Boolean).join(' — ');
}

// حوار استعادة نسخة احتياطية (تأكيد نصّي صريح)
function restoreBackupDialog(key) {
  const { overlay } = openModal({
    title: 'استعادة نسخة احتياطية',
    body: `<div class="form-error">تحذير: ستُستبدل <b>كل</b> البيانات الحالية بمحتوى النسخة
        <span dir="ltr">${esc(key.split('/').pop())}</span>. تُنشأ نسخة وقائية تلقائياً قبل التنفيذ.</div>
      <div id="rbErr"></div>
      <div class="field"><label>اكتب كلمة «استعادة» للتأكيد</label><input id="rb_confirm" placeholder="استعادة" /></div>`,
    buttons: [
      { label: 'تنفيذ الاستعادة', class: 'btn-danger', onClick: async (cl, ov) => {
        const btn = ov.querySelector('[data-i="0"]');
        btn.disabled = true; btn.textContent = 'جارٍ التنفيذ…';
        try {
          const res = await API.post('/admin/backups/restore', { key, confirm: ov.querySelector('#rb_confirm').value.trim() });
          const total = res.report.reduce((a, r) => a + r.rows, 0);
          cl(); toast(`اكتملت الاستعادة — ${arNum(total)} صف`, 'ok');
          VIEWS.backups();
        } catch (err) {
          btn.disabled = false; btn.textContent = 'تنفيذ الاستعادة';
          ov.querySelector('#rbErr').innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
        }
      }},
      { label: 'إلغاء', class: 'btn-ghost', onClick: (cl) => cl() },
    ],
  });
  overlay.querySelector('#rb_confirm').focus();
}

// ---- أجهزتي: الجلسات النشطة للحساب الحالي ----
function myDevicesDialog() {
  const { overlay } = openModal({
    title: 'أجهزتي — الجلسات النشطة',
    body: `<p class="muted">هذه الأجهزة مسجَّلة الدخول بحسابك الآن. تنتهي أي جلسة تلقائياً بعد ٨ ساعات خمول.</p>
      <div id="mdErr"></div><div id="mdBox"><div class="spinner"></div></div>
      <button class="btn-ghost btn-sm mt" id="md_all">إنهاء كل الجلسات الأخرى</button>`,
    buttons: [{ label: 'إغلاق', class: 'btn-ghost', onClick: (cl) => cl() }],
  });
  const err = (m) => overlay.querySelector('#mdErr').innerHTML = m ? `<div class="form-error">${esc(m)}</div>` : '';

  const load = async () => {
    const box = overlay.querySelector('#mdBox');
    box.innerHTML = '<div class="spinner"></div>';
    try {
      const { sessions } = await API.get('/auth/sessions');
      box.innerHTML = `<table class="tbl"><thead><tr><th>الجهاز</th><th>آخر نشاط</th><th>العنوان</th><th></th></tr></thead>
        <tbody>${sessions.map((x) => `<tr>
          <td>${esc(shortUa(x.user_agent))}${x.is_current ? ' <span class="tag tag-green">هذا الجهاز</span>' : ''}</td>
          <td>${fmtDateTime(x.last_active)}</td>
          <td dir="ltr" style="text-align:right">${esc(x.ip || '—')}</td>
          <td>${x.is_current ? '' : `<button class="btn-danger btn-sm" data-md="${esc(x.id)}">إنهاء</button>`}</td></tr>`).join('')}
        </tbody></table>`;
      box.querySelectorAll('[data-md]').forEach((b) => b.onclick = async () => {
        try { await API.del('/auth/sessions/' + encodeURIComponent(b.dataset.md)); toast('أُنهيت الجلسة', 'ok'); load(); }
        catch (ex) { err(ex.message); }
      });
    } catch (ex) { box.innerHTML = `<div class="form-error">${esc(ex.message)}</div>`; }
  };

  overlay.querySelector('#md_all').onclick = async () => {
    try { const r = await API.post('/auth/sessions/revoke-others'); toast(`أُنهيت ${arNum(r.revoked)} جلسة`, 'ok'); load(); }
    catch (ex) { err(ex.message); }
  };
  load();
}

// ---- توقيعي الشخصي ----
async function profileSignature() {
  // هل يوجد توقيع محفوظ؟
  let hasSig = false;
  try { hasSig = (await fetch('/api/settings/my-signature', { credentials: 'same-origin' })).ok; } catch {}
  const pad = signaturePad();

  const { overlay, close } = openModal({
    title: 'توقيعي',
    body: `<p class="muted">يُستخدم التوقيع في النسخة المصدَّرة من المحاضر. إن لم يوجد، يُولَّد ختم افتراضي من اسمك.</p>
      ${hasSig ? `<div class="field"><label>التوقيع الحالي</label>
        <div style="border:1px solid var(--border);border-radius:10px;padding:10px;background:#fff;text-align:center">
          <img src="/api/settings/my-signature?t=${Date.now()}" style="max-height:90px" /></div>
        <button class="btn-ghost btn-sm mt" id="sigDel">حذف التوقيع الحالي</button></div>` : ''}
      <div class="row" style="margin-bottom:10px">
        <button class="btn btn-sm" id="tabDraw">رسم التوقيع</button>
        <button class="btn-ghost btn-sm" id="tabUpload">رفع صورة</button>
      </div>
      <div id="sigDraw"></div>
      <div id="sigUpload" style="display:none">
        <div class="field"><label>صورة التوقيع (PNG بخلفية شفافة يُفضَّل)</label><input type="file" id="sigFile" accept="image/*" /></div>
      </div>`,
    buttons: [
      { label: 'حفظ', onClick: async (cl, ov) => {
        const mode = ov._mode || 'draw';
        let blob = null;
        if (mode === 'draw') {
          if (pad.isEmpty()) return toast('ارسم توقيعك أولًا', 'err');
          blob = await pad.toBlob();
        } else {
          const f = ov.querySelector('#sigFile').files[0];
          if (!f) return toast('اختر صورة', 'err');
          blob = f;
        }
        try {
          const res = await fetch('/api/settings/my-signature', {
            method: 'PUT', body: blob, credentials: 'same-origin',
            headers: { 'content-type': blob.type || 'image/png' },
          });
          if (!res.ok) throw new Error('فشل الحفظ');
          cl(); toast('تم حفظ التوقيع', 'ok');
        } catch (err) { toast(err.message, 'err'); }
      }},
      { label: 'إغلاق', class: 'btn-ghost', onClick: (cl) => cl() },
    ],
  });

  overlay._mode = 'draw';
  overlay.querySelector('#sigDraw').appendChild(pad.el);
  overlay.querySelector('#tabDraw').onclick = () => {
    overlay._mode = 'draw';
    overlay.querySelector('#tabDraw').className = 'btn btn-sm';
    overlay.querySelector('#tabUpload').className = 'btn-ghost btn-sm';
    overlay.querySelector('#sigDraw').style.display = ''; overlay.querySelector('#sigUpload').style.display = 'none';
  };
  overlay.querySelector('#tabUpload').onclick = () => {
    overlay._mode = 'upload';
    overlay.querySelector('#tabUpload').className = 'btn btn-sm';
    overlay.querySelector('#tabDraw').className = 'btn-ghost btn-sm';
    overlay.querySelector('#sigUpload').style.display = ''; overlay.querySelector('#sigDraw').style.display = 'none';
  };
  const del = overlay.querySelector('#sigDel');
  if (del) del.onclick = () => confirmModal('حذف التوقيع', 'سيُحذف توقيعك المحفوظ ويعود الختم الافتراضي. متابعة؟',
    async () => {
      try { await API.del('/settings/my-signature'); close(); toast('تم حذف التوقيع', 'ok'); }
      catch (err) { toast(err.message, 'err'); }
    }, { danger: true });
}

// ---- الهوية البصرية ----
VIEWS.branding = async () => {
  setTitle('الهوية البصرية');
  content().innerHTML = '<div class="spinner"></div>';
  let s;
  try { s = (await API.get('/settings')).settings; } catch (err) { return renderError(err); }
  content().innerHTML = `
    <div class="card"><div class="card-head"><h3>إعدادات الهوية البصرية</h3></div><div class="card-body">
      <div id="brErr"></div>
      <div class="row-2">
        <div class="field"><label>اسم الجهة</label><input id="br_org" value="${esc(s.org_name || '')}" /></div>
        <div class="field"><label>الخط</label><select id="br_font"><option ${s.font_family === 'Tajawal' ? 'selected' : ''}>Tajawal</option><option ${s.font_family === 'Cairo' ? 'selected' : ''}>Cairo</option></select></div>
      </div>
      <div class="field"><label>نص الترويسة</label><input id="br_header" value="${esc(s.header_text || '')}" /></div>
      <div class="field"><label>نص التذييل</label><input id="br_footer" value="${esc(s.footer_text || '')}" /></div>
      <div class="field"><label>اللون الأساسي</label><input type="color" id="br_color" value="${esc(s.primary_color || '#1f6f54')}" style="width:80px;height:40px;padding:2px" /></div>
      <div class="field"><label>السنة الدراسية الحالية</label>
        <input id="br_year" value="${esc(s.current_academic_year || '')}" placeholder="مثال: ١٤٤٧/١٤٤٨" />
        <p class="hint">تُختم على كل محضر ودورة تقييم جديدة، وتُستخدم في فلترة الأرشيف.</p></div>
      <button class="btn" id="br_save">حفظ الإعدادات</button>

      <h4 class="mt">الشعار والعلامة المائية</h4>
      <div class="row-2">
        <div class="field"><label>الشعار</label>${s.logo_key ? `<img src="/file?key=${encodeURIComponent(s.logo_key)}" style="max-height:50px;display:block;margin-bottom:6px" />` : ''}<input type="file" id="br_logo" accept="image/*" /></div>
        <div class="field"><label>العلامة المائية</label>${s.watermark_key ? `<img src="/file?key=${encodeURIComponent(s.watermark_key)}" style="max-height:50px;display:block;margin-bottom:6px" />` : ''}<input type="file" id="br_wm" accept="image/*" /></div>
      </div>
    </div></div>`;

  document.getElementById('br_save').onclick = async () => {
    try {
      const payload = {
        org_name: document.getElementById('br_org').value,
        header_text: document.getElementById('br_header').value,
        footer_text: document.getElementById('br_footer').value,
        primary_color: document.getElementById('br_color').value,
        font_family: document.getElementById('br_font').value,
        current_academic_year: document.getElementById('br_year').value.trim(),
      };
      await API.patch('/settings', payload);
      await applyBranding({ ...State.settings, ...payload }); // تطبيق فوري على الواجهة
      toast('تم الحفظ', 'ok');
    } catch (err) { document.getElementById('brErr').innerHTML = `<div class="form-error">${esc(err.message)}</div>`; }
  };
  const upAsset = async (kind, file) => {
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const res = await fetch(`/api/settings/asset/${kind}?ext=${ext}`, { method: 'PUT', body: file, credentials: 'same-origin', headers: { 'content-type': file.type || 'image/png' } });
    if (!res.ok) throw new Error('فشل الرفع');
  };
  document.getElementById('br_logo').onchange = async (e) => { if (e.target.files[0]) { try { await upAsset('logo', e.target.files[0]); toast('تم رفع الشعار', 'ok'); VIEWS.branding(); } catch (err) { toast(err.message, 'err'); } } };
  document.getElementById('br_wm').onchange = async (e) => { if (e.target.files[0]) { try { await upAsset('watermark', e.target.files[0]); toast('تم رفع العلامة', 'ok'); VIEWS.branding(); } catch (err) { toast(err.message, 'err'); } } };
};

boot();
