// التطبيق الرئيسي (SPA) — منصة المجلس التربوي.
// المرحلة ١: المصادقة، الهيكل العربي، إدارة المستخدمين والمجالس، سجل التدقيق.

const State = { user: null };
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
        <div class="auth-logo">🔑</div>
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
    { key: 'dashboard', label: 'الصفحة الرئيسية', ico: '🏠', roles: '*' },
  ]},
  { group: 'العمل التربوي', items: [
    { key: 'meetings', label: 'المحاضر', ico: '📋', roles: ['president','vice_president','first_supervisor','team_member'] },
    { key: 'tasks', label: 'المهام', ico: '✅', roles: ['president','vice_president','first_supervisor','team_member'] },
    { key: 'evaluations', label: 'التقييم', ico: '📊', roles: ['president','vice_president','first_supervisor','team_member'] },
    { key: 'students', label: 'سجل الطلاب', ico: '🎓', roles: ['president','first_supervisor'] },
  ]},
  { group: 'الإدارة', items: [
    { key: 'users', label: 'المستخدمون', ico: '👥', roles: ['president','system_admin'] },
    { key: 'councils', label: 'المجالس', ico: '🏛️', roles: ['president','vice_president','first_supervisor','team_member'] },
    { key: 'audit', label: 'سجل التدقيق', ico: '🛡️', roles: ['president','system_admin'] },
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
      `<a href="#/${it.key}" class="${view === it.key ? 'active' : ''}"><span class="ico">${it.ico}</span>${it.label}</a>`
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
          <button class="btn-ghost btn-sm" id="logoutBtn" title="خروج">↩</button>
        </div>
      </aside>
      <div class="main">
        <div class="topbar">
          <button class="menu-toggle" id="menuToggle">☰</button>
          <h2 id="pageTitle"></h2>
          <div class="spacer"></div>
          <button class="btn-ghost btn-sm" id="pwBtn">تغيير كلمة المرور</button>
        </div>
        <div class="content" id="content"><div class="spinner"></div></div>
      </div>
    </div>`;

  document.getElementById('logoutBtn').onclick = async () => {
    try { await API.post('/auth/logout'); } catch {}
    State.user = null; location.hash = ''; route();
  };
  document.getElementById('pwBtn').onclick = () => renderChangePassword(false);
  document.getElementById('menuToggle').onclick = () => document.getElementById('sidebar').classList.toggle('open');

  const handler = VIEWS[view] || VIEWS.dashboard;
  handler(rest);
}

function setTitle(t) { const el = document.getElementById('pageTitle'); if (el) el.textContent = t; }
function content() { return document.getElementById('content'); }

// ============ العروض ============
const VIEWS = {};

// ---- الصفحة الرئيسية ----
VIEWS.dashboard = async () => {
  setTitle('الصفحة الرئيسية');
  const u = State.user;
  content().innerHTML = `
    <div class="card"><div class="card-body">
      <h3 style="margin-bottom:6px">مرحباً، ${esc(u.name)} 👋</h3>
      <p class="muted">${esc(ROLE_AR[u.role] || u.role)}${u.stage ? ' — المرحلة ' + STAGE_AR[u.stage] : ''}</p>
    </div></div>
    <div class="grid grid-4 mt">
      <div class="stat"><div class="v">${arNum(0)}</div><div class="l">مهامي المفتوحة</div></div>
      <div class="stat"><div class="v">${arNum(0)}</div><div class="l">محاضر بانتظار توقيعي</div></div>
      <div class="stat"><div class="v">${arNum(0)}</div><div class="l">دورات تقييم مفتوحة</div></div>
      <div class="stat"><div class="v">${arNum(0)}</div><div class="l">آخر المحاضر</div></div>
    </div>
    <div class="card mt"><div class="card-body muted center">
      لوحات الملخص تُفعَّل تِباعاً مع اكتمال وحدات المحاضر والمهام والتقييم.
    </div></div>`;
};

// ---- عروض مؤجلة للمراحل التالية ----
function phasePlaceholder(title, phase) {
  return () => {
    setTitle(title);
    content().innerHTML = `<div class="card"><div class="empty">
      <div class="ico">🚧</div>
      <h3>${esc(title)}</h3>
      <p class="muted">هذه الوحدة تُبنى في المرحلة ${arNum(phase)}.</p>
    </div></div>`;
  };
}
// VIEWS.meetings يُعرَّف في meetings.js (المرحلة ٢)
// VIEWS.tasks يُعرَّف في tasks.js (المرحلة ٣)
VIEWS.evaluations = phasePlaceholder('التقييم التربوي', 5);
VIEWS.students = phasePlaceholder('سجل الطلاب', 6);

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
  const canAssign = ['president'].includes(State.user.role) ||
    (State.user.role === 'first_supervisor' && d.council.type !== 'educational');

  const memberRows = d.members.map((m) => `
    <tr><td><b>${esc(m.name)}</b></td><td>${esc(ROLE_AR[m.role] || m.role)}</td>
    <td>${m.position === 'chair' ? '<span class="tag tag-gold">رئيس المجلس</span>' : 'عضو'}
        ${d.council.default_writer_id === m.user_id ? '<span class="tag tag-green">كاتب افتراضي</span>' : ''}</td></tr>`).join('');

  const writerOpts = d.members.map((m) =>
    `<option value="${m.user_id}" ${d.council.default_writer_id === m.user_id ? 'selected' : ''}>${esc(m.name)}</option>`).join('');

  const fixedRows = d.fixed_items.map((f) =>
    `<li>${esc(f.title)} ${canAssign ? `<button class="btn-ghost btn-sm" data-delfix="${f.id}">حذف</button>` : ''}</li>`).join('');

  openModal({
    title: d.council.name,
    body: `
      <h4 style="margin-bottom:8px">الأعضاء</h4>
      <table class="tbl"><thead><tr><th>الاسم</th><th>الدور</th><th></th></tr></thead><tbody>${memberRows}</tbody></table>
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
}

// ---- سجل التدقيق ----
VIEWS.audit = async () => {
  setTitle('سجل التدقيق');
  content().innerHTML = '<div class="spinner"></div>';
  let data;
  try { data = await API.get('/audit?limit=200'); }
  catch (err) { return renderError(err); }

  const rows = data.entries.map((e) => `
    <tr>
      <td>${fmtDateTime(e.timestamp)}</td>
      <td>${esc(e.user_name || '—')}</td>
      <td><span class="tag tag-gray">${esc(e.action)}</span></td>
      <td>${esc(e.entity_type || '')} ${e.entity_id ? '#' + arNum(e.entity_id) : ''}</td>
    </tr>`).join('');

  content().innerHTML = `
    <div class="card">
      <div class="card-head"><h3>آخر العمليات (${arNum(data.entries.length)})</h3></div>
      <table class="tbl">
        <thead><tr><th>الوقت</th><th>المستخدم</th><th>العملية</th><th>الكيان</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4" class="center muted">لا توجد سجلات</td></tr>'}</tbody>
      </table>
    </div>`;
};

function renderError(err) {
  if (err.status === 401) { State.user = null; return route(); }
  content().innerHTML = `<div class="card"><div class="empty"><div class="ico">⚠️</div><p>${esc(err.message)}</p></div></div>`;
}

boot();
