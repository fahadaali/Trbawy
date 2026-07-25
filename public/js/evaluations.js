// وحدة التقييم (الواجهة) — الدورات، المعايير، النماذج، النتائج، والنافذة التفصيلية.

const CYCLE_STATUS_COLOR = { draft: 'tag-gray', open: 'tag-gold', closed: 'tag-gray', published: 'tag-green' };

VIEWS.evaluations = async (rest) => {
  if (rest && rest[0] === 'criteria') return criteriaManager();
  if (rest && rest[0]) return cycleDetail(rest[0]);
  return cyclesList();
};

async function cyclesList() {
  setTitle('التقييم التربوي');
  content().innerHTML = '<div class="spinner"></div>';
  let cycles;
  try { cycles = (await API.get('/eval/cycles')).cycles; } catch (err) { return renderError(err); }
  const isPres = State.user.role === 'president';

  content().innerHTML = `
    <div class="row" style="margin-bottom:16px">
      ${isPres ? '<button class="btn btn-sm" id="newCycle">+ دورة تقييم جديدة</button>' : ''}
      ${isPres ? '<button class="btn-ghost btn-sm" onclick="nav(\'evaluations/criteria\')">إدارة المعايير والأوزان</button>' : ''}
    </div>
    <div class="grid grid-3">${cycles.map((cy) => `
      <div class="card"><div class="card-body">
        ${statusTag(cy.status, CYCLE_STATUS_AR, CYCLE_STATUS_COLOR)}
        <h3 style="margin:8px 0 4px">${esc(cy.name)}</h3>
        <p class="muted" style="font-size:13px">${esc(cy.start_date)} → ${esc(cy.end_date)}</p>
        <p class="muted" style="font-size:12px">${cy.target_types.split(',').map((t) => TARGET_TYPE_AR[t] || t).join('، ')}</p>
        <button class="btn-ghost btn-sm mt" data-cy="${cy.id}">فتح</button>
      </div></div>`).join('') || `<div class="empty"><div class="ico">${icon('evaluations', 42)}</div><p>لا توجد دورات تقييم</p></div>`}</div>`;

  if (isPres) document.getElementById('newCycle').onclick = newCycleForm;
  content().querySelectorAll('[data-cy]').forEach((b) => b.onclick = () => nav('evaluations/' + b.dataset.cy));
}

function newCycleForm() {
  openModal({
    title: 'دورة تقييم جديدة',
    body: `
      <div id="ncErr"></div>
      <div class="field"><label>اسم الدورة</label><input id="nc_name" placeholder="مثل: تقييم الفصل الأول ١٤٤٨" /></div>
      <div class="row-2">
        <div class="field"><label>من تاريخ</label><input type="date" id="nc_start" /></div>
        <div class="field"><label>إلى تاريخ</label><input type="date" id="nc_end" /></div>
      </div>
      <div class="field"><label>الفئات المشمولة</label>
        ${Object.entries(TARGET_TYPE_AR).map(([v, l]) => `<label class="check-row"><input type="checkbox" value="${v}" /> ${l}</label>`).join('')}
      </div>`,
    buttons: [
      { label: 'إنشاء', onClick: async (cl, ov) => {
        const types = Array.from(ov.querySelectorAll('input[type=checkbox]:checked')).map((i) => i.value);
        try {
          await API.post('/eval/cycles', {
            name: ov.querySelector('#nc_name').value.trim(),
            start_date: ov.querySelector('#nc_start').value,
            end_date: ov.querySelector('#nc_end').value,
            target_types: types,
          });
          cl(); toast('تم إنشاء الدورة', 'ok'); cyclesList();
        } catch (err) { ov.querySelector('#ncErr').innerHTML = `<div class="form-error">${esc(err.message)}</div>`; }
      }},
      { label: 'إلغاء', class: 'btn-ghost', onClick: (cl) => cl() },
    ],
  });
}

// تعديل بيانات دورة قائمة (الفئات تُعدَّل قبل الفتح فقط)
function editCycleForm(cy, currentTypes, onDone) {
  const isDraft = cy.status === 'draft';
  openModal({
    title: 'تعديل بيانات الدورة',
    body: `<div id="ecErr"></div>
      <div class="field"><label>اسم الدورة</label><input id="ec_name" value="${esc(cy.name)}" /></div>
      <div class="row-2">
        <div class="field"><label>من تاريخ</label><input type="date" id="ec_start" value="${esc(cy.start_date)}" /></div>
        <div class="field"><label>إلى تاريخ</label><input type="date" id="ec_end" value="${esc(cy.end_date)}" /></div>
      </div>
      <div class="field"><label>الفئات المشمولة ${isDraft ? '' : '<span class="muted">(لا تُعدَّل بعد فتح الدورة)</span>'}</label>
        ${Object.entries(TARGET_TYPE_AR).map(([v, l]) => `<label class="check-row"><input type="checkbox" value="${v}" ${currentTypes.includes(v) ? 'checked' : ''} ${isDraft ? '' : 'disabled'} /> ${l}</label>`).join('')}
      </div>`,
    buttons: [
      { label: 'حفظ', onClick: async (cl, ov) => {
        const payload = {
          name: ov.querySelector('#ec_name').value.trim(),
          start_date: ov.querySelector('#ec_start').value,
          end_date: ov.querySelector('#ec_end').value,
        };
        if (isDraft) payload.target_types = Array.from(ov.querySelectorAll('input[type=checkbox]:checked')).map((i) => i.value);
        try { await API.patch('/eval/cycles/' + cy.id, payload); cl(); toast('تم الحفظ', 'ok'); onDone(); }
        catch (err) { ov.querySelector('#ecErr').innerHTML = `<div class="form-error">${esc(err.message)}</div>`; }
      }},
      { label: 'إلغاء', class: 'btn-ghost', onClick: (cl) => cl() },
    ],
  });
}

// ---- إدارة المعايير ----
async function criteriaManager() {
  setTitle('المعايير والأوزان');
  content().innerHTML = '<div class="spinner"></div>';
  let all;
  try { all = (await API.get('/eval/criteria')).criteria; } catch (err) { return renderError(err); }

  const sections = Object.keys(TARGET_TYPE_AR).map((tt) => {
    const items = all.filter((c) => c.target_type === tt);
    const sum = items.filter((i) => i.is_active).reduce((a, b) => a + b.weight, 0);
    return `<div class="card mt"><div class="card-head">
        <h3>معايير: ${TARGET_TYPE_AR[tt]}</h3><div class="spacer"></div>
        <span class="tag ${Math.round(sum) === 100 ? 'tag-green' : 'tag-red'}">مجموع الأوزان: ${arNum(sum)}٪</span>
        <button class="btn btn-sm" data-add="${tt}">+ معيار</button></div>
      <table class="tbl"><thead><tr><th>المعيار</th><th>الوصف</th><th>الوزن</th><th>الحالة</th><th></th></tr></thead>
      <tbody>${items.map((c) => `<tr><td><b>${esc(c.name)}</b></td><td class="muted">${esc(c.description || '')}</td>
        <td>${arNum(c.weight)}٪</td><td>${c.is_active ? '<span class="tag tag-green">مفعّل</span>' : '<span class="tag tag-gray">معطّل</span>'}</td>
        <td class="row"><button class="btn-ghost btn-sm" data-edit="${c.id}">تعديل</button><button class="btn-ghost btn-sm" data-del="${c.id}">حذف</button></td></tr>`).join('')}</tbody></table></div>`;
  }).join('');

  content().innerHTML = `<div class="row"><button class="btn-ghost btn-sm" onclick="nav('evaluations')">رجوع للدورات</button>
    <a class="btn-ghost btn-sm" href="/api/eval/criteria/export">تصدير CSV</a>
    <button class="btn-ghost btn-sm" id="critImport">استيراد Excel/CSV</button></div>` + sections;

  const reload = criteriaManager;
  document.getElementById('critImport').onclick = () => importCriteria(reload);
  content().querySelectorAll('[data-add]').forEach((b) => b.onclick = () => criterionForm(b.dataset.add, null, reload));
  content().querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => criterionForm(null, all.find((x) => x.id == b.dataset.edit), reload));
  content().querySelectorAll('[data-del]').forEach((b) => b.onclick = () => confirmModal('حذف المعيار', 'متابعة الحذف؟', async () => {
    try { await API.del('/eval/criteria/' + b.dataset.del); toast('تم', 'ok'); reload(); } catch (err) { toast(err.message, 'err'); }
  }, { danger: true }));
}

function importCriteria(onDone) {
  const { overlay } = openModal({
    title: 'استيراد المعايير',
    body: `<p class="muted">الأعمدة: <code dir="ltr">target_type,name,description,weight</code>. يستبدل معايير الفئات الواردة. صدّر أولًا للاطلاع على الصيغة.</p>
      <input type="file" id="ci_file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
      <p class="hint">يقبل ملفات Excel ‎(.xlsx)‎ وCSV.</p>
      <div id="ci_preview" class="mt"></div>`,
    buttons: [
      { label: 'حفظ', onClick: async (cl, ov) => {
        if (!ov._csv) return toast('اختر ملفًا وعايِنه أولًا', 'err');
        if (!ov._valid) return toast('لا توجد صفوف صحيحة للحفظ', 'err');
        try { const r = await API.post('/eval/criteria/import?commit=1', { csv: ov._csv }); cl(); toast(`تم استيراد ${r.inserted} معيارًا`, 'ok'); onDone(); }
        catch (err) { toast(err.message, 'err'); }
      }},
      { label: 'إغلاق', class: 'btn-ghost', onClick: (cl) => cl() },
    ],
  });
  overlay.querySelector('#ci_file').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    let text;
    try { text = await fileToCsv(f); }
    catch (err) { overlay.querySelector('#ci_preview').innerHTML = `<div class="form-error">${esc(err.message)}</div>`; overlay._csv = null; return; }
    overlay._csv = text;
    try {
      const p = await API.post('/eval/criteria/import', { csv: text });
      overlay._valid = p.valid;
      overlay.querySelector('#ci_preview').innerHTML = `<div class="row"><span class="tag tag-green">صحيح: ${arNum(p.valid)}</span><span class="tag tag-red">خطأ: ${arNum(p.invalid)}</span></div>
        <table class="tbl mt"><thead><tr><th>الصف</th><th>الفئة</th><th>المعيار</th><th>الوزن</th><th>الأخطاء</th></tr></thead>
        <tbody>${p.report.map((r) => `<tr style="${r.errors.length ? 'background:#fdecea' : ''}"><td>${arNum(r.row)}</td><td>${esc(TARGET_TYPE_AR[r.target_type] || r.target_type)}</td><td>${esc(r.name)}</td><td>${arNum(r.weight)}</td><td class="tag-red">${r.errors.map(esc).join('، ') || '✓'}</td></tr>`).join('')}</tbody></table>`;
    } catch (err) { overlay.querySelector('#ci_preview').innerHTML = `<div class="form-error">${esc(err.message)}</div>`; overlay._csv = null; }
  };
}

function criterionForm(targetType, existing, onDone) {
  openModal({
    title: existing ? 'تعديل معيار' : 'معيار جديد',
    body: `<div id="crErr"></div>
      <div class="field"><label>الاسم</label><input id="cr_name" value="${existing ? esc(existing.name) : ''}" /></div>
      <div class="field"><label>الوصف التفصيلي</label><textarea id="cr_desc" rows="2">${existing ? esc(existing.description || '') : ''}</textarea></div>
      <div class="row-2">
        <div class="field"><label>الوزن (٪)</label><input type="number" id="cr_weight" min="0" max="100" value="${existing ? existing.weight : 0}" /></div>
        ${existing ? `<div class="field"><label>الحالة</label><select id="cr_active"><option value="1" ${existing.is_active ? 'selected' : ''}>مفعّل</option><option value="0" ${!existing.is_active ? 'selected' : ''}>معطّل</option></select></div>` : ''}
      </div>`,
    buttons: [
      { label: 'حفظ', onClick: async (cl, ov) => {
        const payload = {
          name: ov.querySelector('#cr_name').value.trim(),
          description: ov.querySelector('#cr_desc').value.trim(),
          weight: Number(ov.querySelector('#cr_weight').value),
        };
        try {
          if (existing) { payload.is_active = ov.querySelector('#cr_active').value === '1'; await API.patch('/eval/criteria/' + existing.id, payload); }
          else { payload.target_type = targetType; await API.post('/eval/criteria', payload); }
          cl(); toast('تم', 'ok'); onDone();
        } catch (err) { ov.querySelector('#crErr').innerHTML = `<div class="form-error">${esc(err.message)}</div>`; }
      }},
      { label: 'إلغاء', class: 'btn-ghost', onClick: (cl) => cl() },
    ],
  });
}

// ---- تفاصيل الدورة ----
async function cycleDetail(id) {
  setTitle('دورة التقييم');
  content().innerHTML = '<div class="spinner"></div>';
  let d;
  try { d = await API.get('/eval/cycles/' + id); } catch (err) { return renderError(err); }
  const cy = d.cycle;
  const isPres = d.is_president;

  const statusBtns = [];
  if (isPres) {
    if (cy.status === 'draft') statusBtns.push(`<button class="btn btn-sm" data-st="open">فتح الدورة</button>`);
    if (cy.status === 'open') statusBtns.push(`<button class="btn btn-sm" data-st="close">إغلاق الإدخال</button>`);
    if (cy.status === 'closed') statusBtns.push(`<button class="btn btn-sm" data-st="publish">نشر النتائج</button>`);
    statusBtns.push(`<button class="btn-ghost btn-sm" id="cyEdit">تعديل بيانات الدورة</button>`);
    if (cy.status === 'draft') statusBtns.push(`<button class="btn-danger btn-sm" id="cyDel">حذف الدورة</button>`);
  }

  content().innerHTML = `
    <div class="card"><div class="card-head">
      <h3>${esc(cy.name)}</h3><div class="spacer"></div>
      ${statusTag(cy.status, CYCLE_STATUS_AR, CYCLE_STATUS_COLOR)}
      <button class="btn-ghost btn-sm" onclick="nav('evaluations')">رجوع</button>
    </div><div class="card-body">
      <p class="muted">الفترة: ${esc(cy.start_date)} → ${esc(cy.end_date)}</p>
      <div class="row mt">${statusBtns.join('')}</div>
    </div></div>
    <div id="cyBody" class="mt"></div>`;

  content().querySelectorAll('[data-st]').forEach((b) => b.onclick = () => {
    const act = b.dataset.st;
    const msg = act === 'open' ? 'سيتم نسخ المعايير وتثبيتها وبدء الإدخال.' : act === 'publish' ? 'ستظهر النتائج لأصحاب الصلاحية.' : 'سيُغلق الإدخال.';
    confirmModal('تأكيد', msg, async () => {
      try { await API.post(`/eval/cycles/${id}/status`, { action: act }); toast('تم', 'ok'); cycleDetail(id); }
      catch (err) { toast(err.message, 'err'); }
    });
  });

  const cyEdit = document.getElementById('cyEdit');
  if (cyEdit) cyEdit.onclick = () => editCycleForm(cy, d.target_types, () => cycleDetail(id));
  const cyDel = document.getElementById('cyDel');
  if (cyDel) cyDel.onclick = () => confirmModal('حذف الدورة',
    'سيُحذف كل ما يخص هذه الدورة (مسودة بلا تقييمات). متابعة؟', async () => {
      try { await API.del('/eval/cycles/' + id); toast('تم حذف الدورة', 'ok'); nav('evaluations'); }
      catch (err) { toast(err.message, 'err'); }
    }, { danger: true });

  const body = document.getElementById('cyBody');
  // أقسام: للتقييم (open) — النتائج (published) — التقدّم (president)
  let html = '';
  if (cy.status === 'open' && d.i_evaluate.length) {
    html += `<div class="card"><div class="card-head"><h3>الإدخال — اختر الفئة</h3></div><div class="card-body">
      <div class="row" id="evTabs">${d.i_evaluate.map((t, i) => `<button class="btn ${i === 0 ? '' : 'btn-ghost'} btn-sm" data-ev="${t}">${TARGET_TYPE_AR[t]}</button>`).join('')}</div>
      <div id="evTargets" class="mt"></div></div></div>`;
  }
  if (cy.status === 'published') {
    const viewable = d.target_types.filter((t) => canViewResultsClient(t));
    if (viewable.length) html += `<div class="card"><div class="card-head"><h3>النتائج</h3></div><div class="card-body">
      <div class="row" id="resTabs">${viewable.map((t, i) => `<button class="btn ${i === 0 ? '' : 'btn-ghost'} btn-sm" data-res="${t}">${TARGET_TYPE_AR[t]}</button>`).join('')}</div>
      <div id="resBody" class="mt"></div></div></div>`;
    for (const tt of viewable) {
      html += `<div class="card mt"><div class="card-head"><h3>لوحة قيادة ${TARGET_TYPE_AR[tt]}</h3></div><div id="dash_${tt}" class="card-body"><div class="spinner"></div></div></div>`;
    }
  }
  if (isPres) html += `<div class="card mt"><div class="card-head"><h3>تقدّم الإدخال لكل مقيِّم</h3></div><div id="progBody" class="card-body"><div class="spinner"></div></div></div>`;
  body.innerHTML = html || '<div class="card"><div class="empty"><div class="ico">⏳</div><p>لا يوجد إجراء متاح لك في هذه الحالة.</p></div></div>';

  // تفعيل التبويبات
  if (cy.status === 'open' && d.i_evaluate.length) {
    const loadTargets = async (tt) => {
      const box = document.getElementById('evTargets');
      box.innerHTML = '<div class="spinner"></div>';
      const { targets } = await API.get(`/eval/cycles/${id}/targets?target_type=${tt}`);
      box.innerHTML = targets.length ? `<table class="tbl"><thead><tr><th>${TARGET_TYPE_AR[tt]}</th><th>الحالة</th><th></th></tr></thead>
        <tbody>${targets.map((t) => `<tr><td>${esc(t.name)}</td><td>${t.submitted ? '<span class="tag tag-green">مُدخَل</span>' : '<span class="tag tag-gray">لم يُدخَل</span>'}</td>
          <td><button class="btn-ghost btn-sm" data-t="${t.id}">${t.submitted ? 'تعديل' : 'تقييم'}</button></td></tr>`).join('')}</tbody></table>`
        : '<div class="empty muted">لا توجد أهداف في نطاقك</div>';
      box.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => evalForm(id, tt, b.dataset.t, () => loadTargets(tt)));
    };
    document.querySelectorAll('#evTabs [data-ev]').forEach((b) => b.onclick = () => {
      document.querySelectorAll('#evTabs [data-ev]').forEach((x) => x.className = 'btn btn-ghost btn-sm');
      b.className = 'btn btn-sm'; loadTargets(b.dataset.ev);
    });
    loadTargets(d.i_evaluate[0]);
  }
  if (cy.status === 'published') {
    const viewable = d.target_types.filter((t) => canViewResultsClient(t));
    if (viewable.length) {
      const loadRes = (tt) => renderResults(id, tt);
      document.querySelectorAll('#resTabs [data-res]').forEach((b) => b.onclick = () => {
        document.querySelectorAll('#resTabs [data-res]').forEach((x) => x.className = 'btn btn-ghost btn-sm');
        b.className = 'btn btn-sm'; loadRes(b.dataset.res);
      });
      loadRes(viewable[0]);
    }
    for (const tt of viewable) renderDashboard(id, tt);
  }
  if (isPres) {
    try {
      const { progress } = await API.get(`/eval/cycles/${id}/progress`);
      document.getElementById('progBody').innerHTML = progress.length ? progress.map((p) => {
        const pct = p.expected ? Math.round((p.submitted / p.expected) * 100) : 0;
        return `<div style="margin-bottom:10px"><div class="row"><span style="flex:1">${esc(p.name)} <span class="muted">(${esc(ROLE_AR[p.role] || '')})</span></span><span>${arNum(p.submitted)}/${arNum(p.expected)} — ${arNum(pct)}٪</span></div>
          <div style="height:8px;background:#eef1f0;border-radius:6px;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--primary)"></div></div></div>`;
      }).join('') : '<div class="muted">لا يوجد مقيّمون</div>';
    } catch (err) { document.getElementById('progBody').innerHTML = `<div class="muted">${esc(err.message)}</div>`; }
  }
}

// خلية اسم: قابلة للنقر لفتح السجل التاريخي إن كان طالبًا
function nameCell(t, tt) {
  return tt === 'students' && t.id
    ? `<a href="#" data-hist="${t.id}">${esc(t.name)}</a>` : esc(t.name);
}

async function renderDashboard(cycleId, tt) {
  const box = document.getElementById('dash_' + tt);
  if (!box) return;
  const role = State.user.role;
  // فلتر المرحلة: الطلاب (الرئيس/النائب)، أعضاء الفرق (الرئيس فقط)، المشرفون الأوائل بلا فلتر
  const stageFilter = (tt === 'students' && ['president', 'vice_president'].includes(role)) || (tt === 'team_members' && role === 'president');
  const stageSel = stageFilter ? `<select id="stage_${tt}" style="padding:8px 11px;border:1px solid var(--border);border-radius:8px">
      <option value="">كل المراحل</option><option value="secondary">الثانوية</option><option value="middle">المتوسطة</option></select>` : '';
  box.innerHTML = `<div class="row" style="margin-bottom:12px">${stageSel}</div><div id="inner_${tt}"><div class="spinner"></div></div>`;

  const load = async () => {
    const inner = document.getElementById('inner_' + tt);
    inner.innerHTML = '<div class="spinner"></div>';
    const st = document.getElementById('stage_' + tt);
    const q = st && st.value ? `&stage=${st.value}` : '';
    const url = tt === 'students'
      ? `/dashboard/students?cycle_id=${cycleId}${q}`
      : `/dashboard/staff?cycle_id=${cycleId}&target_type=${tt}${q}`;
    let d;
    try { d = await API.get(url); } catch (err) { inner.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }
    const b = d.board;
    const distMax = Math.max(1, ...Object.values(b.distribution));
    const distBars = Object.entries(b.distribution).map(([band, n]) => `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><span style="width:60px">${arNum(band)}</span>
        <div style="flex:1;background:#eef1f0;border-radius:6px;overflow:hidden"><div style="height:16px;width:${(n / distMax * 100)}%;background:var(--primary)"></div></div><span>${arNum(n)}</span></div>`).join('');
    inner.innerHTML = `
      <div class="grid grid-4">
        <div class="stat"><div class="v">${arNum(b.total_targets)}</div><div class="l">العدد</div></div>
        <div class="stat"><div class="v">${arNum(b.evaluated)}</div><div class="l">المقيَّمون</div></div>
        <div class="stat"><div class="v">${arNum(b.completion)}٪</div><div class="l">اكتمال الإدخال</div></div>
        <div class="stat"><div class="v">${arFixed(b.overall_avg)}</div><div class="l">المتوسط العام</div></div>
      </div>
      ${d.previous_avg != null ? `<p class="mt muted">مقارنة بالدورة السابقة: ${arFixed(d.previous_avg)} ${b.overall_avg > d.previous_avg ? '▲' : b.overall_avg < d.previous_avg ? '▼' : '='}</p>` : ''}
      ${d.comparison ? `<p class="muted">الثانوي: ${arFixed(d.comparison.secondary)} — المتوسط: ${arFixed(d.comparison.middle)}</p>` : ''}
      <div class="row-2 mt">
        <div class="card"><div class="card-head"><h3>توزيع الدرجات</h3></div><div class="card-body">${distBars}</div></div>
        <div class="card"><div class="card-head"><h3>أضعف المعايير</h3></div><div class="card-body">
          ${b.weakest_criteria.map((w) => `<div class="row"><span style="flex:1">${esc(w.name)}</span><b>${arFixed(w.avg)}</b></div>`).join('') || '<span class="muted">—</span>'}</div></div>
      </div>
      <div class="row-2 mt">
        <div class="card"><div class="card-head"><h3>أعلى ١٠</h3></div><table class="tbl"><tbody>${b.top.map((t) => `<tr><td>${nameCell(t, tt)}</td><td><b>${arFixed(t.score)}</b></td></tr>`).join('') || '<tr><td class="muted">—</td></tr>'}</tbody></table></div>
        <div class="card"><div class="card-head"><h3>أدنى ١٠</h3></div><table class="tbl"><tbody>${b.bottom.map((t) => `<tr><td>${nameCell(t, tt)}</td><td><b>${arFixed(t.score)}</b></td></tr>`).join('') || '<tr><td class="muted">—</td></tr>'}</tbody></table></div>
      </div>`;
    // فتح السجل التاريخي من أسماء الطلاب في اللوحة
    inner.querySelectorAll('[data-hist]').forEach((a) => a.onclick = (e) => {
      e.preventDefault();
      if (typeof studentHistory === 'function') studentHistory(a.dataset.hist);
    });
  };
  if (stageFilter) document.getElementById('stage_' + tt).onchange = load;
  load();
}

function canViewResultsClient(tt) {
  const r = State.user.role;
  if (tt === 'students') return ['president', 'vice_president', 'first_supervisor', 'team_member'].includes(r);
  if (tt === 'team_members') return ['president', 'first_supervisor'].includes(r);
  if (tt === 'first_supervisors') return ['president', 'vice_president'].includes(r);
  return false;
}

// نموذج التقييم
async function evalForm(cycleId, tt, targetId, onDone) {
  let f;
  try { f = await API.get(`/eval/cycles/${cycleId}/form?target_type=${tt}&target_id=${targetId}`); } catch (err) { return toast(err.message, 'err'); }
  const existingScores = {};
  (f.scores || []).forEach((s) => { existingScores[s.criterion_id] = s; });

  const rows = f.criteria.map((cr) => {
    const ex = existingScores[cr.id] || {};
    const scale = [1, 2, 3, 4, 5].map((n) => `<label class="check-inline"><input type="radio" name="sc_${cr.id}" value="${n}" ${ex.score === n ? 'checked' : ''} /> ${arNum(n)}</label>`).join('');
    return `<div style="border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px">
      <b>${esc(cr.name)}</b> <span class="muted">(${arNum(cr.weight)}٪)</span>
      ${cr.description ? `<div class="muted" style="font-size:13px">${esc(cr.description)}</div>` : ''}
      <div class="mt">${scale}
        <label class="check-inline" style="margin-inline-start:8px"><input type="checkbox" id="na_${cr.id}" ${ex.is_na ? 'checked' : ''} /> لا ينطبق</label></div>
      <input placeholder="ملاحظة (اختياري)" id="note_${cr.id}" value="${ex.note ? esc(ex.note) : ''}" style="width:100%;margin-top:8px;padding:7px 10px;border:1px solid var(--border);border-radius:8px" />
    </div>`;
  }).join('');

  openModal({
    title: `تقييم: ${esc(f.target)}`,
    body: `${f.editable ? '' : '<div class="form-error">الدورة ليست مفتوحة للإدخال.</div>'}
      <div id="efErr"></div>${rows}
      <div class="field"><label>توصية عامة (اختياري)</label><textarea id="ef_general" rows="2">${f.existing && f.existing.general_note ? esc(f.existing.general_note) : ''}</textarea></div>`,
    buttons: f.editable ? [
      { label: 'حفظ التقييم', onClick: async (cl, ov) => {
        const scores = f.criteria.map((cr) => {
          const na = ov.querySelector('#na_' + cr.id).checked;
          const sel = ov.querySelector(`input[name=sc_${cr.id}]:checked`);
          return { criterion_id: cr.id, is_na: na, score: sel ? Number(sel.value) : null, note: ov.querySelector('#note_' + cr.id).value.trim() || null };
        });
        const missing = scores.find((s) => !s.is_na && s.score == null);
        if (missing) { ov.querySelector('#efErr').innerHTML = '<div class="form-error">يجب تقييم كل معيار أو تحديد «لا ينطبق»</div>'; return; }
        try {
          await API.put(`/eval/cycles/${cycleId}/evaluate`, { target_type: tt, target_id: Number(targetId), scores, general_note: ov.querySelector('#ef_general').value.trim() || null });
          cl(); toast('تم حفظ التقييم', 'ok'); if (onDone) onDone();
        } catch (err) { ov.querySelector('#efErr').innerHTML = `<div class="form-error">${esc(err.message)}</div>`; }
      }},
      { label: 'إلغاء', class: 'btn-ghost', onClick: (cl) => cl() },
    ] : [{ label: 'إغلاق', class: 'btn-ghost', onClick: (cl) => cl() }],
  });
}

// عرض النتائج
async function renderResults(cycleId, tt) {
  const box = document.getElementById('resBody');
  box.innerHTML = '<div class="spinner"></div>';
  let d, mine;
  try {
    d = await API.get(`/eval/cycles/${cycleId}/results?target_type=${tt}`);
    mine = await API.get(`/eval/cycles/${cycleId}/my-inputs?target_type=${tt}`).catch(() => ({ my_inputs: [] }));
  } catch (err) { box.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }

  const critHead = d.criteria.map((c) => `<th title="${esc(c.name)}">${esc(c.name)}</th>`).join('');
  const rows = d.results.map((r) => `<tr>
    <td>${tt === 'students' ? `<a href="#" data-hist="${r.target_id}"><b>${esc(r.name)}</b></a>` : `<b>${esc(r.name)}</b>`}</td>
    <td><span class="tag tag-green">${arFixed(r.overall)}</span></td>
    ${r.per_criterion.map((pc) => `<td>${pc.avg != null ? `<button class="btn-ghost btn-sm" data-detail="${r.target_id}|${pc.criterion_id}">${arFixed(pc.avg)}</button>` : '—'}</td>`).join('')}
    <td class="muted">${arNum(r.evaluators)}</td></tr>`).join('');

  let html = `<div class="row" style="margin-bottom:10px">
      <a class="btn-ghost btn-sm" href="/api/eval/cycles/${cycleId}/results/export?target_type=${tt}">${icon('package', 15)} تصدير النتائج</a>
      ${tt === 'students' ? '<span class="muted" style="font-size:12px">اضغط على اسم الطالب لعرض سجله التاريخي</span>' : ''}
    </div>
    <table class="tbl"><thead><tr><th>${TARGET_TYPE_AR[tt]}</th><th>النتيجة</th>${critHead}<th>عدد المقيّمين</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="${d.criteria.length + 3}" class="center muted">لا نتائج</td></tr>`}</tbody></table>`;

  if (mine.my_inputs && mine.my_inputs.length) {
    html += `<div class="card mt"><div class="card-head"><h3>مدخلاتي (منفصلة عن المتوسط العام)</h3></div>
      <table class="tbl"><thead><tr><th>${TARGET_TYPE_AR[tt]}</th><th>تقييمي المرجّح</th></tr></thead>
      <tbody>${mine.my_inputs.map((m) => `<tr><td>${esc(m.name)}</td><td>${arFixed(m.weighted)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  box.innerHTML = html;

  // فتح السجل التاريخي للطالب من شاشة النتائج (§٥٫٥)
  box.querySelectorAll('[data-hist]').forEach((a) => a.onclick = (e) => {
    e.preventDefault();
    if (typeof studentHistory === 'function') studentHistory(a.dataset.hist);
  });

  box.querySelectorAll('[data-detail]').forEach((b) => b.onclick = async () => {
    const [targetId, criterionId] = b.dataset.detail.split('|');
    try {
      const { entries } = await API.get(`/eval/cycles/${cycleId}/detail?target_type=${tt}&target_id=${targetId}&criterion_id=${criterionId}`);
      openModal({
        title: 'تفصيل تقييم البند',
        body: `<table class="tbl"><thead><tr><th>المقيِّم</th><th>الدرجة</th><th>الملاحظة</th></tr></thead>
          <tbody>${entries.map((e) => `<tr><td>${esc(e.evaluator)}</td><td>${e.is_na ? 'لا ينطبق' : arNum(e.score)}</td><td class="muted">${esc(e.note || '')}</td></tr>`).join('') || '<tr><td colspan="3" class="center muted">لا مدخلات</td></tr>'}</tbody></table>`,
        buttons: [{ label: 'إغلاق', class: 'btn-ghost', onClick: (cl) => cl() }],
      });
    } catch (err) { toast(err.message, 'err'); }
  });
}
