// عامل الخدمة: يجعل التطبيق قابلًا للتثبيت ويفتح بلا إنترنت.
// - الواجهة (HTML وJS وCSS): الشبكة أولًا بمهلة قصيرة ثم النسخة المحفوظة، فتصل التحديثات فور توفر الاتصال ويعمل التطبيق عند انقطاعه.
// - طلبات /api لا تُحفظ هنا أبدًا (بيانات المرضى لا تُخزَّن في ذاكرة المتصفح الدائمة). التعامل مع انقطاع الإنترنت يتم داخل التطبيق.
const CACHE = 'hms-shell-v1';
const SHELL = ['/', '/app.js', '/style.css', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];
const SLOW_NETWORK_MS = 4000; // شبكة بطيئة: نعرض المحفوظ بعد 4 ثوانٍ ونكمل التحديث في الخلفية

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function networkFirst(request) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (res) => { if (!settled) { settled = true; resolve(res); } };
    const timer = setTimeout(async () => { const hit = await caches.match(request); if (hit) finish(hit); }, SLOW_NETWORK_MS);
    fetch(request)
      .then((res) => {
        clearTimeout(timer);
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(request, copy)); }
        finish(res);
      })
      .catch(async () => {
        clearTimeout(timer);
        const hit = (await caches.match(request)) || (request.mode === 'navigate' ? await caches.match('/') : null);
        finish(hit || Response.error());
      });
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(networkFirst(request));
});
