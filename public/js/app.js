// التطبيق الرئيسي (SPA) — منصة المجلس التربوي.
// المرحلة ١: المصادقة، الهيكل العربي، إدارة المستخدمين والمجالس، سجل التدقيق.

const State = { user: null, pendingShown: false };
const app = () => document.getElementById('app');

// ============ نقطة البدء ============
async function boot() {
  try {
    const { user } = await API.get('/auth/me');
    State.user = user;
  } catch {
    State.user = null;
  }
  window.addEventListener('hashchange', route);
  route();
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
    { key: 'students', label: 'سجل الطلاب', ico: 'students', roles: ['president','first_supervisor'] },
  ]},
  { group: 'الإدارة', items: [
    { key: 'users', label: 'المستخدمون', ico: 'users', roles: ['president','system_admin'] },
    { key: 'councils', label: 'المجالس', ico: 'councils', roles: ['president','vice_president','first_supervisor','team_member'] },
    { key: 'branding', label: 'الهوية البصرية', ico: 'branding', roles: ['president','system_admin'] },
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
          <div class="spacer"></div>
          <div style="position:relative">
            <button class="btn-ghost btn-sm" id="bellBtn">${icon('bell', 18)}<span id="notifBadge" class="badge" style="display:none;position:absolute;top:-6px;inset-inline-start:-6px;background:var(--danger);color:#fff;border-radius:20px;padding:0 6px;font-size:11px"></span></button>
            <div id="notifPanel" style="display:none;position:absolute;top:110%;inset-inline-start:0;width:320px;max-height:400px;overflow:auto;background:#fff;border:1px solid var(--border);border-radius:10px;box-shadow:var(--shadow);z-index:60"></div>
          </div>
          <button class="btn-ghost btn-sm" id="profileBtn">توقيعي</button>
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
  document.getElementById('menuToggle').onclick = () => document.getElementById('sidebar').classList.toggle('open');
  setupNotifications();

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
  const close = () => { pop.classList.remove('show'); setTimeout(() => pop.remove(), 250); };
  pop.querySelector('.x').onclick = close;
  pop.querySelectorAll('.pp-item').forEach((b) => b.onclick = () => { location.hash = items[b.dataset.i].link; close(); });
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
VIEWS.users = async () => {
  setTitle('المستخدمون والصلاحيات');
  content().innerHTML = '<div class="spinner"></div>';
  let data;
  try { data = await API.get('/users'); }
  catch (err) { return renderError(err); }

  const rows = data.users.map((u) => `
    <tr>
      <td><b>${esc(u.name)}</b></td>
      <td dir="ltr" style="text-align:right">${esc(u.email)}</td>
      <td>${esc(ROLE_AR[u.role] || u.role)}</td>
      <td>${u.stage ? esc(STAGE_AR[u.stage]) : '—'}</td>
      <td>${u.is_active ? '<span class="tag tag-green">نشط</span>' : '<span class="tag tag-gray">معطّل</span>'}
          ${u.must_change_password ? '<span class="tag tag-gold">لم يغيّر كلمته</span>' : ''}</td>
      <td class="row">
        <button class="btn-ghost btn-sm" data-edit="${u.id}">تعديل</button>
        <button class="btn-ghost btn-sm" data-reset="${u.id}">إعادة تعيين</button>
      </td>
    </tr>`).join('');

  content().innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3>المستخدمون (${arNum(data.users.length)})</h3>
        <div class="spacer"></div>
        <button class="btn btn-sm" id="addUser">+ مستخدم جديد</button>
      </div>
      <table class="tbl">
        <thead><tr><th>الاسم</th><th>البريد</th><th>الدور</th><th>المرحلة</th><th>الحالة</th><th>إجراءات</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  document.getElementById('addUser').onclick = () => userForm(null);
  content().querySelectorAll('[data-edit]').forEach((b) =>
    b.onclick = () => userForm(data.users.find((x) => x.id == b.dataset.edit)));
  content().querySelectorAll('[data-reset]').forEach((b) =>
    b.onclick = () => resetUserPassword(b.dataset.reset));
};

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
    ${isEdit ? `<div class="field"><label>الحالة</label><select id="uf_active">
        <option value="1" ${existing.is_active ? 'selected' : ''}>نشط</option>
        <option value="0" ${!existing.is_active ? 'selected' : ''}>معطّل</option></select></div>` : ''}
    ${!isEdit ? '<p class="hint">سيُنشأ الحساب بكلمة المرور الافتراضية <b>1234</b> مع إلزام التغيير عند أول دخول.</p>' : ''}`;

  const { close } = openModal({
    title: isEdit ? 'تعديل مستخدم' : 'مستخدم جديد',
    body,
    buttons: [
      { label: 'حفظ', onClick: async (cl, overlay) => {
        const payload = {
          name: overlay.querySelector('#uf_name').value.trim(),
          role: overlay.querySelector('#uf_role').value,
          stage: overlay.querySelector('#uf_stage').value || null,
        };
        if (isEdit) payload.is_active = overlay.querySelector('#uf_active').value === '1';
        else payload.email = overlay.querySelector('#uf_email').value.trim();
        try {
          if (isEdit) await API.patch('/users/' + existing.id, payload);
          else await API.post('/users', payload);
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

// ---- سجل التدقيق ----
const AUDIT_ENTITIES = { '': 'كل الكيانات', meeting: 'محضر', action_item: 'قرار/مهمة', evaluation: 'تقييم', eval_cycle: 'دورة تقييم', student: 'طالب', user: 'مستخدم', council: 'مجلس', settings: 'الإعدادات', backup: 'نسخة احتياطية' };
let auditOffset = 0;

VIEWS.audit = async () => {
  setTitle('سجل التدقيق');
  auditOffset = 0;
  content().innerHTML = `
    <div class="card"><div class="card-head"><h3>سجل التدقيق</h3><div class="spacer"></div>
      <select id="auEntity" style="padding:8px 11px;border:1px solid var(--border);border-radius:8px">${Object.entries(AUDIT_ENTITIES).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <button class="btn-ghost btn-sm" id="auApply">تصفية</button></div>
      <table class="tbl"><thead><tr><th>الوقت</th><th>المستخدم</th><th>العملية</th><th>الكيان</th><th></th></tr></thead>
        <tbody id="auBody"></tbody></table>
      <div class="card-body center"><button class="btn-ghost btn-sm" id="auMore">تحميل المزيد</button></div>
    </div>`;
  const load = async (reset) => {
    if (reset) { auditOffset = 0; document.getElementById('auBody').innerHTML = ''; }
    const ent = document.getElementById('auEntity').value;
    let data;
    try { data = await API.get(`/audit?limit=50&offset=${auditOffset}${ent ? '&entity_type=' + ent : ''}`); }
    catch (err) { return renderError(err); }
    const rows = data.entries.map((e) => `<tr>
      <td>${fmtDateTime(e.timestamp)}</td><td>${esc(e.user_name || '—')}</td>
      <td><span class="tag tag-gray">${esc(e.action)}</span></td>
      <td>${esc(AUDIT_ENTITIES[e.entity_type] || e.entity_type || '')} ${e.entity_id ? '#' + arNum(e.entity_id) : ''}</td>
      <td>${(e.old_value || e.new_value) ? `<button class="btn-ghost btn-sm" data-det='${encodeURIComponent(JSON.stringify({ o: e.old_value, n: e.new_value }))}'>تفاصيل</button>` : ''}</td>
    </tr>`).join('');
    document.getElementById('auBody').insertAdjacentHTML('beforeend', rows || (auditOffset === 0 ? '<tr><td colspan="5" class="center muted">لا سجلات</td></tr>' : ''));
    auditOffset += data.entries.length;
    document.getElementById('auMore').style.display = data.entries.length < 50 ? 'none' : 'inline-flex';
    document.querySelectorAll('#auBody [data-det]').forEach((b) => b.onclick = () => {
      const d = JSON.parse(decodeURIComponent(b.dataset.det));
      openModal({ title: 'تفاصيل العملية', body: `<h4>قبل</h4><pre style="background:#f4f6f5;padding:10px;border-radius:8px;overflow:auto;direction:ltr;font-size:12px">${esc(d.o || '—')}</pre><h4 class="mt">بعد</h4><pre style="background:#f4f6f5;padding:10px;border-radius:8px;overflow:auto;direction:ltr;font-size:12px">${esc(d.n || '—')}</pre>`, buttons: [{ label: 'إغلاق', class: 'btn-ghost', onClick: (cl) => cl() }] });
    });
  };
  document.getElementById('auApply').onclick = () => load(true);
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
          <td><a class="btn-ghost btn-sm" href="/api/admin/backups/download?key=${encodeURIComponent(b.key)}">تنزيل</a></td></tr>`).join('') || '<tr><td colspan="4" class="center muted">لا نسخ بعد</td></tr>'}</tbody></table>
    </div></div>`;
  document.getElementById('bkNow').onclick = async () => {
    try { await API.post('/admin/backups'); toast('تم إنشاء النسخة', 'ok'); VIEWS.backups(); } catch (err) { toast(err.message, 'err'); }
  };
};

// ---- توقيعي الشخصي ----
function profileSignature() {
  openModal({
    title: 'صورة التوقيع الشخصي',
    body: `<p class="muted">تُستخدم صورة التوقيع في النسخة المصدَّرة من المحاضر. إن لم تُرفع صورة، يُولَّد ختم افتراضي من اسمك.</p>
      <div class="field mt"><label>اختر صورة التوقيع (PNG بخلفية شفافة يُفضَّل)</label><input type="file" id="sigFile" accept="image/*" /></div>`,
    buttons: [
      { label: 'رفع', onClick: async (cl, ov) => {
        const f = ov.querySelector('#sigFile').files[0];
        if (!f) return toast('اختر صورة', 'err');
        try {
          const res = await fetch('/api/settings/my-signature', { method: 'PUT', body: f, credentials: 'same-origin', headers: { 'content-type': f.type || 'image/png' } });
          if (!res.ok) throw new Error('فشل الرفع');
          cl(); toast('تم حفظ التوقيع', 'ok');
        } catch (err) { toast(err.message, 'err'); }
      }},
      { label: 'إغلاق', class: 'btn-ghost', onClick: (cl) => cl() },
    ],
  });
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
      <button class="btn" id="br_save">حفظ الإعدادات</button>

      <h4 class="mt">الشعار والعلامة المائية</h4>
      <div class="row-2">
        <div class="field"><label>الشعار</label>${s.logo_key ? `<img src="/file?key=${encodeURIComponent(s.logo_key)}" style="max-height:50px;display:block;margin-bottom:6px" />` : ''}<input type="file" id="br_logo" accept="image/*" /></div>
        <div class="field"><label>العلامة المائية</label>${s.watermark_key ? `<img src="/file?key=${encodeURIComponent(s.watermark_key)}" style="max-height:50px;display:block;margin-bottom:6px" />` : ''}<input type="file" id="br_wm" accept="image/*" /></div>
      </div>
    </div></div>`;

  document.getElementById('br_save').onclick = async () => {
    try {
      await API.patch('/settings', {
        org_name: document.getElementById('br_org').value,
        header_text: document.getElementById('br_header').value,
        footer_text: document.getElementById('br_footer').value,
        primary_color: document.getElementById('br_color').value,
        font_family: document.getElementById('br_font').value,
      });
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
