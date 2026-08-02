// واجهة مساعد الذكاء الاصطناعي — مقترحات يراجعها المستخدم قبل الاعتماد.
// كل الأزرار تظهر فقط عند تهيئة الربط (State.aiEnabled).

// طلب متعدد الأجزاء (رفع ملف صوتي) — عميل API لا يدعم FormData
async function aiUpload(path, formData) {
  const res = await fetch('/api/ai' + path, { method: 'POST', body: formData, credentials: 'same-origin' });
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = { error: text }; } }
  if (!res.ok) { const e = new Error((data && data.error) || 'حدث خطأ'); e.status = res.status; throw e; }
  return data;
}

// زر مساعد موحّد الشكل
function aiBtn(id, label, size = 16) {
  return `<button class="btn-ghost btn-sm ai-btn" id="${id}">${icon('sparkle', size)} ${esc(label)}</button>`;
}

// إظهار حالة الانتظار داخل زر أثناء استدعاء النموذج
async function aiRun(btn, fn) {
  if (!btn) return fn();
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner spinner-inline"></span> جارٍ المعالجة…';
  try { return await fn(); }
  finally { btn.disabled = false; btn.innerHTML = html; }
}

// ملاحظة: صياغة نص البند تتم داخل محرر المحتوى نفسه (شريط المساعد في richEditor)
// بلا مربع نقاط منفصل — راجع ui.js.

// ============================================================
// ١) استخراج القرارات والتوصيات والمهام من نص المناقشة
// ============================================================
function aiExtractDialog(meetingId, seedText, onDone) {
  let items = [];
  const { overlay, close } = openModal({
    title: 'استخراج القرارات والمهام',
    body: `
      <p class="hint">الصق نص المناقشة أو استخدم محتوى البنود أو سجّل الصوت مباشرة،
        وسيقترح المساعد القرارات والتوصيات والمهام. راجعها واختر ما تريد إضافته.</p>
      <div id="aixErr"></div>
      <div class="field"><label>نص المناقشة</label><textarea id="aix_text" rows="7">${esc(seedText || '')}</textarea>
        <div class="row mt">
          ${canRecordAudio() ? '<button type="button" class="btn-ghost btn-sm" id="aix_rec">' + icon('mic', 15) + ' تسجيل صوتي</button>' : ''}
          <button type="button" class="btn-ghost btn-sm" id="aix_file">${icon('paperclip', 15)} ملف صوتي</button>
          <input type="file" accept="audio/*" id="aix_audio" hidden />
          <span class="rich-ai-state" id="aix_state"></span>
        </div></div>
      <div class="row"><button class="btn btn-sm" id="aix_go">${icon('sparkle', 15)} استخرج</button></div>
      <div id="aix_out" class="mt"></div>`,
    buttons: [{ label: 'إغلاق', class: 'btn-ghost', onClick: (cl) => { dictation.destroy(); cl(); } }],
  });

  const err = (m) => overlay.querySelector('#aixErr').innerHTML = m ? `<div class="form-error">${esc(m)}</div>` : '';

  // إملاء صوتي مباشر داخل مربع النص نفسه
  const stateEl = overlay.querySelector('#aix_state');
  const dictation = wireDictation({
    meetingId,
    recBtn: overlay.querySelector('#aix_rec'),
    fileBtn: overlay.querySelector('#aix_file'),
    fileInput: overlay.querySelector('#aix_audio'),
    setState: (msg, kind) => { stateEl.textContent = msg || ''; stateEl.className = 'rich-ai-state' + (kind ? ' ' + kind : ''); },
    insert: (text) => {
      const ta = overlay.querySelector('#aix_text');
      ta.value = (ta.value.trim() ? ta.value.trim() + '\n' : '') + text;
    },
    doneMessage: 'أُضيف نص التفريغ — اضغط «استخرج»',
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dictation.destroy(); });
  overlay.querySelector('.x').addEventListener('click', () => dictation.destroy());

  const renderItems = () => {
    overlay.querySelector('#aix_out').innerHTML = !items.length
      ? '<p class="muted">لم يُعثر على قرارات أو مهام في النص.</p>'
      : `<div class="card"><div class="card-head"><h3>المقترحات (${arNum(items.length)})</h3></div>
          <div class="card-body">
            ${items.map((it, i) => `
              <div class="row" style="align-items:flex-start;margin-bottom:10px;gap:8px">
                <label class="check-inline" style="padding-top:9px"><input type="checkbox" data-pick="${i}" checked /></label>
                <select data-ty="${i}" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px">
                  ${['decision', 'recommendation', 'task'].map((t) => `<option value="${t}" ${it.type === t ? 'selected' : ''}>${ACTION_TYPE_AR[t]}</option>`).join('')}
                </select>
                <select data-pr="${i}" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px">
                  ${['high', 'medium', 'low'].map((p) => `<option value="${p}" ${it.priority === p ? 'selected' : ''}>${PRIORITY_AR[p]}</option>`).join('')}
                </select>
                <textarea data-tx="${i}" rows="2" style="flex:1;padding:8px 11px;border:1px solid var(--border);border-radius:8px">${esc(it.text)}</textarea>
              </div>`).join('')}
            <p class="hint">تُنشأ المهام بتاريخ استحقاق مبدئي بعد أسبوع — عدّله من زر «تعديل» في جدول البنود.</p>
            <div class="row mt"><button class="btn btn-sm" id="aix_add">إضافة المحدَّد للمحضر</button></div>
          </div></div>`;
    overlay.querySelectorAll('[data-tx]').forEach((el) => el.oninput = () => items[el.dataset.tx].text = el.value);
    overlay.querySelectorAll('[data-ty]').forEach((el) => el.onchange = () => items[el.dataset.ty].type = el.value);
    overlay.querySelectorAll('[data-pr]').forEach((el) => el.onchange = () => items[el.dataset.pr].priority = el.value);

    const addBtn = overlay.querySelector('#aix_add');
    if (addBtn) addBtn.onclick = (e) => aiRun(e.currentTarget, async () => {
      const picked = Array.from(overlay.querySelectorAll('[data-pick]:checked')).map((el) => items[el.dataset.pick]);
      if (!picked.length) { err('اختر بنداً واحداً على الأقل'); return; }
      err('');
      let ok = 0; const failures = [];
      for (const it of picked) {
        if (!it.text.trim()) continue;
        try {
          // المهمة تتطلب تاريخ استحقاق — نضبطه مبدئياً بعد أسبوع ويُعدَّل لاحقاً
          const due = it.type === 'task' ? new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10) : null;
          await API.post('/actions/meeting/' + meetingId, { type: it.type, text: it.text.trim(), priority: it.priority, due_date: due, assignees: [] });
          ok++;
        } catch (ex) { failures.push(ex.message); }
      }
      if (ok) toast(`أُضيف ${arNum(ok)} بند`, 'ok');
      if (failures.length) err(failures[0]);
      else { dictation.destroy(); close(); if (onDone) onDone(); }
    });
  };

  overlay.querySelector('#aix_go').onclick = (e) => {
    const text = overlay.querySelector('#aix_text').value.trim();
    if (!text) { err('أدخل نص المناقشة'); return; }
    err('');
    aiRun(e.currentTarget, async () => {
      try {
        const res = await API.post('/ai/extract-actions', { meeting_id: meetingId, text });
        items = res.items || [];
        renderItems();
      } catch (ex) { err(ex.message); }
    });
  };
}

// ============================================================
// ٢) الملخّص التنفيذي للمحضر
// ============================================================
function aiSummaryDialog(meetingId) {
  const { overlay } = openModal({
    title: 'الملخّص التنفيذي',
    body: '<div id="ais_out"><div class="spinner"></div></div>',
    buttons: [
      { label: 'نسخ النص', class: 'btn-ghost', onClick: (cl, ov) => {
        const el = ov.querySelector('#ais_body');
        if (!el) return;
        navigator.clipboard.writeText(el.innerText).then(() => toast('نُسخ الملخّص', 'ok'), () => toast('تعذّر النسخ', 'err'));
      }},
      { label: 'إغلاق', class: 'btn-ghost', onClick: (cl) => cl() },
    ],
  });
  API.post('/ai/meeting-summary', { meeting_id: meetingId })
    .then(({ html }) => {
      overlay.querySelector('#ais_out').innerHTML =
        `<div class="body-rich" id="ais_body">${html}</div>
         <p class="hint mt">ملخّص آلي — راجعه قبل الاعتماد عليه.</p>`;
    })
    .catch((e) => { overlay.querySelector('#ais_out').innerHTML = `<div class="form-error">${esc(e.message)}</div>`; });
}

// ============================================================
// ٣) تحليل ملاحظات التقييم
// ============================================================
function aiEvalNotesDialog(cycleId, targetType, targetId, targetName) {
  const { overlay } = openModal({
    title: 'تحليل ملاحظات التقييم — ' + (targetName || ''),
    body: '<div id="aie_out"><div class="spinner"></div></div>',
    buttons: [{ label: 'إغلاق', class: 'btn-ghost', onClick: (cl) => cl() }],
  });
  API.post('/ai/eval-notes', { cycle_id: cycleId, target_type: targetType, target_id: targetId })
    .then(({ html }) => {
      overlay.querySelector('#aie_out').innerHTML =
        `<div class="body-rich">${html}</div>
         <p class="hint mt">تحليل آلي للملاحظات مجهولة المصدر — للاسترشاد فقط.</p>`;
    })
    .catch((e) => { overlay.querySelector('#aie_out').innerHTML = `<div class="form-error">${esc(e.message)}</div>`; });
}
