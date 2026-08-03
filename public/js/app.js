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
  if (State.user) { await applyBranding(); await loadAiStatus(); }
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

  const hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [view, ...rest] = hash.split('/');
  renderShell(view, rest);
}

function nav(path) { location.hash = '#/' + path; }

// ============ تسجيل الدخول ============
function renderLogin() {
  app().innerHTML = `
    <div class="auth-wrap">
      <form class="auth-card" id="loginForm">
        <div class="auth-logo">م</div>
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
    { key: 'meetings', label: 'المحاضر', ico: 'meetings', roles: ['president','vice_president','first_supervisor','team_member'] },
    { key: 'tasks', label: 'المهام', ico: 'tasks', roles: ['president','vice_president','first_supervisor','team_member'] },
    { key: 'evaluations', label: 'التقييم', ico: 'evaluations', roles: ['president','vice_president','first_supervisor','team_member'] },
    { key: 'students', label: 'سجل الطلاب', ico: 'students', roles: ['president','vice_president','first_supervisor','team_member'] },
  ]},
  { group: 'الإدارة', items: [
    { key: 'users', label: 'المستخدمون', ico: 'users', roles: ['president','system_admin'] },
    { key: 'councils', label: 'المجالس', ico: 'councils', roles: ['president','vice_president','first_supervisor','team_member'] },
    { key: 'branding', label: 'الهوية البصرية', ico: 'branding', roles: ['president','system_admin'] },
    { key: 'notifications', label: 'الإشعارات', ico: 'bell', roles: '*' },
    { key: 'audit', label: 'سجل التدقيق', ico: 'audit', roles: ['president','system_admin'] },
    { key: 'backups', label: 'النسخ الاحتياطي', ico: 'backups', roles: ['president','system_admin'] },
  ]},
];

function canSee(item) {
  return item.roles === '*' || item.roles.includes(State.user.role);
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
      <aside class="sidebar" id="sidebar">
        <div class="brand"><div class="mark">م</div><div class="name">المجلس التربوي<small>منصة المحاضر والتقييم</small></div></div>
        <nav class="nav">${navHtml}</nav>
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
          <div style="position:relative">
            <button class="btn-ghost btn-sm" id="bellBtn">${icon('bell', 18)}<span id="notifBadge" class="badge" style="display:none;position:absolute;top:-6px;inset-inline-start:-6px;background:var(--danger);color:#fff;border-radius:20px;padding:0 6px;font-size:11px"></span></button>
            <div id="notifPanel" style="display:none;position:absolute;top:110%;inset-inline-start:0;width:320px;max-height:400px;overflow:auto;background:#fff;border:1px solid var(--border);border-radius:10px;box-shadow:var(--shadow);z-index:60"></div>
          </div>
          <button class="btn-ghost btn-sm" id="profileBtn">توقيعي</button>
          <button class="btn-ghost btn-sm" id="devicesBtn">${icon('key', 16)} أجهزتي</button>
          <button class="btn-ghost btn-sm" id="pwBtn">تغيير كلمة المرور</button>
        </div>
        <div class="content" id="content"><div class="spinner"></div></div>
      </div>
    </div>`;

  document.getElementById('logoutBtn').onclick = async () => {
    try { await API.post('/auth/logout'); } catch {}
    State.user = null; State.pendingShown = false; document.querySelectorAll('.pending-pop').forEach((el) => el.remove());
    location.hash = ''; route();
  };
  document.getElementById('pwBtn').onclick = () => renderChangePassword(false);
  document.getElementById('profileBtn').onclick = () => profileSignature();
  document.getElementById('devicesBtn').onclick = () => myDevicesDialog();
  document.getElementById('menuToggle').onclick = () => document.getElementById('sidebar').classList.toggle('open');
  setupNotifications();
  setupGlobalSearch();

  // تنبيه العناصر المنتظرة — مرة واحدة عند فتح الصفحة/الدخول
  if (!State.pendingShown) { State.pendingShown = true; setTimeout(showPendingPopup, 500); }

  const handler = VIEWS[view] || VIEWS.dashboard;
  handler(rest);
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
    const b = document.getElementById('notifBadge');
    if (!b) return;
    if (unread > 0) { b.textContent = arNum(unread); b.style.display = 'inline-block'; }
    else b.style.display = 'none';
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
        ${notifications.length ? notifications.map((n) => `
          <a href="${esc(n.link || '#')}" data-nid="${n.id}" style="display:block;padding:10px 12px;border-bottom:1px solid #f0f2f1;${n.is_read ? '' : 'background:#f0f7f4'}">
            <b style="font-size:13px">${esc(n.title)}</b>
            <div class="muted" style="font-size:12px">${esc(n.body || '')}</div>
            <div class="muted" style="font-size:11px">${fmtDateTime(n.created_at)}</div></a>`).join('')
          : '<div class="empty" style="padding:24px">لا إشعارات</div>'}`;
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
    <div id="dashRecent" class="mt"></div>`;
  let s;
  try { s = await API.get('/dashboard/summary'); } catch (err) { return renderError(err); }
  // قد يغادر المستخدم الصفحة قبل وصول البيانات
  if (!document.getElementById('dashCards')) return;
  document.getElementById('dashCards').innerHTML = `
    <div class="stat" style="cursor:pointer" onclick="nav('tasks')"><div class="v">${arNum(s.my_tasks)}</div><div class="l">مهامي المفتوحة</div></div>
    <div class="stat" style="cursor:pointer" onclick="nav('meetings')"><div class="v">${arNum(s.awaiting_signature)}</div><div class="l">محاضر بانتظار توقيعي</div></div>
    <div class="stat" style="cursor:pointer" onclick="nav('evaluations')"><div class="v">${arNum(s.open_cycles)}</div><div class="l">دورات تقييم مفتوحة</div></div>
    <div class="stat"><div class="v">${arNum(s.recent_meetings.length)}</div><div class="l">آخر المحاضر</div></div>`;
  document.getElementById('dashRecent').innerHTML = s.recent_meetings.length ? `
    <div class="card"><div class="card-head"><h3>آخر المحاضر</h3></div>
      <table class="tbl"><thead><tr><th>الرقم</th><th>العنوان</th><th>الحالة</th></tr></thead>
      <tbody>${s.recent_meetings.map((m) => `<tr style="cursor:pointer" onclick="nav('meetings/${m.id}')">
        <td dir="ltr" style="text-align:right"><b>${esc(m.display_number)}</b></td><td>${esc(m.title || '—')}</td>
        <td>${statusTag(m.status, MEETING_STATUS_AR, MEETING_STATUS_COLOR)}</td></tr>`).join('')}</tbody></table></div>` : '';
};

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
        <td><b>${esc(u.name)}</b></td>
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
  document.getElementById('addUser').onclick = () => userForm(null);
  content().querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => userForm(find(b.dataset.edit)));
  content().querySelectorAll('[data-reset]').forEach((b) => b.onclick = () => resetUserPassword(b.dataset.reset));
  content().querySelectorAll('[data-history]').forEach((b) => b.onclick = () => roleHistoryModal(find(b.dataset.history)));
  content().querySelectorAll('[data-toggle]').forEach((b) => {
    const u = find(b.dataset.toggle);
    b.onclick = () => userAction(u, u.is_active ? 'suspend' : 'reactivate');
  });
  content().querySelectorAll('[data-del]').forEach((b) => b.onclick = () => userAction(find(b.dataset.del), 'delete'));
  content().querySelectorAll('[data-restore]').forEach((b) => b.onclick = () => userAction(find(b.dataset.restore), 'restore'));
  content().querySelectorAll('[data-purge]').forEach((b) => b.onclick = () => userAction(find(b.dataset.purge), 'purge'));
};

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

function userForm(existing) {
  const isEdit = !!existing;
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
    ${isEdit ? '<p class="hint">تغيير الدور أو المرحلة يعرض تقرير أثر قبل التنفيذ. التعليق والحذف من أزرار الصف.</p>'
             : '<p class="hint">سيُنشأ الحساب بكلمة المرور الافتراضية <b>1234</b> مع إلزام التغيير عند أول دخول.</p>'}`;

  openModal({
    title: isEdit ? 'تعديل مستخدم' : 'مستخدم جديد',
    body,
    buttons: [
      { label: 'حفظ', onClick: async (cl, overlay) => {
        const name = overlay.querySelector('#uf_name').value.trim();
        const role = overlay.querySelector('#uf_role').value;
        const stage = overlay.querySelector('#uf_stage').value || null;
        try {
          if (!isEdit) {
            await API.post('/users', { name, role, stage, email: overlay.querySelector('#uf_email').value.trim() });
            cl(); toast('تم الحفظ', 'ok'); VIEWS.users();
            return;
          }
          // تغيير الدور أو المرحلة يمرّ بتقرير الأثر
          if (role !== existing.role || (stage || null) !== (existing.stage || null)) {
            cl();
            return userAction(existing, 'role_change', { role, stage, name });
          }
          await API.patch('/users/' + existing.id, { name });
          cl(); toast('تم الحفظ', 'ok'); VIEWS.users();
        } catch (err) {
          overlay.querySelector('#ufErr').innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
        }
      }},
      { label: 'إلغاء', class: 'btn-ghost', onClick: (cl) => cl() },
    ],
  });
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

  content().innerHTML = `<div class="grid grid-3">${data.councils.map((c) => `
    <div class="card"><div class="card-body">
      <div class="tag tag-green" style="margin-bottom:10px">${esc(COUNCIL_TYPE_AR[c.type] || c.type)}</div>
      <h3 style="margin-bottom:4px">${esc(c.name)}</h3>
      <p class="muted" style="font-size:13px">بادئة الترقيم: ${esc(c.number_prefix)}</p>
      <button class="btn-ghost btn-sm mt" data-view="${c.id}">التفاصيل والأعضاء</button>
    </div></div>`).join('')}</div>`;

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
  '': 'كل الأنواع', meeting_invitation: 'دعوة اجتماع', awaiting_signature: 'بانتظار توقيع',
  meeting_approved: 'اعتماد محضر', action_assigned: 'إسناد مهمة', task_due_3: 'تذكير قبل ٣ أيام',
  task_due_today: 'تستحق اليوم', task_overdue: 'مهمة متأخرة', task_overdue_chair: 'تأخر في مجلسك',
  cycle_open: 'فتح دورة', cycle_closing: 'اقتراب إغلاق دورة', results_published: 'نشر نتائج',
};
let notifOffset = 0;

VIEWS.notifications = async () => {
  setTitle('الإشعارات');
  notifOffset = 0;
  content().innerHTML = `
    <div class="card"><div class="card-head"><h3>الإشعارات</h3><div class="spacer"></div>
      <select id="nfType" style="padding:8px 11px;border:1px solid var(--border);border-radius:8px">
        ${Object.entries(NOTIF_TYPE_AR).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <label class="check-inline"><input type="checkbox" id="nfUnread" /> غير المقروء فقط</label>
      <button class="btn-ghost btn-sm" id="nfApply">تصفية</button>
      <button class="btn-ghost btn-sm" id="nfReadAll">تعليم الكل كمقروء</button></div>
      <div id="nfList" class="card-body"></div>
      <div class="card-body center"><button class="btn-ghost btn-sm" id="nfMore">تحميل المزيد</button></div>
    </div>`;

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
  const os = /Android/i.test(ua) ? 'أندرويد' : /iPhone|iPad|iOS/i.test(ua) ? 'iOS'
    : /Windows/i.test(ua) ? 'ويندوز' : /Mac OS/i.test(ua) ? 'ماك' : /Linux/i.test(ua) ? 'لينكس' : '';
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
