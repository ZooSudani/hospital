// خادم محلي يشغّل معالجات Pages Functions الحقيقية فوق SQLite، لاختبار الواجهة في متصفح فعلي.
import http from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
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
import * as tenantStaff from '../../functions/api/platform/tenants/[id]/staff.js';
import * as tenantStaffOne from '../../functions/api/platform/tenants/[id]/staff/[uid].js';
import * as platformAudit from '../../functions/api/platform/audit.js';
import * as accountPw from '../../functions/api/account/password.js';
import * as meApi from '../../functions/api/me.js';
import * as invoices from '../../functions/api/invoices/index.js';
import * as invoiceOne from '../../functions/api/invoices/[id].js';
import * as invoicePay from '../../functions/api/invoices/[id]/pay.js';
import * as invoicePayments from '../../functions/api/invoices/[id]/payments.js';
import * as reportSummary from '../../functions/api/reports/summary.js';
import * as visits from '../../functions/api/patients/[id]/visits.js';
import * as staffPerms from '../../functions/api/staff/[id]/permissions.js';
import * as platformPerms from '../../functions/api/platform/tenants/[id]/staff/[uid]/permissions.js';

const env = { DB: makeDb(), JWT_SECRET: 'ui-test-secret-'.padEnd(48, 'x'), SETUP_KEY: 'ui-key' };
const routes = [
  [/^\/api\/setup$/, setup], [/^\/api\/auth\/login$/, login], [/^\/api\/platform\/tenants$/, tenants],
  [/^\/api\/patients$/, patients], [/^\/api\/patients\/([^/]+)$/, patient],
  [/^\/api\/staff$/, staff], [/^\/api\/staff\/([^/]+)$/, staffOne],
  [/^\/api\/appointments$/, appts], [/^\/api\/appointments\/([^/]+)$/, apptOne], [/^\/api\/audit$/, audit], [/^\/api\/me$/, meApi],
  [/^\/api\/invoices$/, invoices], [/^\/api\/invoices\/([^/]+)$/, invoiceOne], [/^\/api\/invoices\/([^/]+)\/pay$/, invoicePay], [/^\/api\/invoices\/([^/]+)\/payments$/, invoicePayments], [/^\/api\/reports\/summary$/, reportSummary],
  [/^\/api\/patients\/([^/]+)\/visits$/, visits], [/^\/api\/staff\/([^/]+)\/permissions$/, staffPerms],
  [/^\/api\/platform\/tenants\/([^/]+)\/staff\/([^/]+)\/permissions$/, platformPerms], [/^\/api\/platform\/tenants\/([^/]+)$/, tenantOne], [/^\/api\/platform\/tenants\/([^/]+)\/staff$/, tenantStaff], [/^\/api\/platform\/tenants\/([^/]+)\/staff\/([^/]+)$/, tenantStaffOne], [/^\/api\/platform\/audit$/, platformAudit], [/^\/api\/account\/password$/, accountPw],
];

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) {
    // ملفات ثابتة مع رؤوس _headers نفسها التي ستطبقها Cloudflare Pages
    const types = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', png: 'image/png', webmanifest: 'application/manifest+json' };
    const files = { '/': ['index.html', types.html] };
    for (const name of readdirSync(new URL('../../public/', import.meta.url))) {
      if (name === '_headers') continue;
      files['/' + name] = [name, types[name.split('.').pop()] || 'application/octet-stream'];
    }
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
  for (const [re, mod] of routes) { const m = url.pathname.match(re); if (m) { handler = mod['onRequest' + req.method[0] + req.method.slice(1).toLowerCase()]; params = { id: m[1], uid: m[2] }; break; } }
  const data = {};
  const out = handler
    ? await middleware({ request, env, data, next: async () => handler({ request, env, data, params }) })
    : new Response('{"error":"not found"}', { status: 404, headers: { 'content-type': 'application/json' } });
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
}).listen(8799, () => console.log('ready'));
