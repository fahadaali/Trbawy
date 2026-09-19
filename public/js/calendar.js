// وحدة التقويم (الواجهة) — شهرٌ واحد أمام العين: الاجتماعات بتواريخها، والمهام
// والقرارات باستحقاقها.
//
// لا كيان جديد هنا: الشاشة قراءةٌ ثانية لما في المنصة بنافذة زمنية. وما يظهر فيها
// محكومٌ بنموذج الاطلاع نفسه الذي تُصفّى به شاشتا المحاضر والمهام — يفحصه الخادم.
//
// والتاريخان معًا في كل خانة: الميلادي كبيرًا لأنه ميزان المواعيد في الأنظمة، والهجري
// تحته صغيرًا لأنه ميزان المحاضر في هذه المنصة. والأسبوع يبدأ بالأحد كما هو أسبوع
// العمل، والجمعة والسبت في آخره مميَّزتان.

const GREG_MONTHS_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];
const HIJRI_MONTHS_AR = [
  'محرّم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة',
  'رجب', 'شعبان', 'رمضان', 'شوّال', 'ذو القعدة', 'ذو الحجة',
];
const WEEKDAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const WEEKDAYS_SHORT = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];

// ---------- التاريخ الهجري (أم القرى) ----------
// المتصفحات الحديثة تحمل التقويم كاملًا في Intl. وإن لم تحمله سقطت الشاشة إلى
// الميلادي وحده بلا أن ينكسر شيء — فالهجري هنا زيادةُ بيانٍ لا شرطُ عمل.
let _hijriFmt = null;
function hijriFormatter() {
  if (_hijriFmt !== null) return _hijriFmt;
  try {
    _hijriFmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura',
      { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' });
  } catch { _hijriFmt = false; }
  return _hijriFmt;
}

/** { d, m, y } هجريًا لتاريخ ميلادي (YYYY-MM-DD)، أو null إن تعذّر. */
function hijriOf(iso) {
  const fmt = hijriFormatter();
  if (!fmt) return null;
  try {
    const [y, m, d] = iso.split('-').map(Number);
    const parts = fmt.formatToParts(new Date(Date.UTC(y, m - 1, d, 12)));
    const num = (t) => Number((parts.find((p) => p.type === t) || {}).value.replace(/[^0-9]/g, ''));
    const out = { d: num('day'), m: num('month'), y: num('year') };
    return out.d && out.m && out.y ? out : null;
  } catch { return null; }
}

const isoOf = (y, m, d) =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const weekdayOf = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
};

// ---------- حالة الشاشة ----------
const CalView = {
  year: 0, month: 0,           // الشهر المعروض (ميلادي)
  data: null,                  // ما وصل من الخادم لهذا الشهر
  scope: 'all',                // all | mine
  show: { meetings: true, actions: true },
  selected: null,              // اليوم المفتوح تفصيلًا (YYYY-MM-DD)
  today: '',
};

VIEWS.calendar = async () => {
  setTitle('التقويم');
  const now = new Date();
  if (!CalView.year) { CalView.year = now.getFullYear(); CalView.month = now.getMonth() + 1; }
  CalView.scope = LS.get('calendar.scope') === 'mine' ? 'mine' : 'all';
  try {
    const saved = JSON.parse(LS.get('calendar.show') || 'null');
    if (saved && typeof saved === 'object') CalView.show = { meetings: !!saved.meetings, actions: !!saved.actions };
    if (!CalView.show.meetings && !CalView.show.actions) CalView.show = { meetings: true, actions: true };
  } catch { /* تفضيلٌ غير حرج */ }

  content().innerHTML = `
    <div class="card cal-card">
      <div class="card-body tb-toolbar cal-toolbar" id="calBar"></div>
      <div id="calGridBox"><div class="spinner"></div></div>
    </div>
    <div id="calDay" class="mt"></div>`;
  renderCalBar();
  await loadCalendar();
};

/** شريط التنقّل: الشهر والسنة سهامًا وقائمتَي اختيار، ومعهما المصفّيات. */
function renderCalBar() {
  const bar = document.getElementById('calBar');
  if (!bar) return;
  const thisYear = new Date().getFullYear();
  const years = [];
  for (let y = thisYear - 6; y <= thisYear + 6; y++) years.push(y);
  if (!years.includes(CalView.year)) { years.push(CalView.year); years.sort((a, b) => a - b); }

  // السهم يُقلَب: محرفا «‹» و«›» من المحارف المرآتية، فيُرسمان في سياق عربي معكوسَين.
  // فيُكتب هنا ضدُّ ما يُراد رسمه: «السابق» — وموضعه يمين — يُكتب «‹» ليُرسم متّجهًا يمينًا.
  bar.innerHTML = `
    <div class="cal-nav">
      <button class="btn-ghost btn-sm nb" id="calPrevY" title="السنة السابقة" aria-label="السنة السابقة">‹‹</button>
      <button class="btn-ghost btn-sm nb" id="calPrevM" title="الشهر السابق" aria-label="الشهر السابق">‹</button>
      <select id="calMonth" aria-label="الشهر">
        ${GREG_MONTHS_AR.map((n, i) =>
          `<option value="${i + 1}" ${i + 1 === CalView.month ? 'selected' : ''}>${n}</option>`).join('')}
      </select>
      <select id="calYear" aria-label="السنة">
        ${years.map((y) => `<option value="${y}" ${y === CalView.year ? 'selected' : ''}>${arNum(y)}</option>`).join('')}
      </select>
      <button class="btn-ghost btn-sm nb" id="calNextM" title="الشهر التالي" aria-label="الشهر التالي">›</button>
      <button class="btn-ghost btn-sm nb" id="calNextY" title="السنة التالية" aria-label="السنة التالية">››</button>
      <button class="btn-ghost btn-sm" id="calToday">اليوم</button>
    </div>
    <div class="spacer"></div>
    <div class="seg" role="group" aria-label="نطاق العرض">
      <button type="button" class="${CalView.scope === 'all' ? 'on' : ''}" data-scope="all">الكل</button>
      <button type="button" class="${CalView.scope === 'mine' ? 'on' : ''}" data-scope="mine">ما يخصّني</button>
    </div>
    <div class="cal-toggles">
      <label class="chip-check"><input type="checkbox" id="calShowM" ${CalView.show.meetings ? 'checked' : ''} />اجتماعات</label>
      <label class="chip-check"><input type="checkbox" id="calShowA" ${CalView.show.actions ? 'checked' : ''} />مهام</label>
    </div>`;

  const go = (dm) => {
    let m = CalView.month + dm;
    let y = CalView.year;
    while (m > 12) { m -= 12; y++; }
    while (m < 1) { m += 12; y--; }
    CalView.month = m; CalView.year = y; CalView.selected = null;
    renderCalBar(); loadCalendar();
  };
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on('calPrevM', () => go(-1));
  on('calNextM', () => go(1));
  on('calPrevY', () => go(-12));
  on('calNextY', () => go(12));
  on('calToday', () => {
    const n = new Date();
    CalView.year = n.getFullYear(); CalView.month = n.getMonth() + 1;
    CalView.selected = CalView.today || null;
    renderCalBar(); loadCalendar();
  });
  const jump = () => {
    CalView.month = Number(document.getElementById('calMonth').value);
    CalView.year = Number(document.getElementById('calYear').value);
    CalView.selected = null;
    loadCalendar();
  };
  document.getElementById('calMonth').onchange = jump;
  document.getElementById('calYear').onchange = jump;

  // المصفّيات لا تُعيد الجلب: البيانات بين يدي الواجهة والرسم وحده يتغيّر
  bar.querySelectorAll('[data-scope]').forEach((b) => b.onclick = () => {
    CalView.scope = b.dataset.scope;
    LS.set('calendar.scope', CalView.scope);
    bar.querySelectorAll('[data-scope]').forEach((x) => x.classList.toggle('on', x.dataset.scope === CalView.scope));
    renderCalendar();
  });
  const sync = () => {
    const m = document.getElementById('calShowM').checked;
    const a = document.getElementById('calShowA').checked;
    CalView.show = { meetings: m, actions: a };
    LS.set('calendar.show', JSON.stringify(CalView.show));
    renderCalendar();
  };
  document.getElementById('calShowM').onchange = sync;
  document.getElementById('calShowA').onchange = sync;
}

async function loadCalendar() {
  const box = document.getElementById('calGridBox');
  if (!box) return;
  box.innerHTML = '<div class="spinner"></div>';
  try {
    CalView.data = await API.get(`/calendar?year=${CalView.year}&month=${CalView.month}`);
    CalView.today = CalView.data.today;
  } catch (err) { return renderError(err); }
  if (!document.getElementById('calGridBox')) return;   // غادر المستخدم الشاشة
  renderCalendar();
}

/** ما يُعرض بعد المصفّيات — الشاشة تُصفّي ما وصلها، والخادم صفّى ما يحقّ له. */
function calItems() {
  const d = CalView.data || { meetings: [], actions: [] };
  const mine = CalView.scope === 'mine';
  return {
    meetings: CalView.show.meetings ? d.meetings.filter((m) => !mine || m.is_attendee) : [],
    actions: CalView.show.actions ? d.actions.filter((a) => !mine || a.is_mine) : [],
  };
}

/** فهرسٌ باليوم: ما يقع في كل تاريخ من اجتماعات وبنود. */
function calIndex(items) {
  const by = {};
  const slot = (iso) => (by[iso] ||= { meetings: [], actions: [] });
  items.meetings.forEach((m) => slot(String(m.greg_date).slice(0, 10)).meetings.push(m));
  items.actions.forEach((a) => slot(String(a.due_date).slice(0, 10)).actions.push(a));
  return by;
}

function renderCalendar() {
  const box = document.getElementById('calGridBox');
  if (!box || !CalView.data) return;
  const { year, month } = CalView;
  const items = calItems();
  const by = calIndex(items);

  const total = daysInMonth(year, month);
  const firstDow = weekdayOf(isoOf(year, month, 1));
  const rows = Math.ceil((firstDow + total) / 7);
  const prevTotal = daysInMonth(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1);

  const cells = [];
  for (let i = 0; i < rows * 7; i++) {
    const dayNum = i - firstDow + 1;
    if (dayNum < 1) {
      const m = month === 1 ? 12 : month - 1;
      const y = month === 1 ? year - 1 : year;
      cells.push({ iso: isoOf(y, m, prevTotal + dayNum), out: true });
    } else if (dayNum > total) {
      const m = month === 12 ? 1 : month + 1;
      const y = month === 12 ? year + 1 : year;
      cells.push({ iso: isoOf(y, m, dayNum - total), out: true });
    } else {
      cells.push({ iso: isoOf(year, month, dayNum), out: false });
    }
  }

  const hFirst = hijriOf(isoOf(year, month, 1));
  const hLast = hijriOf(isoOf(year, month, total));
  const hijriLabel = hFirst && hLast
    ? (hFirst.m === hLast.m && hFirst.y === hLast.y
      ? `${HIJRI_MONTHS_AR[hFirst.m - 1]} ${arNum(hFirst.y)}هـ`
      : `${HIJRI_MONTHS_AR[hFirst.m - 1]} – ${HIJRI_MONTHS_AR[hLast.m - 1]} ${arNum(hLast.y)}هـ`)
    : '';

  box.innerHTML = `
    <div class="cal-head">
      <h3>${GREG_MONTHS_AR[month - 1]} <span class="num">${arNum(year)}</span></h3>
      ${hijriLabel ? `<span class="cal-hijri">${hijriLabel}</span>` : ''}
      <div class="spacer"></div>
      <span class="cal-count">${monthCountLabel(items)}</span>
    </div>
    <div class="cal-grid" role="grid" aria-label="تقويم الشهر">
      ${WEEKDAYS_AR.map((w, i) => `<div class="cal-dow ${i >= 5 ? 'off' : ''}">
        <span class="only-desktop">${w}</span><span class="only-mobile">${WEEKDAYS_SHORT[i]}</span></div>`).join('')}
      ${cells.map((c) => dayCellHtml(c, by[c.iso])).join('')}
    </div>
    <div class="cal-legend">
      <span><i class="dot dot-meeting"></i> اجتماع</span>
      <span><i class="dot dot-open"></i> بند مفتوح</span>
      <span><i class="dot dot-done"></i> منجَز</span>
      <span><i class="dot dot-late"></i> متأخر عن استحقاقه</span>
      <span class="muted">اضغط أي يوم لتفصيله</span>
    </div>`;

  box.querySelectorAll('[data-day]').forEach((el) => el.onclick = () => selectDay(el.dataset.day));
  const panel = document.getElementById('calDay');
  if (CalView.selected) renderDayPanel(CalView.selected);
  else if (panel) panel.innerHTML = '';
}

function monthCountLabel(items) {
  const parts = [];
  if (CalView.show.meetings) {
    parts.push(items.meetings.length
      ? arCount(items.meetings.length, ['اجتماع واحد', 'اجتماعان', 'اجتماعات', 'اجتماعًا'])
      : 'لا اجتماعات');
  }
  if (CalView.show.actions) {
    parts.push(items.actions.length
      ? arCount(items.actions.length, ['بند مستحقّ', 'بندان مستحقّان', 'بنود مستحقّة', 'بندًا مستحقًّا'])
      : 'لا بنود مستحقّة');
  }
  return parts.join(' · ');
}

/** لون البند في التقويم يتبع حالته الفعلية لا المسجَّلة. */
const actionDot = (a) =>
  a.status === 'done' ? 'dot-done'
    : a.status === 'cancelled' ? 'dot-cancel'
      : a.status === 'stalled' || Number(a.overdue_days) > 0 ? 'dot-late' : 'dot-open';

const MAX_CHIPS = 3;

function dayCellHtml(cell, slot) {
  const h = hijriOf(cell.iso);
  const dow = weekdayOf(cell.iso);
  const gDay = Number(cell.iso.slice(8, 10));
  const cls = [
    'cal-day',
    cell.out ? 'out' : '',
    dow >= 5 ? 'off' : '',
    cell.iso === CalView.today ? 'today' : '',
    cell.iso === CalView.selected ? 'sel' : '',
  ].filter(Boolean).join(' ');

  const all = [
    ...(slot ? slot.meetings.map((m) => ({
      k: 'meeting', dot: 'dot-meeting',
      label: (m.start_time ? fmtTime(m.start_time) + ' ' : '') + (m.title || m.display_number),
      mine: m.is_attendee,
    })) : []),
    ...(slot ? slot.actions.map((a) => ({
      k: 'action', dot: actionDot(a), label: a.text, mine: a.is_mine,
    })) : []),
  ];
  const shown = all.slice(0, MAX_CHIPS);
  const more = all.length - shown.length;

  return `<div class="${cls}" data-day="${cell.iso}" role="gridcell" tabindex="0"
      aria-label="${esc(WEEKDAYS_AR[dow])} ${esc(arNum(cell.iso.replace(/-/g, '/')))}">
    <div class="cal-dnum">
      <b>${arNum(gDay)}</b>
      ${h ? `<span class="hj">${arNum(h.d)}</span>` : ''}
    </div>
    <div class="cal-ev">
      ${shown.map((e) => `<span class="cal-chip ${e.dot}${e.mine ? ' mine' : ''}" title="${esc(e.label)}">
        <i class="dot ${e.dot}"></i><span>${esc(e.label)}</span></span>`).join('')}
      ${more > 0 ? `<span class="cal-more">+${arNum(more)}</span>` : ''}
    </div>
    ${all.length ? `<div class="cal-dots">${all.slice(0, 6).map((e) => `<i class="dot ${e.dot}"></i>`).join('')}</div>` : ''}
  </div>`;
}

function selectDay(iso) {
  CalView.selected = CalView.selected === iso ? null : iso;
  document.querySelectorAll('.cal-day').forEach((el) => el.classList.toggle('sel', el.dataset.day === CalView.selected));
  const panel = document.getElementById('calDay');
  if (!CalView.selected) { if (panel) panel.innerHTML = ''; return; }
  renderDayPanel(CalView.selected);
  if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** لوحة اليوم: كل ما فيه مسرودًا، وكلُّ سطر يفتح سجلّه. */
function renderDayPanel(iso) {
  const box = document.getElementById('calDay');
  if (!box) return;
  const by = calIndex(calItems());
  const slot = by[iso] || { meetings: [], actions: [] };
  const h = hijriOf(iso);
  const dow = weekdayOf(iso);
  const head = `${WEEKDAYS_AR[dow]} ${arNum(iso.replace(/-/g, '/'))}${h ? ` — ${arNum(h.d)} ${HIJRI_MONTHS_AR[h.m - 1]} ${arNum(h.y)}هـ` : ''}`;

  if (!slot.meetings.length && !slot.actions.length) {
    box.innerHTML = `<div class="card"><div class="card-head"><h3>${esc(head)}</h3>
      <div class="spacer"></div><button class="btn-ghost btn-sm" id="calDayX">إغلاق</button></div>
      <div class="card-body"><p class="muted">لا اجتماع ولا بند مستحقّ في هذا اليوم.</p></div></div>`;
    document.getElementById('calDayX').onclick = () => selectDay(iso);
    return;
  }

  const meetRows = slot.meetings.map((m) => `
    <tr style="cursor:pointer" data-go="meetings/${m.id}">
      <td class="nb">${m.start_time ? `${fmtTime(m.start_time)}${m.end_time ? ' — ' + fmtTime(m.end_time) : ''}` : '<span class="muted">غير محدّد</span>'}</td>
      <td><div class="cellbox"><b dir="ltr" style="display:inline-block">${esc(m.display_number)}</b>
        ${m.title ? `<div>${esc(m.title)}</div>` : ''}
        <span class="muted" style="font-size:12.5px">${esc(COUNCIL_TYPE_AR[m.council_type] || m.council_name)}</span></div></td>
      <td>${esc(m.location || (m.location_type === 'remote' ? 'عن بُعد' : '—'))}</td>
      <td><div class="cellbox">${statusTag(m.status, MEETING_STATUS_AR, MEETING_STATUS_COLOR)}
        ${m.is_attendee ? '<span class="tag tag-green">مدعوّ</span>' : ''}</div></td>
    </tr>`).join('');

  const actRows = slot.actions.map((a) => `
    <tr style="cursor:pointer" data-go="tasks/${a.id}">
      <td>${statusTag(a.type, ACTION_TYPE_AR, {})}</td>
      <td><div class="cellbox"><b dir="ltr" style="display:inline-block">${esc(a.display_number)}</b>
        <div>${esc(a.text)}</div>
        <span class="muted" style="font-size:12.5px">${a.meeting_number ? esc(a.meeting_number) : 'مهمة مستقلة'}</span></div></td>
      <td>${personChips(a.assignees)}</td>
      <td><div class="cellbox">${statusTag(a.status, ACTION_STATUS_AR, ACTION_STATUS_COLOR)}
        ${a.is_mine ? '<span class="tag tag-green">لي</span>' : ''}</div></td>
      <td>${miniBar(a.progress)}</td>
    </tr>`).join('');

  box.innerHTML = `
    <div class="card"><div class="card-head"><h3>${esc(head)}</h3>
      <div class="spacer"></div><button class="btn-ghost btn-sm" id="calDayX">إغلاق</button></div>
      ${slot.meetings.length ? `<div class="card-body" style="padding-bottom:0"><b>الاجتماعات</b></div>
        <table class="tbl"><thead><tr><th>الوقت</th><th>الاجتماع</th><th>المكان</th><th>الحالة</th></tr></thead>
        <tbody>${meetRows}</tbody></table>` : ''}
      ${slot.actions.length ? `<div class="card-body" style="padding-bottom:0"><b>البنود المستحقّة</b></div>
        <table class="tbl"><thead><tr><th>النوع</th><th>البند</th><th>المسؤول</th><th>الحالة</th><th>الإنجاز</th></tr></thead>
        <tbody>${actRows}</tbody></table>` : ''}
    </div>`;
  document.getElementById('calDayX').onclick = () => selectDay(iso);
  box.querySelectorAll('[data-go]').forEach((tr) => tr.onclick = () => nav(tr.dataset.go));
}
