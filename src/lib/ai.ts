// مزايا الذكاء الاصطناعي عبر Workers AI.
// كل الدوال تتعطّل بلطف إن لم يكن الربط مُهيّأ (تُرجع خطأ واضحًا بدل الانهيار).
import type { Env } from '../types';

const TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const TEXT_MODEL_FALLBACK = '@cf/meta/llama-3.1-8b-instruct';
const AUDIO_MODEL = '@cf/openai/whisper-large-v3-turbo';

export class AiUnavailable extends Error {
  constructor() { super('خدمة الذكاء الاصطناعي غير مُهيّأة على هذا النشر'); }
}

export function aiEnabled(env: Env): boolean {
  return !!env.AI && typeof env.AI.run === 'function';
}

// استدعاء نموذج نصّي مع تعليمات نظام عربية، ومحاولة نموذج بديل عند الإخفاق.
export async function aiText(
  env: Env, system: string, user: string, maxTokens = 1200,
): Promise<string> {
  if (!aiEnabled(env)) throw new AiUnavailable();
  const messages = [
    { role: 'system', content: system + '\n\nأجب بالعربية الفصحى دائمًا، وبأسلوب إداري رسمي موجز.' },
    { role: 'user', content: user },
  ];
  for (const model of [TEXT_MODEL, TEXT_MODEL_FALLBACK]) {
    try {
      const res: any = await env.AI!.run(model, { messages, max_tokens: maxTokens, temperature: 0.3 });
      const out = (res?.response ?? res?.result?.response ?? '').toString().trim();
      if (out) return out;
    } catch (e) {
      console.error('AI model failed', model, e);
    }
  }
  throw new Error('تعذّر توليد النص — حاول مرة أخرى');
}

// استخراج JSON من مخرجات النموذج (قد تأتي محاطة بشرح أو أسوار كود)
export function extractJson<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start < 0) return null;
  // نحاول من أول قوس حتى آخر قوس مطابق
  const opener = candidate[start];
  const closer = opener === '[' ? ']' : '}';
  const end = candidate.lastIndexOf(closer);
  if (end <= start) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)) as T; }
  catch { return null; }
}

// تفريغ تسجيل صوتي إلى نص
export async function aiTranscribe(env: Env, audio: ArrayBuffer): Promise<string> {
  if (!aiEnabled(env)) throw new AiUnavailable();
  const bytes = [...new Uint8Array(audio)];
  const res: any = await env.AI!.run(AUDIO_MODEL, { audio: bytes, language: 'ar', task: 'transcribe' });
  const text = (res?.text ?? res?.result?.text ?? '').toString().trim();
  if (!text) throw new Error('تعذّر تفريغ التسجيل');
  return text;
}
