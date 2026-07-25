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

// ============================================================
// ١) صياغة نص بند من نقاط + تفريغ صوتي
// ============================================================
// onAccept(html) — يُستدعى عند قبول المستخدم للصياغة.
function aiComposeDialog(meetingId, title, onAccept) {
  const { overlay, close } = openModal({
    title: 'صياغة نص البند بالذكاء الاصطناعي',
    body: `
      <p class="hint">اكتب النقاط التي دارت في المناقشة (أو ارفع تسجيلاً صوتياً لتفريغه)، ثم اطلب الصياغة.
        النتيجة <b>مقترح</b> يمكنك تعديله قبل اعتماده.</p>
      <div id="aicErr"></div>
      <div class="field"><label>النقاط</label>
        <textarea id="aic_points" rows="6" placeholder="- نوقشت نتائج الفصل الأول&#10;- اقترح المشرف زيادة الحصص العلاجية"></textarea></div>
      <div class="field"><label>تفريغ تسجيل صوتي (اختياري)</label>
        <div class="row"><input type="file" id="aic_audio" accept="audio/*" style="flex:1" />
          <button class="btn-ghost btn-sm" id="aic_tr">${icon('mic', 15)} تفريغ</button></div>
        <p class="hint">حتى ٢٠ ميجابايت. يُضاف النص الناتج إلى النقاط أعلاه.</p></div>
      <div class="row"><button class="btn btn-sm" id="aic_gen">${icon('sparkle', 15)} صُغ النص</button></div>
      <div id="aic_out" class="mt"></div>`,
    buttons: [{ label: 'إغلاق', class: 'btn-ghost', onClick: (cl) => cl() }],
  });

  const err = (m) => overlay.querySelector('#aicErr').innerHTML = m ? `<div class="form-error">${esc(m)}</div>` : '';

  overlay.querySelector('#aic_tr').onclick = (e) => {
    const f = overlay.querySelector('#aic_audio').files[0];
    if (!f) { err('اختر ملفاً صوتياً أولاً'); return; }
    err('');
    aiRun(e.currentTarget, async () => {
      try {
        const fd = new FormData();
        fd.append('meeting_id', String(meetingId));
        fd.append('audio', f);
        const { text } = await aiUpload('/transcribe', fd);
        const ta = overlay.querySelector('#aic_points');
        ta.value = (ta.value ? ta.value + '\n' : '') + text;
        toast('تم التفريغ', 'ok');
      } catch (ex) { err(ex.message); }
    });
  };

  overlay.querySelector('#aic_gen').onclick = (e) => {
    const points = overlay.querySelector('#aic_points').value.trim();
    if (!points) { err('أدخل النقاط أولاً'); return; }
    err('');
    aiRun(e.currentTarget, async () => {
      try {
        const { html } = await API.post('/ai/agenda-draft', { meeting_id: meetingId, title, points });
        overlay.querySelector('#aic_out').innerHTML = `
          <div class="card"><div class="card-head"><h3>الصياغة المقترحة</h3></div>
            <div class="card-body"><div class="body-rich" id="aic_html">${html}</div>
              <div class="row mt"><button class="btn btn-sm" id="aic_use">اعتماد هذه الصياغة</button></div></div></div>`;
        overlay.querySelector('#aic_use').onclick = () => {
          onAccept(overlay.querySelector('#aic_html').innerHTML);
          close();
        };
      } catch (ex) { err(ex.message); }
    });
  };
}

// ============================================================
// ٢) استخراج القرارات والتوصيات والمهام من نص المناقشة
// ============================================================
function aiExtractDialog(meetingId, seedText, onDone) {
  let items = [];
  const { overlay, close } = openModal({
    title: 'استخراج القرارات والمهام',
    body: `
      <p class="hint">الصق نص المناقشة أو استخدم محتوى البنود، وسيقترح المساعد القرارات والتوصيات والمهام.
        راجعها واختر ما تريد إضافته — المهام تحتاج تاريخ استحقاق يُضبط لاحقاً.</p>
      <div id="aixErr"></div>
      <div class="field"><label>نص المناقشة</label><textarea id="aix_text" rows="7">${esc(seedText || '')}</textarea></div>
      <div class="row"><button class="btn btn-sm" id="aix_go">${icon('sparkle', 15)} استخرج</button></div>
      <div id="aix_out" class="mt"></div>`,
    buttons: [{ label: 'إغلاق', class: 'btn-ghost', onClick: (cl) => cl() }],
  });

  const err = (m) => overlay.querySelector('#aixErr').innerHTML = m ? `<div class="form-error">${esc(m)}</div>` : '';

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
            <p class="hint">المهام المضافة تُنشأ بتاريخ استحقاق فارغ — عدّلها من بطاقة البند بعد الإضافة.</p>
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
      else { close(); if (onDone) onDone(); }
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
// ٣) الملخّص التنفيذي للمحضر
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
// ٤) تحليل ملاحظات التقييم
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
