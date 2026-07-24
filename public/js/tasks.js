// وحدة المهام (الواجهة) — لوحة «مهامي»، جميع البنود حسب الصلاحية، وتفاصيل البند.

const ACTION_STATUS_COLOR = {
  not_started: 'tag-gray', in_progress: 'tag-gold', done: 'tag-green', stalled: 'tag-red', cancelled: 'tag-gray',
};
const PRIORITY_COLOR = { high: 'tag-red', medium: 'tag-gold', low: 'tag-gray' };

VIEWS.tasks = async (rest) => {
  if (rest && rest[0]) return taskDetail(rest[0]);
  return taskBoard();
};

async function taskBoard() {
  setTitle('المهام');
  const tab = (location.hash.split('?')[1] || '').includes('all') ? 'all' : 'mine';
  content().innerHTML = `
    <div class="row" style="margin-bottom:16px">
      <button class="btn ${tab === 'mine' ? '' : 'btn-ghost'} btn-sm" id="tabMine">مهامي</button>
      <button class="btn ${tab === 'all' ? '' : 'btn-ghost'} btn-sm" id="tabAll">جميع البنود</button>
    </div>
    <div id="tBody"><div class="spinner"></div></div>`;
  document.getElementById('tabMine').onclick = () => { location.hash = '#/tasks'; taskBoard(); };
  document.getElementById('tabAll').onclick = () => { location.hash = '#/tasks?all'; taskBoard(); };
  tab === 'mine' ? loadMine() : loadAll();
}

async function loadMine() {
  const box = document.getElementById('tBody');
  try {
    const { actions } = await API.get('/actions?mine=1');
    const open = actions.filter((a) => a.status !== 'done' && a.status !== 'cancelled');
    const done = actions.filter((a) => a.status === 'done');
    box.innerHTML = `
      <div class="card"><div class="card-head"><h3>البنود المفتوحة (${arNum(open.length)})</h3></div>
        ${open.length ? taskTable(open, true) : `<div class="empty"><div class="ico">${icon('tasks', 42)}</div><p>لا توجد بنود مفتوحة عليك</p></div>`}</div>
      ${done.length ? `<div class="card mt"><div class="card-head"><h3>المنجزة (${arNum(done.length)})</h3></div>${taskTable(done, false)}</div>` : ''}`;
    wireTaskTable(box);
  } catch (err) { box.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
}

async function loadAll() {
  const box = document.getElementById('tBody');
  const typeOpts = Object.entries(ACTION_TYPE_AR).map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  const statusOpts = Object.entries(ACTION_STATUS_AR).map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  box.innerHTML = `
    <div class="card"><div class="card-body">
      <div class="row" style="margin-bottom:12px">
        <select id="taType" style="padding:9px 12px;border:1px solid var(--border);border-radius:8px"><option value="">كل الأنواع</option>${typeOpts}</select>
        <select id="taStatus" style="padding:9px 12px;border:1px solid var(--border);border-radius:8px"><option value="">كل الحالات</option>${statusOpts}</select>
        <button class="btn-ghost btn-sm" id="taApply">تصفية</button>
      </div>
      <div id="taList"><div class="spinner"></div></div>
    </div></div>`;
  const load = async () => {
    const p = new URLSearchParams();
    if (document.getElementById('taType').value) p.set('type', document.getElementById('taType').value);
    if (document.getElementById('taStatus').value) p.set('status', document.getElementById('taStatus').value);
    const list = document.getElementById('taList');
    list.innerHTML = '<div class="spinner"></div>';
    try {
      const { actions } = await API.get('/actions?' + p.toString());
      list.innerHTML = actions.length ? taskTable(actions, false) : `<div class="empty"><div class="ico">${icon('inbox', 42)}</div><p>لا توجد بنود</p></div>`;
      wireTaskTable(list);
    } catch (err) { list.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  };
  document.getElementById('taApply').onclick = load;
  load();
}

function taskTable(actions, allowComplete) {
  return `<table class="tbl">
    <thead><tr><th>النوع</th><th>الرقم</th><th>النص</th><th>الأولوية</th><th>الاستحقاق</th><th>الحالة</th><th>الإنجاز</th><th></th></tr></thead>
    <tbody>${actions.map((a) => `<tr>
      <td>${esc(ACTION_TYPE_AR[a.type] || a.type)}</td>
      <td dir="ltr" style="text-align:right">${esc(a.display_number)}</td>
      <td>${esc(a.text)}</td>
      <td><span class="tag ${PRIORITY_COLOR[a.priority] || 'tag-gray'}">${esc(PRIORITY_AR[a.priority] || '')}</span></td>
      <td>${a.due_date ? esc(a.due_date) : '—'}</td>
      <td>${statusTag(a.status, ACTION_STATUS_AR, ACTION_STATUS_COLOR)}</td>
      <td>${arNum(a.progress)}٪</td>
      <td class="row">
        <button class="btn-ghost btn-sm" data-open="${a.id}">تفاصيل</button>
        ${allowComplete && a.status !== 'done' ? `<button class="btn btn-sm" data-done="${a.id}">${icon('check', 15)} إنجاز</button>` : ''}
      </td></tr>`).join('')}</tbody></table>`;
}

function wireTaskTable(scope) {
  scope.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => taskDetail(b.dataset.open, taskBoard));
  scope.querySelectorAll('[data-done]').forEach((b) => b.onclick = () => completeTask(b.dataset.done, taskBoard));
}

function completeTask(id, onDone) {
  openModal({
    title: 'تعليم البند منجزاً',
    body: `<div class="field"><label>ملاحظة الإنجاز (اختياري)</label><textarea id="cn" rows="2"></textarea></div>`,
    buttons: [
      { label: 'تأكيد الإنجاز', onClick: async (cl, ov) => {
        try { await API.post(`/actions/${id}/complete`, { note: ov.querySelector('#cn').value.trim() || null }); cl(); toast('تم تسجيل الإنجاز', 'ok'); if (onDone) onDone(); } catch (err) { toast(err.message, 'err'); }
      }},
      { label: 'إلغاء', class: 'btn-ghost', onClick: (cl) => cl() },
    ],
  });
}

// تفاصيل بند (نافذة) — تُستخدم من لوحة المهام ومن تفاصيل المحضر
async function taskDetail(id, onBack) {
  let d;
  try { d = await API.get('/actions/' + id); } catch (err) { return toast(err.message, 'err'); }
  const a = d.action;
  const myId = State.user.id;
  const iAmAssignee = d.assignees.some((x) => x.user_id === myId);
  const canManage = ['president', 'first_supervisor'].includes(State.user.role) || iAmAssignee;

  const attList = d.attachments.map((at) =>
    `<li><a href="/api/actions/${id}/attachments/${at.id}" target="_blank">${esc(at.file_name)}</a> <span class="muted">${fmtDateTime(at.uploaded_at)}</span></li>`).join('');

  openModal({
    title: `${ACTION_TYPE_AR[a.type] || a.type} — ${a.display_number}`,
    body: `
      <p>${esc(a.text)}</p>
      <div class="row-2 mt">
        <div><span class="muted">الأولوية:</span> ${esc(PRIORITY_AR[a.priority] || '')}</div>
        <div><span class="muted">الاستحقاق:</span> ${a.due_date ? esc(a.due_date) : '—'}</div>
        <div><span class="muted">الحالة:</span> ${statusTag(a.status, ACTION_STATUS_AR, ACTION_STATUS_COLOR)}</div>
        <div><span class="muted">نسبة الإنجاز:</span> ${arNum(a.progress)}٪</div>
        <div><span class="muted">المحضر المنشئ:</span> ${d.meeting ? esc(d.meeting.display_number) : '—'}</div>
        <div><span class="muted">تاريخ الإنجاز:</span> ${a.completed_at ? fmtDateTime(a.completed_at) : '—'}</div>
      </div>
      <p class="mt"><span class="muted">المسؤولون:</span> ${d.assignees.map((x) => esc(x.name)).join('، ') || '—'}</p>
      ${a.completion_note ? `<p class="muted">ملاحظة الإنجاز: ${esc(a.completion_note)}</p>` : ''}
      <h4 class="mt">مرفقات إثبات الإنجاز</h4>
      <ul style="padding-inline-start:18px">${attList || '<li class="muted">لا مرفقات</li>'}</ul>
      ${iAmAssignee ? `<div class="row mt"><input type="file" id="td_file" /><button class="btn-ghost btn-sm" id="td_upload">رفع مرفق</button></div>` : ''}
      ${canManage && a.status !== 'done' && a.status !== 'cancelled' ? `
        <h4 class="mt">تحديث</h4>
        <div class="row">
          <label>الحالة</label>
          <select id="td_status">${['not_started', 'in_progress', 'stalled'].map((s) => `<option value="${s}" ${a.status === s ? 'selected' : ''}>${ACTION_STATUS_AR[s]}</option>`).join('')}</select>
          <label>الإنجاز</label><input type="number" id="td_progress" min="0" max="100" value="${a.progress}" style="width:80px;padding:7px;border:1px solid var(--border);border-radius:8px" />
          <button class="btn-ghost btn-sm" id="td_save">حفظ</button>
        </div>` : ''}`,
    buttons: [
      ...(iAmAssignee && a.status !== 'done' ? [{ label: 'تعليم منجزاً', onClick: (cl) => { cl(); completeTask(id, () => { if (onBack) onBack(); }); } }] : []),
      ...(canManage && a.status === 'done' ? [{ label: 'إعادة فتح', class: 'btn-ghost', onClick: async (cl) => { try { await API.post(`/actions/${id}/reopen`); cl(); toast('تمت إعادة الفتح', 'ok'); if (onBack) onBack(); } catch (err) { toast(err.message, 'err'); } } }] : []),
      { label: 'إغلاق', class: 'btn-ghost', onClick: (cl) => cl() },
    ],
  });

  const up = document.getElementById('td_upload');
  if (up) up.onclick = async () => {
    const f = document.getElementById('td_file').files[0];
    if (!f) return toast('اختر ملفاً', 'err');
    try {
      const res = await fetch(`/api/actions/${id}/attachments?name=${encodeURIComponent(f.name)}`, {
        method: 'PUT', body: f, credentials: 'same-origin',
      });
      if (!res.ok) throw new Error('فشل الرفع');
      toast('تم رفع المرفق', 'ok'); taskDetail(id, onBack);
    } catch (err) { toast(err.message, 'err'); }
  };
  const sv = document.getElementById('td_save');
  if (sv) sv.onclick = async () => {
    try {
      await API.patch('/actions/' + id, {
        status: document.getElementById('td_status').value,
        progress: Number(document.getElementById('td_progress').value),
      });
      toast('تم الحفظ', 'ok'); taskDetail(id, onBack);
    } catch (err) { toast(err.message, 'err'); }
  };
}
