// وحدة سجل الطلاب (الواجهة) — الإدارة، النقل، الاستيراد/التصدير، والسجل التاريخي.

const STUDENT_STATUS_COLOR = { active: 'tag-green', transferred: 'tag-gold', withdrawn: 'tag-gray', graduated: 'tag-gray' };

VIEWS.students = async () => {
  setTitle('سجل الطلاب');
  content().innerHTML = '<div class="spinner"></div>';
  const canManage = ['president', 'first_supervisor'].includes(State.user.role);
  const isPres = State.user.role === 'president';

  content().innerHTML = `
    <div class="card"><div class="card-head"><h3>سجل الطلاب</h3><div class="spacer"></div>
      ${canManage ? '<button class="btn btn-sm" id="addStudent">+ طالب</button>' : ''}
      ${canManage ? '<button class="btn-ghost btn-sm" id="importBtn">استيراد Excel/CSV</button>' : ''}
      <a class="btn-ghost btn-sm" href="/api/students/export">تصدير</a>
    </div>
    <div class="card-body">
      <div class="row" style="margin-bottom:12px">
        ${isPres ? `<select id="fStage" style="padding:9px 12px;border:1px solid var(--border);border-radius:8px"><option value="">كل المراحل</option><option value="secondary">الثانوية</option><option value="middle">المتوسطة</option></select>` : ''}
        <select id="fStatus" style="padding:9px 12px;border:1px solid var(--border);border-radius:8px"><option value="">كل الحالات</option>
          ${Object.entries(STUDENT_STATUS_AR).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        <input id="fQ" placeholder="بحث بالاسم أو الهوية" style="flex:1;min-width:160px;padding:9px 12px;border:1px solid var(--border);border-radius:8px" />
        <button class="btn-ghost btn-sm" id="fApply">تصفية</button>
      </div>
      <div id="stList"><div class="spinner"></div></div>
    </div></div>`;

  const load = async () => {
    const p = new URLSearchParams();
    const st = document.getElementById('fStage'); if (st && st.value) p.set('stage', st.value);
    if (document.getElementById('fStatus').value) p.set('status', document.getElementById('fStatus').value);
    if (document.getElementById('fQ').value) p.set('q', document.getElementById('fQ').value);
    const box = document.getElementById('stList');
    box.innerHTML = '<div class="spinner"></div>';
    try {
      const { students } = await API.get('/students?' + p.toString());
      box.innerHTML = students.length ? `<table class="tbl">
        <thead><tr><th>الهوية</th><th>الاسم</th><th>المرحلة</th><th>الصف</th><th>الفصل</th><th>الحالة</th><th></th></tr></thead>
        <tbody>${students.map((s) => `<tr>
          <td dir="ltr" style="text-align:right">${esc(s.national_id)}</td>
          <td><a href="#" data-hist="${s.id}"><b>${esc(s.name)}</b></a></td>
          <td>${esc(STAGE_AR[s.stage] || s.stage)}</td><td>${esc(s.grade || '—')}</td><td>${esc(s.class || '—')}</td>
          <td>${statusTag(s.status, STUDENT_STATUS_AR, STUDENT_STATUS_COLOR)}</td>
          <td class="row">${canManage ? `<button class="btn-ghost btn-sm" data-edit="${s.id}">تعديل</button><button class="btn-ghost btn-sm" data-transfer="${s.id}">نقل</button>` : ''}</td>
        </tr>`).join('')}</tbody></table>` : `<div class="empty"><div class="ico">${icon('students', 42)}</div><p>لا يوجد طلاب</p></div>`;
      box.querySelectorAll('[data-hist]').forEach((a) => a.onclick = (e) => { e.preventDefault(); studentHistory(a.dataset.hist); });
      box.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => studentForm(students.find((x) => x.id == b.dataset.edit), load));
      box.querySelectorAll('[data-transfer]').forEach((b) => b.onclick = () => transferStudent(students.find((x) => x.id == b.dataset.transfer), load));
    } catch (err) { box.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  };
  document.getElementById('fApply').onclick = load;
  if (canManage) {
    document.getElementById('addStudent').onclick = () => studentForm(null, load);
    document.getElementById('importBtn').onclick = () => importStudents(load);
  }
  load();
};

function studentForm(existing, onDone) {
  const isEdit = !!existing;
  openModal({
    title: isEdit ? 'تعديل طالب' : 'طالب جديد',
    body: `<div id="sfErr"></div>
      <div class="row-2">
        <div class="field"><label>رقم الهوية</label><input id="sf_nid" dir="ltr" style="text-align:right" value="${existing ? esc(existing.national_id) : ''}" ${isEdit ? 'disabled' : ''} /></div>
        <div class="field"><label>الاسم</label><input id="sf_name" value="${existing ? esc(existing.name) : ''}" /></div>
      </div>
      <div class="row-2">
        <div class="field"><label>المرحلة</label><select id="sf_stage" ${isEdit ? 'disabled' : ''}>
          <option value="secondary" ${existing && existing.stage === 'secondary' ? 'selected' : ''}>الثانوية</option>
          <option value="middle" ${existing && existing.stage === 'middle' ? 'selected' : ''}>المتوسطة</option></select></div>
        <div class="field"><label>الحالة</label><select id="sf_status">${Object.entries(STUDENT_STATUS_AR).map(([v, l]) => `<option value="${v}" ${existing && existing.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <div class="row-2">
        <div class="field"><label>الصف</label><input id="sf_grade" value="${existing ? esc(existing.grade || '') : ''}" /></div>
        <div class="field"><label>الفصل</label><input id="sf_class" value="${existing ? esc(existing.class || '') : ''}" /></div>
      </div>
      <div class="field"><label>ملاحظات</label><textarea id="sf_notes" rows="2">${existing ? esc(existing.notes || '') : ''}</textarea></div>`,
    buttons: [
      { label: 'حفظ', onClick: async (cl, ov) => {
        const payload = {
          name: ov.querySelector('#sf_name').value.trim(),
          grade: ov.querySelector('#sf_grade').value.trim(),
          class: ov.querySelector('#sf_class').value.trim(),
          status: ov.querySelector('#sf_status').value,
          notes: ov.querySelector('#sf_notes').value.trim(),
        };
        try {
          if (isEdit) await API.patch('/students/' + existing.id, payload);
          else { payload.national_id = ov.querySelector('#sf_nid').value.trim(); payload.stage = ov.querySelector('#sf_stage').value; await API.post('/students', payload); }
          cl(); toast('تم الحفظ', 'ok'); onDone();
        } catch (err) { ov.querySelector('#sfErr').innerHTML = `<div class="form-error">${esc(err.message)}</div>`; }
      }},
      { label: 'إلغاء', class: 'btn-ghost', onClick: (cl) => cl() },
    ],
  });
}

function transferStudent(s, onDone) {
  const to = s.stage === 'secondary' ? 'middle' : 'secondary';
  openModal({
    title: 'نقل الطالب',
    body: `<p>نقل <b>${esc(s.name)}</b> من ${STAGE_AR[s.stage]} إلى <b>${STAGE_AR[to]}</b>.</p>
      <p class="muted">يُحتفظ بكامل السجل التاريخي المرتبط برقم الهوية.</p>
      <div class="field"><label>ملاحظة (اختياري)</label><input id="tr_note" /></div>`,
    buttons: [
      { label: 'تأكيد النقل', onClick: async (cl, ov) => {
        try { await API.post('/students/' + s.id + '/transfer', { to_stage: to, note: ov.querySelector('#tr_note').value.trim() || null }); cl(); toast('تم النقل', 'ok'); onDone(); }
        catch (err) { toast(err.message, 'err'); }
      }},
      { label: 'إلغاء', class: 'btn-ghost', onClick: (cl) => cl() },
    ],
  });
}

function importStudents(onDone) {
  const { overlay } = openModal({
    title: 'استيراد الطلاب',
    body: `<p class="muted">حمّل القالب، عبّئه، ثم ارفعه للمعاينة قبل الحفظ.</p>
      <div class="row"><a class="btn-ghost btn-sm" href="/api/students/template">تنزيل القالب</a>
        <input type="file" id="imp_file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" /></div>
      <p class="hint">يقبل ملفات Excel ‎(.xlsx)‎ وCSV.</p>
      <div id="imp_preview" class="mt"></div>`,
    buttons: [
      { label: 'حفظ الصفوف الصحيحة', class: '', onClick: async (cl, ov) => {
        if (!ov._csv) return toast('اختر ملفاً وعايِنه أولاً', 'err');
        if (!ov._valid) return toast('لا توجد صفوف صحيحة للحفظ', 'err');
        try { const r = await API.post('/students/import?commit=1', { csv: ov._csv }); cl(); toast(`تم استيراد ${r.inserted} — تم تخطي ${r.skipped}`, 'ok'); onDone(); }
        catch (err) { toast(err.message, 'err'); }
      }},
      { label: 'إغلاق', class: 'btn-ghost', onClick: (cl) => cl() },
    ],
  });
  overlay.querySelector('#imp_file').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    let text;
    try { text = await fileToCsv(f); }
    catch (err) { overlay.querySelector('#imp_preview').innerHTML = `<div class="form-error">${esc(err.message)}</div>`; overlay._csv = null; return; }
    overlay._csv = text;
    try {
      const p = await API.post('/students/import', { csv: text });
      overlay._valid = p.valid;
      overlay.querySelector('#imp_preview').innerHTML = `
        <div class="row"><span class="tag tag-green">صحيح: ${arNum(p.valid)}</span><span class="tag tag-red">خطأ: ${arNum(p.invalid)}</span><span class="tag tag-gray">الإجمالي: ${arNum(p.total)}</span></div>
        <table class="tbl mt"><thead><tr><th>الصف</th><th>الهوية</th><th>الاسم</th><th>المرحلة</th><th>الأخطاء</th></tr></thead>
        <tbody>${p.report.map((r) => `<tr style="${r.errors.length ? 'background:#fdecea' : ''}"><td>${arNum(r.row)}</td><td dir="ltr" style="text-align:right">${esc(r.national_id)}</td><td>${esc(r.name)}</td><td>${esc(STAGE_AR[r.stage] || r.stage)}</td><td class="tag-red">${r.errors.map(esc).join('، ') || '✓'}</td></tr>`).join('')}</tbody></table>`;
    } catch (err) { overlay.querySelector('#imp_preview').innerHTML = `<div class="form-error">${esc(err.message)}</div>`; overlay._csv = null; }
  };
}

// السجل التاريخي — نافذة تُفتح من أي مكان يظهر فيه اسم الطالب
async function studentHistory(id) {
  let d;
  try { d = await API.get('/students/' + id + '/history'); } catch (err) { return toast(err.message, 'err'); }
  const s = d.student;
  const alertHtml = d.alert === 'low' ? `<div class="form-error">${icon('warning', 15)} أداء متدنٍّ (أقل من ٣)</div>`
    : d.alert === 'declining' ? `<div class="tag tag-gold" style="display:block;padding:8px">${icon('warning', 15)} تراجع عن الدورة السابقة</div>` : '';

  // مخطط تطوّر بسيط (SVG) للطالب مقابل متوسط المرحلة
  const chart = buildTrendChart(d.timeline);

  const rows = d.timeline.map((t) => `<tr>
    <td>${esc(t.name)}</td>
    <td><b>${t.score != null ? arFixed(t.score) : '—'}</b></td>
    <td class="muted">${t.class_avg != null ? arFixed(t.class_avg) : '—'}</td>
    <td class="muted">${t.stage_avg != null ? arFixed(t.stage_avg) : '—'}</td>
  </tr>`).join('');

  openModal({
    title: `السجل التاريخي — ${esc(s.name)}`,
    body: `
      ${alertHtml}
      <div class="row-2">
        <div><span class="muted">رقم الهوية:</span> <span dir="ltr">${esc(s.national_id)}</span></div>
        <div><span class="muted">المرحلة:</span> ${esc(STAGE_AR[s.stage] || s.stage)}</div>
        <div><span class="muted">الصف/الفصل:</span> ${esc(s.grade || '—')} / ${esc(s.class || '—')}</div>
        <div><span class="muted">الحالة:</span> ${esc(STUDENT_STATUS_AR[s.status] || s.status)}</div>
      </div>
      ${d.timeline.length ? `<h4 class="mt">مخطط التطوّر</h4>${chart}
        <table class="tbl mt"><thead><tr><th>الدورة</th><th>نتيجته</th><th>متوسط صفه</th><th>متوسط مرحلته</th></tr></thead><tbody>${rows}</tbody></table>`
        : '<p class="muted mt">لا توجد نتائج تقييم منشورة بعد.</p>'}
      ${d.transfers.length ? `<h4 class="mt">سجل النقل</h4><ul style="padding-inline-start:18px">${d.transfers.map((t) => `<li>${esc(STAGE_AR[t.from_stage] || t.from_stage)} ← ${esc(STAGE_AR[t.to_stage] || t.to_stage)} <span class="muted">${fmtDateTime(t.moved_at)}</span></li>`).join('')}</ul>` : ''}`,
    buttons: [{ label: 'إغلاق', class: 'btn-ghost', onClick: (cl) => cl() }],
  });
}

function buildTrendChart(timeline) {
  const pts = timeline.filter((t) => t.score != null);
  if (pts.length < 1) return '<p class="muted">لا بيانات كافية للمخطط.</p>';
  const W = 460, H = 160, pad = 28;
  const n = pts.length;
  const x = (i) => pad + (n === 1 ? (W - 2 * pad) / 2 : (i * (W - 2 * pad)) / (n - 1));
  const y = (v) => H - pad - ((v - 1) / 4) * (H - 2 * pad); // نطاق 1..5
  const line = (key, color) => {
    const seg = timeline.map((t, i) => ({ t, i })).filter((o) => o.t[key] != null);
    if (!seg.length) return '';
    const path = seg.map((o, k) => `${k === 0 ? 'M' : 'L'}${x(o.i).toFixed(1)},${y(o.t[key]).toFixed(1)}`).join(' ');
    const dots = seg.map((o) => `<circle cx="${x(o.i).toFixed(1)}" cy="${y(o.t[key]).toFixed(1)}" r="3" fill="${color}"/>`).join('');
    return `<path d="${path}" fill="none" stroke="${color}" stroke-width="2"/>${dots}`;
  };
  const grid = [1, 2, 3, 4, 5].map((v) => `<line x1="${pad}" y1="${y(v)}" x2="${W - pad}" y2="${y(v)}" stroke="#eee"/><text x="4" y="${y(v) + 4}" font-size="10" fill="#999">${arNum(v)}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;border:1px solid var(--border);border-radius:8px;background:#fff">
    ${grid}${line('stage_avg', '#c9a24b')}${line('score', '#1f6f54')}
    <text x="${W - pad}" y="14" font-size="11" fill="#1f6f54" text-anchor="end">■ الطالب</text>
    <text x="${W - pad - 70}" y="14" font-size="11" fill="#c9a24b" text-anchor="end">■ المرحلة</text>
  </svg>`;
}
