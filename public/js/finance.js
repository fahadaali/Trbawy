// وحدة المتابعة المالية (الواجهة) — الحركة المالية (صرف · إيراد) ومرفقات إثباتها،
// والعهدة المالية طلبًا وقرارًا.
//
// الصفحة لوحان في شاشة واحدة:
//   الحركات — بطاقات المجاميع، ثم مصفّيات، ثم جدول الحركات وكلُّ حركة بإثباتها.
//   العُهد   — طلبٌ يُرفع على مستوى المجلس التربوي أو مجلس مرحلة، ويقرّره صاحبُ
//              الاعتماد في ذلك المجلس. وقبولُه يُنشئ حركة إيراد بمبلغه في اللحظة
//              نفسها، فتصير العهدة رصيدًا يُصرف منه ويُربط كل صرفٍ منها بها.

const FIN_KIND_AR = { expense: 'صرف', income: 'إيراد' };
const FIN_KIND_COLOR = { expense: 'tag-red', income: 'tag-green' };
const CUSTODY_STATUS_AR = {
  pending: 'بانتظار القرار', approved: 'مقبولة', rejected: 'مرفوضة', cancelled: 'مسحوبة',
};
const CUSTODY_STATUS_COLOR = {
  pending: 'tag-gold', approved: 'tag-green', rejected: 'tag-red', cancelled: 'tag-gray',
};

const FinState = {
  tab: 'entries',            // entries | custody
  meta: null,
  entries: [], summary: null, partial: false,
  custodies: [],
  filters: { council_id: '', kind: '', from: '', to: '', q: '' },
  editing: null,             // الحركة التي يُعاد تحريرها
  formOpen: false,
  pendingFiles: [],          // مرفقات اختِيرت في النموذج ولم تُرفع بعد
};

// ---------- المبالغ ----------
/** مبلغ بالأرقام العربية-الهندية بفاصلتَي الآلاف والعشرة العربيتين: ١٬٢٥٠٫٠٠ */
function arMoney(n) {
  const v = Number(n || 0);
  const [i, f] = Math.abs(v).toFixed(2).split('.');
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
  return (v < 0 ? '−' : '') + arNum(grouped) + '٫' + arNum(f);
}
/**
 * المبلغ كتلةٌ واحدة: إشارته ورقمه وعملته لا تنفصل — لا في سطر ينكسر، ولا في خلية
 * تتحوّل بطاقةً على الجوال فتُوزّع أجزاءها على طرفَي السطر. والرقم معزول الاتجاه.
 */
const riyal = (n, sign = '') =>
  `<span class="amt">${sign}<span class="num">${arMoney(n)}</span> <span class="cur">ر.س</span></span>`;

// ============================================================
// الشاشة
// ============================================================
VIEWS.finance = async () => {
  setTitle('المتابعة المالية');
  const q = location.hash.split('?')[1] || '';
  FinState.tab = q.includes('custody') ? 'custody' : 'entries';

  content().innerHTML = `
    <div class="row" style="margin-bottom:16px">
      <button class="btn ${FinState.tab === 'entries' ? '' : 'btn-ghost'} btn-sm" id="finTabE">الحركات المالية</button>
      <button class="btn ${FinState.tab === 'custody' ? '' : 'btn-ghost'} btn-sm" id="finTabC">العُهد المالية</button>
    </div>
    <div id="finBody"><div class="spinner"></div></div>`;
  document.getElementById('finTabE').onclick = () => { location.hash = '#/finance'; VIEWS.finance(); };
  document.getElementById('finTabC').onclick = () => { location.hash = '#/finance?custody'; VIEWS.finance(); };

  if (!FinState.meta) {
    try { FinState.meta = await API.get('/finance/meta'); }
    catch (err) { return renderError(err); }
  }
  if (!FinState.meta.councils.length) {
    document.getElementById('finBody').innerHTML = `<div class="card"><div class="card-body">
      <div class="empty"><div class="ico">${icon('wallet', 42)}</div>
      <p>لا مجلس ضمن اطلاعك — لا متابعة مالية تُعرض لك.</p></div></div></div>`;
    return;
  }
  renderFinance();
};

const councilOf = (id) => (FinState.meta.councils || []).find((c) => c.id === Number(id)) || null;
const anyCan = (key) => (FinState.meta.councils || []).some((c) => c[key]);
/** المجالس التي يكتب فيها — نموذجُ الإضافة لا يُعرض لمن لا مجلس له يكتب فيه. */
const writableCouncils = () => (FinState.meta.councils || []).filter((c) => c.can_add);

function renderFinance() {
  const box = document.getElementById('finBody');
  box.innerHTML = FinState.tab === 'custody'
    ? '<div id="finCustody"><div class="spinner"></div></div>'
    : `<div id="finCards" class="grid grid-4 fin-cards"></div>
       <div class="card mt">
         <div class="card-body tb-toolbar fin-toolbar" id="finBar"></div>
         <div id="finForm" class="tform" hidden></div>
         <div id="finList"><div class="spinner"></div></div>
       </div>`;
  if (FinState.tab === 'custody') return loadCustodies();
  renderFinBar();
  loadEntries();
}

// ============================================================
// الحركات المالية
// ============================================================
function renderFinBar() {
  const bar = document.getElementById('finBar');
  const f = FinState.filters;
  const canAdd = writableCouncils().length > 0;
  bar.innerHTML = `
    <select id="fCouncil" title="المجلس">
      <option value="">كل المجالس</option>
      ${FinState.meta.councils.map((c) =>
        `<option value="${c.id}" ${String(f.council_id) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
    </select>
    <select id="fKind" title="نوع الحركة">
      <option value="">صرف وإيراد</option>
      ${Object.entries(FIN_KIND_AR).map(([v, l]) =>
        `<option value="${v}" ${f.kind === v ? 'selected' : ''}>${l}</option>`).join('')}
    </select>
    <label class="fin-dt">من <input type="date" id="fFrom" value="${esc(f.from)}" /></label>
    <label class="fin-dt">إلى <input type="date" id="fTo" value="${esc(f.to)}" /></label>
    <input id="fQ" placeholder="بحث في البيان…" value="${esc(f.q)}" />
    <div class="spacer"></div>
    ${canAdd ? `<button class="btn btn-sm" id="fNew">${icon('addbox', 16)} حركة جديدة</button>` : ''}`;

  const pull = () => {
    f.council_id = document.getElementById('fCouncil').value;
    f.kind = document.getElementById('fKind').value;
    f.from = document.getElementById('fFrom').value;
    f.to = document.getElementById('fTo').value;
    f.q = document.getElementById('fQ').value.trim();
    loadEntries();
  };
  ['fCouncil', 'fKind', 'fFrom', 'fTo'].forEach((id) => { document.getElementById(id).onchange = pull; });
  onEnter('fQ', pull);
  document.getElementById('fQ').onblur = pull;
  if (canAdd) document.getElementById('fNew').onclick = () => openEntryForm(null);
}

async function loadEntries() {
  const list = document.getElementById('finList');
  if (!list) return;
  list.innerHTML = '<div class="spinner"></div>';
  const f = FinState.filters;
  const q = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => { if (v) q.set(k, v); });
  try {
    const [data, cu] = await Promise.all([
      API.get('/finance' + (q.toString() ? '?' + q : '')),
      API.get('/finance/custodies?status=approved'),
    ]);
    FinState.entries = data.entries;
    FinState.summary = data.summary;
    FinState.partial = !!data.partial_summary;
    FinState.custodies = cu.custodies;
  } catch (err) { return renderError(err); }
  if (!document.getElementById('finList')) return;
  renderFinCards();
  renderEntries();
}

function renderFinCards() {
  const box = document.getElementById('finCards');
  if (!box) return;
  const s = FinState.summary || { income: 0, expense: 0, balance: 0, count: 0 };
  const open = FinState.custodies.filter((c) => c.status === 'approved');
  const custodyLeft = open.reduce((a, c) => a + Number(c.remaining || 0), 0);
  box.innerHTML = `
    <div class="stat stat-ok"><div class="v">${riyal(s.income)}</div><div class="l">إجمالي الإيرادات</div></div>
    <div class="stat stat-bad"><div class="v">${riyal(s.expense)}</div><div class="l">إجمالي المصروفات</div></div>
    <div class="stat ${s.balance < 0 ? 'stat-bad' : 'stat-ok'}"><div class="v">${riyal(s.balance)}</div>
      <div class="l">الرصيد</div>
      <div class="s">${arCount(s.count, ['حركة واحدة', 'حركتان', 'حركات', 'حركة'])}${FinState.partial ? ' — ضمن ما تطّلع عليه' : ''}</div></div>
    <div class="stat" style="cursor:pointer" onclick="location.hash='#/finance?custody';VIEWS.finance()">
      <div class="v">${riyal(custodyLeft)}</div><div class="l">رصيد العُهد المفتوحة</div>
      <div class="s">${open.length ? arCount(open.length, ['عهدة واحدة', 'عهدتان', 'عُهد', 'عهدة']) : 'لا عهدة مقبولة'}</div></div>`;
}

function renderEntries() {
  const box = document.getElementById('finList');
  if (!box) return;
  if (!FinState.entries.length) {
    box.innerHTML = `<div class="empty"><div class="ico">${icon('wallet', 42)}</div>
      <p>لا حركة مالية بهذه المصفّيات.</p></div>`;
    return;
  }
  box.innerHTML = `
    <table class="tbl tbl-fin"><thead><tr>
      <th>التاريخ</th><th>النوع</th><th>البيان</th><th>المبلغ</th>
      <th>المسؤول</th><th>المجلس</th><th>الإثبات</th><th></th>
    </tr></thead><tbody>
      ${FinState.entries.map((e) => `<tr>
        <td class="nb">${fmtDate(e.entry_date)}</td>
        <td>${statusTag(e.kind, FIN_KIND_AR, FIN_KIND_COLOR)}</td>
        <td><div class="cellbox">
          <b>${esc(e.statement)}</b>
          ${e.custody_purpose ? `<div class="muted" style="font-size:12.5px">${icon('wallet', 13)} من عهدة: ${esc(e.custody_purpose)}</div>` : ''}
          ${e.source === 'custody' ? '<div><span class="tag tag-gold">حركة عهدة — تتبع طلبها</span></div>' : ''}
          ${e.note ? `<div class="muted" style="font-size:12.5px">${esc(e.note)}</div>` : ''}
        </div></td>
        <td class="nb ${e.kind === 'income' ? 'fin-in' : 'fin-out'}">${riyal(e.amount, e.kind === 'income' ? '+ ' : '− ')}</td>
        <td>${e.owner_name ? personChip(e.owner_name, e.owner_color) : '<span class="muted">—</span>'}</td>
        <td class="muted" style="font-size:13px">${esc(e.council_name)}</td>
        <td>${attachCell(e)}</td>
        <td class="nb">
          ${e.can_attach ? `<button class="btn-ghost btn-sm" data-att="${e.id}" title="إضافة إثبات">${icon('paperclip', 15)}</button>` : ''}
          ${e.can_edit ? `<button class="btn-ghost btn-sm" data-edit="${e.id}" title="تعديل">${icon('pen', 15)}</button>` : ''}
          ${e.can_delete ? `<button class="btn-ghost btn-sm" data-del="${e.id}" title="حذف">${icon('trash', 15)}</button>` : ''}
        </td>
      </tr>`).join('')}
    </tbody></table>`;

  box.querySelectorAll('[data-view-att]').forEach((b) => b.onclick = () => {
    const e = FinState.entries.find((x) => x.id === Number(b.dataset.viewAtt));
    if (e) finPreview(e.attachments, Number(b.dataset.i), e);
  });
  box.querySelectorAll('[data-att]').forEach((b) => b.onclick = () => pickAttachments(Number(b.dataset.att)));
  box.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () =>
    openEntryForm(FinState.entries.find((x) => x.id === Number(b.dataset.edit))));
  box.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
    const e = FinState.entries.find((x) => x.id === Number(b.dataset.del));
    confirmModal('حذف الحركة المالية',
      `ستُحذف الحركة «${e.statement}» ومرفقاتها معها، ولا رجعة في ذلك.`,
      async () => {
        try { await API.del('/finance/' + e.id); toast('حُذفت الحركة', 'ok'); loadEntries(); }
        catch (err) { toast(err.message, 'err'); }
      }, { danger: true, confirmLabel: 'حذف' });
  });
}

/** خلية الإثبات: شارةٌ لكل مرفق تفتح معاينته. */
function attachCell(e) {
  const list = e.attachments || [];
  if (!list.length) return '<span class="muted">—</span>';
  return `<span class="fin-atts">${list.map((a, i) =>
    `<button class="fin-att" data-view-att="${e.id}" data-i="${i}" title="${esc(a.name)}">
      ${icon(String(a.mime).startsWith('image/') ? 'image' : 'filePdf', 14)}</button>`).join('')}</span>`;
}

// ---------- نموذج الحركة ----------
function openEntryForm(entry) {
  FinState.editing = entry || null;
  FinState.pendingFiles = [];
  const box = document.getElementById('finForm');
  box.hidden = false;
  const councils = entry
    ? FinState.meta.councils.filter((c) => c.can_edit || c.id === entry.council_id)
    : writableCouncils();
  const cid = entry ? entry.council_id : (FinState.filters.council_id || councils[0]?.id || '');
  const today = new Date().toISOString().slice(0, 10);

  box.innerHTML = `
    <form id="finEntryForm">
      <div class="tf-title"><b>${entry ? 'تعديل حركة مالية' : 'حركة مالية جديدة'}</b>
        <div class="spacer"></div><button type="button" class="btn-ghost btn-sm" id="finCancel">إلغاء</button></div>
      <div class="row-2">
        <div class="field"><label>النوع</label>
          <div class="seg seg-wide" id="finKind" role="group" aria-label="نوع الحركة">
            <button type="button" data-k="expense" class="${!entry || entry.kind === 'expense' ? 'on' : ''}">صرف</button>
            <button type="button" data-k="income" class="${entry && entry.kind === 'income' ? 'on' : ''}">إيراد</button>
          </div></div>
        <div class="field"><label>المبلغ (ر.س)</label>
          <input id="finAmount" inputmode="decimal" required value="${entry ? entry.amount : ''}" placeholder="٠٫٠٠" /></div>
      </div>
      <div class="field"><label>البيان</label>
        <input id="finStatement" required maxlength="400" value="${entry ? esc(entry.statement) : ''}"
          placeholder="شراء مستلزمات · إيراد نشاط…" /></div>
      <div class="row-2">
        <div class="field"><label>التاريخ</label>
          <input type="date" id="finDate" required value="${entry ? esc(String(entry.entry_date).slice(0, 10)) : today}" /></div>
        <div class="field"><label>المجلس</label>
          <select id="finCouncil">${councils.map((c) =>
            `<option value="${c.id}" ${String(c.id) === String(cid) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      </div>
      <div class="row-2">
        <div class="field"><label>المسؤول</label><select id="finOwner"></select></div>
        <div class="field" id="finCustodyField"><label>الصرف من عهدة (اختياري)</label><select id="finCustody"></select></div>
      </div>
      <div class="field"><label>ملاحظة (اختياري)</label>
        <input id="finNote" maxlength="1000" value="${entry ? esc(entry.note || '') : ''}" /></div>
      ${entry ? '' : `<div class="field"><label>مرفقات الإثبات (صور · PDF)</label>
        <input type="file" id="finFiles" multiple accept="image/*,application/pdf" />
        <div class="hint">تُرفع بعد حفظ الحركة. الحد ١٥ م.ب للملف الواحد.</div>
        <div id="finUpRows" class="fin-uprows"></div></div>`}
      <div class="row"><button class="btn btn-sm" type="submit">${entry ? 'حفظ التعديل' : 'حفظ الحركة'}</button></div>
    </form>`;

  const kindOf = () => box.querySelector('#finKind .on').dataset.k;
  box.querySelectorAll('#finKind button').forEach((b) => b.onclick = () => {
    box.querySelectorAll('#finKind button').forEach((x) => x.classList.toggle('on', x === b));
    syncCustodyField();
  });

  const syncOwners = () => {
    const c = councilOf(document.getElementById('finCouncil').value);
    const cur = entry ? entry.owner_id : State.user.id;
    document.getElementById('finOwner').innerHTML = '<option value="">— بلا مسؤول —</option>'
      + (c ? c.members : []).map((m) =>
        `<option value="${m.id}" ${String(m.id) === String(cur) ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
  };
  const syncCustodyField = () => {
    const isExpense = kindOf() === 'expense';
    const field = document.getElementById('finCustodyField');
    field.style.display = isExpense ? '' : 'none';
    const cid2 = Number(document.getElementById('finCouncil').value);
    const open = FinState.custodies.filter((c) => c.status === 'approved' && c.council_id === cid2);
    const cur = entry ? entry.custody_id : null;
    document.getElementById('finCustody').innerHTML = '<option value="">— لا —</option>'
      + open.map((c) => `<option value="${c.id}" ${String(c.id) === String(cur) ? 'selected' : ''}>
          ${esc(c.purpose)} — المتبقي ${arMoney(c.remaining)} ر.س</option>`).join('');
  };
  document.getElementById('finCouncil').onchange = () => { syncOwners(); syncCustodyField(); };
  syncOwners(); syncCustodyField();

  document.getElementById('finCancel').onclick = () => { box.hidden = true; FinState.editing = null; };
  const filesInput = document.getElementById('finFiles');
  if (filesInput) filesInput.onchange = () => { FinState.pendingFiles = [...filesInput.files]; };

  document.getElementById('finEntryForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const btn = ev.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    const body = {
      council_id: Number(document.getElementById('finCouncil').value),
      kind: kindOf(),
      statement: document.getElementById('finStatement').value.trim(),
      amount: document.getElementById('finAmount').value.trim(),
      entry_date: document.getElementById('finDate').value,
      owner_id: Number(document.getElementById('finOwner').value) || null,
      custody_id: kindOf() === 'expense' ? (Number(document.getElementById('finCustody').value) || null) : null,
      note: document.getElementById('finNote').value.trim(),
    };
    try {
      if (entry) {
        await API.patch('/finance/' + entry.id, body);
        toast('حُفظ التعديل', 'ok');
      } else {
        const res = await API.post('/finance', body);
        if (FinState.pendingFiles.length) await uploadFinanceFiles(res.id, FinState.pendingFiles, 'finUpRows');
        toast('سُجّلت الحركة', 'ok');
      }
      box.hidden = true; FinState.editing = null;
      loadEntries();
    } catch (err) {
      toast(err.message, 'err');
      btn.disabled = false;
    }
  };
}

// ---------- المرفقات ----------
/** رفع ملف واحد بتقدّم فعلي (fetch لا يُبلّغ عن تقدّم الرفع). */
function finUploadOne(entryId, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/finance/${entryId}/attachments?name=` + encodeURIComponent(file.name));
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* ردٌّ غير JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error((data && data.error) || 'تعذّر الرفع'));
    };
    xhr.onerror = () => reject(new Error('انقطع الاتصال أثناء الرفع'));
    xhr.send(file);
  });
}

async function uploadFinanceFiles(entryId, files, rowsId) {
  const rows = document.getElementById(rowsId);
  if (rows) {
    rows.innerHTML = files.map((f, i) => `<div class="up-row" id="fu${i}">
      <span class="n">${esc(f.name)}</span><div class="bar"><i style="width:0%"></i></div>
      <span class="st">بالانتظار</span></div>`).join('');
  }
  let failed = 0;
  for (let i = 0; i < files.length; i++) {
    const row = rows ? document.getElementById('fu' + i) : null;
    const bar = row ? row.querySelector('.bar i') : null;
    const st = row ? row.querySelector('.st') : null;
    if (st) st.textContent = 'يُرفع…';
    try {
      await finUploadOne(entryId, files[i], (p) => { if (bar) bar.style.width = Math.round(p * 100) + '%'; });
      if (bar) bar.style.width = '100%';
      if (st) st.textContent = 'تم ✓';
      if (row) row.classList.add('ok');
    } catch (err) {
      failed++;
      if (st) st.textContent = err.message;
      if (row) row.classList.add('err');
    }
  }
  if (failed) toast(`تعذّر رفع ${arNum(failed)} من الإثباتات`, 'err');
  return failed;
}

/** إضافة إثبات إلى حركة قائمة — نافذةٌ صغيرة بلا مغادرة الجدول. */
function pickAttachments(entryId) {
  const entry = FinState.entries.find((e) => e.id === entryId);
  const { overlay, close } = openModal({
    title: 'إضافة إثبات',
    body: `<p class="hint">المقبول صورٌ (JPG · PNG · HEIC…) وملفات PDF، والحد ١٥ م.ب للملف الواحد.</p>
      <div class="field"><input type="file" id="finAddFiles" multiple accept="image/*,application/pdf" /></div>
      ${entry && entry.attachments.length ? `<div class="field"><label>المرفوع سابقًا</label>
        <div class="fin-att-list">${entry.attachments.map((a) => `<div class="fin-att-row">
          <span>${icon(String(a.mime).startsWith('image/') ? 'image' : 'filePdf', 15)} ${esc(a.name)}</span>
          <button class="btn-ghost btn-sm" data-drop="${a.id}">${icon('trash', 14)}</button>
        </div>`).join('')}</div></div>` : ''}
      <div id="finAddRows" class="fin-uprows"></div>`,
    buttons: [
      { label: 'رفع', onClick: async (cl, ov) => {
        const files = [...ov.querySelector('#finAddFiles').files];
        if (!files.length) return toast('اختر ملفًا أولًا', 'err');
        ov.querySelector('.modal-foot').querySelectorAll('button').forEach((b) => (b.disabled = true));
        const failed = await uploadFinanceFiles(entryId, files, 'finAddRows');
        if (!failed) toast('رُفعت الإثباتات', 'ok');
        cl(); loadEntries();
      } },
      { label: 'إغلاق', class: 'btn-ghost', onClick: (cl) => cl() },
    ],
  });
  overlay.querySelectorAll('[data-drop]').forEach((b) => b.onclick = () => {
    confirmModal('حذف الإثبات', 'يُحذف المرفق من الحركة نهائيًا.', async () => {
      try { await API.del('/finance/attachments/' + b.dataset.drop); toast('حُذف المرفق', 'ok'); close(); loadEntries(); }
      catch (err) { toast(err.message, 'err'); }
    }, { danger: true, confirmLabel: 'حذف' });
  });
}

/** معاينة الإثباتات: الصور صورةً، وPDF داخل إطار — والتنقّل بينها بالأسهم. */
function finPreview(list, index, entry) {
  if (!list || !list.length) return;
  let i = Math.max(0, Math.min(index || 0, list.length - 1));
  const { overlay, close } = openModal({
    title: 'إثبات: ' + (entry ? entry.statement : ''),
    body: '<div id="finPrev"></div>',
    buttons: [{ label: 'إغلاق', class: 'btn-ghost', onClick: (cl) => cl() }],
  });
  const draw = () => {
    const a = list[i];
    const raw = `/api/finance/attachments/${a.id}/raw/${encodeURIComponent(a.name)}`;
    const isImg = String(a.mime).startsWith('image/');
    overlay.querySelector('#finPrev').innerHTML = `
      <div class="fin-prev-head">
        <b>${esc(a.name)}</b>
        <div class="spacer"></div>
        <a class="btn-ghost btn-sm" href="/api/finance/attachments/${a.id}/download">${icon('download', 15)} تنزيل</a>
        <a class="btn-ghost btn-sm only-desktop" href="${raw}" target="_blank" rel="noopener">${icon('external', 15)} نافذة</a>
      </div>
      <div class="fin-prev-stage">
        ${isImg ? `<img src="${raw}" alt="${esc(a.name)}" />`
          : `<iframe src="${raw}#view=FitH" title="${esc(a.name)}"></iframe>`}
      </div>
      ${list.length > 1 ? `<div class="fin-prev-nav">
        <button class="btn-ghost btn-sm" id="fpPrev" ${i === 0 ? 'disabled' : ''} aria-label="السابق">‹</button>
        <span>${arNum(i + 1)} من ${arNum(list.length)}</span>
        <button class="btn-ghost btn-sm" id="fpNext" ${i === list.length - 1 ? 'disabled' : ''} aria-label="التالي">›</button>
      </div>` : ''}`;
    const prev = overlay.querySelector('#fpPrev');
    const next = overlay.querySelector('#fpNext');
    if (prev) prev.onclick = () => { i--; draw(); };
    if (next) next.onclick = () => { i++; draw(); };
  };
  draw();
  return close;
}

// ============================================================
// العُهد المالية
// ============================================================
async function loadCustodies() {
  const box = document.getElementById('finCustody');
  if (!box) return;
  box.innerHTML = '<div class="spinner"></div>';
  try { FinState.custodies = (await API.get('/finance/custodies')).custodies; }
  catch (err) { return renderError(err); }
  if (!document.getElementById('finCustody')) return;
  renderCustodies();
}

function renderCustodies() {
  const box = document.getElementById('finCustody');
  const canRequest = anyCan('can_request');
  const pending = FinState.custodies.filter((c) => c.status === 'pending');
  const mineToDecide = pending.filter((c) => c.can_decide);

  box.innerHTML = `
    <div class="card">
      <div class="card-body tb-toolbar fin-toolbar">
        <select id="cuStatus" title="الحالة">
          <option value="">كل الطلبات</option>
          ${Object.entries(CUSTODY_STATUS_AR).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
        </select>
        <div class="spacer"></div>
        ${mineToDecide.length ? `<span class="tag tag-gold">${arCount(mineToDecide.length, ['طلبٌ ينتظر قرارك', 'طلبان ينتظران قرارك', 'طلبات تنتظر قرارك', 'طلبًا ينتظر قرارك'])}</span>` : ''}
        ${canRequest ? `<button class="btn btn-sm" id="cuNew">${icon('addbox', 16)} طلب عهدة</button>` : ''}
      </div>
      <div id="cuList"></div>
    </div>`;
  document.getElementById('cuStatus').onchange = (e) => renderCustodyList(e.target.value);
  if (canRequest) document.getElementById('cuNew').onclick = () => custodyRequestDialog();
  renderCustodyList('');
}

function renderCustodyList(status) {
  const box = document.getElementById('cuList');
  const rows = FinState.custodies.filter((c) => !status || c.status === status);
  if (!rows.length) {
    box.innerHTML = `<div class="empty"><div class="ico">${icon('wallet', 42)}</div>
      <p>لا طلب عهدة بهذه الحالة.</p></div>`;
    return;
  }
  box.innerHTML = `
    <table class="tbl"><thead><tr>
      <th>المستوى</th><th>البيان</th><th>المطلوب</th><th>المقبول</th>
      <th>المصروف</th><th>المتبقي</th><th>الطالب</th><th>الحالة</th><th></th>
    </tr></thead><tbody>
      ${rows.map((c) => `<tr>
        <td>${esc(COUNCIL_TYPE_AR[c.council_type] || c.council_name)}</td>
        <td><div class="cellbox"><b>${esc(c.purpose)}</b>
          ${c.needed_by ? `<div class="muted" style="font-size:12.5px">مطلوبة قبل ${fmtDate(c.needed_by)}</div>` : ''}
          ${c.decision_note ? `<div class="muted" style="font-size:12.5px">${esc(c.decision_note)}</div>` : ''}</div></td>
        <td class="nb">${riyal(c.amount)}</td>
        <td class="nb">${c.approved_amount == null ? '<span class="muted">—</span>' : riyal(c.approved_amount)}</td>
        <td class="nb">${c.status === 'approved' ? riyal(c.spent) : '<span class="muted">—</span>'}</td>
        <td class="nb">${c.remaining == null ? '<span class="muted">—</span>'
          : `<span class="${c.remaining <= 0 ? 'fin-out' : 'fin-in'}">${riyal(c.remaining)}</span>`}</td>
        <td><div class="cellbox">${personChip(c.requested_by_name || '—', c.requested_by_color)}
          <div class="muted" style="font-size:12px">${fmtDateTime(c.requested_at)}</div></div></td>
        <td><div class="cellbox">${statusTag(c.status, CUSTODY_STATUS_AR, CUSTODY_STATUS_COLOR)}
          ${c.decided_by_name ? `<div class="muted" style="font-size:12px">${esc(c.decided_by_name)}</div>` : ''}</div></td>
        <td class="nb">
          ${c.can_decide ? `<button class="btn btn-sm" data-ok="${c.id}">قبول</button>
            <button class="btn-ghost btn-sm" data-no="${c.id}">رفض</button>` : ''}
          ${c.can_cancel ? `<button class="btn-ghost btn-sm" data-cancel="${c.id}">سحب</button>` : ''}
          ${c.status === 'approved' ? `<button class="btn-ghost btn-sm" data-spend="${c.id}" title="مصروفات هذه العهدة">${icon('list', 15)}</button>` : ''}
        </td>
      </tr>`).join('')}
    </tbody></table>`;

  const find = (id) => FinState.custodies.find((c) => c.id === Number(id));
  box.querySelectorAll('[data-ok]').forEach((b) => b.onclick = () => custodyDecisionDialog(find(b.dataset.ok), true));
  box.querySelectorAll('[data-no]').forEach((b) => b.onclick = () => custodyDecisionDialog(find(b.dataset.no), false));
  box.querySelectorAll('[data-cancel]').forEach((b) => b.onclick = () => {
    const c = find(b.dataset.cancel);
    confirmModal('سحب الطلب', `يُسحب طلب العهدة «${c.purpose}» فلا يُفصل فيه.`, async () => {
      try { await API.post(`/finance/custodies/${c.id}/cancel`); toast('سُحب الطلب', 'ok'); loadCustodies(); }
      catch (err) { toast(err.message, 'err'); }
    }, { confirmLabel: 'سحب' });
  });
  box.querySelectorAll('[data-spend]').forEach((b) => b.onclick = () => custodySpendDialog(find(b.dataset.spend)));
}

function custodyRequestDialog() {
  const councils = FinState.meta.councils.filter((c) => c.can_request);
  const { overlay, close } = openModal({
    title: 'طلب عهدة مالية',
    body: `
      <p class="hint">الطلب يُرفع إلى جهة اعتماد المجلس المختار — رئيس المجلس التربوي لمجلسه،
        والمشرف الأول لمرحلته. وقبولُه يُنشئ حركة إيراد بمبلغه المقبول فتصير العهدة رصيدًا يُصرف منه.</p>
      <div class="field"><label>المستوى</label>
        <select id="cuCouncil">${councils.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label>المبلغ المطلوب (ر.س)</label>
        <input id="cuAmount" inputmode="decimal" placeholder="٠٫٠٠" /></div>
      <div class="field"><label>البيان / الغرض</label>
        <input id="cuPurpose" maxlength="400" placeholder="مستلزمات النشاط الطلابي…" /></div>
      <div class="field"><label>مطلوبة قبل (اختياري)</label><input type="date" id="cuNeeded" /></div>`,
    buttons: [
      { label: 'رفع الطلب', onClick: async (cl, ov) => {
        const body = {
          council_id: Number(ov.querySelector('#cuCouncil').value),
          amount: ov.querySelector('#cuAmount').value.trim(),
          purpose: ov.querySelector('#cuPurpose').value.trim(),
          needed_by: ov.querySelector('#cuNeeded').value || null,
        };
        try {
          await API.post('/finance/custodies', body);
          toast('رُفع الطلب إلى جهة الاعتماد', 'ok');
          cl(); loadCustodies();
        } catch (err) { toast(err.message, 'err'); }
      } },
      { label: 'إلغاء', class: 'btn-ghost', onClick: (cl) => cl() },
    ],
  });
  overlay.querySelector('#cuAmount').focus();
}

function custodyDecisionDialog(c, approve) {
  openModal({
    title: approve ? 'قبول طلب العهدة' : 'رفض طلب العهدة',
    body: `
      <div class="cal-when"><b>${esc(c.purpose)}</b>
        <div><span class="muted">المستوى:</span> ${esc(c.council_name)}</div>
        <div><span class="muted">الطالب:</span> ${esc(c.requested_by_name || '—')}</div>
        <div><span class="muted">المبلغ المطلوب:</span> ${riyal(c.amount)}</div></div>
      ${approve ? `<div class="field mt"><label>المبلغ المقبول (ر.س)</label>
        <input id="cdAmount" inputmode="decimal" value="${c.amount}" />
        <div class="hint">يجوز أن يقلّ عن المطلوب. وبالقبول تُنشأ حركة إيراد بهذا المبلغ في المجلس نفسه.</div></div>`
        : '<p class="hint mt">الرفض قرارٌ مسجَّل بسببه — لا يُحذف الطلب.</p>'}
      <div class="field"><label>${approve ? 'ملاحظة (اختياري)' : 'سبب الرفض'}</label>
        <input id="cdNote" maxlength="1000" /></div>`,
    buttons: [
      { label: approve ? 'قبول وإنشاء الإيراد' : 'رفض', class: approve ? '' : 'btn-danger',
        onClick: async (cl, ov) => {
          const body = { decision: approve ? 'approve' : 'reject', note: ov.querySelector('#cdNote').value.trim() };
          if (approve) body.amount = ov.querySelector('#cdAmount').value.trim();
          try {
            await API.post(`/finance/custodies/${c.id}/decision`, body);
            toast(approve ? 'قُبلت العهدة وسُجّل إيرادها' : 'رُفض الطلب', 'ok');
            cl(); loadCustodies();
          } catch (err) { toast(err.message, 'err'); }
        } },
      { label: 'إلغاء', class: 'btn-ghost', onClick: (cl) => cl() },
    ],
  });
}

/** مصروفات عهدة بعينها — تُعرض بمصفّي الحركات نفسه. */
async function custodySpendDialog(c) {
  if (!c) return;
  let data;
  try { data = await API.get('/finance?custody_id=' + c.id); }
  catch (err) { return toast(err.message, 'err'); }
  const rows = data.entries.filter((e) => e.kind === 'expense');
  openModal({
    title: 'مصروفات العهدة: ' + c.purpose,
    body: `
      <div class="cal-when">
        <div><span class="muted">المقبول:</span> ${riyal(c.approved_amount)}</div>
        <div><span class="muted">المصروف:</span> ${riyal(c.spent)}</div>
        <div><span class="muted">المتبقي:</span> ${riyal(c.remaining)}</div>
      </div>
      ${rows.length ? `<table class="tbl mt"><thead><tr><th>التاريخ</th><th>البيان</th><th>المبلغ</th></tr></thead>
        <tbody>${rows.map((e) => `<tr><td class="nb">${fmtDate(e.entry_date)}</td>
          <td>${esc(e.statement)}</td><td class="nb">${riyal(e.amount)}</td></tr>`).join('')}</tbody></table>`
        : '<p class="muted mt">لم يُصرف من هذه العهدة شيء بعد.</p>'}`,
    buttons: [{ label: 'إغلاق', class: 'btn-ghost', onClick: (cl) => cl() }],
  });
}
