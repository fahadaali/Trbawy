// إشعارات الدفع على الويب (Web Push) — تنفيذ كامل بـ WebCrypto داخل Worker.
//
// المعياران المطبَّقان:
//   • RFC 8292 (VAPID): رمز JWT موقَّع بـ ES256 يُعرِّف خادم التطبيق لخدمة الدفع.
//   • RFC 8291 (aes128gcm): تعمية الحمولة بمفتاح مشتق من ECDH بين مفتاح مؤقّت
//     لكل رسالة ومفتاح المتصفح (p256dh) مع سرّ الاشتراك (auth).
//
// نُعمّي الحمولة ولا نكتفي برسالة فارغة: Safari على iPhone لا يضمن تسليم الدفع بلا حمولة،
// والمعمّى يعمل في كل المتصفحات فلا حاجة لمسارين.
import type { Env } from '../types';

// ---------- ترميز Base64URL ----------
export function b64uEncode(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64uDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const utf8 = (s: string) => new TextEncoder().encode(s);
function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ---------- مفاتيح VAPID ----------
export interface VapidKeys {
  publicKey: string;   // نقطة غير مضغوطة (٦٥ بايت) بترميز base64url — يستعملها المتصفح
  privateKey: string;  // مُركّبة d من JWK بترميز base64url
  subject: string;     // mailto: أو https: — تُعرّف مالك الخدمة
}

/** توليد زوج مفاتيح VAPID جديد (يُنفَّذ مرة واحدة ثم يُحفظ). */
export async function generateVapidKeys(subject: string): Promise<VapidKeys> {
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const pub = await crypto.subtle.exportKey('raw', kp.publicKey) as ArrayBuffer;
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey) as JsonWebKey;
  return { publicKey: b64uEncode(pub), privateKey: jwk.d!, subject };
}

// مفتاح التوقيع يُبنى من d مع إحداثيَّي النقطة العامة (x, y) المستخرجَين من المفتاح العام
async function importSigningKey(keys: VapidKeys): Promise<CryptoKey> {
  const raw = b64uDecode(keys.publicKey);
  if (raw.length !== 65 || raw[0] !== 4) throw new Error('مفتاح VAPID العام غير صالح');
  const jwk: JsonWebKey = {
    kty: 'EC', crv: 'P-256', ext: true, key_ops: ['sign'],
    x: b64uEncode(raw.slice(1, 33)),
    y: b64uEncode(raw.slice(33, 65)),
    d: keys.privateKey,
  };
  return await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/** رمز VAPID لجمهور محدَّد (أصل خدمة الدفع) — صالح ١٢ ساعة. */
async function vapidToken(keys: VapidKeys, audience: string): Promise<string> {
  const header = b64uEncode(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64uEncode(utf8(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: keys.subject,
  })));
  const signingInput = `${header}.${payload}`;
  const key = await importSigningKey(keys);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(signingInput));
  return `${signingInput}.${b64uEncode(sig)}`;   // WebCrypto تُخرج r||s وهو ما يطلبه JWS
}

// ---------- تعمية الحمولة (RFC 8291) ----------
export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;   // مفتاح المتصفح العام (base64url)
  auth: string;     // سرّ الاشتراك ١٦ بايت (base64url)
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource }, key, length * 8);
  return new Uint8Array(bits);
}

async function encryptPayload(sub: PushSubscriptionKeys, plaintext: Uint8Array): Promise<Uint8Array> {
  const uaPublic = b64uDecode(sub.p256dh);
  const authSecret = b64uDecode(sub.auth);

  // مفتاح مؤقّت لهذه الرسالة وحدها (سرّية أمامية)
  const eph = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  // أنواع Workers تسمّي الحقل $public؛ والمواصفة القياسية public — نمرّر الاثنين
  const ecdhParams = { name: 'ECDH', public: uaKey, $public: uaKey } as any;
  const shared = new Uint8Array(await crypto.subtle.deriveBits(ecdhParams, eph.privateKey, 256));

  // IKM = HKDF(auth, ECDH, "WebPush: info" ‖ 0 ‖ ua_public ‖ as_public)
  const ikm = await hkdf(authSecret, shared,
    concat(utf8('WebPush: info'), new Uint8Array([0]), uaPublic, asPublic), 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, concat(utf8('Content-Encoding: aes128gcm'), new Uint8Array([0])), 16);
  const nonce = await hkdf(salt, ikm, concat(utf8('Content-Encoding: nonce'), new Uint8Array([0])), 12);

  // سجل واحد: النص مع فاصل الحشو 0x02 (آخر سجل)
  const aesKey = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource }, aesKey, concat(plaintext, new Uint8Array([2])) as BufferSource));

  // الترويسة: salt(16) ‖ rs(4) ‖ idlen(1) ‖ as_public(65)
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

export interface PushResult {
  ok: boolean;
  status: number;  // ٠ = لم يصل الطلب إلى الخدمة أصلًا (شبكة أو مهلة)
  gone: boolean;   // اشتراك بطل (404/410) — يُحذف من القاعدة
  detail?: string; // ما قالته الخدمة عند الرفض — وهو كل ما نملكه للتشخيص
}

/**
 * سبب الرفض كما نطقت به الخدمة، مقتضبًا. ردودها أسطر قصيرة:
 * أبل `{"reason":"BadJwtToken"}`، وفَيَربيس `{"error":{"message":"…"}}`،
 * وموزيلا `{"errno":109,"message":"…"}` — فنلتقط الحقل الدالّ ونترك الباقي.
 */
async function refusalReason(res: Response): Promise<string | undefined> {
  try {
    const text = (await res.text()).trim().replace(/\s+/g, ' ');
    if (!text) return undefined;
    try {
      const j: any = JSON.parse(text);
      const r = j?.reason || j?.message || j?.error?.message || j?.error?.status;
      if (r) return String(r).slice(0, 160);
    } catch { /* ليس JSON — نأخذ النص كما هو */ }
    return text.slice(0, 160);
  } catch { return undefined; }
}

/** إرسال رسالة دفع واحدة إلى اشتراك واحد. */
export async function sendPush(
  keys: VapidKeys, sub: PushSubscriptionKeys, payload: unknown, ttl = 86400,
): Promise<PushResult> {
  const body = await encryptPayload(sub, utf8(JSON.stringify(payload)));
  const audience = new URL(sub.endpoint).origin;
  const token = await vapidToken(keys, audience);

  // مهلة قصوى حتى لا يعلّق طلب المستخدم بسبب بطء خدمة الدفع
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `vapid t=${token}, k=${keys.publicKey}`,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        'TTL': String(ttl),
        'Urgency': 'normal',
      },
      body: body as BodyInit,
      signal: ctl.signal,
    });
    const out: PushResult = {
      ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410,
    };
    if (!res.ok) out.detail = await refusalReason(res);
    return out;
  } catch (e: any) {
    console.error('push send failed (non-fatal)', e);
    return {
      ok: false, status: 0, gone: false,
      detail: e?.name === 'AbortError' ? 'انتهت المهلة قبل ردّ الخدمة'
        : String(e?.message || e).slice(0, 160),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- مفاتيح المنصة: من البيئة أو مولَّدة مرة وتُحفظ ----------
let cachedKeys: VapidKeys | null | undefined;

/**
 * أصل الموقع كما وصل به الطلب — يصلح قيمةً لحقل `sub` في رمز VAPID.
 * الحقل يجب أن يكون عنوان `https:` أو `mailto:` صالحًا تتعرّف به خدمةُ الدفع على
 * صاحب الخدمة، وبعضُ الخدمات (أبل خاصة) تتشدّد فيه فترفض الرمز كلَّه إن أنكرته.
 * فأصلُ الموقع أصدقُ من بريد متخيَّل على نطاق لا وجود له.
 */
let siteOrigin: string | null = null;
export function rememberSiteOrigin(url: string): void {
  if (siteOrigin) return;
  try {
    const o = new URL(url).origin;
    if (o.startsWith('https://')) siteOrigin = o;
  } catch { /* عنوان غير صالح — نتركه */ }
}

/** إسقاط المفاتيح المخبّأة ليُعاد قراءتها من القاعدة (بعد رفض الخدمة اعتمادها). */
export function forgetVapidKeys(): void { cachedKeys = undefined; }

/**
 * حقل `sub` في رمز VAPID — وهو ما تتعرّف به خدمةُ الدفع على صاحب الخدمة.
 *
 * ولمسار الكرون هنا شأنٌ خاص: العزلة المجدولة لا يصلها طلبٌ يُعرَف منه أصلُ الموقع،
 * فكانت توقّع بـ`mailto:no-reply@tarbawi.local` — نطاقٌ لا وجود له، وبعض الخدمات
 * تتشدّد في هذا الحقل فترفض الرمز كلَّه. والتذكيراتُ اليومية كلها تمرّ من هناك.
 * فنحفظ الأصل حين يُعرف من طلبٍ حقيقي، ونقرأه في المسار الذي لا يعرفه.
 */
async function resolveSubject(env: Env): Promise<string> {
  if (env.VAPID_SUBJECT) return env.VAPID_SUBJECT;
  try {
    const row = await env.DB.prepare('SELECT site_origin FROM settings WHERE id = 1')
      .first<{ site_origin: string | null }>();
    if (siteOrigin) {
      if (row?.site_origin !== siteOrigin) {
        await env.DB.prepare(
          `INSERT INTO settings (id, site_origin) VALUES (1, ?)
           ON CONFLICT(id) DO UPDATE SET site_origin = excluded.site_origin`,
        ).bind(siteOrigin).run();
      }
      return siteOrigin;
    }
    if (row?.site_origin) return row.site_origin;
  } catch { /* العمود أو الجدول غير موجود بعد — نمضي إلى البديل */ }
  return siteOrigin || 'mailto:no-reply@tarbawi.local';
}

/**
 * مفاتيح الدفع لهذا النشر.
 * الأفضلية لأسرار البيئة (VAPID_*)، وإلا تُولَّد مرة واحدة وتُحفظ في الإعدادات
 * حتى تعمل الإشعارات دون خطوات إعداد يدوية. تغيير المفاتيح يُبطل الاشتراكات القائمة.
 */
export async function getVapidKeys(env: Env): Promise<VapidKeys | null> {
  if (cachedKeys !== undefined) return cachedKeys;
  const subject = await resolveSubject(env);
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    cachedKeys = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject };
    return cachedKeys;
  }
  try {
    const read = () => env.DB.prepare(
      'SELECT push_public_key AS pub, push_private_key AS prv FROM settings WHERE id = 1',
    ).first<{ pub: string | null; prv: string | null }>();
    const row = await read();
    if (row?.pub && row?.prv) {
      cachedKeys = { publicKey: row.pub, privateKey: row.prv, subject };
      return cachedKeys;
    }
    // التوليد الأول قد يتسابق عليه طلبان فيولّد كلٌّ زوجًا. نكتب بلا استبدال ثم
    // نقرأ ما استقرّ في القاعدة فنتّفق على زوج واحد: زوجان مختلفان يعنيان أن
    // المتصفح اشترك بمفتاح والخادمَ يوقّع بغيره — فتُرفض كل الإشعارات بلا استثناء.
    const fresh = await generateVapidKeys(subject);
    await env.DB.prepare(
      `INSERT INTO settings (id, push_public_key, push_private_key) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         push_public_key  = COALESCE(settings.push_public_key,  excluded.push_public_key),
         push_private_key = COALESCE(settings.push_private_key, excluded.push_private_key)`,
    ).bind(fresh.publicKey, fresh.privateKey).run();
    const stored = await read();
    cachedKeys = stored?.pub && stored?.prv
      ? { publicKey: stored.pub, privateKey: stored.prv, subject }
      : fresh;
    return cachedKeys;
  } catch (e) {
    console.error('vapid keys unavailable', e);
    cachedKeys = null;
    return null;
  }
}
