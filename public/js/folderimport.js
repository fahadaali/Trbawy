// استيراد مجلد كامل إلى الملفات التربوية — أرشيف ZIP (كما يُنزّله قوقل درايف) أو مجلدٌ
// من الجهاز، بمجلداته الفرعية وملفاته كما هي.
//
// المسار كله في المتصفح: يُقرأ فهرس الأرشيف (zipreader.js)، ويُبنى في الخادم ما نقص من
// شجرة المجلدات دفعةً واحدة، ثم يُفكّ كل ملف ويُرفع وحده — ثلاثة معًا — والكبير منها
// مجزّأً. فلا يمرّ الأرشيف كاملًا عبر الشبكة دفعة ولا في الذاكرة، ويُستأنف ما انقطع
// بإعادة الاستيراد نفسه: المجلد القائم يُعاد استخدامه، والملف القائم يُتخطّى.

const IMPORT_CONCURRENCY = 3;

// اسم أرشيف درايف: «اسم المجلد-20251021T093015Z-001.zip» — يُستخرج منه اسم المجلد
const driveBaseName = (name) => String(name || '')
  .replace(/\.zip$/i, '')
  .replace(/-\d{8}T\d{6}Z(-\d{3})?$/i, '')
  .replace(/-\d{3}$/, '')
  .trim() || 'مجلد مستورد';

/** المسار نظيفًا: فواصل موحّدة، بلا «.» ولا «..» ولا فراغات زائدة. */
function cleanImportPath(p) {
  return String(p || '').replace(/\\/g, '/').split('/')
    .map((s) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((s) => s && s !== '.' && s !== '..').join('/');
}

// الاسم كما يحفظه الخادم (cleanName) — ليُطابق «الموجود» ما سيُكتب فعلًا
const serverName = (n) => String(n || '').replace(/[\\/]+/g, '_').replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\s+/g, ' ').trim().slice(0, 160);

// ============================================================
// الرفع المجزّأ للملفات الكبيرة (يستعمله الرفع العادي أيضًا)
// ============================================================
/**
 * يرفع Blob كبيرًا قطعةً قطعة. `dest`: { folder } أو { access, council_id, year }.
 * يُلغى الرفع في التخزين إن تعذّر، فلا تبقى قطعٌ يتيمة.
 */
async function uploadLarge(blob, name, dest, onProgress, isCancelled = () => false) {
  const start = await API.post('/files/upload/multipart', {
    name, size: blob.size, type: blob.type || '', ...dest,
  });
  const id = encodeURIComponent(start.upload_id);
  const partBytes = start.part_bytes;
  const parts = [];
  try {
    for (let n = 1, off = 0; off < blob.size; n++, off += partBytes) {
      if (isCancelled()) throw new Error('أُوقف الاستيراد');
      const chunk = blob.slice(off, Math.min(off + partBytes, blob.size));
      let res = null;
      for (let attempt = 0; attempt < 3 && !res; attempt++) {
        try {
          const r = await fetch(`/api/files/upload/multipart/${id}/${n}`, {
            method: 'PUT', credentials: 'same-origin', body: chunk,
          });
          const data = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(data.error || 'تعذّر رفع جزء من الملف');
          res = data;
        } catch (err) {
          if (attempt === 2) throw err;
        }
      }
      parts.push(res);
      onProgress(Math.min(1, (off + chunk.size) / blob.size));
    }
    return await API.post(`/files/upload/multipart/${id}/complete`, { parts });
  } catch (err) {
    API.del(`/files/upload/multipart/${id}`).catch(() => {});
    throw err;
  }
}

// ============================================================
// اختيار المصدر
// ============================================================
function folderImportDialog() {
  const target = FilesState.folderId
    ? (FilesState.path[FilesState.path.length - 1] || {}).name || 'المجلد الحالي'
    : 'جذر الأرشيف';
  const dirSupported = 'webkitdirectory' in document.createElement('input');
  const { overlay, close } = openModal({
    title: 'استيراد مجلد',
    body: `<p class="hint">يُستورد المجلد بمجلداته الفرعية وملفاته كما هي إلى: <b>${esc(target)}</b>.</p>
      <div class="scope-pick">
        <button type="button" class="scope-opt" id="fiZip" style="text-align:start">
          <span class="ic">${icon('package', 18)}</span>
          <b>أرشيف مضغوط (ZIP)</b>
          <small>مجلد قوقل درايف: «تنزيل» من درايف يعطيك ملف zip — وإن كبر قسّمه درايف إلى عدة ملفات، فاخترها كلها معًا.</small>
        </button>
        ${dirSupported ? `<button type="button" class="scope-opt" id="fiDir" style="text-align:start">
          <span class="ic">${icon('folder', 18)}</span>
          <b>مجلد من الجهاز</b>
          <small>مجلد على حاسبك (أو مجلد درايف المتزامن عبر Google Drive للحاسب).</small>
        </button>` : ''}
      </div>
      <p class="hint">لا حدّ لحجم الأرشيف: يُقرأ من جهازك ملفًا ملفًا. والملف الواحد حتى
        ${fileSize(FilesState.meta.max_large_bytes || FilesState.meta.max_bytes)}.
        وإن انقطع الاستيراد فأعده بالأرشيف نفسه — يُكمل ما نقص ولا يكرّر ما رُفع.</p>`,
    buttons: [{ label: 'إغلاق', class: 'btn-ghost', onClick: (cl) => cl() }],
  });
  const pick = (attrs) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.hidden = true;
    Object.assign(input, attrs);
    // مُلحقٌ بالصفحة: بعض المتصفحات لا تفتح منتقي المجلدات لعنصرٍ خارجها
    document.body.appendChild(input);
    input.onchange = async () => {
      const files = [...(input.files || [])];
      input.remove();
      if (!files.length) return;
      close();
      try {
        const plan = attrs.webkitdirectory ? await planFromDirectory(files) : await planFromZips(files);
        previewImport(plan);
      } catch (err) { toast(err.message, 'err'); }
    };
    input.click();
  };
  overlay.querySelector('#fiZip').onclick = () => pick({ multiple: true, accept: '.zip,application/zip,application/x-zip-compressed' });
  const dir = overlay.querySelector('#fiDir');
  if (dir) dir.onclick = () => pick({ webkitdirectory: true, multiple: true });
}

// ============================================================
// خطة الاستيراد: قائمة الملفات بمساراتها، ومصدر كلٍّ منها
// ============================================================
async function planFromZips(zips) {
  const items = [];
  const skipped = [];
  for (const z of zips) {
    if (!/\.zip$/i.test(z.name) && z.type !== 'application/zip' && z.type !== 'application/x-zip-compressed')
      throw new Error(`«${z.name}» ليس أرشيف ZIP`);
    let entries;
    try { entries = await openZip(z); }
    catch (err) { throw new Error(`«${z.name}»: ${err.message}`); }
    for (const e of entries) {
      if (e.dir || zipIsJunk(e.path)) continue;
      const path = cleanImportPath(e.path);
      if (!path) continue;
      if (e.encrypted) { skipped.push({ path, reason: 'محميّ بكلمة مرور' }); continue; }
      if (e.method !== 0 && e.method !== 8) { skipped.push({ path, reason: 'ضغطٌ غير مدعوم' }); continue; }
      items.push({ path, size: e.size, get: () => zipEntryBlob(z, e) });
    }
  }
  const names = [...new Set(zips.map((z) => driveBaseName(z.name)))];
  return { items, skipped, source: zips.map((z) => z.name).join('، '), suggestedRoot: names.length === 1 ? names[0] : 'مجلد مستورد' };
}

async function planFromDirectory(files) {
  const items = files
    .filter((f) => !zipIsJunk(f.webkitRelativePath || f.name))
    .map((f) => ({ path: cleanImportPath(f.webkitRelativePath || f.name), size: f.size, get: async () => f }))
    .filter((it) => it.path);
  const root = (items[0] && items[0].path.split('/')[0]) || 'مجلد';
  return { items, skipped: [], source: root, suggestedRoot: root };
}

// ============================================================
// المعاينة قبل البدء
// ============================================================
function previewImport(plan) {
  const m = FilesState.meta;
  // المسار نفسه في أرشيفين مختارين معًا يُرفع مرة واحدة — الأول منهما
  const seen = new Set();
  plan.items = plan.items.filter((it) => {
    const k = it.path.toLowerCase();
    if (seen.has(k)) { plan.skipped.push({ path: it.path, reason: 'مكرر في أكثر من أرشيف' }); return false; }
    seen.add(k);
    return true;
  });
  const maxLarge = m.max_large_bytes || m.max_bytes;
  if (!plan.items.length) return toast('لا ملفات في المصدر المختار', 'err');

  const tops = new Set(plan.items.map((it) => it.path.split('/')[0]));
  const looseFiles = plan.items.some((it) => !it.path.includes('/'));
  // أرشيفٌ بلا مجلدٍ جامع (ملفاتٌ أو مجلداتٌ متفرقة في أعلاه) يُجمع افتراضيًا في مجلدٍ باسمه
  const needsWrap = tops.size > 1 || looseFiles;
  const tooBig = plan.items.filter((it) => it.size > maxLarge);
  const total = plan.items.reduce((s, it) => s + it.size, 0);
  const dirs = new Set();
  plan.items.forEach((it) => {
    const parts = it.path.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  });

  const { overlay } = openModal({
    title: 'معاينة الاستيراد',
    body: `<div class="row">
        <span class="tag tag-green">${arNum(plan.items.length)} ملف</span>
        <span class="tag tag-gray">${arNum(dirs.size)} مجلد</span>
        <span class="tag tag-gray">${fileSize(total)}</span>
        ${tooBig.length ? `<span class="tag tag-red">${arNum(tooBig.length)} أكبر من الحد</span>` : ''}
        ${plan.skipped.length ? `<span class="tag tag-gold">${arNum(plan.skipped.length)} لا يُستورد</span>` : ''}
      </div>
      <p class="hint mt">المصدر: ${esc(plan.source)}</p>
      <div class="field"><label><input type="checkbox" id="impWrap" ${needsWrap ? 'checked' : ''} />
        ضع المحتوى داخل مجلد جديد باسم</label>
        <input id="impWrapName" value="${esc(plan.suggestedRoot)}" /></div>
      <div class="field"><label><input type="checkbox" id="impSkip" checked />
        تخطَّ الملف إن وُجد بالاسم نفسه في مجلده (لاستئناف استيرادٍ انقطع)</label></div>
      <div style="max-height:220px;overflow:auto;border:1px solid var(--border);border-radius:10px"><table class="tbl stack-off" style="display:table;width:100%">
        <thead><tr><th>الملف</th><th>الحجم</th></tr></thead>
        <tbody>${plan.items.slice(0, 200).map((it) => `<tr${it.size > maxLarge ? ' style="background:#fdecea"' : ''}>
          <td dir="auto" style="word-break:break-all">${esc(it.path)}</td><td>${fileSize(it.size)}</td></tr>`).join('')}
          ${plan.items.length > 200 ? `<tr><td colspan="2" class="muted">… و${arNum(plan.items.length - 200)} ملفًا آخر</td></tr>` : ''}
        </tbody></table></div>
      ${plan.skipped.length ? `<p class="hint">لا يُستورد: ${plan.skipped.slice(0, 10).map((s) => `${esc(s.path)} (${esc(s.reason)})`).join('، ')}</p>` : ''}
      <p class="hint mt">أبقِ هذه الصفحة مفتوحة حتى ينتهي الاستيراد — والتقدّم يظهر أسفل الشاشة.</p>`,
    buttons: [
      { label: 'إلغاء', class: 'btn-ghost', onClick: (cl) => cl() },
      {
        label: 'بدء الاستيراد',
        onClick: async (cl, ov) => {
          const wrap = ov.querySelector('#impWrap').checked;
          const wrapName = serverName(ov.querySelector('#impWrapName').value) || plan.suggestedRoot;
          const skipExisting = ov.querySelector('#impSkip').checked;
          cl();
          let scope = null;
          if (!FilesState.folderId) {
            scope = await rootScopeDialog(plan.items.length);
            if (!scope) return;
          }
          runImport(plan, { wrap: wrap ? wrapName : '', skipExisting, scope, maxLarge });
        },
      },
    ],
  });
  const sync = () => { overlay.querySelector('#impWrapName').disabled = !overlay.querySelector('#impWrap').checked; };
  overlay.querySelector('#impWrap').onchange = sync;
  sync();
}

// ============================================================
// التنفيذ
// ============================================================
async function runImport(plan, opts) {
  const m = FilesState.meta;
  const targetId = FilesState.folderId || null;
  const scope = opts.scope;
  const items = plan.items.map((it) => {
    const full = opts.wrap ? opts.wrap + '/' + it.path : it.path;
    const parts = full.split('/');
    return { ...it, dir: parts.slice(0, -1).join('/'), name: serverName(parts[parts.length - 1]) };
  });

  const state = { cancelled: false, done: 0, skipped: 0, failed: [], bytes: 0, passed: 0, active: new Map() };
  const totalBytes = items.reduce((s, it) => s + it.size, 0);
  const panel = document.getElementById('fUpPanel');
  const guard = (e) => { e.preventDefault(); e.returnValue = ''; };
  window.addEventListener('beforeunload', guard);

  panel.hidden = false;
  panel.innerHTML = `<div class="up-head"><b id="impTitle">استيراد: تجهيز المجلدات…</b>
      <button class="btn-ghost btn-sm" id="impStop">إيقاف</button></div>
    <div class="up-body">
      <div class="up-row"><span class="n" id="impCount"></span><span class="s" id="impBytes"></span>
        <div class="bar"><i id="impBar" style="width:0%"></i></div><span class="st" id="impPct"></span></div>
      <div id="impActive"></div>
      <div id="impFailed"></div>
    </div>`;
  const $ = (id) => panel.querySelector('#' + id);
  $('impStop').onclick = () => { state.cancelled = true; $('impStop').disabled = true; $('impTitle').textContent = 'جارٍ الإيقاف…'; };

  const draw = () => {
    const pct = totalBytes ? Math.round(((state.passed + [...state.active.values()].reduce((s, a) => s + a.sent, 0)) / totalBytes) * 100) : 100;
    $('impBar').style.width = Math.min(100, pct) + '%';
    $('impPct').textContent = arNum(Math.min(100, pct)) + '٪';
    $('impCount').textContent = `${arNum(state.done + state.skipped + state.failed.length)} / ${arNum(items.length)} ملف`;
    $('impBytes').textContent = fileSize(state.bytes) + ' رُفع من ' + fileSize(totalBytes);
    $('impActive').innerHTML = [...state.active.values()].map((a) =>
      `<div class="up-row"><span class="n">${esc(a.name)}</span><span class="st">${arNum(Math.round(a.p * 100))}٪</span></div>`).join('');
    $('impFailed').innerHTML = state.failed.length
      ? `<p class="hint" style="color:var(--danger,#c0392b)">تعذّر ${arNum(state.failed.length)}:</p>` +
        state.failed.slice(-20).map((f) => `<div class="up-row err"><span class="n">${esc(f.path)}</span><span class="st">${esc(f.error)}</span></div>`).join('')
      : '';
  };

  let createdFolders = 0;
  const folderOf = { '': targetId };
  try {
    // ١) المجلدات — مرتّبة بالعمق، على دفعات
    const dirSet = new Set();
    items.forEach((it) => {
      const parts = it.dir ? it.dir.split('/') : [];
      for (let i = 1; i <= parts.length; i++) dirSet.add(parts.slice(0, i).join('/'));
    });
    const dirs = [...dirSet].sort((a, b) => a.split('/').length - b.split('/').length);
    const scopeBody = scope ? { access: scope.access, council_id: scope.council_id, academic_year: scope.year } : {};
    for (let i = 0; i < dirs.length; i += 1000) {
      const r = await API.post('/files/folders/ensure-paths', { parent_id: targetId, paths: dirs.slice(i, i + 1000), ...scopeBody });
      Object.assign(folderOf, r.map);
      createdFolders += r.created || 0;
    }

    // ٢) الموجود سلفًا — لتخطّيه
    const existing = new Set();
    if (opts.skipExisting) {
      const ids = [...new Set(Object.values(folderOf).map((v) => v || 0))];
      for (let i = 0; i < ids.length; i += 500) {
        const r = await API.post('/files/existing-names', { folder_ids: ids.slice(i, i + 500) });
        Object.entries(r.names).forEach(([fid, names]) => names.forEach((n) => existing.add(fid + '/' + n)));
      }
    }

    // ٣) الملفات — ثلاثة معًا
    $('impTitle').textContent = 'استيراد: ' + plan.source;
    let next = 0;
    const worker = async () => {
      while (!state.cancelled && next < items.length) {
        const it = items[next++];
        const fid = folderOf[it.dir] || null;
        if (opts.skipExisting && existing.has((fid || 0) + '/' + it.name)) {
          state.skipped++; state.passed += it.size; draw(); continue;
        }
        if (it.size > opts.maxLarge) {
          state.failed.push({ path: it.path, error: 'أكبر من الحد المسموح' });
          state.passed += it.size;
          draw();
          continue;
        }
        const slot = { name: it.name, p: 0, sent: 0 };
        state.active.set(it, slot);
        const dest = fid ? { folder: fid } : { access: scope.access, council_id: scope.council_id, year: scope.year };
        const onP = (p) => { slot.p = p; slot.sent = p * it.size; draw(); };
        // محاولتان لكل ملف — انقطاعٌ عابر في الشبكة لا يُسقط ملفًا من آلاف
        let ok = false, lastErr = null;
        for (let attempt = 0; attempt < 2 && !ok && !state.cancelled; attempt++) {
          try {
            const blob = await it.get();
            if (blob.size > m.max_bytes) await uploadLarge(blob, it.name, dest, onP, () => state.cancelled);
            else {
              const q = new URLSearchParams({ name: it.name });
              Object.entries(dest).forEach(([k, v]) => { if (v != null && v !== '') q.set(k, String(v)); });
              await uploadOne(blob, q, onP);
            }
            ok = true;
          } catch (err) { lastErr = err; }
        }
        state.active.delete(it);
        if (ok) { state.done++; state.bytes += it.size; state.passed += it.size; }
        else if (!state.cancelled) {
          state.failed.push({ path: it.path, error: lastErr ? lastErr.message : 'تعذّر الرفع' });
          state.passed += it.size;
        }
        draw();
      }
    };
    draw();
    await Promise.all(Array.from({ length: IMPORT_CONCURRENCY }, worker));
  } catch (err) {
    state.failed.push({ path: '—', error: err.message });
  } finally {
    window.removeEventListener('beforeunload', guard);
  }

  // الحدث يُسجَّل على أعلى مجلدٍ استقبل الاستيراد: المجلد الجامع إن وُجد، وإلا الهدف
  // وإن جاء الأرشيف بمجلدٍ جامع واحد (كأرشيف درايف) فعليه
  const tops = [...new Set(items.map((it) => it.dir.split('/')[0]).filter(Boolean))];
  const topId = (opts.wrap && folderOf[opts.wrap])
    || (tops.length === 1 && items.every((it) => it.dir) && folderOf[tops[0]]) || targetId;
  API.post('/files/import-log', {
    source: plan.source, folder_id: topId, folders: createdFolders, files: state.done,
    bytes: state.bytes, skipped: state.skipped, failed: state.failed.length,
  }).catch(() => {});

  const notRun = items.length - state.done - state.skipped - state.failed.length;
  $('impTitle').textContent = state.cancelled ? 'أُوقف الاستيراد' : 'انتهى الاستيراد';
  $('impStop').textContent = 'إغلاق';
  $('impStop').disabled = false;
  $('impStop').onclick = () => { panel.hidden = true; };
  $('impActive').innerHTML = `<p class="hint">رُفع ${arNum(state.done)} ملف${state.skipped ? ` · تُخطّي ${arNum(state.skipped)} موجود` : ''}${createdFolders ? ` · أُنشئ ${arNum(createdFolders)} مجلد` : ''}${notRun > 0 ? ` · لم يُرفع ${arNum(notRun)} (أعد الاستيراد لإكماله)` : ''}</p>`;
  toast(state.failed.length || notRun > 0
    ? `رُفع ${arNum(state.done)} ملف — وبقي ${arNum(state.failed.length + Math.max(0, notRun))}`
    : `تم استيراد ${arNum(state.done)} ملف`, state.failed.length || notRun > 0 ? 'err' : 'ok');
  if (!state.failed.length && notRun <= 0) setTimeout(() => { panel.hidden = true; }, 4000);
  await loadFiles();
  FilesState.meta = await API.get('/files/meta').catch(() => FilesState.meta);
}
