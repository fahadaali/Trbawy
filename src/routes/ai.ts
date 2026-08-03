// مساعد الذكاء الاصطناعي: صياغة بنود المحضر، استخراج القرارات والمهام،
// تفريغ التسجيلات الصوتية، الملخّص التنفيذي، وتحليل ملاحظات التقييم.
// كل المخرجات مقترحات فقط — لا تُحفظ تلقائياً، يراجعها المستخدم ويعتمدها بنفسه.
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import { canViewMeeting, canEditDraft, canViewResults } from '../permissions';
import { getCouncil } from '../lib/meetings';
import { resultTargets } from '../lib/evaltargets';
import { sanitizeHtml } from '../lib/sanitize';
import { audit } from '../lib/audit';
import { aiEnabled, aiText, aiTranscribe, extractJson, AiUnavailable } from '../lib/ai';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', requireAuth, requirePasswordChanged);

const EDITABLE = ['invitation', 'draft'];
const MAX_INPUT = 20000;   // حد طول النص المُرسل للنموذج
const MAX_AUDIO = 20 * 1024 * 1024; // ٢٠ ميجابايت

// تنظيف النص الوارد من المستخدم قبل تمريره للنموذج
function trimInput(v: unknown): string {
  return String(v ?? '').trim().slice(0, MAX_INPUT);
}

// تحويل خطأ الذكاء الاصطناعي إلى استجابة مفهومة بدل انهيار الطلب
function aiError(c: any, e: unknown) {
  if (e instanceof AiUnavailable) return c.json({ error: e.message, ai_disabled: true }, 503);
  console.error('AI route error:', e);
  return c.json({ error: (e as Error)?.message || 'تعذّر تنفيذ الطلب' }, 502);
}

// إتاحة الميزة على هذا النشر (تُخفي الواجهة الأزرار عند التعطيل)
app.get('/status', (c) => c.json({ enabled: aiEnabled(c.env) }));

// محضر قابل للتحرير من قِبل المستخدم الحالي
async function editableMeeting(c: any, id: number) {
  const db = c.env.DB as D1Database;
  const m = await db.prepare('SELECT * FROM meetings WHERE id = ?').bind(id).first<any>();
  if (!m) return { error: c.json({ error: 'المحضر غير موجود' }, 404) };
  const council = await getCouncil(c.env, m.council_id);
  if (!council) return { error: c.json({ error: 'المجلس غير موجود' }, 404) };
  if (!EDITABLE.includes(m.status)) return { error: c.json({ error: 'المحضر مقفل ولا يقبل التعديل' }, 409) };
  if (!canEditDraft(c.get('user'), council, m.writer_id))
    return { error: c.json({ error: 'لا تملك صلاحية تحرير هذا المحضر' }, 403) };
  return { meeting: m, council };
}

// ------------------------------------------------------------
// ١) صياغة نص بند من نقاط مختصرة
// ------------------------------------------------------------
app.post('/agenda-draft', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const meetingId = Number(b.meeting_id);
  const { error, council } = await editableMeeting(c, meetingId) as any;
  if (error) return error;

  const title = trimInput(b.title);
  const points = trimInput(b.points);
  if (!points) return c.json({ error: 'أدخل النقاط المراد صياغتها' }, 400);

  const system =
    'أنت كاتب محاضر في مجلس تربوي بمدرسة. مهمتك صياغة نص بند من نقاط مختصرة يدوّنها الكاتب. ' +
    'اكتب فقرات مترابطة تصف المناقشة وما دار حولها بأسلوب المحاضر الرسمية (بصيغة الماضي والغائب). ' +
    'لا تخترع أرقاماً أو أسماءً أو قرارات لم ترد في النقاط. ' +
    'أخرج نصاً بصيغة HTML بسيطة باستخدام <p> و<ul><li> فقط، دون أي شرح أو مقدمة.';
  const user = `عنوان البند: ${title || '(بدون عنوان)'}\nالمجلس: ${council.name}\n\nالنقاط:\n${points}`;

  try {
    const out = await aiText(c.env, system, user, 1400);
    return c.json({ html: sanitizeHtml(out) });
  } catch (e) { return aiError(c, e); }
});

// ------------------------------------------------------------
// ٢) استخراج القرارات والتوصيات والمهام من نص المناقشة
// ------------------------------------------------------------
const TYPES = ['decision', 'recommendation', 'task'];
const PRIORITIES = ['high', 'medium', 'low'];

app.post('/extract-actions', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const meetingId = Number(b.meeting_id);
  const { error } = await editableMeeting(c, meetingId) as any;
  if (error) return error;

  const text = trimInput(b.text);
  if (!text) return c.json({ error: 'لا يوجد نص لاستخراج القرارات منه' }, 400);

  const system =
    'أنت مساعد إداري يستخرج القرارات والتوصيات والمهام من نص مناقشة مجلس تربوي. ' +
    'صنّف كل عنصر: decision للقرار المُلزم، recommendation للتوصية، task للمهمة التنفيذية المُسندة. ' +
    'اكتب نص كل عنصر جملة واحدة واضحة قابلة للقياس. لا تستخرج ما لم يرد صراحة في النص. ' +
    'أخرج مصفوفة JSON فقط بالشكل: ' +
    '[{"type":"decision|recommendation|task","text":"...","priority":"high|medium|low"}] ' +
    'دون أي نص آخر قبلها أو بعدها.';

  try {
    const out = await aiText(c.env, system, text, 1600);
    const parsed = extractJson<any[]>(out);
    if (!Array.isArray(parsed)) return c.json({ error: 'تعذّر تحليل مخرجات النموذج — أعد المحاولة' }, 502);
    const items = parsed
      .filter((it) => it && typeof it.text === 'string' && it.text.trim())
      .slice(0, 40)
      .map((it) => ({
        type: TYPES.includes(it.type) ? it.type : 'task',
        text: String(it.text).trim().slice(0, 1000),
        priority: PRIORITIES.includes(it.priority) ? it.priority : 'medium',
      }));
    return c.json({ items });
  } catch (e) { return aiError(c, e); }
});

// ------------------------------------------------------------
// ٣) تفريغ تسجيل صوتي إلى نص
// ------------------------------------------------------------
app.post('/transcribe', async (c) => {
  const form = await c.req.formData().catch(() => null);
  if (!form) return c.json({ error: 'لم يُرسل ملف صوتي' }, 400);
  const meetingId = Number(form.get('meeting_id'));
  const { error } = await editableMeeting(c, meetingId) as any;
  if (error) return error;

  const file: unknown = form.get('audio');
  if (!(file instanceof File)) return c.json({ error: 'لم يُرسل ملف صوتي' }, 400);
  if (file.size === 0) return c.json({ error: 'الملف الصوتي فارغ' }, 400);
  if (file.size > MAX_AUDIO) return c.json({ error: 'حجم الملف الصوتي يتجاوز ٢٠ ميجابايت' }, 413);

  try {
    const text = await aiTranscribe(c.env, await file.arrayBuffer());
    await audit(c.env, {
      userId: c.get('user').id, action: 'ai_transcribe', entityType: 'meeting', entityId: meetingId,
      newValue: { size: file.size }, ip: c.req.header('cf-connecting-ip') || null,
    });
    return c.json({ text });
  } catch (e) { return aiError(c, e); }
});

// ------------------------------------------------------------
// ٤) الملخّص التنفيذي للمحضر
// ------------------------------------------------------------
app.post('/meeting-summary', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const id = Number(b.meeting_id);
  const m = await c.env.DB.prepare('SELECT * FROM meetings WHERE id = ?').bind(id).first<any>();
  if (!m) return c.json({ error: 'المحضر غير موجود' }, 404);
  const council = await getCouncil(c.env, m.council_id);
  if (!council) return c.json({ error: 'المجلس غير موجود' }, 404);
  if (!(await canViewMeeting(c.env, c.get('user'), m, council)))
    return c.json({ error: 'لا تملك صلاحية الاطلاع على هذا المحضر' }, 403);

  const agenda = await c.env.DB.prepare(
    'SELECT title, body FROM agenda_items WHERE meeting_id = ? ORDER BY sort_order',
  ).bind(id).all();
  const actions = await c.env.DB.prepare(
    'SELECT type, display_number, text FROM action_items WHERE source_meeting_id = ? ORDER BY id',
  ).bind(id).all();

  const stripTags = (s: string) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const body = [
    `المجلس: ${council.name}`,
    `المحضر: ${m.display_number} — ${m.title || ''}`,
    '',
    'البنود:',
    ...(agenda.results as any[]).map((a, i) => `${i + 1}) ${a.title}: ${stripTags(a.body)}`),
    '',
    'القرارات والتوصيات والمهام:',
    ...(actions.results as any[]).map((a) => `- [${a.display_number}] ${a.text}`),
  ].join('\n');
  if (!agenda.results.length && !actions.results.length)
    return c.json({ error: 'المحضر لا يحتوي على بنود أو قرارات لتلخيصها' }, 400);

  const system =
    'أنت مساعد إداري. لخّص محضر اجتماع في ملخّص تنفيذي موجز لا يتجاوز ٢٠٠ كلمة، ' +
    'يبرز أهم ما نوقش وأبرز القرارات والمهام ومن يتابعها. ' +
    'أخرج نصاً بصيغة HTML بسيطة باستخدام <p> و<ul><li> فقط، دون مقدمات.';

  try {
    const out = await aiText(c.env, system, trimInput(body), 900);
    return c.json({ html: sanitizeHtml(out) });
  } catch (e) { return aiError(c, e); }
});

// ------------------------------------------------------------
// ٥) تحليل ملاحظات التقييم لمُقيَّم في دورة
// ------------------------------------------------------------
app.post('/eval-notes', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const cycleId = Number(b.cycle_id);
  const targetType = String(b.target_type || '');
  const targetId = Number(b.target_id);
  const u = c.get('user');

  if (!canViewResults(u, targetType)) return c.json({ error: 'لا تملك صلاحية الاطلاع على هذه النتائج' }, 403);
  const cycle = await c.env.DB.prepare('SELECT * FROM eval_cycles WHERE id = ?').bind(cycleId).first<any>();
  if (!cycle) return c.json({ error: 'الدورة غير موجودة' }, 404);
  if (cycle.status !== 'published' && cycle.status !== 'closed')
    return c.json({ error: 'النتائج غير متاحة قبل إقفال الدورة' }, 409);

  // نطاق الاطلاع: لا يتجاوز المستخدم مرحلته
  const allowed = await resultTargets(c.env, u, targetType);
  if (!allowed.some((t) => t.id === targetId))
    return c.json({ error: 'المُقيَّم خارج نطاق صلاحيتك' }, 403);

  const notes = await c.env.DB.prepare(
    `SELECT cr.name AS criterion, s.score, s.is_na, s.note, e.general_note
       FROM evaluations e
       JOIN evaluation_scores s ON s.evaluation_id = e.id
       JOIN eval_criteria cr ON cr.id = s.criterion_id
      WHERE e.cycle_id = ? AND e.target_type = ? AND e.target_id = ? AND e.submitted_at IS NOT NULL`,
  ).bind(cycleId, targetType, targetId).all();

  const rows = notes.results as any[];
  const lines = rows
    .map((r) => {
      const parts = [`${r.criterion}: ${r.is_na ? 'لا ينطبق' : r.score}`];
      if (r.note) parts.push(`ملاحظة: ${r.note}`);
      return parts.join(' — ');
    });
  const generals = [...new Set(rows.map((r) => r.general_note).filter(Boolean))];
  if (!lines.length) return c.json({ error: 'لا توجد تقييمات مُسلَّمة لهذا المُقيَّم' }, 400);

  const payload = [
    `الدورة: ${cycle.name}`,
    '',
    'الدرجات والملاحظات (مجهولة المصدر):',
    ...lines,
    ...(generals.length ? ['', 'ملاحظات عامة:', ...generals.map((g) => `- ${g}`)] : []),
  ].join('\n');

  const system =
    'أنت مستشار تطوير أداء تربوي. حلّل درجات وملاحظات تقييم واستخرج: ' +
    'أبرز نقاط القوة، وأبرز فرص التحسين، وثلاث توصيات تطويرية عملية. ' +
    'لا تذكر أسماء المقيِّمين ولا تفترض معلومات غير واردة. ' +
    'أخرج HTML بسيطاً باستخدام <p> و<ul><li> و<strong> فقط، دون مقدمات.';

  try {
    const out = await aiText(c.env, system, trimInput(payload), 1200);
    return c.json({ html: sanitizeHtml(out) });
  } catch (e) { return aiError(c, e); }
});

export default app;
