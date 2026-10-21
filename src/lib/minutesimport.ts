// استيراد محضرٍ أُعدّ خارج المنصة (PDF): النصّ ← بيانات محضر منظّمة يراجعها صاحبها.
//
// النموذج يقرأ النصّ ويُخرج JSON بالترويسة والحضور والبنود والمتابعات والقرارات والمهام.
// وكل ما بعده هنا حتميّ لا يُترك للنموذج: تطبيع القيم إلى ما تقبله المنصة، وتحويل
// التاريخ الهجري، ومطابقة الأسماء المكتوبة في المحضر بأعضاء المجلس. ولا يُحفظ شيءٌ من
// هذا كله — يُعرض مسودةً تُراجَع وتُصحَّح، ثم تُحفظ بطلبٍ مستقل (POST /meetings/import).
import { normKey, toEnDigits } from './csv';
import { parseLooseDate } from './hijri';

export const MINUTES_CHUNK = 12000;  // حروف النص في الطلب الواحد للنموذج
export const MINUTES_MAX_CHUNKS = 5; // ما فوقه محضرٌ أطول من أن يُفرَّغ دفعة

export const MINUTES_SYSTEM = `أنت مساعد إداري يحوّل نصّ محضر اجتماع (مستخرجٍ آليًّا من ملف PDF، وقد يكون فيه
تكرار أو اضطراب في ترتيب الأسطر أو الجداول) إلى بيانات منظّمة.
أعد JSON فقط بلا أي شرح، بهذا الشكل تمامًا:
{"title":"","greg_date":"","hijri_date":"","start_time":"","end_time":"","location":"","location_type":"in_person",
 "attendees":[{"name":"","title":"","status":"present"}],
 "agenda":[{"title":"","body":""}],
 "followups":[{"text":"","status_note":""}],
 "actions":[{"type":"decision","text":"","priority":"medium","due_date":"","owners":[""]}]}
القواعد:
- لا تخترع أي معلومة غير موجودة في النص. ما لم يُذكر اتركه نصًّا فارغًا "" أو مصفوفة فارغة [].
- greg_date بصيغة YYYY-MM-DD إن ورد التاريخ الميلادي، و hijri_date بصيغة YYYY/MM/DD إن ورد الهجري
  (حوّل اسم الشهر إلى رقمه: محرم=1 صفر=2 ربيع الأول=3 ربيع الآخر=4 جمادى الأولى=5 جمادى الآخرة=6
  رجب=7 شعبان=8 رمضان=9 شوال=10 ذو القعدة=11 ذو الحجة=12). ولا تحوّل بين التقويمين.
- start_time و end_time كما وردا (مثل 9:30 ص).
- location_type: "remote" إن كان الاجتماع عن بُعد (زوم، تيمز، رابط)، وإلا "in_person".
- attendees: كل شخص ورد في الحضور أو الاعتذار أو الغياب، باسمه كما ورد (دون اللقب مثل أ. أو د.)
  وصفته إن ذُكرت في title، و status: "present" للحاضر، "apology" للمعتذر، "absent" للغائب.
- agenda: بنود الاجتماع أو محاوره بالترتيب، title عنوان البند، و body ما دار فيه من نقاش بصياغة النص نفسه موجزًا.
- followups: ما ورد في المحضر من متابعة قرارات أو مهام سابقة، وحالتها في status_note (منجز، جارٍ، متأخر…).
- actions: كل قرار (decision) أو توصية (recommendation) أو مهمة مكلَّف بها أحد (task)، text نصّه،
  owners أسماء المكلفين كما وردت، due_date موعده إن ذُكر (بالصيغة كما ورد)، priority: high أو medium أو low
  (medium ما لم يُذكر خلافه).`;

export function minutesPrompt(text: string, part: number, parts: number): string {
  return (parts > 1 ? `هذا الجزء ${part} من ${parts} من نص المحضر — استخرج ما ورد فيه وحده:\n\n` : 'نص المحضر:\n\n') + text;
}

/** تقسيم النص الطويل على فواصل الفقرات — فلا ينقطع بندٌ في منتصف جملته ما أمكن. */
export function splitMinutes(text: string, size = MINUTES_CHUNK): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n\n', size);
    if (cut < size * 0.5) cut = rest.lastIndexOf('\n', size);
    if (cut < size * 0.5) cut = size;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export interface Member { user_id: number; name: string }
export type AttStatus = 'present' | 'apology' | 'absent';
export type ActionType = 'decision' | 'recommendation' | 'task';

export interface MinutesDraft {
  title: string;
  greg_date: string;        // YYYY-MM-DD أو ''
  hijri_date_raw: string;   // كما فهمه النموذج — للعرض إن تعذّر التحويل
  start_time: string;
  end_time: string;
  location: string;
  location_type: 'in_person' | 'remote';
  attendees: { name: string; title: string; status: AttStatus; user_id: number | null }[];
  agenda: { title: string; body: string }[];
  followups: { text: string; status_note: string }[];
  actions: {
    type: ActionType; text: string; priority: 'high' | 'medium' | 'low'; due_date: string;
    owners: { name: string; user_id: number | null }[];
  }[];
}

const str = (v: unknown, max = 2000): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const text = (v: unknown, max = 8000): string =>
  String(v ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

function attStatus(v: unknown): AttStatus {
  const s = normKey(String(v ?? ''));
  if (/apolog|اعتذ|معتذر/.test(s)) return 'apology';
  if (/absent|غائب|غياب|لم يحضر/.test(s)) return 'absent';
  return 'present';
}

function actionType(v: unknown): ActionType {
  const s = normKey(String(v ?? ''));
  if (/recommend|توصي/.test(s)) return 'recommendation';
  if (/task|مهم|تكليف/.test(s)) return 'task';
  return 'decision';
}

function priority(v: unknown): 'high' | 'medium' | 'low' {
  const s = normKey(String(v ?? ''));
  if (/high|عالي|عاجل/.test(s)) return 'high';
  if (/low|منخفض/.test(s)) return 'low';
  return 'medium';
}

// الألقاب تسبق الأسماء في المحاضر ولا تُكتب في حسابات المنصة
const TITLES = /^(?:الاستاذه?|الاستاذ|ا\.|ا\/|أ\.|الدكتوره?|د\.|د\/|المهندسه?|م\.|الشيخ|سعاده|المشرفه?|المعلمه?|الوكيله?|المدير|المديره)\s*/;
const tokensOf = (name: string): string[] => {
  let k = normKey(name);
  for (let i = 0; i < 3; i++) k = k.replace(TITLES, '');
  return k.replace(/[.،,()]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter((t) => t && t !== 'بن' && t !== 'بنت' && t !== 'ابن');
};

/**
 * عضو المجلس المقصود باسمٍ ورد في المحضر، أو null إن لم يتعيّن واحدٌ بعينه.
 * تطابقٌ تام بعد حذف الألقاب، وإلا اسمٌ تحتوي كلماتُه كلَّ كلمات الآخر (فهد العتيبي ⊂
 * فهد بن عبدالله العتيبي) بكلمتين فأكثر — ولا يُقبل إلا مرشّحٌ وحيد.
 */
export function matchMember(raw: string, members: Member[]): number | null {
  const t = tokensOf(raw);
  if (!t.length) return null;
  const key = t.join(' ');
  const exact = members.filter((m) => tokensOf(m.name).join(' ') === key);
  if (exact.length === 1) return exact[0].user_id;
  if (exact.length > 1) return null;
  const set = new Set(t);
  const cands = members.filter((m) => {
    const mt = tokensOf(m.name);
    if (mt.length < 2 && t.length < 2) return false;
    const small = mt.length <= t.length ? mt : t;
    const big = new Set(mt.length <= t.length ? t : mt);
    return small.length >= 2 && small.every((x) => big.has(x))
      || (mt.length >= 2 && t.length >= 2 && mt[0] === t[0] && mt[mt.length - 1] === t[t.length - 1] && set.has(mt[0]));
  });
  return cands.length === 1 ? cands[0].user_id : null;
}

/** يدمج مخرجات أجزاء النص في مسودة واحدة ويطبّع قيمها ويطابق أسماءها بالأعضاء. */
export function buildDraft(parts: any[], members: Member[]): MinutesDraft {
  const first = (k: string) => parts.map((p) => str(p?.[k], 300)).find(Boolean) || '';
  const hijriRaw = first('hijri_date');
  const greg = parseLooseDate(first('greg_date')) || parseLooseDate(hijriRaw) || '';

  const seenAtt = new Set<string>();
  const attendees: MinutesDraft['attendees'] = [];
  for (const p of parts) for (const a of arr(p?.attendees)) {
    const name = str(a?.name, 120);
    const userId = matchMember(name, members);
    // الشخص نفسه يرد في أكثر من جزء أو بلقبٍ مرة وبدونه أخرى — يُعدّ مرة واحدة
    const k = userId ? 'u' + userId : tokensOf(name).join(' ');
    if (!name || !k || seenAtt.has(k)) continue;
    seenAtt.add(k);
    attendees.push({ name, title: str(a?.title, 120), status: attStatus(a?.status), user_id: userId });
  }

  const agenda = parts.flatMap((p) => arr(p?.agenda))
    .map((a) => ({ title: str(a?.title, 300), body: text(a?.body) }))
    .filter((a) => a.title || a.body)
    .map((a) => ({ title: a.title || a.body.slice(0, 80), body: a.body }));

  const followups = parts.flatMap((p) => arr(p?.followups))
    .map((f) => ({ text: text(f?.text, 1000), status_note: str(f?.status_note, 200) }))
    .filter((f) => f.text);

  const seenAct = new Set<string>();
  const actions: MinutesDraft['actions'] = [];
  for (const p of parts) for (const a of arr(p?.actions)) {
    const t = text(a?.text, 2000);
    const k = normKey(t);
    if (!t || seenAct.has(k)) continue;
    seenAct.add(k);
    const owners = arr(a?.owners).map((o) => str(typeof o === 'string' ? o : o?.name, 120)).filter(Boolean)
      .map((name) => ({ name, user_id: matchMember(name, members) }));
    actions.push({
      type: actionType(a?.type), text: t, priority: priority(a?.priority),
      due_date: parseLooseDate(toEnDigits(str(a?.due_date, 40))) || '', owners,
    });
  }

  const locType = parts.some((p) => /remote|بعد/.test(String(p?.location_type ?? ''))) ? 'remote' : 'in_person';
  return {
    title: first('title'), greg_date: greg, hijri_date_raw: hijriRaw,
    start_time: first('start_time'), end_time: first('end_time'),
    location: first('location'), location_type: locType,
    attendees, agenda, followups, actions,
  };
}
