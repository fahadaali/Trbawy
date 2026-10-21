// استيراد محضرٍ أُعدّ خارج المنصة (PDF) — يُفرَّغ بالذكاء الاصطناعي محضرًا تابعًا لمحضرٍ رئيس.
//
// ثلاث خطوات: (١) المحضر الرئيس والمجلس والملف، (٢) مراجعة ما استُخرج وتصحيحه — الترويسة
// والحضور مطابَقًا بأعضاء المجلس والبنود والمتابعات والقرارات والمهام بمسؤوليها،
// (٣) الحفظ: يُنشأ المحضر مسودةً (POST /meetings/import) ثم يُرفق به ملف الـPDF الأصلي.
// ولا يُحفظ شيءٌ قبل الخطوة الثالثة: ما يُخرجه النموذج اقتراحٌ يراجعه صاحبه.

/** `parent`: المحضر الرئيس إن فُتحت النافذة من صفحته، وإلا null فيُختار من القائمة. */
async function minutesImportDialog(parent) {
  let councils = [], meetings = [];
  try {
    councils = ((await API.get('/councils')).councils || []).filter(canCreateForCouncil);
    meetings = parent ? [] : ((await API.get('/meetings')).meetings || []).filter((x) => x.status !== 'cancelled');
  } catch (err) { return toast(err.message, 'err'); }
  if (!councils.length) return toast('لا تملك صلاحية إنشاء محضر في أي مجلس', 'err');
  const defCouncil = parent && councils.some((c) => c.id === parent.council_id) ? parent.council_id : councils[0].id;
  const meetingLabel = (x) => `${x.display_number}${x.title ? ' — ' + x.title : ''}`;

  const { overlay, close } = openModal({
    title: parent ? 'إضافة محضر تابع من PDF' : 'استيراد محضر PDF',
    body: `<p class="hint">ارفع محضرًا أُعدّ خارج المنصة، فيقرؤه الذكاء الاصطناعي ويفرّغ ترويسته وحضوره
        وبنوده ومتابعاته وقراراته ومهامه — ثم تراجعه وتصحّحه قبل الحفظ. يُحفظ محضرًا تابعًا
        للمحضر الرئيس (مسودةً تمرّ بالتوقيع والاعتماد)، ويُرفق به الملف الأصلي.</p>
      ${parent ? `<div class="field"><label>المحضر الرئيس</label><div><b dir="ltr">${esc(parent.display_number)}</b>${parent.title ? ' — ' + esc(parent.title) : ''}</div></div>`
        : `<div class="field"><label>المحضر الرئيس الذي يتبعه</label>
          <input id="mi_q" placeholder="ابحث بالرقم أو العنوان…" />
          <select id="mi_parent" size="5" style="margin-top:6px">${meetings.map((x) =>
            `<option value="${x.id}" data-council="${x.council_id}">${esc(meetingLabel(x))}</option>`).join('')}</select></div>`}
      <div class="field"><label>مجلس المحضر المستورد</label>
        <select id="mi_council">${councils.map((c) =>
          `<option value="${c.id}" ${c.id === defCouncil ? 'selected' : ''}>${esc(COUNCIL_TYPE_AR[c.type] || c.name)}</option>`).join('')}</select></div>
      <div class="field"><label>ملف المحضر (PDF)</label>
        <input type="file" id="mi_file" accept=".pdf,application/pdf" /></div>
      <details><summary class="hint" style="cursor:pointer">الملف صورة ممسوحة؟ الصق نص المحضر بدلًا منه</summary>
        <textarea id="mi_text" rows="6" placeholder="نص المحضر…" style="margin-top:8px"></textarea></details>
      <div id="mi_err"></div>`,
    buttons: [
      { label: 'إلغاء', class: 'btn-ghost', onClick: (cl) => cl() },
      { label: 'تحليل المحضر', onClick: () => analyze() },
    ],
  });

  const q = overlay.querySelector('#mi_q');
  const sel = overlay.querySelector('#mi_parent');
  if (q) q.oninput = () => {
    const v = q.value.trim();
    [...sel.options].forEach((o) => { o.hidden = !!v && !o.textContent.includes(v); });
  };
  // اختيار المحضر الرئيس يقترح مجلسه للمحضر التابع
  if (sel) sel.onchange = () => {
    const cid = sel.selectedOptions[0]?.dataset.council;
    const cs = overlay.querySelector('#mi_council');
    if (cid && [...cs.options].some((o) => o.value === cid)) cs.value = cid;
  };

  const err = (msg) => { overlay.querySelector('#mi_err').innerHTML = msg ? `<div class="form-error">${esc(msg)}</div>` : ''; };
  async function analyze() {
    const parentId = parent ? parent.id : Number(sel?.value);
    if (!parentId) return err('اختر المحضر الرئيس');
    const file = overlay.querySelector('#mi_file').files[0];
    const text = overlay.querySelector('#mi_text').value.trim();
    if (!file && !text) return err('أرفق ملف PDF أو الصق نص المحضر');
    const councilId = Number(overlay.querySelector('#mi_council').value);
    const fd = new FormData();
    fd.append('council_id', String(councilId));
    if (file) fd.append('pdf', file);
    else fd.append('text', text);

    err('');
    const btn = overlay.querySelector('.modal-foot [data-i="1"]');
    btn.disabled = true;
    btn.textContent = 'يقرأ المحضر… قد يستغرق دقيقة';
    try {
      const r = await fetch('/api/ai/import-minutes', { method: 'POST', body: fd, credentials: 'same-origin' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'تعذّر تحليل المحضر');
      close();
      const parentRow = parent || meetings.find((x) => x.id === parentId);
      minutesReview({ ...data, parent: parentRow, council_id: councilId, file });
    } catch (e) {
      err(e.message);
      btn.disabled = false;
      btn.textContent = 'تحليل المحضر';
    }
  }
}

// ============================================================
// المراجعة والتصحيح قبل الحفظ
// ============================================================
function minutesReview(ctx) {
  const { draft, members } = ctx;
  const memberName = (id) => (members.find((x) => x.user_id === id) || {}).name || '';
  // الحالة الأولى للحضور: من طابق اسمه في المحضر بحالته، ومن لم يُذكر غائب —
  // إلا أن يخلو المحضر من قائمة حضور أصلًا فيُفترض الجميع حاضرين
  const listed = draft.attendees.length > 0;
  const st = {
    head: {
      title: draft.title, greg_date: draft.greg_date, start_time: draft.start_time, end_time: draft.end_time,
      location: draft.location, location_type: draft.location_type,
    },
    att: Object.fromEntries(members.map((x) => [x.user_id, listed ? 'absent' : 'present'])),
    guests: [],
    agenda: draft.agenda.map((a) => ({ ...a })),
    followups: draft.followups.map((f) => ({ ...f })),
    actions: draft.actions.map((a) => ({
      type: a.type, text: a.text, priority: a.priority, due_date: a.due_date,
      assignees: a.owners.filter((o) => o.user_id).map((o) => o.user_id),
      unmatched: a.owners.filter((o) => !o.user_id).map((o) => o.name),
    })),
  };
  draft.attendees.forEach((a) => {
    if (a.user_id) st.att[a.user_id] = a.status;
    else st.guests.push({ name: a.name, title: a.title, status: a.status, map: '' });
  });

  const { overlay, close } = openModal({
    title: 'مراجعة المحضر المستورد',
    body: '<div id="mr" class="mi-review"></div>',
    buttons: [
      { label: 'إلغاء', class: 'btn-ghost', onClick: (cl) => cl() },
      { label: 'حفظ كمسودة', onClick: () => save() },
    ],
  });
  overlay.querySelector('.modal').style.maxWidth = '980px';
  const root = overlay.querySelector('#mr');
  const opt = (map, cur) => Object.entries(map).map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('');
  const memberOpts = (cur) => members.map((x) => `<option value="${x.user_id}" ${x.user_id === cur ? 'selected' : ''}>${esc(x.name)}</option>`).join('');

  // يقرأ ما في الحقول إلى الحالة — قبل كل إعادة رسم وقبل الحفظ
  function collect() {
    const v = (sel) => root.querySelector(sel)?.value ?? '';
    Object.keys(st.head).forEach((k) => { st.head[k] = v(`[data-h="${k}"]`); });
    root.querySelectorAll('[data-att]').forEach((s) => { st.att[s.dataset.att] = s.value; });
    st.guests.forEach((g, i) => {
      g.name = v(`[data-g="${i}"][data-k="name"]`); g.title = v(`[data-g="${i}"][data-k="title"]`);
      g.status = v(`[data-g="${i}"][data-k="status"]`); g.map = v(`[data-g="${i}"][data-k="map"]`);
    });
    st.agenda.forEach((a, i) => { a.title = v(`[data-a="${i}"][data-k="title"]`); a.body = v(`[data-a="${i}"][data-k="body"]`); });
    st.followups.forEach((f, i) => { f.text = v(`[data-f="${i}"][data-k="text"]`); f.status_note = v(`[data-f="${i}"][data-k="note"]`); });
    st.actions.forEach((a, i) => {
      a.type = v(`[data-x="${i}"][data-k="type"]`); a.text = v(`[data-x="${i}"][data-k="text"]`);
      a.priority = v(`[data-x="${i}"][data-k="priority"]`); a.due_date = v(`[data-x="${i}"][data-k="due"]`);
    });
  }

  function draw() {
    const h = st.head;
    root.innerHTML = `
      ${(ctx.warnings || []).map((w) => `<div class="form-error">${esc(w)}</div>`).join('')}
      <p class="hint">يتبع المحضر الرئيس <b dir="ltr">${esc(ctx.parent?.display_number || '')}</b>${ctx.parent?.title ? ' — ' + esc(ctx.parent.title) : ''}.
        راجع كل ما يلي وصحّحه — ما استخرجه الذكاء الاصطناعي اقتراحٌ لا يُحفظ إلا بعد مراجعتك.</p>
      ${ctx.excerpt ? `<details class="mt"><summary class="hint" style="cursor:pointer">النص المستخرج من الملف (${arNum(ctx.chars || 0)} حرف)</summary>
        <pre dir="auto" style="white-space:pre-wrap;max-height:200px;overflow:auto;font:inherit;font-size:13px;background:var(--bg,#f6f7f6);padding:10px;border-radius:8px">${esc(ctx.excerpt)}${(ctx.chars || 0) > ctx.excerpt.length ? '…' : ''}</pre></details>` : ''}

      <h4 class="mt">الترويسة</h4>
      <div class="field"><label>العنوان</label><input data-h="title" value="${esc(h.title)}" /></div>
      <div class="row-2">
        <div class="field"><label>التاريخ الميلادي</label><input type="date" data-h="greg_date" value="${esc(h.greg_date)}" />
          <small class="hint" id="mr_hijri">${h.greg_date ? esc(hijriFromGreg(h.greg_date)) : (draft.hijri_date_raw ? 'ورد في المحضر: ' + esc(draft.hijri_date_raw) + ' — أدخل ما يقابله' : 'لم يُستخرج تاريخ — أدخله')}</small></div>
        <div class="field"><label>نوع الاجتماع</label><select data-h="location_type">${opt({ in_person: 'حضوري', remote: 'عن بُعد' }, h.location_type)}</select></div>
      </div>
      <div class="row-2">
        <div class="field"><label>من</label><input data-h="start_time" value="${esc(h.start_time)}" placeholder="٩:٣٠ ص" /></div>
        <div class="field"><label>إلى</label><input data-h="end_time" value="${esc(h.end_time)}" placeholder="١١:٠٠ ص" /></div>
      </div>
      <div class="field"><label>المكان</label><input data-h="location" value="${esc(h.location)}" placeholder="وفق المحضر المرفق" /></div>

      <h4 class="mt">الحضور — أعضاء المجلس</h4>
      ${members.map((x) => `<div class="row" style="margin-bottom:6px">
        <span style="flex:1"><b>${esc(x.name)}</b> <span class="muted">${esc(ROLE_AR[x.role] || '')}</span></span>
        <select data-att="${x.user_id}">${opt(ATT_STATUS_AR, st.att[x.user_id])}</select></div>`).join('')}
      ${st.guests.length ? `<h4 class="mt">أسماء وردت ولم تُطابق عضوًا</h4>
        <p class="hint">اربط الاسم بعضوٍ إن كان هو نفسه، وإلا يُضاف ضيفًا.</p>
        ${st.guests.map((g, i) => `<div class="row" style="margin-bottom:6px;flex-wrap:wrap">
          <input data-g="${i}" data-k="name" value="${esc(g.name)}" style="flex:1;min-width:140px" />
          <input data-g="${i}" data-k="title" value="${esc(g.title)}" placeholder="الصفة" style="flex:1;min-width:110px" />
          <select data-g="${i}" data-k="map"><option value="">ضيف</option>${memberOpts(Number(g.map) || null)}</select>
          <select data-g="${i}" data-k="status">${opt(ATT_STATUS_AR, g.status)}</select>
          <button type="button" class="btn-ghost btn-sm" data-del="guests:${i}" aria-label="حذف">&times;</button></div>`).join('')}` : ''}
      <button type="button" class="btn-ghost btn-sm" data-add="guests">+ ضيف</button>

      <h4 class="mt">البنود (${arNum(st.agenda.length)})</h4>
      ${st.agenda.map((a, i) => `<div class="card" style="margin-bottom:8px"><div class="card-body">
        <div class="row"><input data-a="${i}" data-k="title" value="${esc(a.title)}" placeholder="عنوان البند" style="flex:1" />
          <button type="button" class="btn-ghost btn-sm" data-del="agenda:${i}" aria-label="حذف">&times;</button></div>
        <textarea data-a="${i}" data-k="body" rows="3" class="mt" placeholder="ما دار في البند">${esc(a.body)}</textarea></div></div>`).join('')}
      <button type="button" class="btn-ghost btn-sm" data-add="agenda">+ بند</button>

      <h4 class="mt">متابعة القرارات السابقة (${arNum(st.followups.length)})</h4>
      ${st.followups.map((f, i) => `<div class="row" style="margin-bottom:6px">
        <input data-f="${i}" data-k="text" value="${esc(f.text)}" style="flex:3" />
        <input data-f="${i}" data-k="note" value="${esc(f.status_note)}" placeholder="الحالة" style="flex:1" />
        <button type="button" class="btn-ghost btn-sm" data-del="followups:${i}" aria-label="حذف">&times;</button></div>`).join('')}
      <button type="button" class="btn-ghost btn-sm" data-add="followups">+ متابعة</button>

      <h4 class="mt">القرارات والتوصيات والمهام (${arNum(st.actions.length)})</h4>
      ${st.actions.map((a, i) => `<div class="card" style="margin-bottom:8px"><div class="card-body">
        <div class="row" style="flex-wrap:wrap">
          <select data-x="${i}" data-k="type">${opt(ACTION_TYPE_AR, a.type)}</select>
          <select data-x="${i}" data-k="priority">${opt(PRIORITY_AR, a.priority)}</select>
          <label class="hint">الاستحقاق <input type="date" data-x="${i}" data-k="due" value="${esc(a.due_date)}" /></label>
          <div class="spacer"></div>
          <button type="button" class="btn-ghost btn-sm" data-del="actions:${i}" aria-label="حذف">&times;</button></div>
        <textarea data-x="${i}" data-k="text" rows="2" class="mt">${esc(a.text)}</textarea>
        <div class="row mt" style="flex-wrap:wrap">
          ${a.assignees.map((uid) => `<span class="tag tag-green">${esc(memberName(uid))}
            <button type="button" data-unassign="${i}:${uid}" style="background:none;border:none;cursor:pointer" aria-label="إزالة">&times;</button></span>`).join('')}
          <select data-assign="${i}"><option value="">+ مسؤول</option>${members.filter((x) => !a.assignees.includes(x.user_id))
            .map((x) => `<option value="${x.user_id}">${esc(x.name)}</option>`).join('')}</select>
        </div>
        ${a.unmatched.length ? `<p class="hint">ورد في المحضر ولم يُطابق عضوًا: ${a.unmatched.map(esc).join('، ')}</p>` : ''}
        ${a.type === 'task' && !a.due_date ? '<p class="hint">مهمة بلا موعد — تُستحق بعد أسبوع من تاريخ الاجتماع ما لم تحدّده.</p>' : ''}
      </div></div>`).join('')}
      <button type="button" class="btn-ghost btn-sm" data-add="actions">+ قرار أو مهمة</button>
      <div id="mr_err" class="mt"></div>`;

    root.querySelector('[data-h="greg_date"]').onchange = (e) => {
      root.querySelector('#mr_hijri').textContent = e.target.value ? hijriFromGreg(e.target.value) : '';
    };
    root.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
      collect();
      const [list, i] = b.dataset.del.split(':');
      st[list].splice(Number(i), 1);
      draw();
    });
    root.querySelectorAll('[data-add]').forEach((b) => b.onclick = () => {
      collect();
      const blank = {
        guests: { name: '', title: '', status: 'present', map: '' },
        agenda: { title: '', body: '' },
        followups: { text: '', status_note: '' },
        actions: { type: 'decision', text: '', priority: 'medium', due_date: '', assignees: [], unmatched: [] },
      };
      st[b.dataset.add].push(blank[b.dataset.add]);
      draw();
    });
    root.querySelectorAll('[data-assign]').forEach((s) => s.onchange = () => {
      if (!s.value) return;
      collect();
      st.actions[Number(s.dataset.assign)].assignees.push(Number(s.value));
      draw();
    });
    root.querySelectorAll('[data-unassign]').forEach((b) => b.onclick = () => {
      collect();
      const [i, uid] = b.dataset.unassign.split(':').map(Number);
      const a = st.actions[i];
      a.assignees = a.assignees.filter((x) => x !== uid);
      draw();
    });
  }
  draw();

  async function save() {
    collect();
    const errBox = root.querySelector('#mr_err');
    const fail = (msg) => { errBox.innerHTML = `<div class="form-error">${esc(msg)}</div>`; errBox.scrollIntoView({ block: 'nearest' }); };
    const h = st.head;
    if (!h.greg_date) return fail('أدخل تاريخ الاجتماع');
    const start = parseTimeInput(h.start_time), end = parseTimeInput(h.end_time);
    if (start === undefined || end === undefined) return fail('صيغة الوقت غير مفهومة — مثال: ٩:٣٠ ص');

    // اسمٌ رُبط بعضو يصير حالةَ ذلك العضو، والباقي ضيوف
    const att = { ...st.att };
    const guests = [];
    st.guests.forEach((g) => {
      if (g.map) att[g.map] = g.status;
      else if (g.name.trim()) guests.push({ name: g.name.trim(), title: g.title.trim(), status: g.status });
    });
    const payload = {
      parent_meeting_id: ctx.parent.id, council_id: ctx.council_id, source_name: ctx.file ? ctx.file.name : null,
      title: h.title.trim(), greg_date: h.greg_date, hijri_date: hijriFromGreg(h.greg_date),
      start_time: start, end_time: end, location_type: h.location_type, location: h.location.trim(),
      attendees: Object.entries(att).map(([uid, status]) => ({ user_id: Number(uid), status })),
      guests,
      agenda: st.agenda.filter((a) => a.title.trim()),
      followups: st.followups.filter((f) => f.text.trim()),
      actions: st.actions.filter((a) => a.text.trim()).map((a) => ({
        type: a.type, text: a.text.trim(), priority: a.priority, due_date: a.due_date || null, assignees: a.assignees,
      })),
    };

    const btn = overlay.querySelector('.modal-foot [data-i="1"]');
    btn.disabled = true;
    btn.textContent = 'يُحفظ…';
    try {
      const r = await API.post('/meetings/import', payload);
      // الملف الأصلي مرفقٌ بالمحضر — إن تعذّر رفعه بقي المحضر ويُرفق يدويًا
      if (ctx.file) {
        const up = await fetch(`/api/meetings/${r.id}/attachments?name=${encodeURIComponent(ctx.file.name)}`, {
          method: 'PUT', body: ctx.file, credentials: 'same-origin',
          headers: { 'Content-Type': ctx.file.type || 'application/pdf' },
        }).catch(() => null);
        if (!up || !up.ok) toast('حُفظ المحضر، وتعذّر إرفاق الملف الأصلي — أرفقه من صفحة المحضر', 'err');
      }
      close();
      toast(`حُفظ المحضر التابع ${r.display_number} مسودةً — راجعه ثم أرسله للتوقيعات`, 'ok');
      nav('meetings/' + r.id);
    } catch (e) {
      fail(e.message);
      btn.disabled = false;
      btn.textContent = 'حفظ كمسودة';
    }
  }
}
