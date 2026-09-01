// وحدة الملفات التربوية (الواجهة) — أرشيف المنصة: تصفّح المجلدات، الرفع والاستبدال،
// التاقات والأعوام والألوان، سلة المحذوفات، وسجل التعديل لكل ملف.
// المعاينة كلها عبر المستعرض الموحّد في viewer.js.

const FILE_CAT_AR = {
  pdf: 'PDF', image: 'صورة', video: 'فيديو', audio: 'صوت', doc: 'مستند وورد',
  sheet: 'جدول بيانات', slide: 'عرض تقديمي', text: 'نص', archive: 'أرشيف مضغوط', other: 'ملف',
};
const FILE_CAT_ICON = {
  pdf: 'filePdf', image: 'image', video: 'fileVideo', audio: 'mic', doc: 'fileDoc',
  sheet: 'fileSheet', slide: 'fileSlide', text: 'meetings', archive: 'package', other: 'meetings',
};
// لون خافت لكل صنف — يميّز الملفات في الشبكة بلمحة
const FILE_CAT_COLOR = {
  pdf: '#c0392b', image: '#8e44ad', video: '#2980b9', audio: '#16a085', doc: '#2c5f9e',
  sheet: '#1f8a54', slide: '#c9861a', text: '#6b7a75', archive: '#7f6000', other: '#6b7a75',
};
// (ACCESS_AR في app.js لدرجات الاطلاع — وهذه أسماء نطاقات المجلدات)
const FILE_ACCESS_AR = { public: 'عام للمنصة', council: 'مجلس', private: 'خاص بي' };
// ألوان المجلدات والتاقات الجاهزة (تُختار من لوحة بدل كتابة قيمة)
const FOLDER_COLORS = ['#1f6f54', '#2980b9', '#8e44ad', '#c0392b', '#c9861a', '#16a085', '#475569', '#b9770e'];

const FilesState = {
  folderId: null, path: [], folder: null, meta: null,
  folders: [], files: [], view: 'grid', sort: 'name',
  filters: { q: '', tag: 0, year: '', type: '' },
  trash: false,
};

/** حجم مقروء بالعربية. */
function fileSize(bytes) {
  const b = Number(bytes || 0);
  if (b < 1024) return arNum(b) + ' بايت';
  if (b < 1048576) return arFixed(b / 1024, 0).replace('٫٠', '') + ' ك.ب';
  if (b < 1073741824) return arFixed(b / 1048576, 1) + ' م.ب';
  return arFixed(b / 1073741824, 2) + ' ج.ب';
}

const fileCatIcon = (cat, size = 22) => icon(FILE_CAT_ICON[cat] || 'meetings', size);

/** شارة تاق ملوّنة. */
function tagChip(t, removable) {
  return `<span class="ftag" style="background:${t.color}1a;color:${t.color};border-color:${t.color}40">
    ${esc(t.name)}${removable ? `<button data-untag="${t.id}" aria-label="إزالة">&times;</button>` : ''}</span>`;
}

// ============================================================
// الشاشة
// ============================================================
VIEWS.files = async (rest) => {
  setTitle('الملفات التربوية');
  const wanted = rest && rest[0] ? Number(rest[0]) : null;
  FilesState.folderId = Number.isFinite(wanted) && wanted ? wanted : null;
  FilesState.trash = (rest || []).includes('trash');
  content().innerHTML = '<div class="spinner"></div>';

  try {
    FilesState.meta = await API.get('/files/meta');
  } catch (err) {
    content().innerHTML = `<div class="card"><div class="card-body"><div class="empty">
      <div class="ico">${icon('lock', 42)}</div><p>${esc(err.message)}</p></div></div></div>`;
    return;
  }

  const m = FilesState.meta;
  content().innerHTML = `
    <div class="card files-card">
      <div class="card-head">
        <h3>${FilesState.trash ? 'سلة المحذوفات' : 'الملفات التربوية'}</h3>
        <div class="spacer"></div>
        ${FilesState.trash ? `<button class="btn-ghost btn-sm" id="fBack">${icon('folder', 16)} الأرشيف</button>` : `
          ${m.perms.add ? `<button class="btn btn-sm" id="fUpload">${icon('upload', 16)} رفع ملفات</button>` : ''}
          ${m.perms.add ? `<button class="btn-ghost btn-sm" id="fNewFolder">${icon('folderPlus', 16)} مجلد جديد</button>` : ''}
          ${m.perms.edit || m.perms.add ? `<button class="btn-ghost btn-sm" id="fTags">${icon('tag', 16)} التاقات</button>` : ''}
          <button class="btn-ghost btn-sm" id="fTrash">${icon('trash', 16)} السلة</button>`}
      </div>
      <div class="card-body">
        <div class="files-toolbar">
          <div class="fbread" id="fBread"></div>
          <div class="spacer"></div>
          <div class="fview">
            <button data-v="grid" class="${FilesState.view === 'grid' ? 'active' : ''}" title="عرض شبكي">${icon('grid', 16)}</button>
            <button data-v="list" class="${FilesState.view === 'list' ? 'active' : ''}" title="عرض قائمة">${icon('list', 16)}</button>
          </div>
        </div>
        <div class="files-filters">
          <input id="fQ" placeholder="بحث في الأرشيف كله…" value="${esc(FilesState.filters.q)}" />
          <select id="fYear"><option value="">كل الأعوام</option>
            ${m.years.map((y) => `<option value="${esc(y)}">${esc(y)}</option>`).join('')}</select>
          <select id="fType"><option value="">كل الأنواع</option>
            ${Object.entries(FILE_CAT_AR).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
          <select id="fSort">
            <option value="name">ترتيب بالاسم</option>
            <option value="date">الأحدث أولاً</option>
            <option value="size">الأكبر حجماً</option>
          </select>
        </div>
        ${m.tags.length ? `<div class="ftagbar" id="fTagBar">
          ${m.tags.map((t) => `<button class="ftag-btn" data-tag="${t.id}"
            style="--tc:${t.color}">${esc(t.name)}</button>`).join('')}</div>` : ''}
        <div id="fDrop" class="files-drop">
          <div id="fBody"><div class="spinner"></div></div>
        </div>
        <div class="files-note" id="fNote"></div>
        <div class="files-stats" id="fStats"></div>
      </div>
    </div>
    <div class="upload-panel" id="fUpPanel" hidden></div>`;

  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on('fUpload', () => pickAndUpload());
  on('fNewFolder', () => folderDialog(null));
  on('fTags', () => tagsManagerDialog());
  on('fTrash', () => { location.hash = '#/files/trash'; });
  on('fBack', () => { location.hash = '#/files'; });
  document.querySelectorAll('.fview button').forEach((b) => b.onclick = () => {
    FilesState.view = b.dataset.v;
    document.querySelectorAll('.fview button').forEach((x) => x.classList.toggle('active', x === b));
    drawFiles();
  });
  document.getElementById('fYear').value = FilesState.filters.year;
  document.getElementById('fType').value = FilesState.filters.type;
  document.getElementById('fSort').value = FilesState.sort;
  document.getElementById('fYear').onchange = (e) => { FilesState.filters.year = e.target.value; loadFiles(); };
  document.getElementById('fType').onchange = (e) => { FilesState.filters.type = e.target.value; loadFiles(); };
  document.getElementById('fSort').onchange = (e) => { FilesState.sort = e.target.value; drawFiles(); };
  let qTimer = null;
  document.getElementById('fQ').oninput = (e) => {
    clearTimeout(qTimer);
    const v = e.target.value.trim();
    qTimer = setTimeout(() => { FilesState.filters.q = v; loadFiles(); }, 300);
  };
  document.querySelectorAll('[data-tag]').forEach((b) => b.onclick = () => {
    const id = Number(b.dataset.tag);
    FilesState.filters.tag = FilesState.filters.tag === id ? 0 : id;
    document.querySelectorAll('[data-tag]').forEach((x) => x.classList.toggle('active', Number(x.dataset.tag) === FilesState.filters.tag));
    loadFiles();
  });
  if (!FilesState.trash && m.perms.add) setupDropZone();

  await loadFiles();
};

/** جلب محتوى المجلد الحالي أو نتائج التصفية. */
async function loadFiles() {
  const box = document.getElementById('fBody');
  if (!box) return;
  box.innerHTML = '<div class="spinner"></div>';
  const p = new URLSearchParams();
  if (FilesState.trash) p.set('trash', '1');
  else if (FilesState.folderId) p.set('folder', String(FilesState.folderId));
  const f = FilesState.filters;
  if (f.q) p.set('q', f.q);
  if (f.tag) p.set('tag', String(f.tag));
  if (f.year) p.set('year', f.year);
  if (f.type) p.set('type', f.type);
  try {
    const d = await API.get('/files?' + p.toString());
    FilesState.folder = d.folder || null;
    FilesState.path = d.path || [];
    FilesState.folders = d.folders || [];
    FilesState.files = d.files || [];
    FilesState.canAdd = !!d.can_add;
    FilesState.searching = !!d.searching;
    drawBreadcrumb();
    drawFiles();
  } catch (err) {
    box.innerHTML = `<div class="empty"><div class="ico">${icon('warning', 40)}</div><p>${esc(err.message)}</p></div>`;
  }
}

function drawBreadcrumb() {
  const el = document.getElementById('fBread');
  if (!el) return;
  if (FilesState.trash) { el.innerHTML = '<span class="cur">المحذوفات — تُستعاد أو تُحذف نهائياً</span>'; return; }
  const parts = [`<a href="#/files">${icon('folder', 15)} الأرشيف</a>`];
  FilesState.path.forEach((p, i) => {
    const last = i === FilesState.path.length - 1;
    parts.push(last ? `<span class="cur">${esc(p.name)}</span>` : `<a href="#/files/${p.id}">${esc(p.name)}</a>`);
  });
  el.innerHTML = parts.join('<i>›</i>');
  if (FilesState.searching) el.innerHTML += ' <span class="fsearch-note">— نتائج البحث في الأرشيف كله</span>';
}

/** ترتيب العناصر بحسب الاختيار الحالي. */
function sortItems(items, isFile) {
  const s = FilesState.sort;
  const arr = [...items];
  if (s === 'date') arr.sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)));
  else if (s === 'size' && isFile) arr.sort((a, b) => (b.size || 0) - (a.size || 0));
  else arr.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));
  return arr;
}

function drawFiles() {
  const box = document.getElementById('fBody');
  if (!box) return;
  const folders = sortItems(FilesState.folders, false);
  const files = sortItems(FilesState.files, true);

  if (!folders.length && !files.length) {
    box.innerHTML = `<div class="empty"><div class="ico">${icon('folderOpen', 44)}</div>
      <p>${FilesState.trash ? 'السلة فارغة' : FilesState.searching ? 'لا نتائج مطابقة' : 'لا ملفات في هذا المجلد'}</p>
      ${!FilesState.trash && FilesState.canAdd ? '<span>اسحب الملفات إلى هنا أو اضغط «رفع ملفات»</span>' : ''}</div>`;
  } else if (FilesState.view === 'grid') {
    box.innerHTML = `<div class="fgrid">
      ${folders.map(folderCardHtml).join('')}
      ${files.map(fileCardHtml).join('')}</div>`;
  } else {
    box.innerHTML = `<div class="t-scroll"><table class="tbl stack">
      <thead><tr><th>الاسم</th><th>التاقات</th><th>العام</th><th>الحجم</th><th>آخر تحديث</th><th>بواسطة</th><th></th></tr></thead>
      <tbody>
        ${folders.map(folderRowHtml).join('')}
        ${files.map(fileRowHtml).join('')}
      </tbody></table></div>`;
  }

  // نطاق الجذر يُقال صراحةً: ما يُرفع هنا عامٌّ لكل من يملك اطلاع الملفات
  const note = document.getElementById('fNote');
  if (note) {
    note.innerHTML = (!FilesState.trash && !FilesState.folderId && !FilesState.searching && FilesState.canAdd)
      ? `${icon('warning', 14)} ما يُرفع في جذر الأرشيف عامٌّ لكل من يملك اطلاع الملفات — أنشئ مجلدًا لتقصر ملفاته على مجلس أو على نفسك.`
      : '';
  }

  const stats = document.getElementById('fStats');
  if (stats) {
    const bytes = files.reduce((n, f) => n + (f.size || 0), 0);
    stats.innerHTML = `${arNum(folders.length)} مجلد · ${arNum(files.length)} ملف${files.length ? ' · ' + fileSize(bytes) : ''}
      ${FilesState.meta ? ` — إجمالي أرشيفك ${arNum(FilesState.meta.stats.files)} ملف (${fileSize(FilesState.meta.stats.bytes)})` : ''}`;
  }
  bindItemEvents();
}

// ---- بطاقات الشبكة ----
function folderCardHtml(d) {
  const color = d.color || 'var(--primary)';
  return `<div class="fcard folder" data-folder="${d.id}">
    <span class="fico" style="color:${color};background:${d.color ? d.color + '18' : 'var(--primary-light)'}">${icon('folder', 26)}</span>
    <div class="fname" title="${esc(d.name)}">${esc(d.name)}</div>
    <div class="fmeta">${arNum(d.file_count || 0)} ملف${d.folder_count ? ' · ' + arNum(d.folder_count) + ' مجلد' : ''}${d.academic_year ? ' · ' + esc(d.academic_year) : ''}</div>
    <div class="ftags">${(d.tags || []).map((t) => tagChip(t)).join('')}${accessBadge(d)}</div>
    <button class="fmore" data-menu="folder:${d.id}" aria-label="خيارات">⋯</button>
  </div>`;
}

function fileCardHtml(f) {
  const color = FILE_CAT_COLOR[f.category] || '#6b7a75';
  const thumb = f.category === 'image' && !f.deleted_at
    ? `<img class="fthumb" src="/api/files/${f.id}/raw" alt="" loading="lazy" />` : '';
  return `<div class="fcard file" data-file="${f.id}">
    <span class="fico" style="color:${color};background:${color}14">${thumb || fileCatIcon(f.category, 26)}</span>
    <div class="fname" title="${esc(f.name)}">${esc(f.name)}</div>
    <div class="fmeta">${esc(FILE_CAT_AR[f.category] || 'ملف')} · ${fileSize(f.size)}${f.version > 1 ? ' · ط' + arNum(f.version) : ''}</div>
    <div class="ftags">${(f.tags || []).map((t) => tagChip(t)).join('')}${f.academic_year ? `<span class="fyear">${esc(f.academic_year)}</span>` : ''}${accessBadge(f)}</div>
    <button class="fmore" data-menu="file:${f.id}" aria-label="خيارات">⋯</button>
  </div>`;
}

function accessBadge(item) {
  if (item.access === 'public') return '';
  const label = item.access === 'private' ? 'خاص' : (item.council_name || 'مجلس');
  return `<span class="faccess">${icon(item.access === 'private' ? 'lock' : 'councils', 12)}${esc(label)}</span>`;
}

// ---- صفوف القائمة ----
function folderRowHtml(d) {
  return `<tr data-folder="${d.id}">
    <td data-l="الاسم"><a href="#/files/${d.id}" class="frow-name">
      <span style="color:${d.color || 'var(--primary)'}">${icon('folder', 18)}</span> <b>${esc(d.name)}</b></a></td>
    <td data-l="التاقات">${(d.tags || []).map((t) => tagChip(t)).join('') || '—'}</td>
    <td data-l="العام">${esc(d.academic_year || '—')}</td>
    <td data-l="الحجم">${arNum(d.file_count || 0)} ملف</td>
    <td data-l="آخر تحديث">${esc(String(d.updated_at || d.created_at || '').slice(0, 10))}</td>
    <td data-l="بواسطة">${esc(d.owner_name || '—')}</td>
    <td class="cell-actions"><button class="btn-ghost btn-sm" data-menu="folder:${d.id}">⋯</button></td>
  </tr>`;
}

function fileRowHtml(f) {
  return `<tr data-file="${f.id}">
    <td data-l="الاسم"><a href="#" class="frow-name" data-open="${f.id}">
      <span style="color:${FILE_CAT_COLOR[f.category]}">${fileCatIcon(f.category, 18)}</span> <b>${esc(f.name)}</b></a></td>
    <td data-l="التاقات">${(f.tags || []).map((t) => tagChip(t)).join('') || '—'}</td>
    <td data-l="العام">${esc(f.academic_year || '—')}</td>
    <td data-l="الحجم">${fileSize(f.size)}</td>
    <td data-l="آخر تحديث">${esc(String(f.updated_at || f.created_at || '').slice(0, 10))}</td>
    <td data-l="بواسطة">${esc(f.uploader_name || '—')}</td>
    <td class="cell-actions"><button class="btn-ghost btn-sm" data-menu="file:${f.id}">⋯</button></td>
  </tr>`;
}

// ---- ربط الأحداث بالبطاقات والصفوف ----
function bindItemEvents() {
  const box = document.getElementById('fBody');
  if (!box) return;
  box.querySelectorAll('.fcard.folder').forEach((el) => el.onclick = (e) => {
    if (e.target.closest('.fmore')) return;
    if (FilesState.trash) return;
    location.hash = '#/files/' + el.dataset.folder;
  });
  box.querySelectorAll('.fcard.file').forEach((el) => el.onclick = (e) => {
    if (e.target.closest('.fmore')) return;
    openViewerAt(Number(el.dataset.file));
  });
  box.querySelectorAll('[data-open]').forEach((a) => a.onclick = (e) => {
    e.preventDefault();
    openViewerAt(Number(a.dataset.open));
  });
  box.querySelectorAll('[data-menu]').forEach((b) => b.onclick = (e) => {
    e.preventDefault(); e.stopPropagation();
    const [kind, id] = b.dataset.menu.split(':');
    itemMenu(b, kind, Number(id));
  });
}

/** فتح المستعرض على ملف، وبقية ملفات الشاشة تُصفَّح بالأسهم. */
function openViewerAt(id) {
  if (FilesState.trash) { toast('استعد الملف من السلة لمعاينته', ''); return; }
  const list = sortItems(FilesState.files, true);
  const i = list.findIndex((f) => f.id === id);
  Viewer.open(list, Math.max(0, i), { onChange: () => loadFiles() });
}

// ---- قائمة الخيارات ----
function itemMenu(anchor, kind, id) {
  const item = kind === 'file'
    ? FilesState.files.find((f) => f.id === id)
    : FilesState.folders.find((f) => f.id === id);
  if (!item) return;
  const isFile = kind === 'file';
  const items = [];

  if (FilesState.trash) {
    if (item.can_delete) items.push({ ic: 'restore', label: 'استعادة', fn: () => restoreItem(kind, id) });
    if (FilesState.meta.perms.purge) items.push({ ic: 'trash', label: 'حذف نهائي', danger: true, fn: () => purgeItem(kind, item) });
  } else {
    if (isFile) {
      items.push({ ic: 'search', label: 'معاينة', fn: () => openViewerAt(id) });
      items.push({ ic: 'download', label: 'تنزيل', fn: () => { location.href = `/api/files/${id}/download`; } });
    } else {
      items.push({ ic: 'folderOpen', label: 'فتح', fn: () => { location.hash = '#/files/' + id; } });
    }
    items.push({ ic: 'audit', label: 'سجل التعديل', fn: () => (isFile ? fileHistoryDialog(item) : folderHistoryDialog(item)) });
    if (item.can_edit) {
      items.push({ ic: 'pen', label: 'إعادة تسمية وتفاصيل', fn: () => (isFile ? fileEditDialog(item) : folderDialog(item)) });
      items.push({ ic: 'tag', label: 'التاقات', fn: () => itemTagsDialog(kind, item) });
      items.push({ ic: 'share', label: 'نقل إلى مجلد', fn: () => moveDialog(kind, item) });
      if (isFile) items.push({ ic: 'replace', label: 'استبدال الملف', fn: () => replaceFileDialog(item, () => loadFiles()) });
    }
    if (item.can_delete) items.push({ ic: 'trash', label: 'حذف إلى السلة', danger: true, fn: () => trashItem(kind, item) });
  }
  openPopupMenu(anchor, items);
}

/** قائمة منسدلة صغيرة قرب زرّها. */
function openPopupMenu(anchor, items) {
  document.querySelectorAll('.pop-menu').forEach((m) => m.remove());
  if (!items.length) return;
  const menu = document.createElement('div');
  menu.className = 'pop-menu';
  menu.innerHTML = items.map((it, i) =>
    `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${icon(it.ic, 16)}${esc(it.label)}</button>`).join('');
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const top = Math.min(r.bottom + 6, window.innerHeight - menu.offsetHeight - 10);
  menu.style.top = top + 'px';
  menu.style.right = Math.max(8, window.innerWidth - r.right - 4) + 'px';
  menu.querySelectorAll('button').forEach((b) => b.onclick = () => {
    menu.remove();
    items[+b.dataset.i].fn();
  });
  setTimeout(() => {
    const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
    document.addEventListener('mousedown', close);
  }, 10);
}

// ============================================================
// الرفع
// ============================================================
function pickAndUpload() {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.onchange = () => { if (input.files.length) uploadFiles([...input.files]); };
  input.click();
}

function setupDropZone() {
  const zone = document.getElementById('fDrop');
  if (!zone) return;
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { stop(e); zone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { stop(e); if (ev === 'drop' || e.target === zone) zone.classList.remove('drag'); }));
  zone.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) uploadFiles(files);
  });
}

/** رفع ملف واحد مع تقدّم فعلي (fetch لا يُبلّغ عن تقدّم الرفع). */
function uploadOne(file, query, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', '/api/files/upload?' + query.toString());
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error((data && data.error) || 'تعذّر الرفع'));
    };
    xhr.onerror = () => reject(new Error('انقطع الاتصال أثناء الرفع'));
    xhr.send(file);
  });
}

async function uploadFiles(list) {
  const max = FilesState.meta.max_bytes;
  const panel = document.getElementById('fUpPanel');
  panel.hidden = false;
  panel.innerHTML = `<div class="up-head"><b>رفع ${arNum(list.length)} ملف</b><button class="x" aria-label="إغلاق">&times;</button></div>
    <div class="up-body">${list.map((f, i) => `
      <div class="up-row" id="up${i}">
        <span class="n">${esc(f.name)}</span>
        <span class="s">${fileSize(f.size)}</span>
        <div class="bar"><i style="width:0%"></i></div>
        <span class="st">بالانتظار</span>
      </div>`).join('')}</div>`;
  panel.querySelector('.x').onclick = () => { panel.hidden = true; };

  let done = 0, failed = 0;
  for (let i = 0; i < list.length; i++) {
    const file = list[i];
    const row = document.getElementById('up' + i);
    const bar = row.querySelector('.bar i');
    const st = row.querySelector('.st');
    if (file.size > max) {
      st.textContent = 'أكبر من الحد المسموح';
      row.classList.add('err');
      failed++;
      continue;
    }
    st.textContent = 'يُرفع…';
    const q = new URLSearchParams({ name: file.name });
    if (FilesState.folderId) q.set('folder', String(FilesState.folderId));
    else if (FilesState.meta.current_year) q.set('year', FilesState.meta.current_year);
    try {
      await uploadOne(file, q, (p) => { bar.style.width = Math.round(p * 100) + '%'; });
      bar.style.width = '100%';
      st.textContent = 'تم ✓';
      row.classList.add('ok');
      done++;
    } catch (err) {
      st.textContent = err.message;
      row.classList.add('err');
      failed++;
    }
  }
  toast(failed ? `رُفع ${arNum(done)} وتعذّر ${arNum(failed)}` : `تم رفع ${arNum(done)} ملف`, failed ? 'err' : 'ok');
  setTimeout(() => { panel.hidden = true; }, failed ? 6000 : 2200);
  await loadFiles();
  FilesState.meta = await API.get('/files/meta').catch(() => FilesState.meta);
}

/** استبدال محتوى ملف قائم — الاسم والتاقات تبقى، والإصدار يعلو ويُسجَّل. */
function replaceFileDialog(f, onDone) {
  const { overlay, close } = openModal({
    title: 'استبدال: ' + f.name,
    body: `<p class="hint">يُستبدل محتوى الملف ويعلو رقم إصداره، ويبقى مكانه وتاقاته وسجله.
      النسخة السابقة لا تُحفظ — يُسجَّل الاستبدال في سجل الملف.</p>
      <div class="field"><label>الملف الجديد</label><input type="file" id="rpFile" /></div>
      <div class="field"><label>سبب الاستبدال (اختياري)</label><input id="rpNote" placeholder="تصحيح خطأ · نسخة محدَّثة…" /></div>
      <div class="bar" id="rpBar" hidden><i style="width:0%"></i></div>
      <div id="rpErr"></div>`,
    buttons: [
      { label: 'إلغاء', class: 'btn-ghost', onClick: (cl) => cl() },
      {
        label: 'استبدال',
        onClick: async (cl, ov) => {
          const file = ov.querySelector('#rpFile').files[0];
          const errBox = ov.querySelector('#rpErr');
          if (!file) { errBox.innerHTML = '<div class="form-error">اختر الملف الجديد</div>'; return; }
          if (file.size > (FilesState.meta?.max_bytes || 52428800)) {
            errBox.innerHTML = '<div class="form-error">حجم الملف يتجاوز الحد المسموح</div>';
            return;
          }
          const bar = ov.querySelector('#rpBar');
          bar.hidden = false;
          const q = new URLSearchParams({ name: file.name });
          const note = ov.querySelector('#rpNote').value.trim();
          if (note) q.set('note', note);
          try {
            const res = await new Promise((resolve, reject) => {
              const xhr = new XMLHttpRequest();
              xhr.open('PUT', `/api/files/${f.id}/replace?` + q.toString());
              xhr.withCredentials = true;
              xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
              xhr.upload.onprogress = (e) => { if (e.lengthComputable) bar.querySelector('i').style.width = Math.round(e.loaded / e.total * 100) + '%'; };
              xhr.onload = () => {
                let d = null;
                try { d = JSON.parse(xhr.responseText); } catch {}
                if (xhr.status >= 200 && xhr.status < 300) resolve(d);
                else reject(new Error((d && d.error) || 'تعذّر الاستبدال'));
              };
              xhr.onerror = () => reject(new Error('انقطع الاتصال أثناء الرفع'));
              xhr.send(file);
            });
            cl();
            toast('تم استبدال الملف', 'ok');
            if (onDone) onDone({ size: res.size, version: res.version });
          } catch (err) {
            bar.hidden = true;
            errBox.innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
          }
        },
      },
    ],
  });
  overlay.querySelector('#rpFile').focus();
}

// ============================================================
// المجلدات والتفاصيل
// ============================================================
function folderDialog(existing) {
  const m = FilesState.meta;
  const isEdit = !!existing;
  const parent = FilesState.folder;    // المجلد المفتوح حاليًا يصير الأب للجديد
  const canChooseAccess = !isEdit ? !parent : !existing.parent_id;
  const cur = existing || {};
  const body = `
    <div id="fdErr"></div>
    <div class="field"><label>اسم المجلد</label><input id="fd_name" value="${esc(cur.name || '')}" /></div>
    <div class="row-2">
      <div class="field"><label>العام الدراسي</label>
        <input id="fd_year" list="fdYears" value="${esc(cur.academic_year || (isEdit ? '' : (parent?.academic_year || m.current_year || '')))}" placeholder="١٤٤٧هـ" />
        <datalist id="fdYears">${m.years.map((y) => `<option value="${esc(y)}"></option>`).join('')}</datalist>
      </div>
      <div class="field"><label>اللون</label>
        <div class="color-row" id="fd_colors">
          ${FOLDER_COLORS.map((c) => `<button type="button" data-c="${c}" style="background:${c}" class="${cur.color === c ? 'sel' : ''}"></button>`).join('')}
          <button type="button" data-c="" class="none ${!cur.color ? 'sel' : ''}">افتراضي</button>
        </div>
      </div>
    </div>
    ${canChooseAccess ? `
    <div class="field"><label>من يرى هذا المجلد؟</label>
      <select id="fd_access">
        <option value="public" ${cur.access === 'public' || !isEdit ? 'selected' : ''}>عام — كل من يملك اطلاع الملفات</option>
        ${m.councils.length ? `<option value="council" ${cur.access === 'council' ? 'selected' : ''}>مجلس معيّن — بحسب اطلاع المستخدم عليه</option>` : ''}
        <option value="private" ${cur.access === 'private' ? 'selected' : ''}>خاص بي وحدي</option>
      </select>
    </div>
    <div class="field" id="fd_councilWrap" style="display:none"><label>المجلس</label>
      <select id="fd_council">${m.councils.map((cl) => `<option value="${cl.id}" ${cur.council_id === cl.id ? 'selected' : ''}>${esc(cl.name)}</option>`).join('')}</select>
    </div>` : `<p class="hint">${isEdit ? 'المجلد داخل مجلد آخر يرث نطاق اطلاعه' : `يُنشأ داخل «${esc(parent?.name || '')}» ويرث نطاق اطلاعه`}</p>`}
    <div class="field"><label>وصف (اختياري)</label><input id="fd_desc" value="${esc(cur.description || '')}" /></div>
    <div class="field"><label>التاقات</label><div class="tag-pick" id="fd_tags">
      ${m.tags.map((t) => `<label class="chip-check" style="--tc:${t.color}">
        <input type="checkbox" value="${t.id}" ${(cur.tags || []).some((x) => x.id === t.id) ? 'checked' : ''} />${esc(t.name)}</label>`).join('')}
      ${m.tags.length ? '' : '<span class="hint">لا تاقات بعد — أنشئها من زر «التاقات»</span>'}
    </div></div>`;

  const { overlay, close } = openModal({
    title: isEdit ? 'تعديل المجلد' : 'مجلد جديد',
    body,
    buttons: [
      { label: 'إلغاء', class: 'btn-ghost', onClick: (cl) => cl() },
      {
        label: 'حفظ',
        onClick: async (cl, ov) => {
          const name = ov.querySelector('#fd_name').value.trim();
          if (!name) { ov.querySelector('#fdErr').innerHTML = '<div class="form-error">اسم المجلد مطلوب</div>'; return; }
          const payload = {
            name,
            academic_year: ov.querySelector('#fd_year').value.trim(),
            description: ov.querySelector('#fd_desc').value.trim(),
            color: ov.querySelector('#fd_colors .sel')?.dataset.c || '',
            tags: [...ov.querySelectorAll('#fd_tags input:checked')].map((i) => Number(i.value)),
          };
          const accessSel = ov.querySelector('#fd_access');
          if (accessSel) {
            payload.access = accessSel.value;
            if (accessSel.value === 'council') payload.council_id = Number(ov.querySelector('#fd_council').value);
          }
          try {
            if (isEdit) await API.patch('/files/folders/' + existing.id, payload);
            else await API.post('/files/folders', { ...payload, parent_id: FilesState.folderId });
            cl();
            toast('تم الحفظ', 'ok');
            await loadFiles();
          } catch (err) {
            ov.querySelector('#fdErr').innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
          }
        },
      },
    ],
  });

  overlay.querySelectorAll('#fd_colors button').forEach((b) => b.onclick = () => {
    overlay.querySelectorAll('#fd_colors button').forEach((x) => x.classList.remove('sel'));
    b.classList.add('sel');
  });
  const acc = overlay.querySelector('#fd_access');
  if (acc) {
    const sync = () => { overlay.querySelector('#fd_councilWrap').style.display = acc.value === 'council' ? '' : 'none'; };
    acc.onchange = sync;
    sync();
  }
  overlay.querySelector('#fd_name').focus();
}

/** تعديل بيانات ملف: الاسم، العام، الوصف. */
function fileEditDialog(f) {
  const m = FilesState.meta;
  openModal({
    title: 'تفاصيل الملف',
    body: `<div id="feErr"></div>
      <div class="field"><label>اسم الملف</label><input id="fe_name" value="${esc(f.name)}" /></div>
      <div class="row-2">
        <div class="field"><label>العام الدراسي</label>
          <input id="fe_year" list="feYears" value="${esc(f.academic_year || '')}" placeholder="١٤٤٧هـ" />
          <datalist id="feYears">${m.years.map((y) => `<option value="${esc(y)}"></option>`).join('')}</datalist></div>
        <div class="field"><label>النوع</label><input value="${esc(FILE_CAT_AR[f.category] || 'ملف')} · ${esc((f.ext || '').toUpperCase())}" disabled /></div>
      </div>
      <div class="field"><label>وصف (اختياري)</label><input id="fe_desc" value="${esc(f.description || '')}" /></div>`,
    buttons: [
      { label: 'إلغاء', class: 'btn-ghost', onClick: (cl) => cl() },
      {
        label: 'حفظ',
        onClick: async (cl, ov) => {
          try {
            await API.patch('/files/' + f.id, {
              name: ov.querySelector('#fe_name').value.trim(),
              academic_year: ov.querySelector('#fe_year').value.trim(),
              description: ov.querySelector('#fe_desc').value.trim(),
            });
            cl();
            toast('تم الحفظ', 'ok');
            await loadFiles();
          } catch (err) {
            ov.querySelector('#feErr').innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
          }
        },
      },
    ],
  });
}

/** تعديل تاقات ملف أو مجلد. */
function itemTagsDialog(kind, item) {
  const m = FilesState.meta;
  if (!m.tags.length) { tagsManagerDialog(); return; }
  openModal({
    title: 'تاقات: ' + item.name,
    body: `<div class="tag-pick" id="it_tags">
      ${m.tags.map((t) => `<label class="chip-check" style="--tc:${t.color}">
        <input type="checkbox" value="${t.id}" ${(item.tags || []).some((x) => x.id === t.id) ? 'checked' : ''} />${esc(t.name)}</label>`).join('')}
      </div>`,
    buttons: [
      { label: 'إلغاء', class: 'btn-ghost', onClick: (cl) => cl() },
      {
        label: 'حفظ',
        onClick: async (cl, ov) => {
          const tags = [...ov.querySelectorAll('#it_tags input:checked')].map((i) => Number(i.value));
          try {
            if (kind === 'file') await API.patch('/files/' + item.id, { tags });
            else await API.patch('/files/folders/' + item.id, { tags });
            cl();
            toast('تم الحفظ', 'ok');
            await loadFiles();
          } catch (err) { toast(err.message, 'err'); }
        },
      },
    ],
  });
}

/** نقل ملف أو مجلد إلى مجلد آخر — من شجرة المجلدات التي يكتب فيها المستخدم. */
async function moveDialog(kind, item) {
  let data = { folders: [], root: true };
  try { data = await API.get('/files/folders/tree'); } catch { /* يبقى الجذر خيارًا */ }

  // مجلدٌ لا يُنقل إلى نفسه ولا إلى أحد أحفاده — والخادم يرفضها أيضًا
  const banned = new Set();
  if (kind === 'folder') {
    banned.add(item.id);
    let grew = true;
    while (grew) {
      grew = false;
      data.folders.forEach((d) => {
        if (!banned.has(d.id) && banned.has(d.parent_id)) { banned.add(d.id); grew = true; }
      });
    }
  }

  // اسم بمساره ليتميّز المتشابهون
  const byId = Object.fromEntries(data.folders.map((d) => [d.id, d]));
  const label = (d) => {
    const parts = [d.name];
    let p = d.parent_id;
    for (let i = 0; p && byId[p] && i < 8; i++) { parts.unshift(byId[p].name); p = byId[p].parent_id; }
    return parts.join(' ‹ ');
  };
  const options = (data.root ? [{ id: '', name: '— جذر الأرشيف —' }] : [])
    .concat(data.folders.filter((d) => !banned.has(d.id) && d.id !== item.folder_id && d.id !== item.parent_id)
      .map((d) => ({ id: d.id, name: label(d) })));

  if (!options.length) { toast('لا يوجد مجلد آخر تملك الكتابة فيه', 'err'); return; }

  openModal({
    title: 'نقل: ' + item.name,
    body: `<div class="field"><label>إلى مجلد</label>
      <select id="mv_target">${options.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select>
      <div class="hint">العنصر يرث نطاق اطلاع المجلد الهدف.</div></div>`,
    buttons: [
      { label: 'إلغاء', class: 'btn-ghost', onClick: (cl) => cl() },
      {
        label: 'نقل',
        onClick: async (cl, ov) => {
          const v = ov.querySelector('#mv_target').value;
          const target = v === '' ? null : Number(v);
          try {
            if (kind === 'file') await API.patch('/files/' + item.id, { folder_id: target });
            else await API.patch('/files/folders/' + item.id, { parent_id: target });
            cl();
            toast('تم النقل', 'ok');
            await loadFiles();
          } catch (err) { toast(err.message, 'err'); }
        },
      },
    ],
  });
}

// ============================================================
// الحذف والاستعادة
// ============================================================
function trashItem(kind, item) {
  const isFolder = kind === 'folder';
  confirmModal(
    isFolder ? 'حذف المجلد' : 'حذف الملف',
    isFolder
      ? `سيُنقل «${item.name}» وكل ما بداخله إلى سلة المحذوفات، ويمكن استعادته منها.`
      : `سيُنقل «${item.name}» إلى سلة المحذوفات، ويمكن استعادته منها.`,
    async () => {
      try {
        await API.del(isFolder ? '/files/folders/' + item.id : '/files/' + item.id);
        toast('نُقل إلى السلة', 'ok');
        await loadFiles();
      } catch (err) { toast(err.message, 'err'); }
    },
  );
}

async function restoreItem(kind, id) {
  try {
    await API.post(kind === 'folder' ? `/files/folders/${id}/restore` : `/files/${id}/restore`);
    toast('تمت الاستعادة', 'ok');
    await loadFiles();
  } catch (err) { toast(err.message, 'err'); }
}

function purgeItem(kind, item) {
  confirmModal(
    'حذف نهائي',
    `سيُحذف «${item.name}» نهائياً من التخزين${kind === 'folder' ? ' مع كل ملفاته' : ''} ولا يمكن التراجع.`,
    async () => {
      try {
        await API.del(kind === 'folder' ? `/files/folders/${item.id}/purge` : `/files/${item.id}/purge`);
        toast('حُذف نهائياً', 'ok');
        await loadFiles();
      } catch (err) { toast(err.message, 'err'); }
    },
    { danger: true },
  );
}

// ============================================================
// سجل التعديل والاستبدال
// ============================================================
const FILE_EVENT_AR = {
  upload: 'رفع الملف', create: 'إنشاء المجلد', replace: 'استبدال المحتوى',
  rename: 'إعادة تسمية', move: 'نقل', tags: 'تعديل التاقات', year: 'تغيير العام',
  description: 'تعديل الوصف', access: 'تغيير نطاق الاطلاع', color: 'تغيير اللون',
  trash: 'حذف إلى السلة', restore: 'استعادة', purge: 'حذف نهائي', download: 'تنزيل',
};
const FILE_EVENT_ICON = {
  upload: 'upload', create: 'folderPlus', replace: 'replace', rename: 'pen', move: 'share',
  tags: 'tag', year: 'meetings', description: 'pen', access: 'lock', color: 'branding',
  trash: 'trash', restore: 'restore', purge: 'trash', download: 'download',
};

async function fileHistoryDialog(f) {
  const { overlay } = openModal({
    title: 'سجل الملف: ' + f.name,
    body: '<div class="spinner" style="margin:24px auto"></div>',
  });
  try {
    const d = await API.get(`/files/${f.id}/history`);
    overlay.querySelector('.modal-body').innerHTML = historyHtml(d.events, { ...d.file, category: f.category });
  } catch (err) {
    overlay.querySelector('.modal-body').innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

async function folderHistoryDialog(d) {
  const { overlay } = openModal({
    title: 'سجل المجلد: ' + d.name,
    body: '<div class="spinner" style="margin:24px auto"></div>',
  });
  try {
    const res = await API.get(`/files/folders/${d.id}/history`);
    overlay.querySelector('.modal-body').innerHTML = historyHtml(res.events, null);
  } catch (err) {
    overlay.querySelector('.modal-body').innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

function historyHtml(events, file) {
  const head = file ? `<div class="fhist-head">
    <div><b>${esc(FILE_CAT_AR[file.category] || 'ملف')}</b><span>${esc((file.ext || '').toUpperCase())}</span></div>
    <div><b>${fileSize(file.size)}</b><span>الحجم الحالي</span></div>
    <div><b>${arNum(file.version || 1)}</b><span>رقم الإصدار</span></div>
    <div><b>${esc(String(file.created_at || '').slice(0, 10))}</b><span>تاريخ الرفع</span></div>
  </div>` : '';
  if (!events || !events.length) return head + '<div class="empty" style="padding:24px">لا أحداث مسجّلة</div>';
  return head + `<div class="fhist">${events.map((e) => {
    const detail = eventDetail(e);
    return `<div class="fhist-row">
      <span class="ic">${icon(FILE_EVENT_ICON[e.action] || 'audit', 16)}</span>
      <div class="tx">
        <b>${esc(FILE_EVENT_AR[e.action] || e.action)}</b>
        ${detail ? `<span class="d">${detail}</span>` : ''}
        ${e.note ? `<span class="d">«${esc(e.note)}»</span>` : ''}
        <span class="m">${esc(e.actor_name || 'النظام')} — ${esc(String(e.created_at || '').replace('T', ' ').slice(0, 16))}</span>
      </div></div>`;
  }).join('')}</div>`;
}

/** وصف مختصر لما تغيّر في الحدث (قبل ← بعد). */
function eventDetail(e) {
  const o = e.old_value || {};
  const n = e.new_value || {};
  if (e.action === 'replace') {
    return `من ${fileSize(o.size)} إلى ${fileSize(n.size)} · الإصدار ${arNum(o.version || 1)} ← ${arNum(n.version || 2)}`;
  }
  if (e.action === 'rename' && o.name && n.name && o.name !== n.name) return `${esc(o.name)} ← ${esc(n.name)}`;
  if (e.action === 'upload' && n.size != null) return fileSize(n.size);
  if (e.action === 'year' && (o.academic_year || n.academic_year)) return `${esc(o.academic_year || '—')} ← ${esc(n.academic_year || '—')}`;
  if (e.action === 'access' && (o.access || n.access)) return `${esc(FILE_ACCESS_AR[o.access] || '—')} ← ${esc(FILE_ACCESS_AR[n.access] || '—')}`;
  if (e.action === 'move') return 'تغيّر المجلد';
  return '';
}

// ============================================================
// إدارة التاقات
// ============================================================
function tagsManagerDialog() {
  const m = FilesState.meta;
  const { overlay, close } = openModal({
    title: 'التاقات وألوانها',
    body: `<div id="tgErr"></div>
      <div class="tag-new">
        <input id="tg_name" placeholder="اسم تاق جديد" />
        <div class="color-row" id="tg_colors">
          ${FOLDER_COLORS.map((c, i) => `<button type="button" data-c="${c}" style="background:${c}" class="${i === 0 ? 'sel' : ''}"></button>`).join('')}
        </div>
        <button class="btn btn-sm" id="tg_add">إضافة</button>
      </div>
      <div id="tg_list">${tagsListHtml(m.tags)}</div>`,
    buttons: [{ label: 'إغلاق', class: 'btn-ghost', onClick: (cl) => { cl(); loadFiles(); } }],
  });

  const pickColor = () => overlay.querySelector('#tg_colors .sel')?.dataset.c || FOLDER_COLORS[0];
  overlay.querySelectorAll('#tg_colors button').forEach((b) => b.onclick = () => {
    overlay.querySelectorAll('#tg_colors button').forEach((x) => x.classList.remove('sel'));
    b.classList.add('sel');
  });

  const refresh = async () => {
    FilesState.meta = await API.get('/files/meta');
    overlay.querySelector('#tg_list').innerHTML = tagsListHtml(FilesState.meta.tags);
    bind();
  };
  const bind = () => {
    overlay.querySelectorAll('[data-del-tag]').forEach((b) => b.onclick = async () => {
      try { await API.del('/files/tags/' + b.dataset.delTag); await refresh(); }
      catch (err) { toast(err.message, 'err'); }
    });
    overlay.querySelectorAll('[data-tag-color]').forEach((inp) => inp.onchange = async () => {
      try { await API.patch('/files/tags/' + inp.dataset.tagColor, { color: inp.value }); await refresh(); }
      catch (err) { toast(err.message, 'err'); }
    });
    overlay.querySelectorAll('[data-tag-name]').forEach((inp) => inp.onchange = async () => {
      try { await API.patch('/files/tags/' + inp.dataset.tagName, { name: inp.value }); await refresh(); }
      catch (err) { toast(err.message, 'err'); }
    });
  };
  bind();

  overlay.querySelector('#tg_add').onclick = async () => {
    const name = overlay.querySelector('#tg_name').value.trim();
    if (!name) return;
    try {
      await API.post('/files/tags', { name, color: pickColor() });
      overlay.querySelector('#tg_name').value = '';
      await refresh();
    } catch (err) {
      overlay.querySelector('#tgErr').innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
    }
  };
}

function tagsListHtml(tags) {
  if (!tags || !tags.length) return '<div class="empty" style="padding:18px">لا تاقات بعد</div>';
  return `<table class="tbl"><tbody>${tags.map((t) => `<tr>
    <td style="width:44px"><input type="color" value="${esc(t.color)}" data-tag-color="${t.id}" title="لون التاق" /></td>
    <td><input value="${esc(t.name)}" data-tag-name="${t.id}" class="tg-name" /></td>
    <td style="width:70px"><button class="btn-ghost btn-sm danger" data-del-tag="${t.id}">حذف</button></td>
  </tr>`).join('')}</tbody></table>`;
}
