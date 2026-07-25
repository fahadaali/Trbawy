// وحدة المحاضر (الواجهة) — قائمة، إنشاء، تفاصيل، تحرير، حالات، اعتماد، إلغاء.

const ATT_STATUS_AR = { present: 'حاضر', apology: 'معتذر', absent: 'غائب' };

// هل يملك المستخدم صلاحية إنشاء محضر لهذا المجلس؟ (يطابق canCreateMeeting في الخلفية)
function hijriFromGreg(greg) {
  if (!greg) return '';
  try {
    return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(greg)) + 'هـ';
  } catch { return ''; }
}

VIEWS.meetings = async (rest) => {
  if (rest && rest[0] === 'new') return meetingCreate();
  if (rest && rest[0]) return meetingDetail(rest[0]);
  return meetingList();
};

// ---- القائمة ----
async function meetingList() {
  setTitle('المحاضر');
  content().innerHTML = '<div class="spinner"></div>';
  let councils = [];
  try { councils = (await API.get('/councils')).councils; } catch (err) { return renderError(err); }

  const canCreate = councils.some(canCreateForCouncil);

  const councilOpts = councils.map((c) => `<option value="${c.id}">${esc(COUNCIL_TYPE_AR[c.type] || c.name)}</option>`).join('');
  const statusOpts = Object.entries(MEETING_STATUS_AR).map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  // سنوات هجرية للتصفية (السنة الحالية وأربع سابقة)
  const curHijri = Number(new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { year: 'numeric' })
    .formatToParts(new Date()).find((x) => x.type === 'year').value.replace(/\D/g, ''));
  const yearOpts = Array.from({ length: 5 }, (_, i) => curHijri - i)
    .map((y) => `<option value="${y}">${arNum(y)}هـ</option>`).join('');

  content().innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3>المحاضر</h3>
        <div class="spacer"></div>
        <button class="btn-ghost btn-sm" id="bundleBtn">${icon('package', 16)} تصدير حزمة</button>
        ${canCreate ? '<button class="btn btn-sm" id="newMeeting">+ دعوة/محضر جديد</button>' : ''}
      </div>
      <div class="card-body">
        <div class="row" style="margin-bottom:14px">
          <select id="fCouncil" style="padding:9px 12px;border:1px solid var(--border);border-radius:8px"><option value="">كل المجالس</option>${councilOpts}</select>
          <select id="fStatus" style="padding:9px 12px;border:1px solid var(--border);border-radius:8px"><option value="">كل الحالات</option>${statusOpts}</select>
          <select id="fYear" style="padding:9px 12px;border:1px solid var(--border);border-radius:8px"><option value="">كل السنوات</option>${yearOpts}</select>
          <input id="fQ" placeholder="بحث في الرقم والعنوان والبنود والحضور والمهام" style="flex:1;min-width:200px;padding:9px 12px;border:1px solid var(--border);border-radius:8px" />
          <button class="btn-ghost btn-sm" id="fApply">تصفية</button>
        </div>
        <div id="mList"><div class="spinner"></div></div>
      </div>
    </div>`;

  if (canCreate) document.getElementById('newMeeting').onclick = () => nav('meetings/new');
  document.getElementById('bundleBtn').onclick = () => {
    openModal({
      title: 'تصدير حزمة محاضر',
      body: `<p class="muted">تُصدَّر المحاضر المعتمدة لمجلس في فترة محددة في ملف واحد.</p>
        <div class="field"><label>المجلس</label><select id="bn_council">${councilOpts}</select></div>
        <div class="row-2"><div class="field"><label>من تاريخ</label><input type="date" id="bn_from" /></div>
          <div class="field"><label>إلى تاريخ</label><input type="date" id="bn_to" /></div></div>`,
      buttons: [
        { label: 'تصدير', onClick: (cl, ov) => {
          const cid = ov.querySelector('#bn_council').value;
          const from = ov.querySelector('#bn_from').value, to = ov.querySelector('#bn_to').value;
          if (!cid || !from || !to) return toast('حدد المجلس والفترة', 'err');
          window.open(`/print/bundle?council_id=${cid}&from=${from}&to=${to}&print=1`, '_blank'); cl();
        }},
        { label: 'إلغاء', class: 'btn-ghost', onClick: (cl) => cl() },
      ],
    });
  };
  const load = async () => {
    const p = new URLSearchParams();
    if (document.getElementById('fCouncil').value) p.set('council_id', document.getElementById('fCouncil').value);
    if (document.getElementById('fStatus').value) p.set('status', document.getElementById('fStatus').value);
    if (document.getElementById('fYear').value) p.set('year', document.getElementById('fYear').value);
    if (document.getElementById('fQ').value) p.set('q', document.getElementById('fQ').value);
    const box = document.getElementById('mList');
    box.innerHTML = '<div class="spinner"></div>';
    try {
      const { meetings } = await API.get('/meetings?' + p.toString());
      if (!meetings.length) { box.innerHTML = `<div class="empty"><div class="ico">${icon('meetings', 42)}</div><p>لا توجد محاضر</p></div>`; return; }
      box.innerHTML = `<table class="tbl">
        <thead><tr><th>رقم المحضر</th><th>العنوان</th><th>المجلس</th><th>التاريخ</th><th>الحالة</th><th></th></tr></thead>
        <tbody>${meetings.map((m) => `<tr>
          <td dir="ltr" style="text-align:right"><b>${esc(m.display_number)}</b></td>
          <td>${esc(m.title || '—')}</td>
          <td>${esc(COUNCIL_TYPE_AR[m.council_type] || m.council_name)}</td>
          <td>${esc(m.hijri_date || m.greg_date || '—')}</td>
          <td>${statusTag(m.status, MEETING_STATUS_AR, MEETING_STATUS_COLOR)}</td>
          <td><button class="btn-ghost btn-sm" data-open="${m.id}">عرض</button></td>
        </tr>`).join('')}</tbody></table>`;
      box.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => nav('meetings/' + b.dataset.open));
    } catch (err) { box.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  };
  document.getElementById('fApply').onclick = load;
  onEnter('fQ', load);
  load();
}

// ---- إنشاء ----
async function meetingCreate() {
  setTitle('دعوة/محضر جديد');
  content().innerHTML = '<div class="spinner"></div>';
  let councils;
  try { councils = (await API.get('/councils')).councils; } catch (err) { return renderError(err); }
  const creatable = councils.filter(canCreateForCouncil);
  if (!creatable.length) { content().innerHTML = '<div class="card"><div class="empty">لا تملك صلاحية إنشاء محاضر</div></div>'; return; }

  const today = new Date().toISOString().slice(0, 10);
  content().innerHTML = `
    <div class="card"><div class="card-head"><h3>دعوة/محضر جديد</h3><div class="spacer"></div>
      <button class="btn-ghost btn-sm" onclick="nav('meetings')">رجوع</button></div>
      <div class="card-body">
        <div id="mcErr"></div>
        <div class="row-2">
          <div class="field"><label>المجلس</label><select id="mc_council">${creatable.map((c) => `<option value="${c.id}">${esc(COUNCIL_TYPE_AR[c.type] || c.name)}</option>`).join('')}</select>
            <div class="hint">رقم المحضر المتوقع: <b id="mc_preview">—</b></div></div>
          <div class="field"><label>عنوان الاجتماع (اختياري)</label><input id="mc_title" placeholder="مثل: الاجتماع الدوري الأول" /></div>
        </div>
        <div class="row-2">
          <div class="field"><label>التاريخ الميلادي</label><input type="date" id="mc_greg" value="${today}" /></div>
          <div class="field"><label>التاريخ الهجري</label><input id="mc_hijri" value="${hijriFromGreg(today)}" readonly style="background:#f0f2f1" /></div>
        </div>
        <div class="row-2">
          <div class="field"><label>وقت البداية</label><input type="time" id="mc_start" /></div>
          <div class="field"><label>وقت النهاية</label><input type="time" id="mc_end" /></div>
        </div>
        <div class="row-2">
          <div class="field"><label>نوع المكان</label><select id="mc_loctype"><option value="in_person">حضوري</option><option value="remote">عن بُعد</option></select></div>
          <div class="field"><label>المكان / رابط الاجتماع</label><input id="mc_loc" /></div>
        </div>
        <div class="field"><label>الكاتب (يحرّر المسودة فقط)</label><select id="mc_writer"></select></div>

        <h4 class="mt">الحضور</h4>
        <div id="mc_members" class="mt"></div>
        <h4 class="mt">الضيوف (لا يوقّعون)</h4>
        <div id="mc_guests"></div>
        <button class="btn-ghost btn-sm mt" id="mc_addGuest">+ إضافة ضيف</button>

        <h4 class="mt">بنود جدول الأعمال الجديدة</h4>
        <p class="hint">البنود الثابتة (التلاوة، مراجعة المحضر السابق...) تُضاف تلقائياً.</p>
        <div id="mc_agenda"></div>
        <button class="btn-ghost btn-sm mt" id="mc_addItem">+ إضافة بند</button>

        <div class="mt"><button class="btn" id="mc_save">إنشاء الدعوة</button></div>
      </div></div>`;

  const guests = [];
  const agenda = [];
  const renderGuests = () => {
    document.getElementById('mc_guests').innerHTML = guests.map((g, i) => `
      <div class="row" style="margin-bottom:8px">
        <input placeholder="اسم الضيف" data-g-name="${i}" value="${esc(g.name)}" style="flex:1;padding:8px 11px;border:1px solid var(--border);border-radius:8px" />
        <input placeholder="الصفة" data-g-title="${i}" value="${esc(g.title)}" style="flex:1;padding:8px 11px;border:1px solid var(--border);border-radius:8px" />
        <button class="btn-ghost btn-sm" data-g-del="${i}">حذف</button>
      </div>`).join('');
    document.querySelectorAll('[data-g-name]').forEach((el) => el.oninput = () => guests[el.dataset.gName].name = el.value);
    document.querySelectorAll('[data-g-title]').forEach((el) => el.oninput = () => guests[el.dataset.gTitle].title = el.value);
    document.querySelectorAll('[data-g-del]').forEach((el) => el.onclick = () => { guests.splice(el.dataset.gDel, 1); renderGuests(); });
  };
  const renderAgenda = () => {
    document.getElementById('mc_agenda').innerHTML = agenda.map((a, i) => `
      <div class="row" style="margin-bottom:8px">
        <input placeholder="عنوان البند" data-a-title="${i}" value="${esc(a.title)}" style="flex:1;padding:8px 11px;border:1px solid var(--border);border-radius:8px" />
        <button class="btn-ghost btn-sm" data-a-del="${i}">حذف</button>
      </div>`).join('');
    document.querySelectorAll('[data-a-title]').forEach((el) => el.oninput = () => agenda[el.dataset.aTitle].title = el.value);
    document.querySelectorAll('[data-a-del]').forEach((el) => el.onclick = () => { agenda.splice(el.dataset.aDel, 1); renderAgenda(); });
  };
  document.getElementById('mc_addGuest').onclick = () => { guests.push({ name: '', title: '' }); renderGuests(); };
  document.getElementById('mc_addItem').onclick = () => { agenda.push({ title: '' }); renderAgenda(); };

  const loadMeta = async () => {
    const cid = document.getElementById('mc_council').value;
    try {
      const meta = await API.get('/meetings/meta/new?council_id=' + cid);
      document.getElementById('mc_preview').textContent = meta.preview_number;
      document.getElementById('mc_writer').innerHTML = '<option value="">— الكاتب الافتراضي —</option>' +
        meta.members.map((m) => `<option value="${m.user_id}" ${meta.default_writer_id === m.user_id ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
      document.getElementById('mc_members').innerHTML = meta.members.map((m) => `
        <div class="row" style="margin-bottom:6px">
          <span style="flex:1"><b>${esc(m.name)}</b> <span class="muted">${esc(ROLE_AR[m.role] || '')}</span></span>
          <select data-att="${m.user_id}" style="padding:7px 10px;border:1px solid var(--border);border-radius:8px">
            <option value="present">حاضر</option><option value="apology">معتذر</option><option value="absent">غائب</option>
          </select>
        </div>`).join('');
    } catch (err) { toast(err.message, 'err'); }
  };
  document.getElementById('mc_council').onchange = loadMeta;
  document.getElementById('mc_greg').onchange = (e) => { document.getElementById('mc_hijri').value = hijriFromGreg(e.target.value); };
  await loadMeta();

  document.getElementById('mc_save').onclick = async () => {
    const attendees = Array.from(document.querySelectorAll('[data-att]')).map((s) => ({ user_id: Number(s.dataset.att), attendance_status: s.value }));
    const payload = {
      council_id: Number(document.getElementById('mc_council').value),
      title: document.getElementById('mc_title').value.trim() || null,
      greg_date: document.getElementById('mc_greg').value,
      hijri_date: document.getElementById('mc_hijri').value,
      start_time: document.getElementById('mc_start').value || null,
      end_time: document.getElementById('mc_end').value || null,
      location_type: document.getElementById('mc_loctype').value,
      location: document.getElementById('mc_loc').value.trim() || null,
      writer_id: document.getElementById('mc_writer').value ? Number(document.getElementById('mc_writer').value) : null,
      attendees,
      guests: guests.filter((g) => g.name.trim()),
      agenda: agenda.filter((a) => a.title.trim()),
    };
    try {
      const { id } = await API.post('/meetings', payload);
      toast('تم إنشاء الدعوة', 'ok');
      nav('meetings/' + id);
    } catch (err) { document.getElementById('mcErr').innerHTML = `<div class="form-error">${esc(err.message)}</div>`; }
  };
}

// ---- التفاصيل ----
async function meetingDetail(id) {
  setTitle('المحضر');
  content().innerHTML = '<div class="spinner"></div>';
  let d;
  try { d = await API.get('/meetings/' + id); } catch (err) { return renderError(err); }
  const m = d.meeting, p = d.perms;

  const attRows = d.attendees.map((a) => `<tr>
    <td>${a.is_guest ? esc(a.guest_name) + ' <span class="tag tag-gray">ضيف</span>' : esc(a.user_name)}</td>
    <td>${a.is_guest ? esc(a.guest_title || '') : esc(ROLE_AR[a.user_role] || '')}</td>
    <td>${esc(ATT_STATUS_AR[a.attendance_status] || a.attendance_status)}</td>
    <td>${a.signed_at ? '<span class="tag tag-green">وقّع</span>' : (a.is_guest || a.attendance_status !== 'present' ? '—' : '<span class="tag tag-gold">بانتظار التوقيع</span>')}</td>
  </tr>`).join('');

  const agendaHtml = d.agenda.map((it) => `<li><b>${esc(it.title)}</b>${it.item_type === 'fixed' ? ' <span class="tag tag-gray">ثابت</span>' : ''}${it.body ? `<div class="body-rich" style="font-size:14px">${it.body}</div>` : ''}</li>`).join('');

  const linksHtml = (d.parent || (d.amendments && d.amendments.length)) ? `<div class="card mt"><div class="card-body">
    ${d.parent ? `<div>محضر تصويب/ملحق للمحضر: <a href="#/meetings/${d.parent.id}"><b dir="ltr">${esc(d.parent.display_number)}</b></a></div>` : ''}
    ${(d.amendments && d.amendments.length) ? `<div>محاضر التصويب/الملحق: ${d.amendments.map((a) => `<a href="#/meetings/${a.id}" dir="ltr">${esc(a.display_number)}</a>`).join('، ')}</div>` : ''}
  </div></div>` : '';

  const followupHtml = d.followups && d.followups.length ? `
    <div class="card mt"><div class="card-head"><h3>جدول المتابعة (بنود سابقة مفتوحة)</h3></div>
      <table class="tbl"><thead><tr><th>النوع</th><th>الرقم</th><th>النص</th><th>الحالة</th><th>الإنجاز</th><th>تاريخ الإنجاز</th>${p.can_edit ? '<th></th>' : ''}</tr></thead>
      <tbody>${d.followups.map((f) => `<tr><td>${esc(ACTION_TYPE_AR[f.type] || f.type)}</td><td dir="ltr" style="text-align:right">${esc(f.display_number)}</td>
        <td>${esc(f.text)}</td><td>${statusTag(f.status, ACTION_STATUS_AR)}</td><td>${arNum(f.progress)}٪</td>
        <td>${f.completed_at ? fmtDateTime(f.completed_at) : '—'}</td>
        ${p.can_edit ? `<td>${f.status === 'done' ? `<button class="btn-ghost btn-sm" data-fixdate="${f.id}">تعديل التاريخ</button>` : ''}</td>` : ''}</tr>`).join('')}</tbody></table></div>` : '';

  const actionsHtml = (d.actions && d.actions.length) || p.can_edit ? `
    <div class="card mt"><div class="card-head"><h3>القرارات والتوصيات والمهام</h3><div class="spacer"></div>
      ${p.can_edit && State.aiEnabled ? aiBtn('btnAiExtract', 'استخراج بالذكاء الاصطناعي') : ''}
      ${p.can_edit ? '<button class="btn btn-sm" id="btnAddAction">+ إضافة بند</button>' : ''}</div>
      ${(d.actions && d.actions.length) ? `<table class="tbl"><thead><tr><th>النوع</th><th>الرقم</th><th>النص</th><th>المسؤول</th><th>الاستحقاق</th><th>الحالة</th><th></th></tr></thead>
      <tbody>${d.actions.map((a) => `<tr><td>${esc(ACTION_TYPE_AR[a.type] || a.type)}</td><td dir="ltr" style="text-align:right">${esc(a.display_number)}</td><td>${esc(a.text)}</td>
        <td>${esc(a.assignees || '—')}</td><td>${a.due_date ? esc(a.due_date) : '—'}</td><td>${statusTag(a.status, ACTION_STATUS_AR)}</td>
        <td><button class="btn-ghost btn-sm" data-openaction="${a.id}">عرض</button>${p.can_edit ? `<button class="btn-ghost btn-sm" data-editaction="${a.id}">تعديل</button>` : ''}</td></tr>`).join('')}</tbody></table>`
      : '<div class="card-body muted">لا توجد بنود بعد.</div>'}</div>` : '';

  const btns = [];
  if (m.status === 'invitation' && p.can_edit) btns.push(`<button class="btn btn-sm" id="btnStart">بدء تحرير المسودة</button>`);
  if (p.can_edit) {
    btns.push(`<button class="btn-ghost btn-sm" id="btnHeader">تعديل الترويسة</button>`);
    btns.push(`<button class="btn-ghost btn-sm" id="btnAgenda">تعديل البنود</button>`);
    btns.push(`<button class="btn-ghost btn-sm" id="btnAtt">تعديل الحضور</button>`);
  }
  if (p.can_sign) btns.push(`<button class="btn btn-sm" id="btnSign">${icon('pen', 16)} توقيع المحضر</button>`);
  if (p.can_submit) btns.push(`<button class="btn btn-sm" id="btnSubmit">إرسال للتوقيعات</button>`);
  if (p.can_approve) btns.push(`<button class="btn btn-sm" id="btnApprove">اعتماد وإقفال</button>`);
  if (p.can_revert) btns.push(`<button class="btn-ghost btn-sm" id="btnRevert">إرجاع إلى المسودة</button>`);
  if (p.can_archive) btns.push(`<button class="btn-ghost btn-sm" id="btnArchive">أرشفة</button>`);
  if (p.can_print) btns.push(`<button class="btn-ghost btn-sm" id="btnPrint">${icon('print', 16)} طباعة / تصدير PDF</button>`);
  btns.push(`<button class="btn-ghost btn-sm" id="btnIcs">${icon('calendar2', 16)} إضافة للتقويم</button>`);
  if (State.aiEnabled) btns.push(aiBtn('btnAiSummary', 'ملخّص تنفيذي'));
  if (canCreateForCouncil(d.council)) btns.push(`<button class="btn-ghost btn-sm" id="btnDup">${icon('copy', 16)} نسخ كمحضر جديد</button>`);
  if (p.can_amend) btns.push(`<button class="btn-ghost btn-sm" id="btnAmend">${icon('meetings', 16)} محضر تصويب/ملحق</button>`);
  if (p.can_cancel) btns.push(`<button class="btn-danger btn-sm" id="btnCancel">إلغاء المحضر</button>`);

  // لوحة التوقيعات في مرحلة الانتظار
  let signPanel = '';
  if (m.status === 'awaiting_signatures') {
    const present = d.attendees.filter((a) => !a.is_guest && a.attendance_status === 'present');
    const pending = present.filter((a) => !a.signed_at && !a.signature_override);
    signPanel = `<div class="card mt"><div class="card-head"><h3>حالة التوقيعات</h3></div><div class="card-body">
      ${pending.length ? `<div class="tag tag-gold" style="display:block;padding:8px">بانتظار توقيع: ${pending.map((a) => esc(a.user_name)).join('، ')}</div>` : `<div class="tag tag-green" style="display:block;padding:8px">اكتملت التوقيعات ${icon('check', 15)}</div>`}
      <table class="tbl mt"><thead><tr><th>العضو</th><th>التوقيع</th><th>الوقت</th><th>الرمز</th>${p.can_override ? '<th></th>' : ''}</tr></thead><tbody>
      ${present.map((a) => `<tr><td>${esc(a.user_name)}</td>
        <td>${a.signed_at ? '<span class="tag tag-green">وقّع</span>' : (a.signature_override ? '<span class="tag tag-gold">تجاوز</span>' : '<span class="tag tag-gray">لم يوقّع</span>')}</td>
        <td>${a.signed_at ? fmtDateTime(a.signed_at) : '—'}</td><td dir="ltr" style="text-align:right" class="muted">${esc(a.signature_hash || '')}</td>
        ${p.can_override ? `<td>${!a.signed_at && !a.signature_override ? `<button class="btn-ghost btn-sm" data-override="${a.user_id}">تجاوز</button>` : ''}</td>` : ''}</tr>`).join('')}
      </tbody></table></div></div>`;
  }

  content().innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3 dir="ltr" style="text-align:right">${esc(m.display_number)}</h3>
        <div class="spacer"></div>
        ${statusTag(m.status, MEETING_STATUS_AR, MEETING_STATUS_COLOR)}
        <button class="btn-ghost btn-sm" onclick="nav('meetings')">رجوع</button>
      </div>
      <div class="card-body">
        ${m.status === 'cancelled' ? `<div class="form-error">هذا المحضر <b>ملغى</b>. السبب: ${esc(m.cancel_reason || '')}</div>` : ''}
        ${m.status === 'approved' ? `<div class="tag tag-green" style="display:block;padding:10px">${icon('check', 15)} محضر معتمد ومقفل — أي تصحيح يكون عبر محضر تصويب/ملحق.</div>` : ''}
        <div class="row-2 mt">
          <div><span class="muted">العنوان:</span> ${esc(m.title || '—')}</div>
          <div><span class="muted">المجلس:</span> ${esc(COUNCIL_TYPE_AR[d.council.type] || d.council.name)}</div>
          <div><span class="muted">التاريخ الهجري:</span> ${esc(m.hijri_date || '—')}</div>
          <div><span class="muted">التاريخ الميلادي:</span> ${esc(m.greg_date || '—')}</div>
          <div><span class="muted">الوقت:</span> ${m.start_time ? esc(m.start_time) : '—'} ${m.end_time ? '– ' + esc(m.end_time) : ''}</div>
          <div><span class="muted">المكان:</span> ${m.location_type === 'remote' ? 'عن بُعد' : 'حضوري'} ${m.location ? '— ' + esc(m.location) : ''}</div>
        </div>
        <div class="row mt">${btns.join('')}</div>
      </div>
    </div>

    ${linksHtml}
    ${signPanel}

    <div class="row-2 mt">
      <div class="card"><div class="card-head"><h3>${icon('paperclip', 16)} مرفقات المحضر</h3></div>
        <div class="card-body"><div id="mAtt"><div class="spinner"></div></div>
          ${p.can_edit ? `<div class="row mt"><input type="file" id="mAttFile" style="flex:1" /><button class="btn-ghost btn-sm" id="mAttUp">رفع</button></div>` : ''}
        </div></div>
      <div class="card"><div class="card-head"><h3>${icon('comment', 16)} المناقشة</h3></div>
        <div class="card-body"><div id="mCom"><div class="spinner"></div></div>
          ${['approved', 'archived', 'cancelled'].includes(m.status) ? '<p class="muted mt">المحضر مقفل — لا تُقبل تعليقات جديدة.</p>'
            : `<div class="row mt"><input id="mComTxt" placeholder="اكتب تعليقًا…" style="flex:1;padding:9px 12px;border:1px solid var(--border);border-radius:8px" />
                 <button class="btn btn-sm" id="mComAdd">إضافة</button></div>`}
        </div></div>
    </div>

    <div class="card mt"><div class="card-head"><h3>الحضور</h3></div>
      <table class="tbl"><thead><tr><th>الاسم</th><th>الصفة</th><th>الحالة</th><th>التوقيع</th></tr></thead><tbody>${attRows}</tbody></table></div>

    <div class="card mt"><div class="card-head"><h3>جدول الأعمال والبنود</h3></div>
      <div class="card-body"><ul style="padding-inline-start:18px;line-height:2.2">${agendaHtml || '<li class="muted">لا توجد بنود</li>'}</ul></div></div>
    ${followupHtml}
    ${actionsHtml}`;

  const reload = () => meetingDetail(id);
  const doStatus = async (action) => { try { await API.post(`/meetings/${id}/status`, { action }); toast('تم', 'ok'); reload(); } catch (err) { toast(err.message, 'err'); } };
  bind('btnStart', () => doStatus('start_draft'));
  bind('btnSubmit', () => confirmModal('إرسال للتوقيعات', 'سينتقل المحضر إلى حالة «بانتظار التوقيعات». متابعة؟', () => doStatus('submit')));
  bind('btnApprove', () => confirmModal('اعتماد وإقفال', 'بعد الاعتماد يُقفل المحضر نهائياً ولا يقبل التعديل. متابعة؟', async () => {
    try { await API.post(`/meetings/${id}/status`, { action: 'approve' }); toast('تم الاعتماد', 'ok'); reload(); }
    catch (err) { if (err.data && err.data.pending) toast('بانتظار توقيع: ' + err.data.pending.join('، '), 'err'); else toast(err.message, 'err'); }
  }));
  bind('btnArchive', () => doStatus('archive'));
  bind('btnRevert', () => confirmModal('إرجاع إلى المسودة',
    'سيعود المحضر قابلًا للتحرير، وتُلغى كل التوقيعات المسجّلة (يلزم إعادة التوقيع). متابعة؟',
    () => doStatus('revert'), { danger: true }));
  bind('btnSign', () => confirmModal('توقيع المحضر', 'بالتوقيع تقرّ بمحتوى المحضر. سيُسجَّل وقت التوقيع ورمز تحقق فريد. متابعة؟', async () => {
    try { await API.post(`/meetings/${id}/sign`); toast('تم التوقيع', 'ok'); reload(); } catch (err) { toast(err.message, 'err'); }
  }));
  bind('btnPrint', () => window.open(`/print/meeting/${id}?print=1`, '_blank'));
  bind('btnIcs', () => { window.location.href = `/ics/meeting/${id}`; });
  bind('btnDup', () => confirmModal('نسخ كمحضر جديد',
    'سيُنشأ محضر جديد (دعوة) بنفس البنود والحضور والترويسة، برقم جديد. متابعة؟', async () => {
      try { const r = await API.post(`/meetings/${id}/duplicate`, {}); toast('تم إنشاء نسخة: ' + r.display_number, 'ok'); nav('meetings/' + r.id); }
      catch (err) { toast(err.message, 'err'); }
    }));

  // مرفقات المحضر
  const loadAtt = async () => {
    const box = document.getElementById('mAtt');
    if (!box) return;
    try {
      const { attachments } = await API.get(`/meetings/${id}/attachments`);
      box.innerHTML = attachments.length ? `<ul style="padding-inline-start:18px;line-height:2">${attachments.map((a) => `
        <li><a href="/api/meetings/${id}/attachments/${a.id}" target="_blank">${esc(a.file_name)}</a>
          <span class="muted" style="font-size:12px">${esc(a.uploaded_by_name || '')} · ${fmtDateTime(a.uploaded_at)}</span>
          ${p.can_edit ? `<button class="btn-ghost btn-sm" data-delatt="${a.id}">حذف</button>` : ''}</li>`).join('')}</ul>`
        : '<p class="muted">لا مرفقات</p>';
      box.querySelectorAll('[data-delatt]').forEach((b) => b.onclick = async () => {
        try { await API.del(`/meetings/${id}/attachments/${b.dataset.delatt}`); loadAtt(); } catch (err) { toast(err.message, 'err'); }
      });
    } catch (err) { box.innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
  };
  loadAtt();
  bind('mAttUp', async () => {
    const f = document.getElementById('mAttFile').files[0];
    if (!f) return toast('اختر ملفًا', 'err');
    try {
      const res = await fetch(`/api/meetings/${id}/attachments?name=${encodeURIComponent(f.name)}`,
        { method: 'PUT', body: f, credentials: 'same-origin', headers: { 'content-type': f.type || 'application/octet-stream' } });
      if (!res.ok) throw new Error('فشل الرفع');
      toast('تم رفع المرفق', 'ok'); document.getElementById('mAttFile').value = ''; loadAtt();
    } catch (err) { toast(err.message, 'err'); }
  });

  // المناقشة
  const loadCom = async () => {
    const box = document.getElementById('mCom');
    if (!box) return;
    try {
      const { comments } = await API.get(`/meetings/${id}/comments`);
      box.innerHTML = comments.length ? comments.map((cm) => `
        <div style="padding:9px 0;border-bottom:1px solid #f0f2f1">
          <div class="row"><b style="flex:1;font-size:13.5px">${esc(cm.user_name)}</b>
            <span class="muted" style="font-size:11.5px">${fmtDateTime(cm.created_at)}</span>
            ${(cm.user_id === State.user.id || State.user.role === 'president') ? `<button class="btn-ghost btn-sm" data-delcom="${cm.id}">حذف</button>` : ''}</div>
          <div style="font-size:14px">${esc(cm.body)}</div></div>`).join('')
        : '<p class="muted">لا تعليقات بعد</p>';
      box.querySelectorAll('[data-delcom]').forEach((b) => b.onclick = async () => {
        try { await API.del(`/meetings/${id}/comments/${b.dataset.delcom}`); loadCom(); } catch (err) { toast(err.message, 'err'); }
      });
    } catch (err) { box.innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
  };
  loadCom();
  const addCom = async () => {
    const inp = document.getElementById('mComTxt');
    const body = inp.value.trim();
    if (!body) return;
    try { await API.post(`/meetings/${id}/comments`, { body }); inp.value = ''; loadCom(); }
    catch (err) { toast(err.message, 'err'); }
  };
  bind('mComAdd', addCom);
  onEnter('mComTxt', addCom);
  bind('btnAmend', () => confirmModal('محضر تصويب/ملحق', 'سيُنشأ محضر جديد (مسودة) مرتبط بهذا المحضر لإجراء التصحيح. متابعة؟', async () => {
    try { const r = await API.post(`/meetings/${id}/amend`); toast('تم إنشاء محضر التصويب', 'ok'); nav('meetings/' + r.id); } catch (err) { toast(err.message, 'err'); }
  }));
  content().querySelectorAll('[data-override]').forEach((b) => b.onclick = () => {
    const uid = b.dataset.override;
    openModal({ title: 'تجاوز التوقيع', body: `<p class="muted">يُستخدم عند تعذّر توقيع العضو. يُسجَّل السبب في التدقيق.</p><div class="field"><label>سبب التجاوز</label><textarea id="ovr" rows="2"></textarea></div>`,
      buttons: [
        { label: 'تأكيد التجاوز', onClick: async (cl, ov) => { const reason = ov.querySelector('#ovr').value.trim(); if (!reason) return toast('السبب مطلوب', 'err');
          try { await API.post(`/meetings/${id}/override/${uid}`, { reason }); cl(); toast('تم التجاوز', 'ok'); reload(); } catch (err) { toast(err.message, 'err'); } }},
        { label: 'إلغاء', class: 'btn-ghost', onClick: (cl) => cl() },
      ]});
  });
  bind('btnHeader', () => editHeader(id, m, d));
  bind('btnAgenda', () => editAgenda(id, d));
  bind('btnAtt', () => editAttendees(id, d));
  bind('btnCancel', () => {
    openModal({ title: 'إلغاء المحضر', body: `<div class="field"><label>سبب الإلغاء</label><textarea id="cxr" rows="3"></textarea></div>`,
      buttons: [
        { label: 'تأكيد الإلغاء', class: 'btn-danger', onClick: async (cl, ov) => {
          const reason = ov.querySelector('#cxr').value.trim();
          if (!reason) return toast('السبب مطلوب', 'err');
          try { await API.post(`/meetings/${id}/cancel`, { reason }); cl(); toast('تم الإلغاء', 'ok'); reload(); } catch (err) { toast(err.message, 'err'); }
        }},
        { label: 'تراجع', class: 'btn-ghost', onClick: (cl) => cl() },
      ]});
  });

  // إدارة القرارات/المهام
  const members = d.attendees.filter((a) => !a.is_guest);
  bind('btnAddAction', () => actionForm(id, members, null));
  bind('btnAiSummary', () => aiSummaryDialog(id));
  // نص المناقشة المبدئي = محتوى بنود جدول الأعمال بعد تجريد الوسوم
  bind('btnAiExtract', () => {
    const seed = (d.agenda || [])
      .map((a) => `${a.title}: ${String(a.body || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()}`)
      .join('\n');
    aiExtractDialog(id, seed, reload);
  });
  content().querySelectorAll('[data-editaction]').forEach((b) =>
    b.onclick = () => actionForm(id, members, d.actions.find((x) => x.id == b.dataset.editaction)));
  content().querySelectorAll('[data-openaction]').forEach((b) =>
    b.onclick = () => (typeof taskDetail === 'function' ? taskDetail(b.dataset.openaction, reload) : nav('tasks')));
  content().querySelectorAll('[data-fixdate]').forEach((b) =>
    b.onclick = () => adjustCompletionDate(b.dataset.fixdate, reload));
}

// نموذج إنشاء/تعديل قرار/توصية/مهمة داخل محضر
function actionForm(meetingId, members, existing) {
  const isEdit = !!existing;
  openModal({
    title: isEdit ? 'تعديل بند' : 'قرار / توصية / مهمة جديدة',
    body: `
      <div id="afErr"></div>
      <div class="field"><label>النوع</label><select id="af_type" ${isEdit ? 'disabled' : ''}>
        <option value="decision" ${existing && existing.type === 'decision' ? 'selected' : ''}>قرار</option>
        <option value="recommendation" ${existing && existing.type === 'recommendation' ? 'selected' : ''}>توصية</option>
        <option value="task" ${!existing || existing.type === 'task' ? 'selected' : ''}>مهمة</option>
      </select></div>
      <div class="field"><label>النص</label><textarea id="af_text" rows="3">${existing ? esc(existing.text) : ''}</textarea></div>
      <div class="row-2">
        <div class="field"><label>الأولوية</label><select id="af_priority">
          ${['high', 'medium', 'low'].map((p) => `<option value="${p}" ${existing && existing.priority === p ? 'selected' : ''}>${PRIORITY_AR[p]}</option>`).join('')}
        </select></div>
        <div class="field"><label>تاريخ الاستحقاق <span class="muted" id="af_dueHint"></span></label><input type="date" id="af_due" value="${existing && existing.due_date ? esc(existing.due_date) : ''}" /></div>
      </div>
      <div class="field"><label>المسؤولون</label>
        <div id="af_assignees" style="max-height:150px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px">
          ${members.map((m) => `<label class="check-row"><input type="checkbox" value="${m.user_id}" /> ${esc(m.user_name)}</label>`).join('')}
        </div></div>`,
    buttons: [
      { label: 'حفظ', onClick: async (cl, ov) => {
        const type = ov.querySelector('#af_type').value;
        const assignees = Array.from(ov.querySelectorAll('#af_assignees input:checked')).map((i) => Number(i.value));
        const payload = {
          type, text: ov.querySelector('#af_text').value.trim(),
          priority: ov.querySelector('#af_priority').value,
          due_date: ov.querySelector('#af_due').value || null,
          assignees,
        };
        try {
          if (isEdit) await API.patch('/actions/' + existing.id, payload);
          else await API.post('/actions/meeting/' + meetingId, payload);
          cl(); toast('تم الحفظ', 'ok'); meetingDetail(meetingId);
        } catch (err) { ov.querySelector('#afErr').innerHTML = `<div class="form-error">${esc(err.message)}</div>`; }
      }},
      { label: 'إلغاء', class: 'btn-ghost', onClick: (cl) => cl() },
    ],
  });
  // إبراز أن الاستحقاق إلزامي للمهمة
  const upd = () => { document.getElementById('af_dueHint').textContent = document.getElementById('af_type').value === 'task' ? '(إلزامي)' : '(اختياري)'; };
  document.getElementById('af_type').onchange = upd; upd();
}

function adjustCompletionDate(actionId, onDone) {
  openModal({
    title: 'تعديل تاريخ الإنجاز',
    body: `<p class="muted">يبقى التاريخ الأصلي محفوظاً في سجل التدقيق.</p>
      <div class="field"><label>تاريخ الإنجاز الفعلي</label><input type="date" id="cd_date" /></div>`,
    buttons: [
      { label: 'حفظ', onClick: async (cl, ov) => {
        const v = ov.querySelector('#cd_date').value;
        if (!v) return toast('التاريخ مطلوب', 'err');
        try { await API.patch(`/actions/${actionId}/completion-date`, { completed_at: v }); cl(); toast('تم', 'ok'); if (onDone) onDone(); } catch (err) { toast(err.message, 'err'); }
      }},
      { label: 'إلغاء', class: 'btn-ghost', onClick: (cl) => cl() },
    ],
  });
}

function bind(elId, fn) { const el = document.getElementById(elId); if (el) el.onclick = fn; }

function editHeader(id, m, d) {
  const members = d.attendees.filter((a) => !a.is_guest);
  openModal({
    title: 'تعديل ترويسة المحضر',
    body: `
      <div class="field"><label>عنوان الاجتماع</label><input id="eh_title" value="${esc(m.title || '')}" /></div>
      <div class="row-2">
        <div class="field"><label>التاريخ الميلادي</label><input type="date" id="eh_greg" value="${esc(m.greg_date || '')}" /></div>
        <div class="field"><label>التاريخ الهجري</label><input id="eh_hijri" value="${esc(m.hijri_date || '')}" readonly style="background:#f0f2f1" /></div>
      </div>
      <div class="row-2">
        <div class="field"><label>وقت البداية</label><input type="time" id="eh_start" value="${esc(m.start_time || '')}" /></div>
        <div class="field"><label>وقت النهاية</label><input type="time" id="eh_end" value="${esc(m.end_time || '')}" /></div>
      </div>
      <div class="row-2">
        <div class="field"><label>نوع المكان</label><select id="eh_loctype"><option value="in_person" ${m.location_type !== 'remote' ? 'selected' : ''}>حضوري</option><option value="remote" ${m.location_type === 'remote' ? 'selected' : ''}>عن بُعد</option></select></div>
        <div class="field"><label>المكان / الرابط</label><input id="eh_loc" value="${esc(m.location || '')}" /></div>
      </div>
      <div class="field"><label>كاتب المحضر</label><select id="eh_writer"><option value="">— الافتراضي —</option>${members.map((mm) => `<option value="${mm.user_id}" ${m.writer_id === mm.user_id ? 'selected' : ''}>${esc(mm.user_name)}</option>`).join('')}</select></div>`,
    buttons: [
      { label: 'حفظ', onClick: async (cl, ov) => {
        const payload = {
          title: ov.querySelector('#eh_title').value.trim() || null,
          greg_date: ov.querySelector('#eh_greg').value,
          hijri_date: ov.querySelector('#eh_hijri').value,
          start_time: ov.querySelector('#eh_start').value || null,
          end_time: ov.querySelector('#eh_end').value || null,
          location_type: ov.querySelector('#eh_loctype').value,
          location: ov.querySelector('#eh_loc').value.trim() || null,
          writer_id: ov.querySelector('#eh_writer').value ? Number(ov.querySelector('#eh_writer').value) : null,
        };
        try { await API.patch('/meetings/' + id, payload); cl(); toast('تم الحفظ', 'ok'); meetingDetail(id); } catch (err) { toast(err.message, 'err'); }
      }},
      { label: 'إلغاء', class: 'btn-ghost', onClick: (cl) => cl() },
    ],
  });
  const g = document.getElementById('eh_greg');
  g.onchange = () => { document.getElementById('eh_hijri').value = hijriFromGreg(g.value); };
}

function editAgenda(id, d) {
  const items = d.agenda.map((a) => ({ title: a.title, body: a.body, item_type: a.item_type }));
  const render = (ov) => {
    ov.querySelector('#ea_list').innerHTML = items.map((it, i) => `
      <div class="drag-row" draggable="true" data-idx="${i}">
        <span class="drag-handle" title="اسحب لإعادة الترتيب">⠿</span>
        <input data-t="${i}" value="${esc(it.title)}" style="flex:1;padding:8px 11px;border:1px solid var(--border);border-radius:8px" />
        ${it.item_type === 'fixed' ? '<span class="tag tag-gray">ثابت</span>' : ''}
        <button class="btn-ghost btn-sm" data-up="${i}" title="أعلى" ${i === 0 ? 'disabled' : ''}>▲</button>
        <button class="btn-ghost btn-sm" data-dn="${i}" title="أسفل" ${i === items.length - 1 ? 'disabled' : ''}>▼</button>
        <button class="btn-ghost btn-sm" data-body="${i}">محتوى${it.body ? ' ✓' : ''}</button>
        <button class="btn-ghost btn-sm" data-d="${i}">حذف</button>
      </div>`).join('');
    ov.querySelectorAll('[data-t]').forEach((el) => el.oninput = () => items[el.dataset.t].title = el.value);
    ov.querySelectorAll('[data-d]').forEach((el) => el.onclick = () => { items.splice(el.dataset.d, 1); render(ov); });
    ov.querySelectorAll('[data-body]').forEach((el) => el.onclick = () => editItemBody(items, +el.dataset.body, () => render(ov), id));
    const move = (from, to) => {
      if (to < 0 || to >= items.length) return;
      items.splice(to, 0, items.splice(from, 1)[0]);
      render(ov);
    };
    ov.querySelectorAll('[data-up]').forEach((el) => el.onclick = () => move(+el.dataset.up, +el.dataset.up - 1));
    ov.querySelectorAll('[data-dn]').forEach((el) => el.onclick = () => move(+el.dataset.dn, +el.dataset.dn + 1));

    // السحب والإفلات
    let dragIdx = null;
    ov.querySelectorAll('.drag-row').forEach((row) => {
      row.ondragstart = (e) => { dragIdx = +row.dataset.idx; row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; };
      row.ondragend = () => row.classList.remove('dragging');
      row.ondragover = (e) => { e.preventDefault(); row.classList.add('drag-over'); };
      row.ondragleave = () => row.classList.remove('drag-over');
      row.ondrop = (e) => {
        e.preventDefault(); row.classList.remove('drag-over');
        const to = +row.dataset.idx;
        if (dragIdx != null && dragIdx !== to) move(dragIdx, to);
        dragIdx = null;
      };
    });
  };
  const { overlay } = openModal({
    title: 'تعديل بنود جدول الأعمال',
    body: `<div id="ea_list"></div><button class="btn-ghost btn-sm mt" id="ea_add">+ إضافة بند</button>`,
    buttons: [
      { label: 'حفظ', onClick: async (cl) => {
        try { await API.put(`/meetings/${id}/agenda`, { items: items.filter((x) => x.title.trim()) }); cl(); toast('تم الحفظ', 'ok'); meetingDetail(id); } catch (err) { toast(err.message, 'err'); }
      }},
      { label: 'إلغاء', class: 'btn-ghost', onClick: (cl) => cl() },
    ],
  });
  render(overlay);
  overlay.querySelector('#ea_add').onclick = () => { items.push({ title: '', body: null, item_type: 'new' }); render(overlay); };
}

// تحرير محتوى بند بالمحرر الغني (مع مساعد الصياغة عند تهيئة الذكاء الاصطناعي)
function editItemBody(items, i, onDone, meetingId) {
  const ed = richEditor(items[i].body || '');
  const showAi = State.aiEnabled && meetingId;
  const { overlay, close } = openModal({
    title: 'محتوى البند (محرر غني)',
    body: `${showAi ? `<div class="row" style="margin-bottom:10px">${aiBtn('ib_ai', 'صياغة بالذكاء الاصطناعي')}</div>` : ''}<div id="rich_mount"></div>`,
    buttons: [
      { label: 'حفظ المحتوى', onClick: () => { items[i].body = ed.getHtml(); close(); if (onDone) onDone(); } },
      { label: 'إلغاء', class: 'btn-ghost', onClick: (cl) => cl() },
    ],
  });
  overlay.querySelector('#rich_mount').appendChild(ed.el);
  if (showAi) {
    overlay.querySelector('#ib_ai').onclick = () =>
      aiComposeDialog(meetingId, items[i].title || '', (html) => { ed.setHtml(html); toast('أُدرجت الصياغة — راجعها قبل الحفظ', 'ok'); });
  }
}

function editAttendees(id, d) {
  const members = d.attendees.filter((a) => !a.is_guest);
  const guests = d.attendees.filter((a) => a.is_guest).map((g) => ({ name: g.guest_name, title: g.guest_title || '' }));
  const renderGuests = (ov) => {
    ov.querySelector('#eag').innerHTML = guests.map((g, i) => `
      <div class="row" style="margin-bottom:8px">
        <input data-gn="${i}" value="${esc(g.name)}" placeholder="اسم الضيف" style="flex:1;padding:8px 11px;border:1px solid var(--border);border-radius:8px" />
        <input data-gt="${i}" value="${esc(g.title)}" placeholder="الصفة" style="flex:1;padding:8px 11px;border:1px solid var(--border);border-radius:8px" />
        <button class="btn-ghost btn-sm" data-gd="${i}">حذف</button></div>`).join('');
    ov.querySelectorAll('[data-gn]').forEach((el) => el.oninput = () => guests[el.dataset.gn].name = el.value);
    ov.querySelectorAll('[data-gt]').forEach((el) => el.oninput = () => guests[el.dataset.gt].title = el.value);
    ov.querySelectorAll('[data-gd]').forEach((el) => el.onclick = () => { guests.splice(el.dataset.gd, 1); renderGuests(ov); });
  };
  const { overlay } = openModal({
    title: 'تعديل الحضور',
    body: `${members.map((mm) => `<div class="row" style="margin-bottom:6px">
        <span style="flex:1"><b>${esc(mm.user_name)}</b></span>
        <select data-att="${mm.user_id}" style="padding:7px 10px;border:1px solid var(--border);border-radius:8px">
          <option value="present" ${mm.attendance_status === 'present' ? 'selected' : ''}>حاضر</option>
          <option value="apology" ${mm.attendance_status === 'apology' ? 'selected' : ''}>معتذر</option>
          <option value="absent" ${mm.attendance_status === 'absent' ? 'selected' : ''}>غائب</option>
        </select></div>`).join('')}
      ${(d.missing_members && d.missing_members.length) ? `
        <h4 class="mt">أعضاء المجلس غير المُدرجين</h4>
        <p class="hint">أُضيفوا للمجلس بعد إنشاء هذا المحضر — حدّد من حضر منهم.</p>
        ${d.missing_members.map((mm) => `<div class="row" style="margin-bottom:6px">
          <label class="check-inline" style="flex:1"><input type="checkbox" data-addmem="${mm.user_id}" /> <b>${esc(mm.name)}</b></label>
          <select data-newatt="${mm.user_id}" style="padding:7px 10px;border:1px solid var(--border);border-radius:8px">
            <option value="present">حاضر</option><option value="apology">معتذر</option><option value="absent">غائب</option>
          </select></div>`).join('')}` : ''}
      <h4 class="mt">الضيوف</h4><div id="eag"></div>
      <button class="btn-ghost btn-sm mt" id="eag_add">+ إضافة ضيف</button>`,
    buttons: [
      { label: 'حفظ', onClick: async (cl, ov) => {
        const attendees = Array.from(ov.querySelectorAll('[data-att]')).map((s) => ({ user_id: Number(s.dataset.att), attendance_status: s.value }));
        // إضافة الأعضاء المحدَّدين حديثًا
        ov.querySelectorAll('[data-addmem]:checked').forEach((chk) => {
          const uid = chk.dataset.addmem;
          const sel = ov.querySelector(`[data-newatt="${uid}"]`);
          attendees.push({ user_id: Number(uid), attendance_status: sel ? sel.value : 'present' });
        });
        try { await API.put(`/meetings/${id}/attendees`, { attendees, guests: guests.filter((g) => g.name.trim()) }); cl(); toast('تم الحفظ', 'ok'); meetingDetail(id); } catch (err) { toast(err.message, 'err'); }
      }},
      { label: 'إلغاء', class: 'btn-ghost', onClick: (cl) => cl() },
    ],
  });
  renderGuests(overlay);
  overlay.querySelector('#eag_add').onclick = () => { guests.push({ name: '', title: '' }); renderGuests(overlay); };
}
