// وحدة المهام (الواجهة) — «مهامي»، جميع البنود، الالتزام والأداء، وإنشاء المهام المستقلة.
//
// المهمة لا تُولد كلها من اجتماع: منها ما يُقرَّر في محضر، ومنها ما يُكلَّف به الرجل في
// يومه. والاثنتان تُعرضان معًا في مكان واحد وبترتيب واحد — تاريخ الاستحقاق — وإنما
// يفرّق بينهما **وسمٌ** على البند: رقم محضره، أو «مستقلة».
//
// وللقائمة نفسها ثلاث صور يختار المستخدم بينها وتُحفظ عليه:
//   جدول  — التفاصيل كاملة صفًّا صفًّا.
//   كانبان — أعمدةٌ بالحالة المسجَّلة، تُسحب البطاقة بينها فتتغيّر حالتها.
//   جانت  — محورٌ زمني يُظهر مدى كل مهمة وتأخّرها، من اليمين إلى اليسار كاتجاه القراءة.
//
// وإنشاء المهمة المستقلة يقع في الصفحة نفسها: لوحةٌ تنطوي وتنفتح، لا نافذة جديدة.

VIEWS.tasks = async (rest) => {
  if (rest && rest[0]) return taskDetail(rest[0]);
  return taskBoard();
};

// ---------- حالة الشاشة ----------
const TaskBoard = {
  tab: 'mine',
  view: 'table',            // table | kanban | gantt
  source: 'all',            // all | meeting | standalone
  actions: [],
  assign: null,             // { can_create, scope, users } — يُجلب مرة واحدة
  editing: null,            // المهمة المستقلة التي يُعاد تحريرها
  pendingEdit: null,        // تحريرٌ طُلب من خارج الشاشة (نافذة التفاصيل)
};

const TASK_VIEW_LABELS = { table: 'جدول', kanban: 'كانبان', gantt: 'جانت' };
const TASK_VIEW_ICONS = { table: 'list', kanban: 'grid', gantt: 'calendar2' };
// أعمدة الكانبان = الحالة **المسجَّلة**: هي وحدها ما يملك المستخدم تغييره بالسحب.
// والتأخّر عن الاستحقاق يظهر شارةً حمراء على البطاقة أينما كانت.
const KANBAN_COLS = ['not_started', 'in_progress', 'stalled', 'done', 'cancelled'];

// ---------- الهيكل العام ----------
async function taskBoard() {
  setTitle('المهام');
  const q = location.hash.split('?')[1] || '';
  const tab = q.includes('perf') ? 'perf' : q.includes('all') ? 'all' : 'mine';
  TaskBoard.tab = tab;
  TaskBoard.view = LS.get('tasks.view') || 'table';
  if (!TASK_VIEW_LABELS[TaskBoard.view]) TaskBoard.view = 'table';

  content().innerHTML = `
    <div class="row" style="margin-bottom:16px">
      <button class="btn ${tab === 'mine' ? '' : 'btn-ghost'} btn-sm" id="tabMine">مهامي</button>
      <button class="btn ${tab === 'all' ? '' : 'btn-ghost'} btn-sm" id="tabAll">جميع البنود</button>
      <button class="btn ${tab === 'perf' ? '' : 'btn-ghost'} btn-sm" id="tabPerf">الالتزام والأداء</button>
    </div>
    <div id="tBody"><div class="spinner"></div></div>`;
  document.getElementById('tabMine').onclick = () => { location.hash = '#/tasks'; taskBoard(); };
  document.getElementById('tabAll').onclick = () => { location.hash = '#/tasks?all'; taskBoard(); };
  document.getElementById('tabPerf').onclick = () => { location.hash = '#/tasks?perf'; taskBoard(); };

  if (tab === 'perf') return loadPerformance();
  await ensureAssignable();
  renderWorkspace();
}

/** من يجوز لهذا المستخدم إسناد المهام إليهم — يُجلب مرة واحدة في الجلسة. */
async function ensureAssignable() {
  if (TaskBoard.assign) return;
  try { TaskBoard.assign = await API.get('/actions/assignable'); }
  catch { TaskBoard.assign = { can_create: false, scope: 'self', users: [] }; }
}

const SCOPE_HINT = {
  all: 'تستطيع إسناد المهمة إلى جميع منسوبي المنصة.',
  stage_team: 'تستطيع إسناد المهمة إلى أعضاء مجلس مرحلتك.',
  self: 'تستطيع إسناد المهمة إلى نفسك.',
};

// ---------- مساحة العمل: شريط الأدوات + نموذج الإنشاء + القائمة ----------
function renderWorkspace() {
  const box = document.getElementById('tBody');
  const isAll = TaskBoard.tab === 'all';
  const canCreate = !!(TaskBoard.assign && TaskBoard.assign.can_create);
  const seg = Object.keys(TASK_VIEW_LABELS).map((v) =>
    `<button type="button" class="${TaskBoard.view === v ? 'on' : ''}" data-view="${v}">
       ${icon(TASK_VIEW_ICONS[v], 15)}<span>${TASK_VIEW_LABELS[v]}</span></button>`).join('');

  box.innerHTML = `
    <div class="card">
      <div class="card-body tb-toolbar">
        <div class="seg" role="group" aria-label="طريقة العرض">${seg}</div>
        <select id="tSource" title="مصدر البند">
          <option value="all">كل المصادر</option>
          <option value="meeting">من محاضر</option>
          <option value="standalone">مهام مستقلة</option>
        </select>
        ${isAll ? `
          <select id="tType"><option value="">كل الأنواع</option>
            ${Object.entries(ACTION_TYPE_AR).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
          <select id="tStatus"><option value="">كل الحالات</option>
            ${Object.entries(ACTION_STATUS_AR).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>` : ''}
        <div class="spacer"></div>
        ${canCreate ? `<button class="btn btn-sm" id="tNew">${icon('addbox', 16)} مهمة جديدة</button>` : ''}
      </div>
      <div id="tForm" class="tform" hidden></div>
      <div id="tList"><div class="spinner"></div></div>
    </div>`;

  // تبديل الصورة لا يُعيد جلب البيانات: هي بين يدي الواجهة، والرسم وحده يتغيّر
  const segBtns = box.querySelectorAll('[data-view]');
  segBtns.forEach((b) => b.onclick = () => {
    TaskBoard.view = b.dataset.view;
    LS.set('tasks.view', TaskBoard.view);
    segBtns.forEach((x) => x.classList.toggle('on', x.dataset.view === TaskBoard.view));
    renderList();
  });
  const src = document.getElementById('tSource');
  src.value = TaskBoard.source;
  src.onchange = () => { TaskBoard.source = src.value; renderList(); };
  if (isAll) {
    document.getElementById('tType').onchange = loadActions;
    document.getElementById('tStatus').onchange = loadActions;
  }
  if (canCreate) document.getElementById('tNew').onclick = () => openTaskForm(null);

  // تحريرٌ طُلب من نافذة التفاصيل قبل الوصول إلى هذه الشاشة
  if (TaskBoard.pendingEdit) {
    const t = TaskBoard.pendingEdit;
    TaskBoard.pendingEdit = null;
    setTimeout(() => openTaskForm(t), 0);
  }
  loadActions();
}

async function loadActions() {
  const list = document.getElementById('tList');
  if (!list) return;
  list.innerHTML = '<div class="spinner"></div>';
  const p = new URLSearchParams();
  if (TaskBoard.tab === 'mine') p.set('mine', '1');
  const typeSel = document.getElementById('tType');
  const statusSel = document.getElementById('tStatus');
  if (typeSel && typeSel.value) p.set('type', typeSel.value);
  if (statusSel && statusSel.value) p.set('status', statusSel.value);
  try {
    const { actions } = await API.get('/actions?' + p.toString());
    TaskBoard.actions = actions || [];
    renderList();
  } catch (err) { list.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
}

/** تصفية المصدر تقع في الواجهة: البيانات كلها بين يديها ولا حاجة لرحلة أخرى. */
function visibleActions() {
  const s = TaskBoard.source;
  if (s === 'meeting') return TaskBoard.actions.filter((a) => a.source_meeting_id != null);
  if (s === 'standalone') return TaskBoard.actions.filter((a) => a.source_meeting_id == null);
  return TaskBoard.actions;
}

/** الترتيب الواحد في كل الصور: الأقرب استحقاقًا أولًا، وما لا استحقاق له في آخره، والمنجَز بعدهما. */
function byDueDate(list) {
  return [...list].sort((x, y) => {
    const dx = x.status === 'done' || x.status === 'cancelled' ? 1 : 0;
    const dy = y.status === 'done' || y.status === 'cancelled' ? 1 : 0;
    if (dx !== dy) return dx - dy;
    if (!x.due_date && !y.due_date) return y.id - x.id;
    if (!x.due_date) return 1;
    if (!y.due_date) return -1;
    return x.due_date < y.due_date ? -1 : x.due_date > y.due_date ? 1 : y.id - x.id;
  });
}

function renderList() {
  const list = document.getElementById('tList');
  if (!list) return;
  const rows = byDueDate(visibleActions());
  if (!rows.length) {
    list.innerHTML = `<div class="empty"><div class="ico">${icon('tasks', 42)}</div>
      <p>${TaskBoard.tab === 'mine' ? 'لا توجد بنود عليك' : 'لا توجد بنود'}</p></div>`;
    return;
  }
  list.innerHTML = TaskBoard.view === 'kanban' ? kanbanView(rows)
    : TaskBoard.view === 'gantt' ? ganttView(rows)
      : tableView(rows);
  wireTaskList(list);
}

// ---------- وسم مصدر البند ----------
/** رقم المحضر وسمًا لما نشأ منه، و«مستقلة» لما أُنشئ خارجه. */
function sourceTag(a) {
  return a.source_meeting_id != null
    ? `<span class="tag tag-gold src-tag" title="من محضر"><span dir="ltr">${esc(a.meeting_number || '—')}</span></span>`
    : '<span class="tag tag-gray src-tag" title="مهمة أُنشئت خارج المحاضر">مستقلة</span>';
}

/** هل يُرجَّح أن يملك المستخدم تحريك حالة هذا البند؟ (والخادم يفحصها على كل حال) */
function mayMoveTask(a) {
  return !!a.is_mine || a.created_by === State.user.id
    || may('actions.edit', ['president', 'first_supervisor'].includes(State.user.role));
}

// ---------- ١) الجدول ----------
function tableView(actions) {
  return `<table class="tbl tbl-tasks">
    <thead><tr><th>النوع</th><th>الرقم</th><th>البند</th><th>المسؤول</th><th>الأولوية</th>
      <th>الاستحقاق</th><th>الحالة</th><th>الإنجاز</th><th>الالتزام بالموعد</th><th></th></tr></thead>
    <tbody>${actions.map((a) => `<tr>
      <td>${esc(ACTION_TYPE_AR[a.type] || a.type)}</td>
      <td dir="ltr" style="text-align:right">${esc(a.display_number)}</td>
      <td>${esc(a.text)} ${sourceTag(a)}${Number(a.carried_count) > 1 ? ` <span class="tag tag-gold">رُحِّل ${arNum(a.carried_count)} مرات</span>` : ''}</td>
      <td>${personChips(a.assignees)}</td>
      <td><span class="tag ${PRIORITY_COLOR[a.priority] || 'tag-gray'}">${esc(PRIORITY_AR[a.priority] || '')}</span></td>
      <td>${fmtDate(a.due_date)}</td>
      <td>${statusTag(a.status, ACTION_STATUS_AR, ACTION_STATUS_COLOR)}</td>
      <td>${miniBar(a.progress)}</td>
      <td>${delayTag(a)}</td>
      <td class="row">
        <button class="btn-ghost btn-sm" data-open="${a.id}">تفاصيل</button>
        ${a.is_mine && a.status !== 'done' && a.status !== 'cancelled' ? `<button class="btn btn-sm" data-done="${a.id}">${icon('check', 15)} إنجاز</button>` : ''}
      </td></tr>`).join('')}</tbody></table>`;
}

// ---------- ٢) الكانبان ----------
function kanbanView(actions) {
  // التجميع بالحالة المسجَّلة لا الفعلية: «متعثّرة» المشتقّة من فوات الاستحقاق ليست
  // حالة يضعها إنسان، فلو جُمِّع عليها لعاد ما يُسحب منها إلى مكانه في اللحظة نفسها.
  const cols = KANBAN_COLS.map((s) => ({ key: s, items: actions.filter((a) => (a.recorded_status || a.status) === s) }))
    .filter((c) => c.key !== 'cancelled' || c.items.length);

  const card = (a) => {
    const overdue = Number(a.overdue_days || 0);
    return `<article class="kcard" data-open="${a.id}" ${mayMoveTask(a) ? `draggable="true" data-id="${a.id}"` : ''}>
      <div class="kc-top">
        <span class="num" dir="ltr">${esc(a.display_number)}</span>
        <span class="tag ${PRIORITY_COLOR[a.priority] || 'tag-gray'}">${esc(PRIORITY_AR[a.priority] || '')}</span>
      </div>
      <p class="kc-text">${esc(a.text)}</p>
      <div class="kc-meta">
        ${sourceTag(a)}
        ${a.due_date ? `<span class="kc-due ${overdue ? 'late' : ''}">${icon('calendar2', 13)} ${fmtDate(a.due_date)}</span>` : ''}
      </div>
      ${overdue ? `<div class="kc-late">متأخرة ${arCount(overdue, ['يومًا واحدًا', 'يومين', 'أيام', 'يومًا'])}</div>` : ''}
      <div class="kc-foot">${personChips(a.assignees)}${miniBar(a.progress)}</div>
    </article>`;
  };

  return `<div class="kb-wrap"><div class="kb">
    ${cols.map((c) => `<section class="kb-col" data-col="${c.key}">
      <header class="kb-head"><span class="dot ${ACTION_STATUS_COLOR[c.key]}"></span>
        ${esc(ACTION_STATUS_AR[c.key])}<span class="n">${arNum(c.items.length)}</span></header>
      <div class="kb-list">${c.items.map(card).join('') || '<p class="kb-empty">لا شيء هنا</p>'}</div>
    </section>`).join('')}
  </div></div>
  <p class="legend-note kb-note">اسحب البطاقة إلى عمود آخر لتغيير حالتها. والأعمدة تعرض الحالة المسجَّلة،
     وما فات استحقاقه تعلوه شارة حمراء بعدد أيام تأخّره.</p>`;
}

/** سحب البطاقة بين الأعمدة — تغييرٌ واحد يُرسل للخادم، وهو الفاصل في الصلاحية. */
function wireKanban(scope) {
  let dragId = null;
  scope.querySelectorAll('.kcard[draggable="true"]').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      dragId = el.dataset.id;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragId); } catch { /* بعض المتصفحات تتشدّد */ }
    });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); dragId = null; });
  });
  scope.querySelectorAll('.kb-col').forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave', () => col.classList.remove('over'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('over');
      const id = dragId || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
      if (!id) return;
      const status = col.dataset.col;
      const a = TaskBoard.actions.find((x) => String(x.id) === String(id));
      if (!a || (a.recorded_status || a.status) === status) return;
      try {
        await API.patch('/actions/' + id, { status });
        toast('تم تحديث الحالة', 'ok');
        loadActions();
      } catch (err) { toast(err.message, 'err'); }
    });
  });
}

// ---------- ٣) مخطط جانت ----------
const DAY_MS = 86400000;
const dayOf = (d) => Math.floor(Date.parse(String(d).slice(0, 10) + 'T00:00:00Z') / DAY_MS);
const dayToDate = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);

function ganttView(actions) {
  const plotted = actions.filter((a) => a.due_date);
  const skipped = actions.length - plotted.length;
  if (!plotted.length) {
    return `<div class="empty"><div class="ico">${icon('calendar2', 42)}</div>
      <p>لا بند له تاريخ استحقاق يُرسم على المحور</p></div>`;
  }

  const today = dayOf(new Date().toISOString());
  const rows = plotted.map((a) => {
    const due = dayOf(a.due_date);
    const startRaw = a.created_at ? dayOf(a.created_at) : due;
    const start = Math.min(startRaw, due);
    const closed = a.status === 'done' || a.status === 'cancelled';
    // امتداد أحمر يقيس ما تجاوز الوعد: إلى يوم الإنجاز إن أُنجز متأخرًا، وإلى اليوم إن بقي مفتوحًا
    const overEnd = closed
      ? (a.completed_at && dayOf(a.completed_at) > due ? dayOf(a.completed_at) : due)
      : Math.max(due, today);
    return { a, start, due, overEnd, over: overEnd > due };
  });

  const min = Math.min(...rows.map((r) => r.start), today) - 1;
  const max = Math.max(...rows.map((r) => r.overEnd), today) + 1;
  const days = Math.max(1, max - min + 1);
  const DAY_PX = days > 120 ? 8 : days > 60 ? 14 : 26;
  const pct = (n) => (n / days) * 100;

  // علامات المحور: خطوة تكفي ألا تتزاحم التواريخ
  const step = Math.max(1, Math.ceil(76 / DAY_PX));
  const ticks = [];
  for (let d = min; d <= max; d += step) {
    const iso = dayToDate(d);
    ticks.push(`<span class="g-tick" style="inset-inline-start:${pct(d - min)}%">
      <i></i><b>${arNum(iso.slice(8, 10))}/${arNum(iso.slice(5, 7))}</b></span>`);
  }
  const todayPct = today >= min && today <= max ? pct(today - min + 0.5) : null;
  const todayLine = todayPct == null ? ''
    : `<span class="g-today" style="inset-inline-start:${todayPct}%" title="اليوم"></span>`;

  const bar = (r) => {
    const w = Math.max(0.6, pct(r.due - r.start + 1));
    const key = r.a.recorded_status || r.a.status;
    const title = `${r.a.text} — من ${dayToDate(r.start)} إلى ${r.a.due_date}`;
    return `<span class="g-bar st-${key}" style="inset-inline-start:${pct(r.start - min)}%;width:${w}%" title="${esc(title)}">
        <span class="g-fill" style="width:${Math.max(0, Math.min(100, Number(r.a.progress) || 0))}%"></span></span>
      ${r.over ? `<span class="g-over" style="inset-inline-start:${pct(r.due + 1 - min)}%;width:${Math.max(0.6, pct(r.overEnd - r.due))}%"
          title="تجاوز الاستحقاق"></span>` : ''}`;
  };

  return `<div class="gantt-wrap"><div class="gantt" style="min-width:${240 + days * DAY_PX}px">
    <div class="g-name g-head">البند</div>
    <div class="g-track g-head g-axis">${ticks.join('')}${todayLine}</div>
    ${rows.map((r) => `
      <div class="g-name" data-open="${r.a.id}" title="${esc(r.a.text)}">
        <b>${esc(r.a.text)}</b>
        <span class="g-sub">${sourceTag(r.a)} ${statusTag(r.a.status, ACTION_STATUS_AR, ACTION_STATUS_COLOR)}</span>
      </div>
      <div class="g-track" data-open="${r.a.id}">${bar(r)}${todayLine}</div>`).join('')}
  </div></div>
  <div class="g-legend legend-note">
    <span><i class="sw st-not_started"></i> لم تبدأ</span>
    <span><i class="sw st-in_progress"></i> جارية</span>
    <span><i class="sw st-stalled"></i> متعثرة</span>
    <span><i class="sw st-done"></i> منجزة</span>
    <span><i class="sw sw-over"></i> تجاوز الاستحقاق</span>
    <span><i class="sw sw-today"></i> اليوم</span>
    ${skipped ? `<span>· ${arCount(skipped, ['بندٌ واحد', 'بندان', 'بنود', 'بندًا'])} بلا تاريخ استحقاق لا يظهر على المحور</span>` : ''}
  </div>`;
}

// ---------- ربط الأحداث المشتركة ----------
function wireTaskList(scope) {
  scope.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => taskDetail(b.dataset.open, loadActions));
  scope.querySelectorAll('[data-done]').forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    completeTask(b.dataset.done, loadActions);
  });
  if (TaskBoard.view === 'kanban') wireKanban(scope);
}

// ============================================================
// إنشاء مهمة مستقلة وتحريرها — في الصفحة نفسها لا في نافذة
// ============================================================
function openTaskForm(existing) {
  const box = document.getElementById('tForm');
  if (!box) return;
  TaskBoard.editing = existing || null;
  const a = TaskBoard.assign || { users: [], scope: 'self' };
  const mine = new Set(existing && existing.assignee_ids ? existing.assignee_ids.map(String) : [String(State.user.id)]);
  const due = existing && existing.due_date ? existing.due_date : new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);

  box.hidden = false;
  box.innerHTML = `
    <h4 class="tf-title">${existing ? 'تعديل المهمة' : 'مهمة جديدة'}
      ${existing ? `<span class="tag tag-gray" dir="ltr">${esc(existing.display_number)}</span>` : ''}</h4>
    <div id="tfErr"></div>
    <div class="field"><label>نص المهمة</label>
      <textarea id="tf_text" rows="2" placeholder="ما المطلوب عمله…">${esc(existing ? existing.text : '')}</textarea></div>
    <div class="row-2">
      <div class="field"><label>الأولوية</label><select id="tf_priority">
        ${['high', 'medium', 'low'].map((p) => `<option value="${p}" ${(existing ? existing.priority : 'medium') === p ? 'selected' : ''}>${PRIORITY_AR[p]}</option>`).join('')}
      </select></div>
      <div class="field"><label>تاريخ الاستحقاق <span class="muted">(إلزامي)</span></label>
        <input type="date" id="tf_due" value="${esc(due)}" />
        <div class="row chips">
          ${[['اليوم', 0], ['بعد ٣ أيام', 3], ['بعد أسبوع', 7], ['بعد أسبوعين', 14]]
            .map(([label, d]) => `<button type="button" class="chip" data-due="${d}">${label}</button>`).join('')}
        </div></div>
    </div>
    <div class="field"><label>المسؤولون
        <button type="button" class="chip" id="tf_me" style="margin-inline-start:8px">أنا</button>
        <button type="button" class="chip" id="tf_none">مسح التحديد</button></label>
      <div class="who-pick" id="tf_who">
        ${a.users.map((x) => `<label class="chip-check">
          <input type="checkbox" value="${x.id}" ${mine.has(String(x.id)) ? 'checked' : ''} />
          ${esc(x.name)}</label>`).join('') || '<span class="muted">لا أحد متاح للإسناد</span>'}
      </div>
      <div class="hint">${esc(SCOPE_HINT[a.scope] || '')} ومن لم يُسنِد أحدًا فالمهمة عليه هو.</div></div>
    <div class="row">
      <button class="btn btn-sm" id="tf_save">${existing ? 'حفظ التعديل' : 'إضافة المهمة'}</button>
      <button class="btn-ghost btn-sm" id="tf_cancel">إلغاء</button>
    </div>`;

  const dueInp = box.querySelector('#tf_due');
  box.querySelectorAll('[data-due]').forEach((b) => b.onclick = () => {
    dueInp.value = new Date(Date.now() + Number(b.dataset.due) * 864e5).toISOString().slice(0, 10);
  });
  const boxes = () => Array.from(box.querySelectorAll('#tf_who input'));
  box.querySelector('#tf_me').onclick = () => boxes().forEach((i) => { if (i.value == State.user.id) i.checked = true; });
  box.querySelector('#tf_none').onclick = () => boxes().forEach((i) => i.checked = false);
  box.querySelector('#tf_cancel').onclick = closeTaskForm;
  box.querySelector('#tf_save').onclick = saveTaskForm;
  box.querySelector('#tf_text').focus();
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeTaskForm() {
  const box = document.getElementById('tForm');
  TaskBoard.editing = null;
  if (box) { box.hidden = true; box.innerHTML = ''; }
}

async function saveTaskForm() {
  const box = document.getElementById('tForm');
  if (!box) return;
  const btn = box.querySelector('#tf_save');
  const err = box.querySelector('#tfErr');
  const payload = {
    text: box.querySelector('#tf_text').value.trim(),
    priority: box.querySelector('#tf_priority').value,
    due_date: box.querySelector('#tf_due').value || null,
    assignees: Array.from(box.querySelectorAll('#tf_who input:checked')).map((i) => Number(i.value)),
  };
  if (!payload.text) return void (err.innerHTML = '<div class="form-error">نص المهمة مطلوب</div>');
  if (!payload.due_date) return void (err.innerHTML = '<div class="form-error">تاريخ الاستحقاق إلزامي للمهمة</div>');
  // الإنشاء بلا إسناد يجعلها على منشئها، أما التعديل فيُرسل ما اختير حرفيًا
  btn.disabled = true;
  try {
    if (TaskBoard.editing) await API.patch('/actions/' + TaskBoard.editing.id, payload);
    else await API.post('/actions', payload);
    toast(TaskBoard.editing ? 'تم حفظ التعديل' : 'أُضيفت المهمة', 'ok');
    closeTaskForm();
    loadActions();
  } catch (e) {
    err.innerHTML = `<div class="form-error">${esc(e.message)}</div>`;
    btn.disabled = false;
  }
}

/** تحرير مهمة مستقلة من نافذة التفاصيل — يفتح لوحة الشاشة لا نافذة أخرى. */
function editStandaloneTask(action, assigneeIds) {
  const t = { ...action, assignee_ids: assigneeIds };
  if (document.getElementById('tForm')) return openTaskForm(t);
  TaskBoard.pendingEdit = t;
  location.hash = '#/tasks';
  route();
}

// ---- لوحة الالتزام: نسبة الإنجاز ودقة التوقيت والتأخير لكل مكلَّف ----
async function loadPerformance() {
  const box = document.getElementById('tBody');
  let d;
  try { d = await API.get('/actions/stats'); } catch (err) { return void (box.innerHTML = `<div class="empty">${esc(err.message)}</div>`); }
  const o = d.overall;
  const tone = (v) => (v >= 80 ? 'stat-ok' : v >= 50 ? 'stat-warn' : 'stat-bad');

  const rows = d.board.map((r) => `<tr>
    <td>${personChips([{ n: r.name, c: r.color }])}<div class="muted" style="font-size:12px">${esc(ROLE_AR[r.role] || r.role)}</div></td>
    <td>${arNum(r.total)}</td>
    <td>${arNum(r.done)}</td>
    <td>${r.stalled ? `<span class="tag tag-red">${arNum(r.stalled)}</span>` : arNum(0)}</td>
    <td>${arNum(r.late)}</td>
    <td>${(() => { const d = Math.max(r.delay_max || 0, r.overdue_days_max || 0);
      return d ? `<span class="tag tag-red">${arNum(d)}</span>` : arNum(0); })()}</td>
    <td>${arNum(r.delay_avg)}</td>
    <td>${miniBar(r.completion_rate)}</td>
    <td>${miniBar(r.timeliness)}</td>
    <td>${miniBar(r.commitment)}</td>
  </tr>`).join('');

  const stalledHtml = (d.stalled && d.stalled.length) ? `
    <div class="card mt"><div class="card-head"><h3>أكثر البنود تعثّرًا</h3></div>
      <table class="tbl"><thead><tr><th>الرقم</th><th>البند</th><th>المسؤول</th><th>المحضر</th>
        <th>الاستحقاق</th><th>التأخر</th><th>مرات الترحيل</th><th>الإنجاز</th></tr></thead>
      <tbody>${d.stalled.map((a) => `<tr>
        <td dir="ltr" style="text-align:right">${esc(a.display_number)}</td>
        <td>${esc(a.text)}</td><td>${personChips(a.assignees)}</td>
        <td dir="ltr" style="text-align:right">${esc(a.meeting_number || 'مستقلة')}</td>
        <td>${fmtDate(a.due_date)}</td>
        <td>${a.overdue_days ? `<span class="tag tag-red">${arCount(a.overdue_days, ['يومًا واحدًا', 'يومين', 'أيام', 'يومًا'])}</span>` : '<span class="muted">—</span>'}</td>
        <td>${arNum(a.carried_count || 0)}</td>
        <td>${miniBar(a.progress)}</td></tr>`).join('')}</tbody></table></div>` : '';

  box.innerHTML = `
    <div class="grid grid-4">
      <div class="stat ${tone(o.completion_rate)}"><div class="v">${arNum(o.completion_rate)}٪</div><div class="l">نسبة الإنجاز</div>
        <div class="s">${arNum(o.done)} من ${arNum(o.total)} بندًا</div></div>
      <div class="stat ${tone(o.timeliness)}"><div class="v">${arNum(o.timeliness)}٪</div><div class="l">دقة التوقيت</div>
        <div class="s">${arNum(o.on_time)} في الموعد · ${arNum(o.late)} متأخرة</div></div>
      <div class="stat ${o.stalled ? 'stat-bad' : 'stat-ok'}"><div class="v">${arNum(o.stalled)}</div><div class="l">بنود متعثّرة الآن</div>
        <div class="s">أطول تأخّر ${arCount(o.overdue_days_max || 0, ['يوم واحد', 'يومان', 'أيام', 'يومًا'])}</div></div>
      <div class="stat ${o.delay_max ? 'stat-bad' : 'stat-ok'}"><div class="v">${arNum(o.delay_max)}</div><div class="l">أطول تأخير عند الإنجاز</div>
        <div class="s">${o.late ? `على ${arCount(o.late, ['بند واحد', 'بندين', 'بنود', 'بندًا'])} أُنجزت متأخرة · متوسط ${arFixed(o.delay_avg)} يوم` : 'لا بند أُنجز متأخرًا'}</div></div>
    </div>
    <div class="card mt"><div class="card-head"><h3>الالتزام حسب المكلَّف</h3>
      <div class="spacer"></div><span class="legend-note">نسبة الالتزام = ٦٠٪ إنجاز + ٤٠٪ دقة توقيت</span></div>
      ${d.board.length ? `<table class="tbl"><thead><tr><th>المكلَّف</th><th>المُسنَد</th><th>المنجَز</th>
        <th>متعثرة الآن</th><th>أُنجزت متأخرة</th><th>أطول تأخير</th><th>متوسط التأخير</th>
        <th>نسبة الإنجاز</th><th>دقة التوقيت</th><th>الالتزام</th></tr></thead><tbody>${rows}</tbody></table>`
        : `<div class="empty"><div class="ico">${icon('tasks', 42)}</div><p>لا توجد بنود مُسندة بعد</p></div>`}
    </div>
    ${stalledHtml}
    <p class="muted mt">تشمل الأرقام بنود المحاضر والمهام المستقلة معًا — فالمكلَّف يُقاس بما عليه لا بمصدره.</p>
    ${d.scope === 'self' ? '<p class="muted">تُعرض بياناتك وحدها — لوحة المجلس الكاملة لمن يملك اطلاعًا كاملًا عليه.</p>' : ''}`;
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

// تفويض/إعادة إسناد بند إلى عضو آخر
async function delegateTask(id, onDone) {
  let cands = [];
  try { cands = (await API.get(`/actions/${id}/delegate-candidates`)).candidates; }
  catch (err) { return toast(err.message, 'err'); }
  openModal({
    title: 'تفويض البند',
    body: `<div id="dgErr"></div>
      <div class="field"><label>المفوَّض إليه</label>
        <select id="dg_to"><option value="">— اختر عضوًا —</option>
          ${cands.filter((x) => x.user_id !== State.user.id).map((x) => `<option value="${x.user_id}">${esc(x.name)} (${esc(ROLE_AR[x.role] || x.role)})</option>`).join('')}
        </select></div>
      <label class="check-row"><input type="checkbox" id="dg_keep" /> أبقني مسؤولًا أيضًا</label>
      <div class="field mt"><label>ملاحظة (اختياري)</label><input id="dg_note" /></div>`,
    buttons: [
      { label: 'تفويض', onClick: async (cl, ov) => {
        const to = ov.querySelector('#dg_to').value;
        if (!to) return toast('اختر عضوًا', 'err');
        try {
          await API.post(`/actions/${id}/delegate`, {
            to_user_id: Number(to), keep_me: ov.querySelector('#dg_keep').checked,
            note: ov.querySelector('#dg_note').value.trim() || null,
          });
          cl(); toast('تم التفويض', 'ok'); if (onDone) onDone();
        } catch (err) { ov.querySelector('#dgErr').innerHTML = `<div class="form-error">${esc(err.message)}</div>`; }
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
  // القرار من الخادم: منشئُ المهمة المستقلة يديرها ولو لم يملك «تعديل البنود» بدوره
  const canManage = d.can_manage || iAmAssignee;
  const standalone = !!a.is_standalone;

  const attList = d.attachments.map((at) =>
    `<li><a href="/api/actions/${id}/attachments/${at.id}" target="_blank">${esc(at.file_name)}</a> <span class="muted">${fmtDateTime(at.uploaded_at)}</span></li>`).join('');

  openModal({
    title: `${ACTION_TYPE_AR[a.type] || a.type} — ${a.display_number}`,
    body: `
      <p>${esc(a.text)}</p>
      <div class="row-2 mt">
        <div><span class="muted">الأولوية:</span> ${esc(PRIORITY_AR[a.priority] || '')}</div>
        <div><span class="muted">الاستحقاق:</span> ${fmtDate(a.due_date)}</div>
        <div><span class="muted">الحالة:</span> ${statusTag(a.effective_status || a.status, ACTION_STATUS_AR, ACTION_STATUS_COLOR)}</div>
        <div><span class="muted">نسبة الإنجاز:</span> ${arNum(a.progress)}٪</div>
        <div><span class="muted">المصدر:</span> ${d.meeting ? `محضر <span dir="ltr">${esc(d.meeting.display_number)}</span>` : 'مهمة مستقلة (بلا محضر)'}</div>
        <div><span class="muted">تاريخ الإنجاز:</span> ${a.completed_at ? fmtDateTime(a.completed_at) : '—'}</div>
      </div>
      <p class="mt"><span class="muted">المسؤولون:</span> ${personChips(d.assignees.map((x) => ({ n: x.name, c: x.color })))}</p>
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
      ...(standalone && d.can_manage && a.status !== 'done' && a.status !== 'cancelled'
        ? [{ label: 'تعديل المهمة', class: 'btn-ghost', onClick: (cl) => { cl(); editStandaloneTask(a, d.assignees.map((x) => x.user_id)); } }] : []),
      ...(iAmAssignee && a.status !== 'done' ? [{ label: 'تعليم منجزاً', onClick: (cl) => { cl(); completeTask(id, () => { if (onBack) onBack(); }); } }] : []),
      ...(canManage && a.status === 'done' ? [{ label: 'إعادة فتح', class: 'btn-ghost', onClick: async (cl) => { try { await API.post(`/actions/${id}/reopen`); cl(); toast('تمت إعادة الفتح', 'ok'); if (onBack) onBack(); } catch (err) { toast(err.message, 'err'); } } }] : []),
      ...(canManage && a.status !== 'done' && a.status !== 'cancelled' ? [{ label: 'تفويض', class: 'btn-ghost', onClick: (cl) => { cl(); delegateTask(id, onBack); } }] : []),
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
