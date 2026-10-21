// خادم محلي يشغّل معالجات Pages Functions الحقيقية فوق SQLite، لاختبار الواجهة في متصفح فعلي.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { makeDb } from '../d1-shim.js';
import { onRequest as middleware } from '../../functions/_middleware.js';
import * as setup from '../../functions/api/setup.js';
import * as login from '../../functions/api/auth/login.js';
import * as tenants from '../../functions/api/platform/tenants.js';
import * as patients from '../../functions/api/patients/index.js';
import * as patient from '../../functions/api/patients/[id].js';
import * as staff from '../../functions/api/staff/index.js';
import * as staffOne from '../../functions/api/staff/[id].js';
import * as appts from '../../functions/api/appointments/index.js';
import * as apptOne from '../../functions/api/appointments/[id].js';
import * as audit from '../../functions/api/audit.js';
import * as tenantOne from '../../functions/api/platform/tenants/[id].js';
import * as accountPw from '../../functions/api/account/password.js';

const env = { DB: makeDb(), JWT_SECRET: 'ui-test-secret-'.padEnd(48, 'x'), SETUP_KEY: 'ui-key' };
const routes = [
  [/^\/api\/setup$/, setup], [/^\/api\/auth\/login$/, login], [/^\/api\/platform\/tenants$/, tenants],
  [/^\/api\/patients$/, patients], [/^\/api\/patients\/([^/]+)$/, patient],
  [/^\/api\/staff$/, staff], [/^\/api\/staff\/([^/]+)$/, staffOne],
  [/^\/api\/appointments$/, appts], [/^\/api\/appointments\/([^/]+)$/, apptOne], [/^\/api\/audit$/, audit], [/^\/api\/platform\/tenants\/([^/]+)$/, tenantOne], [/^\/api\/account\/password$/, accountPw],
];

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) {
    // ملفات ثابتة مع رؤوس _headers نفسها التي ستطبقها Cloudflare Pages
    const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
    const f = files[url.pathname];
    if (!f) { res.writeHead(404); return res.end('not found'); }
    const headers = { 'content-type': f[1] };
    for (const line of readFileSync(new URL('../../public/_headers', import.meta.url), 'utf8').split('\n').slice(1)) {
      const m = line.match(/^\s+([\w-]+):\s*(.+)$/); if (m) headers[m[1]] = m[2];
    }
    res.writeHead(200, headers);
    return res.end(readFileSync(new URL('../../public/' + f[0], import.meta.url)));
  }
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
  let handler, params = {};
  for (const [re, mod] of routes) { const m = url.pathname.match(re); if (m) { handler = mod['onRequest' + req.method[0] + req.method.slice(1).toLowerCase()]; params = { id: m[1] }; break; } }
  const data = {};
  const out = handler
    ? await middleware({ request, env, data, next: async () => handler({ request, env, data, params }) })
    : new Response('{"error":"not found"}', { status: 404, headers: { 'content-type': 'application/json' } });
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
}).listen(8799, () => console.log('ready'));
