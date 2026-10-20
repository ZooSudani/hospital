export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export const fail = (status, message) => json({ error: message }, status);

const MAX_BODY = 20000; // 20 كيلوبايت تكفي أي طلب في النظام، وما فوقها يُرفض قبل المعالجة

export async function readJson(request, max = MAX_BODY) {
  try {
    if (Number(request.headers.get('content-length') || 0) > max) return null;
    const text = await request.text();
    if (text.length > max) return null;
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

// عنوان العميل كما تضعه Cloudflare (لا يمكن للعميل تزويره عند المرور عبرها)
export const clientIp = (request) => request.headers.get('cf-connecting-ip') || 'unknown';

export const can = (auth, ...roles) => roles.includes(auth.role);
