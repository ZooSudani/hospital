// كلمات المرور: PBKDF2-SHA256 (100000 دورة، الحد الأقصى في Workers)
// التوكن: JWT بصيغة  HS256 عبر WebCrypto
const enc = new TextEncoder();
const ITERATIONS = 100000;

const toB64u = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const fromB64u = (s) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  );
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toB64u(salt)}$${toB64u(hash)}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, iter, salt, hash] = String(stored).split('$');
  if (scheme !== 'pbkdf2') return false;
  const got = await pbkdf2(password, fromB64u(salt), Number(iter));
  return sameBytes(got, fromB64u(hash));
}

async function hmacKey(secret, usages) {
  if (!secret || String(secret).length < 32) throw new Error('JWT_SECRET ضعيف: يجب ألا يقل عن 32 حرفًا');
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages);
}

export async function signToken(claims, secret, ttlSeconds = 8 * 3600) {
  const header = toB64u(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = toB64u(enc.encode(JSON.stringify({ ...claims, exp })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret, ['sign']), enc.encode(`${header}.${payload}`));
  return `${header}.${payload}.${toB64u(sig)}`;
}

export async function verifyToken(token, secret) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  try {
    const ok = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret, ['verify']),
      fromB64u(parts[2]),
      enc.encode(`${parts[0]}.${parts[1]}`)
    );
    if (!ok) return null;
    const claims = JSON.parse(new TextDecoder().decode(fromB64u(parts[1])));
    if (!claims.exp || claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

// مقارنة بزمن ثابت (لا يتسرب منها طول التطابق)
export async function safeEqual(a, b) {
  const [x, y] = await Promise.all(
    [a, b].map(async (v) => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(v ?? '')))))
  );
  return sameBytes(x, y);
}

const COMMON = new Set([
  '12345678', '123456789', '1234567890', '11111111', '00000000', 'password', 'password1', 'password123',
  'qwertyui', 'qwerty123', 'abcd1234', 'iloveyou', 'admin123', 'admin1234', '12341234', '87654321',
]);

// سياسة كلمات المرور: ترجع نص المشكلة أو null إن كانت مقبولة
export function passwordProblem(pw, ...personal) {
  const p = String(pw ?? '');
  if (p.length < 8) return 'كلمة المرور 8 أحرف على الأقل';
  if (p.length > 128) return 'كلمة المرور طويلة جدًا';
  if (/^(.)\1+$/.test(p)) return 'كلمة المرور بسيطة جدًا';
  const low = p.toLowerCase();
  if (COMMON.has(low)) return 'كلمة المرور شائعة وسهلة التخمين';
  for (const x of personal) {
    const t = String(x ?? '').toLowerCase().split('@')[0];
    if (t.length >= 4 && low.includes(t)) return 'لا تضع اسمك أو بريدك داخل كلمة المرور';
  }
  return null;
}
