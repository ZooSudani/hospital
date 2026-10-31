const $ = (id) => document.getElementById(id);
let session = JSON.parse(sessionStorage.getItem('session') || 'null');

// إشعار ثابت أعلى الشاشة (يراه المستخدم مهما نزل في الصفحة)؛ يختفي وحده، ويُغلق باللمس
let sayTimer;
function say(text, kind = '') {
  const m = $('msg');
  clearTimeout(sayTimer);
  m.textContent = text;
  m.className = text ? `show ${kind}` : '';
  if (text) sayTimer = setTimeout(() => { m.className = ''; }, kind === 'err' ? 9000 : 4500);
}
$('msg').onclick = () => say('');

// نافذة تأكيد أو إدخال داخل الصفحة (بدل prompt وconfirm التي تُظهر كلمات المرور نصًا مكشوفًا ولا تناسب الجوال)
// ترجع: true عند التأكيد بلا حقل، أو النص المُدخل، أو null عند الإلغاء.
function ask({ title, text = '', input = null, value = '', okText = 'تأكيد' }) {
  return new Promise((resolve) => {
    const field = $('modal-input'), showBox = $('modal-show');
    $('modal-title').textContent = title; $('modal-text').textContent = text; $('modal-text').hidden = !text;
    field.hidden = !input; $('modal-show-wrap').hidden = input !== 'password';
    field.type = input === 'password' ? 'password' : input === 'number' ? 'number' : 'text';
    field.value = value; showBox.checked = false; $('modal-ok').textContent = okText;
    $('modal').hidden = false;
    (input ? field : $('modal-ok')).focus();
    const finish = (v) => {
      $('modal').hidden = true;
      $('modal-ok').removeEventListener('click', ok); $('modal-cancel').removeEventListener('click', cancel);
      document.removeEventListener('keydown', key); showBox.removeEventListener('change', toggle);
      resolve(v);
    };
    const ok = () => finish(input ? field.value : true);
    const cancel = () => finish(null);
    const key = (e) => { if (e.key === 'Escape') cancel(); else if (e.key === 'Enter' && input) ok(); };
    const toggle = () => { if (input === 'password') field.type = showBox.checked ? 'text' : 'password'; };
    $('modal-ok').addEventListener('click', ok); $('modal-cancel').addEventListener('click', cancel);
    document.addEventListener('keydown', key); showBox.addEventListener('change', toggle);
  });
}

// ===== الاتصال بالخادم، مع تحمّل ضعف الإنترنت =====
// عند انقطاع الاتصال تُعرض آخر نسخة من القوائم التي حمّلها المستخدم (في sessionStorage فقط، وتُمسح عند الخروج أو إغلاق التبويب)،
// ويُمنع الحفظ برسالة واضحة. السجل الطبي لا يُخزَّن أبدًا لأنه الأكثر حساسية.
const CACHEABLE = [/^\/api\/appointments\?/, /^\/api\/patients(\?|$)/, /^\/api\/invoices(\?|$)/, /^\/api\/reports\/summary/, /^\/api\/staff\?role=doctor$/];
const cacheKey = (path) => `c:${session?.user?.id || '-'}:${path}`;
const isCacheable = (path) => CACHEABLE.some((re) => re.test(path));
function clearCache() { Object.keys(sessionStorage).filter((k) => k.startsWith('c:')).forEach((k) => sessionStorage.removeItem(k)); }
function setOfflineBar(text) { const bar = $('offline-bar'); bar.textContent = text || ''; bar.hidden = !text; }
const hhmm = (t) => new Date(t + 2 * 3600 * 1000).toISOString().slice(11, 16);
const NET_TIMEOUT = 20000; // اتصال معلّق أكثر من 20 ثانية يُعامل كانقطاع

async function api(path, { method = 'GET', body } = {}) {
  const isGet = method === 'GET';
  let res;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), NET_TIMEOUT);
    try {
      res = await fetch(path, {
        method,
        headers: { 'content-type': 'application/json', ...(session ? { authorization: 'Bearer ' + session.token } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } finally { clearTimeout(timer); }
  } catch {
    if (isGet && isCacheable(path)) {
      try {
        const c = JSON.parse(sessionStorage.getItem(cacheKey(path)) || 'null');
        if (c) { setOfflineBar(`غير متصل بالإنترنت. تُعرض آخر بيانات حُمّلت (${hhmm(c.t)})، ولا يمكن حفظ تعديلات الآن.`); return c.data; }
      } catch { /* نسخة تالفة: تُتجاهل */ }
    }
    setOfflineBar('غير متصل بالإنترنت. تحقق من الاتصال ثم أعد المحاولة.');
    throw new Error('لا يوجد اتصال بالخادم. تحقق من الإنترنت ثم أعد المحاولة');
  }
  setOfflineBar('');
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json().catch(() => ({})) : null;
  if (res.status === 401 && session) { logout(); say('انتهت الجلسة. سجّل الدخول مرة أخرى', 'err'); }
  if (!isJson) throw new Error('ردّ الخادم غير متوقع. غالبًا ملف ناقص في النشر: ' + path.split('?')[0]);
  if (!res.ok) throw new Error(data.error || 'حدث خطأ غير متوقع');
  if (isGet && isCacheable(path)) { try { sessionStorage.setItem(cacheKey(path), JSON.stringify({ t: Date.now(), data })); } catch { /* الذاكرة ممتلئة */ } }
  return data;
}

// صلاحيات المستخدم تأتي من الخادم (الدخول و/api/me) وهي المصدر الوحيد: لا قوائم أدوار مكررة هنا.
// الخادم يفرضها فعليًا، وهذه الدالة تمنع إظهار ما لا يخص المستخدم.
const has = (perm) => !!session && Array.isArray(session.permissions) && session.permissions.includes(perm);
const adminMode = () => location.hash === '#admin';
let currentFile = null;      // المريض المفتوح سجله الطبي
let editingPatient = null;   // المريض الذي يجري تعديله

const roleNames = { platform_admin: 'مدير المنصة', admin: 'مدير المستشفى', doctor: 'طبيب', reception: 'استقبال', accountant: 'محاسب' };

function render() {
  const on = !!session;
  const tenant = on && !!session.tenant;
  $('s-login').hidden = on; $('logout').hidden = !on;
  $('setup-link').hidden = on || !adminMode();
  $('platform-hint').hidden = !adminMode();
  if (on || !adminMode()) $('s-setup').hidden = true;
  $('s-platform').hidden = !(on && session.user.role === 'platform_admin');
  $('s-patients').hidden = !(tenant && has('patients.read'));
  $('p-form').hidden = !(tenant && (has('patients.create') || has('patients.update')));
  $('p-title').textContent = editingPatient ? 'تعديل بيانات المريض' : (has('patients.create') ? 'تسجيل مريض' : 'تعديل بيانات مريض (اختر «تعديل» من القائمة)');
  if (!(tenant && has('visits.read'))) currentFile = null;
  $('s-pfile').hidden = !currentFile;
  $('pf-form').hidden = !has('visits.write');
  $('s-appts').hidden = !(tenant && has('appointments.read'));
  $('a-form').hidden = !(tenant && has('appointments.book'));
  $('s-invoices').hidden = !(tenant && has('invoices.read'));
  $('inv-form').hidden = !(tenant && has('invoices.create'));
  $('s-reports').hidden = !(tenant && has('reports.view'));
  $('s-staff').hidden = !(tenant && has('staff.manage'));
  $('s-audit').hidden = !(tenant && has('audit.view'));
  $('s-account').hidden = !on;
  $('s-paudit').hidden = !(on && session.user.role === 'platform_admin');
  $('appts-th').textContent = has('appointments.all') || !on ? 'المريض والطبيب' : 'المريض';
  $('who').textContent = on ? `${session.user.name} · ${roleNames[session.user.role]}${session.tenant ? ' · ' + session.tenant.name : ''}` : 'لم تسجل الدخول';
  if (!$('s-platform').hidden) loadTenants();
  if (!$('s-patients').hidden) loadPatients();
  if (!$('s-staff').hidden) loadStaff();
  if (!$('s-audit').hidden) loadAudit();
  if (!$('s-paudit').hidden) loadPlatformAudit();
  if (!$('s-appts').hidden) { initApptDates(); loadAppts(); }
  if (!$('a-form').hidden || !$('inv-form').hidden) loadPatientOptions();
  if (!$('s-invoices').hidden) loadInvoices();
  document.querySelectorAll('[data-jump]').forEach((b) => { b.hidden = $(b.dataset.jump).hidden; }); // زر «+ جديد» لمن يملك صلاحية النموذج فقط
  buildTabs();
}

// ===== التبويبات: قسم واحد في كل مرة، والتبويبات المتاحة تتبع الصلاحيات =====
const SECTION_TAB = { 's-platform': 'hospitals', 's-paudit': 'activity', 's-appts': 'appts', 's-patients': 'patients', 's-pfile': 'patients', 's-invoices': 'invoices', 's-reports': 'reports', 's-staff': 'team', 's-audit': 'team', 's-account': 'account' };
const TAB_LABELS = { hospitals: 'المستشفيات', activity: 'النشاط', appts: 'المواعيد', patients: 'المرضى', invoices: 'الفواتير', reports: 'التقارير', team: 'الفريق', account: 'حسابي' };
const TAB_ORDER = ['hospitals', 'appts', 'patients', 'invoices', 'reports', 'team', 'activity', 'account']; // ترتيب العرض
const DEFAULT_TAB = ['hospitals', 'appts', 'invoices', 'patients', 'reports', 'team', 'activity', 'account']; // أولوية التبويب الافتتاحي: المواعيد، وللمحاسب الفواتير
let currentTab = null;
let permHidden = {}; // الأقسام المخفية بسبب الصلاحيات (قبل اختيار التبويب)

function buildTabs() {
  permHidden = Object.fromEntries(Object.keys(SECTION_TAB).map((id) => [id, $(id).hidden]));
  const open = TAB_ORDER.filter((t) => Object.entries(SECTION_TAB).some(([id, tab]) => tab === t && id !== 's-pfile' && !permHidden[id]));
  if (!session || !open.length) { currentTab = null; $('tabs').innerHTML = ''; $('tabs').hidden = true; document.body.classList.remove('has-tabs'); return; }
  if (!open.includes(currentTab)) currentTab = DEFAULT_TAB.find((t) => open.includes(t));
  $('tabs').innerHTML = open.map((t) => `<button data-tab="${t}">${TAB_LABELS[t]}</button>`).join('');
  $('tabs').hidden = false; document.body.classList.add('has-tabs');
  applyTab();
}

function applyTab() {
  for (const [id, tab] of Object.entries(SECTION_TAB)) {
    const byPerm = id === 's-pfile' ? !(currentFile && has('visits.read')) : permHidden[id];
    $(id).hidden = byPerm || tab !== currentTab;
  }
  $('tabs').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === currentTab));
  if (currentTab === 'reports' && !$('s-reports').hidden) loadReports();
}

$('tabs').onclick = (ev) => {
  const b = ev.target.closest('button'); if (!b) return;
  currentTab = b.dataset.tab; applyTab(); window.scrollTo(0, 0);
};

function logout() { session = null; currentFile = null; editingPatient = null; currentTab = null; sessionStorage.removeItem('session'); clearCache(); render(); }

$('logout').onclick = logout;
$('toggle-setup').onclick = () => { $('s-setup').hidden = !$('s-setup').hidden; };

$('do-login').onclick = async () => {
  try {
    session = await api('/api/auth/login', { method: 'POST', body: { slug: $('slug').value, email: $('email').value, password: $('password').value } });
    sessionStorage.setItem('session', JSON.stringify(session));
    $('password').value = ''; say(''); render();
  } catch (e) { say(e.message, 'err'); }
};

$('do-setup').onclick = async () => {
  try {
    await api('/api/setup', { method: 'POST', body: { key: $('su-key').value, name: $('su-name').value, email: $('su-email').value, password: $('su-pass').value } });
    say('تم إنشاء مدير المنصة. سجّل الدخول برمز platform', 'ok'); $('s-setup').hidden = true; $('slug').value = 'platform'; $('email').value = $('su-email').value;
  } catch (e) { say(e.message, 'err'); }
};

// ===== محرّر الصلاحيات لكل شخص =====
// يعرض كتالوج الصلاحيات من الخادم، ويحسب الفرق عن افتراضيات الدور (منح/سحب) عند الحفظ.
async function openPermEditor(box, url, afterSave) {
  const info = await api(url);
  const checked = new Set(info.effective);
  const grantable = new Set(info.grantable);
  const groups = {};
  for (const p of info.catalog) (groups[p.group] ||= []).push(p);
  const body = Object.entries(groups).map(([g, list]) => `<div class="pgroup"><b>${esc(g)}</b>${list.map((p) => {
    const isDefault = info.defaults.includes(p.key);
    const toggle = info.editable && (isDefault || grantable.has(p.key)); // سحب ما يملكه الدور مسموح دائمًا، ومنح الحساسة مقيَّد
    const custom = isDefault !== checked.has(p.key) ? ' <span class="badge ok">مخصص</span>' : '';
    return `<label class="perm"><input type="checkbox" data-perm="${esc(p.key)}" ${checked.has(p.key) ? 'checked' : ''} ${toggle ? '' : 'disabled'}><span>${esc(p.label)}${p.restricted ? ' <small>(حساسة)</small>' : ''}${custom}</span></label>`;
  }).join('')}</div>`).join('');
  box.hidden = false;
  box.innerHTML = `<h3>صلاحيات ${esc(info.name)} (${esc(roleNames[info.role] || info.role)})</h3>${body}` + (info.editable
    ? '<div class="actions"><button class="mini" data-act="perm-save">حفظ الصلاحيات</button><button class="mini" data-act="perm-reset">استعادة الافتراضي</button><button class="mini" data-act="perm-close">إغلاق</button></div>'
    : '<p><small>لا يمكن تعديل هذه الصلاحيات من حسابك.</small></p><div class="actions"><button class="mini" data-act="perm-close">إغلاق</button></div>');
  box.onclick = async (ev) => {
    const b = ev.target.closest('button'); if (!b || !b.dataset.act || !b.dataset.act.startsWith('perm-')) return;
    ev.stopPropagation();
    try {
      if (b.dataset.act === 'perm-close') { box.hidden = true; box.innerHTML = ''; return; }
      let payload = {};
      if (b.dataset.act === 'perm-save') {
        const grant = [], deny = [];
        box.querySelectorAll('input[data-perm]').forEach((c) => {
          const isDefault = info.defaults.includes(c.dataset.perm);
          if (c.checked && !isDefault) grant.push(c.dataset.perm);
          if (!c.checked && isDefault) deny.push(c.dataset.perm);
        });
        payload = { grant, deny };
      }
      await api(url, { method: 'PUT', body: payload });
      say(b.dataset.act === 'perm-reset' ? 'أُعيدت الصلاحيات إلى الافتراضي' : 'تم حفظ الصلاحيات', 'ok');
      await openPermEditor(box, url, afterSave);
      if (afterSave) afterSave();
    } catch (e) { say(e.message, 'err'); }
  };
}

// ===== لوحة مدير المنصة =====
let openTenant = null; // المستشفى المفتوح لإدارة موظفيه

async function loadTenants() {
  try {
    const { tenants } = await api('/api/platform/tenants');
    $('tenants').innerHTML = tenants.map((t) => {
      const on = t.status === 'active';
      const id = esc(t.id);
      return `<div class="card${on ? '' : ' off'}">
        <div class="card-head"><b>${esc(t.name)}</b><span class="badge ${on ? 'ok' : 'bad'}">${on ? 'فعّال' : 'موقوف'}</span></div>
        <small dir="ltr">${esc(t.slug)} · ${esc(t.admin_email || 'بلا مدير')}</small>
        <div class="stats"><span>موظفون ${t.staff_count}</span><span>مرضى ${t.patients_count}</span><span>مواعيد ${t.appointments_count}</span></div>
        <small>آخر نشاط: <span dir="ltr">${esc(t.last_activity ? khartoumTime(t.last_activity) : 'لا يوجد')}</span></small>
        <div class="actions">
          <button class="mini" data-act="manage" data-id="${id}">إدارة الموظفين</button>
          <button class="mini" data-act="toggle" data-id="${id}" data-status="${esc(t.status)}">${on ? 'إيقاف' : 'تفعيل'}</button>
          <button class="mini" data-act="rename" data-id="${id}" data-name="${esc(t.name)}">تسمية</button>
          <button class="mini" data-act="unlock" data-id="${id}">فك القفل</button>
          <button class="mini" data-act="pass" data-id="${id}">كلمة مرور المدير</button>
        </div>
        <div class="detail" id="d-${id}" hidden></div>
      </div>`;
    }).join('') || '<p>لا توجد مستشفيات بعد. أضف أول مستشفى من النموذج أعلاه</p>';
    if (openTenant) { if ($('d-' + openTenant)) await manageTenant(openTenant); else openTenant = null; }
  } catch (e) { say(e.message, 'err'); }
}

// بعد حفظ صلاحيات من لوحة المنصة نحدّث قائمة الموظفين دون إغلاق المحرّر
async function manageTenantKeepEditor(id) {
  const box = $('pb-' + id); const keep = box ? box.innerHTML : null; const handler = box ? box.onclick : null;
  await manageTenant(id);
  const nb = $('pb-' + id);
  if (nb && keep) { nb.innerHTML = keep; nb.hidden = false; nb.onclick = handler; }
}

async function manageTenant(id) {
  const box = $('d-' + id); if (!box) return;
  const { staff } = await api(`/api/platform/tenants/${id}/staff`);
  openTenant = id;
  const rows = staff.map((u) => `<tr class="${u.active ? '' : 'off'}"><td>${esc(u.name)}<br><small dir="ltr">${esc(u.email)}</small><br><small>آخر دخول: <span dir="ltr">${esc(u.last_login ? khartoumTime(u.last_login) : 'لم يدخل')}</span></small></td><td>${roleNames[u.role] || esc(u.role)}${u.custom ? ' <span class="badge ok">مخصص</span>' : ''}${u.active ? '' : ' (موقوف)'}</td><td><button class="mini" data-act="s-toggle" data-id="${esc(id)}" data-uid="${esc(u.id)}" data-active="${u.active}">${u.active ? 'إيقاف' : 'تفعيل'}</button><button class="mini" data-act="s-pass" data-id="${esc(id)}" data-uid="${esc(u.id)}">كلمة مرور</button><button class="mini" data-act="s-unlock" data-id="${esc(id)}" data-uid="${esc(u.id)}">فك القفل</button><button class="mini" data-act="s-perms" data-id="${esc(id)}" data-uid="${esc(u.id)}">الصلاحيات</button></td></tr>`).join('');
  box.hidden = false;
  box.innerHTML = `<h3>الموظفون</h3><table><thead><tr><th>الموظف</th><th>الدور</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <h3>إضافة موظف</h3>
    <input class="s-name" aria-label="الاسم" placeholder="الاسم">
    <input class="s-email" type="email" dir="ltr" aria-label="البريد الإلكتروني" placeholder="البريد الإلكتروني">
    <input class="s-pass" type="password" autocomplete="new-password" dir="ltr" aria-label="كلمة المرور" placeholder="كلمة المرور">
    <select class="s-role" aria-label="الدور"><option value="admin">مدير مستشفى</option><option value="doctor">طبيب</option><option value="reception">استقبال</option><option value="accountant">محاسب</option></select>
    <div class="actions"><button class="mini" data-act="s-add" data-id="${esc(id)}">إضافة</button><button class="mini" data-act="close" data-id="${esc(id)}">إغلاق</button></div>
    <div class="perm-box card" id="pb-${esc(id)}" hidden></div>`;
}

$('tenants').onclick = async (ev) => {
  const b = ev.target.closest('button'); if (!b) return;
  const { act, id, uid } = b.dataset;
  const patch = (path, body) => api(path, { method: 'PATCH', body });
  if (act && act.startsWith('perm-')) return; // أزرار محرّر الصلاحيات يعالجها المحرّر نفسه
  try {
    if (act === 'manage') { await manageTenant(id); return; }
    if (act === 's-perms') { await openPermEditor($('pb-' + id), `/api/platform/tenants/${id}/staff/${uid}/permissions`, () => manageTenantKeepEditor(id)); return; }
    if (act === 'close') { openTenant = null; $('d-' + id).hidden = true; return; }
    if (act === 'toggle') {
      const next = b.dataset.status === 'active' ? 'suspended' : 'active';
      if (next === 'suspended' && !(await ask({ title: 'إيقاف المستشفى', text: 'سيُمنع كل موظفي هذا المستشفى من الدخول فورًا. متابعة؟', okText: 'إيقاف' }))) return;
      await patch('/api/platform/tenants/' + id, { status: next });
      say(next === 'active' ? 'تم تفعيل المستشفى' : 'تم إيقاف المستشفى', 'ok');
    } else if (act === 'rename') {
      const name = await ask({ title: 'اسم المستشفى', input: 'text', value: b.dataset.name, okText: 'حفظ' });
      if (!name) return;
      await patch('/api/platform/tenants/' + id, { name });
      say('تمت التسمية', 'ok');
    } else if (act === 'unlock') {
      await patch('/api/platform/tenants/' + id, { unlock: true });
      say('تم فك قفل الدخول عن كل موظفي المستشفى', 'ok');
      return;
    } else if (act === 'pass') {
      const pw = await ask({ title: 'كلمة مرور جديدة لمدير المستشفى', text: '8 أحرف على الأقل، ولا تحتوي بريده أو اسمه', input: 'password', okText: 'حفظ' });
      if (!pw) return;
      const r = await patch('/api/platform/tenants/' + id, { admin_password: pw });
      say('تم تعيين كلمة مرور جديدة للمدير: ' + r.admin_email, 'ok');
    } else if (act === 's-toggle') {
      await patch(`/api/platform/tenants/${id}/staff/${uid}`, { active: b.dataset.active !== '1' });
      say('تم تحديث حالة الموظف', 'ok');
    } else if (act === 's-pass') {
      const pw = await ask({ title: 'كلمة مرور جديدة للموظف', text: '8 أحرف على الأقل، ولا تحتوي بريده أو اسمه', input: 'password', okText: 'حفظ' });
      if (!pw) return;
      await patch(`/api/platform/tenants/${id}/staff/${uid}`, { password: pw });
      say('تم تغيير كلمة مرور الموظف', 'ok');
      return;
    } else if (act === 's-unlock') {
      await patch(`/api/platform/tenants/${id}/staff/${uid}`, { unlock: true });
      say('تم فك قفل الموظف', 'ok');
      return;
    } else if (act === 's-add') {
      const box = $('d-' + id);
      await api(`/api/platform/tenants/${id}/staff`, { method: 'POST', body: { name: box.querySelector('.s-name').value, email: box.querySelector('.s-email').value, password: box.querySelector('.s-pass').value, role: box.querySelector('.s-role').value } });
      say('تمت إضافة الموظف', 'ok');
    }
    loadTenants();
  } catch (e) { say(e.message, 'err'); }
};

async function loadPlatformAudit() {
  try {
    const { events } = await api('/api/platform/audit');
    $('paudit').innerHTML = events.map((e) => {
      const who = e.user_name ? esc(e.user_name) : (e.action === 'login.fail' && e.detail ? esc(e.detail) : 'غير معروف');
      const where = e.tenant_name ? esc(e.tenant_name) : 'المنصة';
      const extra = e.action === 'login.fail' ? (e.ip ? ' · ' + esc(e.ip) : '') : '';
      return `<tr><td dir="ltr">${esc(khartoumTime(e.created_at))}</td><td>${who}<br><small>${esc(actionNames[e.action] || e.action)} · ${where}${extra}</small></td></tr>`;
    }).join('') || '<tr><td colspan="2">لا توجد أحداث بعد</td></tr>';
  } catch (e) { say(e.message, 'err'); }
}

$('do-pass').onclick = async () => {
  try {
    const r = await api('/api/account/password', { method: 'POST', body: { current: $('acc-current').value, next: $('acc-new').value } });
    session.token = r.token; sessionStorage.setItem('session', JSON.stringify(session)); // الجلسة القديمة سقطت، فنستبدلها بالجديدة
    ['acc-current', 'acc-new'].forEach((i) => ($(i).value = ''));
    say('تم تغيير كلمة المرور', 'ok');
  } catch (e) { say(e.message, 'err'); }
};

$('do-tenant').onclick = async () => {
  try {
    await api('/api/platform/tenants', { method: 'POST', body: { name: $('t-name').value, slug: $('t-slug').value, admin_name: $('t-aname').value, admin_email: $('t-aemail').value, admin_password: $('t-apass').value } });
    say('تمت إضافة المستشفى', 'ok'); ['t-name','t-slug','t-aname','t-aemail','t-apass'].forEach((i) => ($(i).value = '')); loadTenants();
  } catch (e) { say(e.message, 'err'); }
};

let patientCache = {};

async function loadPatients() {
  try {
    const { patients } = await api('/api/patients?q=' + encodeURIComponent($('q').value));
    patientCache = Object.fromEntries(patients.map((p) => [p.id, p]));
    $('p-hint').hidden = patients.length < 50 || !!$('q').value;
    $('patients').innerHTML = patients.map((p) => {
      const acts = (has('visits.read') ? `<button class="mini" data-act="file" data-id="${esc(p.id)}">السجل الطبي</button>` : '') + (has('patients.update') ? `<button class="mini" data-act="edit" data-id="${esc(p.id)}">تعديل</button>` : '');
      return `<tr><td dir="ltr">${esc(p.file_no)}</td><td>${esc(p.full_name)}</td><td dir="ltr">${esc(p.phone || '')}</td><td>${acts}</td></tr>`;
    }).join('') || `<tr><td colspan="4">${has('patients.create') ? 'لا يوجد مرضى. سجّل أول مريض من النموذج أعلاه' : 'لا يوجد مرضى بعد'}</td></tr>`;
  } catch (e) { say(e.message, 'err'); }
}

function resetPatientForm() {
  editingPatient = null;
  ['p-name', 'p-phone', 'p-birth', 'p-gender'].forEach((i) => ($(i).value = ''));
  $('do-patient').textContent = 'حفظ المريض'; $('p-cancel').hidden = true;
  $('p-title').textContent = has('patients.create') ? 'تسجيل مريض' : 'تعديل بيانات مريض (اختر «تعديل» من القائمة)';
}

$('do-patient').onclick = async () => {
  try {
    const body = { full_name: $('p-name').value, phone: $('p-phone').value, birth_date: $('p-birth').value, gender: $('p-gender').value };
    if (editingPatient) {
      await api('/api/patients/' + editingPatient, { method: 'PATCH', body });
      say('تم حفظ التعديلات', 'ok');
    } else {
      if (!has('patients.create')) { say('لا تملك صلاحية تسجيل مرضى جدد', 'err'); return; }
      const r = await api('/api/patients', { method: 'POST', body });
      say('تم حفظ المريض، رقم الملف ' + r.file_no, 'ok'); toList('p-list-title');
    }
    resetPatientForm(); loadPatients(); if (!$('a-form').hidden || !$('inv-form').hidden) loadPatientOptions();
  } catch (e) { say(e.message, 'err'); }
};

$('p-cancel').onclick = resetPatientForm;

$('patients').onclick = async (ev) => {
  const b = ev.target.closest('button'); if (!b) return;
  if (b.dataset.act === 'edit') {
    const p = patientCache[b.dataset.id]; if (!p) return;
    editingPatient = p.id;
    $('p-name').value = p.full_name; $('p-phone').value = p.phone || ''; $('p-birth').value = p.birth_date || ''; $('p-gender').value = p.gender || '';
    $('do-patient').textContent = 'حفظ التعديلات'; $('p-cancel').hidden = false; $('p-title').textContent = 'تعديل بيانات المريض';
    $('p-form').scrollIntoView();
  } else if (b.dataset.act === 'file') {
    await openFile(b.dataset.id);
  }
};

// ===== تقارير الإدارة =====
const money = (n) => Number(n).toLocaleString('en-US');

// رسم بياني بسيط لإيراد آخر 7 أيام (SVG بسمات لا بأنماط مضمّنة، فتتوافق مع سياسة الأمان). الأحدث إلى اليمين.
function revenueChart(series, selected) {
  const max = Math.max(1, ...series.map((x) => x.total));
  const bars = series.map((x, i) => {
    const h = Math.round((x.total / max) * 70), px = (6 - i) * 44 + 6, y = 82 - h;
    return `<rect class="bar${x.date === selected ? ' sel' : ''}" x="${px}" y="${y}" width="32" height="${Math.max(h, 1)}" rx="3"/>`
      + (x.total ? `<text class="val" x="${px + 16}" y="${y - 4}" text-anchor="middle">${money(x.total)}</text>` : '')
      + `<text x="${px + 16}" y="98" text-anchor="middle">${x.date.slice(8)}</text>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 320 104" role="img" aria-label="إيراد آخر 7 أيام">${bars}</svg>`;
}

async function loadReports() {
  try {
    if (!$('r-day').value) $('r-day').value = todayKhartoum();
    const r = await api('/api/reports/summary?date=' + encodeURIComponent($('r-day').value));
    const m = r.revenue.by_method, a = r.appointments;
    const overdue = r.overdue.items.map((x) => `<tr><td dir="ltr">${esc(x.starts_at.slice(5))}</td><td>${x.patient_name ? esc(x.patient_name) : 'مريض'}<br><small>${esc(x.doctor_name)}</small></td></tr>`).join('');
    $('r-body').innerHTML = `
      <div class="kpis">
        <div class="kpi"><small>الإيراد المحصَّل</small><b dir="ltr">${money(r.revenue.total)}</b><small>${r.revenue.count} دفعة</small></div>
        <div class="kpi"><small>غير محصَّل (فواتير مفتوحة)</small><b dir="ltr">${money(r.outstanding.total)}</b><small>${r.outstanding.count} فاتورة</small></div>
        <div class="kpi"><small>المرضى</small><b>${r.patients.total}</b><small>${r.patients.new_today} جديد في هذا اليوم</small></div>
        <div class="kpi"><small>مواعيد اليوم</small><b>${a.total}</b><small>تمت ${a.done} · محجوزة ${a.scheduled}</small></div>
      </div>
      <h3>الإيراد حسب طريقة الدفع</h3>
      <table><tbody>
        <tr><td>نقدًا</td><td dir="ltr">${money(m.cash.total)}</td><td>${m.cash.n} دفعة</td></tr>
        <tr><td>بنكك</td><td dir="ltr">${money(m.bankak.total)}</td><td>${m.bankak.n} دفعة</td></tr>
        <tr><td>أخرى</td><td dir="ltr">${money(m.other.total)}</td><td>${m.other.n} دفعة</td></tr>
      </tbody></table>
      <h3>إيراد آخر 7 أيام</h3>${revenueChart(r.series, r.date)}
      <h3>المواعيد الفائتة <span class="badge ${r.overdue.count ? 'bad' : 'ok'}">${r.overdue.count}</span></h3>
      <p class="note">محجوزة مضى وقتها دون تسجيل «تمت» أو «لم يحضر» أو إلغاء. حدّث حالتها من تبويب المواعيد.</p>
      ${overdue ? `<table><tbody>${overdue}</tbody></table>` : '<p>لا توجد مواعيد فائتة</p>'}`;
  } catch (e) { say(e.message, 'err'); }
}

function shiftReportDay(n) {
  const d = new Date($('r-day').value + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  $('r-day').value = d.toISOString().slice(0, 10);
  loadReports();
}
$('r-day').onchange = loadReports;
$('r-prev').onclick = () => shiftReportDay(-1);
$('r-next').onclick = () => shiftReportDay(1);
$('r-today').onclick = () => { $('r-day').value = todayKhartoum(); loadReports(); };

// ===== الفواتير =====
const invStatus = { open: 'مفتوحة', paid: 'مسددة', void: 'ملغاة' };

async function loadInvoices() {
  try {
    const { invoices } = await api('/api/invoices');
    $('invoices').innerHTML = invoices.map((i) => {
      let actions = `<small>${invStatus[i.status] || esc(i.status)}</small>`;
      if (i.status === 'open') {
        actions = (has('invoices.collect') ? `<button class="mini" data-act="collect" data-id="${esc(i.id)}" data-left="${i.total - i.paid}">تحصيل</button>` : '')
          + (has('invoices.void') && i.paid === 0 ? `<button class="mini" data-act="void" data-id="${esc(i.id)}">إلغاء</button>` : '')
          || actions;
      }
      if (i.paid > 0) actions += `<button class="mini" data-act="payments" data-id="${esc(i.id)}">الدفعات</button>`;
      return `<tr class="${i.status === 'open' ? '' : 'off'}"><td>${esc(i.patient_name)}<br><small dir="ltr">${esc(khartoumTime(i.created_at))}</small><br><small>${invStatus[i.status] || esc(i.status)}</small></td><td dir="ltr">${i.paid} / ${i.total}</td><td>${actions}</td></tr>`;
    }).join('') || '<tr><td colspan="3">لا توجد فواتير بعد</td></tr>';
  } catch (e) { say(e.message, 'err'); }
}

$('do-invoice').onclick = async () => {
  try {
    await api('/api/invoices', { method: 'POST', body: { patient_id: $('inv-patient').value, total: Number($('inv-total').value) } });
    $('inv-total').value = ''; say('تم إصدار الفاتورة', 'ok'); loadInvoices(); toList('inv-list-title');
  } catch (e) { say(e.message, 'err'); }
};

const methodNames = { cash: 'نقدًا', bankak: 'بنكك', other: 'أخرى' };

// نافذة تحصيل الدفعة: المبلغ وطريقة الدفع ورقم العملية (إلزامي لبنكك)
function askPayment(left) {
  return new Promise((resolve) => {
    $('pay-left').textContent = `المتبقي على الفاتورة: ${left}`;
    $('pay-amount').value = left; $('pay-method').value = 'cash'; $('pay-ref').value = '';
    const sync = () => {
      const m = $('pay-method').value;
      $('pay-ref-wrap').hidden = m === 'cash';
      $('pay-ref').placeholder = m === 'bankak' ? 'رقم عملية بنكك (مطلوب)' : 'رقم العملية (اختياري)';
    };
    sync(); $('pay-modal').hidden = false; $('pay-amount').focus();
    const finish = (v) => {
      $('pay-modal').hidden = true;
      $('pay-ok').removeEventListener('click', ok); $('pay-cancel').removeEventListener('click', cancel);
      $('pay-method').removeEventListener('change', sync); document.removeEventListener('keydown', key);
      resolve(v);
    };
    const ok = () => finish({ amount: Number($('pay-amount').value), method: $('pay-method').value, reference: $('pay-ref').value });
    const cancel = () => finish(null);
    const key = (e) => { if (e.key === 'Escape') cancel(); };
    $('pay-ok').addEventListener('click', ok); $('pay-cancel').addEventListener('click', cancel);
    $('pay-method').addEventListener('change', sync); document.addEventListener('keydown', key);
  });
}

async function openPayments(id) {
  const { payments } = await api(`/api/invoices/${id}/payments`);
  const box = $('inv-detail');
  box.hidden = false;
  box.innerHTML = '<h3>دفعات الفاتورة</h3>' + (payments.map((p) => `<div class="pay-row"><b dir="ltr">${p.amount}</b> · ${methodNames[p.method] || esc(p.method)}${p.reference ? ` · <span dir="ltr">${esc(p.reference)}</span>` : ''}<br><small dir="ltr">${esc(khartoumTime(p.created_at))}</small> · <small>${esc(p.collector)}</small></div>`).join('') || '<p>لا توجد دفعات مسجلة</p>')
    + '<div class="actions"><button class="mini" data-act="close-payments">إغلاق</button></div>';
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
$('inv-detail').onclick = (ev) => { if (ev.target.closest('[data-act=close-payments]')) $('inv-detail').hidden = true; };

$('invoices').onclick = async (ev) => {
  const b = ev.target.closest('button'); if (!b) return;
  try {
    if (b.dataset.act === 'payments') { await openPayments(b.dataset.id); return; }
    if (b.dataset.act === 'collect') {
      const p = await askPayment(b.dataset.left);
      if (!p) return;
      await api(`/api/invoices/${b.dataset.id}/pay`, { method: 'POST', body: p });
      say('تم تسجيل الدفعة', 'ok');
    } else if (b.dataset.act === 'void') {
      if (!(await ask({ title: 'إلغاء الفاتورة', text: 'لا يمكن التراجع عن إلغاء الفاتورة.', okText: 'إلغاء الفاتورة' }))) return;
      await api('/api/invoices/' + b.dataset.id, { method: 'PATCH', body: { status: 'void' } });
      say('تم إلغاء الفاتورة', 'ok');
    }
    loadInvoices();
  } catch (e) { say(e.message, 'err'); }
};

// ===== السجل الطبي =====
async function openFile(id) {
  try {
    const { patient, visits } = await api(`/api/patients/${id}/visits`);
    currentFile = id;
    $('pf-title').textContent = `السجل الطبي: ${patient.full_name} (ملف ${patient.file_no})`;
    $('pf-list').innerHTML = visits.map((v) => `<div class="visit"><small dir="ltr">${esc(khartoumTime(v.created_at))}</small> · <small>${esc(v.doctor_name)}</small>
      ${v.diagnosis ? `<div><b>التشخيص</b><div class="pre">${esc(v.diagnosis)}</div></div>` : ''}
      ${v.notes ? `<div><b>الملاحظات</b><div class="pre">${esc(v.notes)}</div></div>` : ''}
      ${v.prescription ? `<div><b>الوصفة</b><div class="pre">${esc(v.prescription)}</div></div>` : ''}</div>`).join('') || '<p>لا توجد زيارات مسجلة بعد</p>';
    $('pf-form').hidden = !has('visits.write');
    applyTab(); $('s-pfile').scrollIntoView();
  } catch (e) { say(e.message, 'err'); }
}

$('pf-close').onclick = () => { currentFile = null; applyTab(); };

$('do-visit').onclick = async () => {
  try {
    await api(`/api/patients/${currentFile}/visits`, { method: 'POST', body: { diagnosis: $('pf-dx').value, notes: $('pf-notes').value, prescription: $('pf-rx').value } });
    ['pf-dx', 'pf-notes', 'pf-rx'].forEach((i) => ($(i).value = ''));
    say('تم حفظ الزيارة في السجل الطبي', 'ok');
    await openFile(currentFile);
  } catch (e) { say(e.message, 'err'); }
};

let timer; $('q').oninput = () => { clearTimeout(timer); timer = setTimeout(loadPatients, 300); };
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

async function loadStaff() {
  try {
    const { staff } = await api('/api/staff');
    $('staff').innerHTML = staff.map((u) => {
      const me = u.id === session.user.id;
      const actions = me ? '<small>حسابك</small>' :
        `<button class="mini" data-act="toggle" data-id="${esc(u.id)}" data-active="${u.active}">${u.active ? 'إيقاف' : 'تفعيل'}</button><button class="mini" data-act="pass" data-id="${esc(u.id)}">كلمة مرور</button>${u.role === 'admin' ? '' : `<button class="mini" data-act="perms" data-id="${esc(u.id)}">الصلاحيات</button>`}`;
      return `<tr class="${u.active ? '' : 'off'}"><td>${esc(u.name)}<br><small dir="ltr">${esc(u.email)}</small></td><td>${roleNames[u.role] || esc(u.role)}${u.custom ? ' <span class="badge ok">مخصص</span>' : ''}${u.active ? '' : ' (موقوف)'}</td><td>${actions}</td></tr>`;
    }).join('');
  } catch (e) { say(e.message, 'err'); }
}

$('do-staff').onclick = async () => {
  try {
    await api('/api/staff', { method: 'POST', body: { name: $('st-name').value, email: $('st-email').value, password: $('st-pass').value, role: $('st-role').value } });
    say('تمت إضافة الموظف', 'ok'); ['st-name','st-email','st-pass'].forEach((i) => ($(i).value = '')); loadStaff();
  } catch (e) { say(e.message, 'err'); }
};

$('staff').onclick = async (ev) => {
  const b = ev.target.closest('button'); if (!b) return;
  try {
    if (b.dataset.act === 'perms') { await openPermEditor($('perm-panel'), `/api/staff/${b.dataset.id}/permissions`, loadStaff); return; }
    if (b.dataset.act === 'toggle') {
      await api('/api/staff/' + b.dataset.id, { method: 'PATCH', body: { active: b.dataset.active !== '1' } });
      say('تم تحديث الحالة', 'ok');
    } else if (b.dataset.act === 'pass') {
      const pw = await ask({ title: 'كلمة مرور جديدة للموظف', text: '8 أحرف على الأقل، ولا تحتوي بريده أو اسمه', input: 'password', okText: 'حفظ' });
      if (!pw) return;
      await api('/api/staff/' + b.dataset.id, { method: 'PATCH', body: { password: pw } });
      say('تم تغيير كلمة المرور', 'ok');
    }
    loadStaff();
  } catch (e) { say(e.message, 'err'); }
};

// ===== المواعيد =====
const statusNames = { scheduled: 'محجوز', done: 'تمت', cancelled: 'ملغي', no_show: 'لم يحضر' };
const todayKhartoum = () => new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 10);

function initApptDates() {
  if (!$('a-day').value) $('a-day').value = todayKhartoum();
  if (!$('a-date').value) $('a-date').value = todayKhartoum();
  if (!$('a-time').options.length) {
    for (let h = 7; h < 22; h++) for (const m of ['00', '15', '30', '45']) {
      const t = String(h).padStart(2, '0') + ':' + m;
      $('a-time').add(new Option(t, t));
    }
    $('a-time').value = '09:00';
  }
}

const patientOption = (p) => `<option value="${esc(p.id)}">${esc(p.full_name)} (ملف ${esc(p.file_no)})</option>`;

// بحث المريض أثناء الكتابة في نماذج الحجز والفواتير، فلا يقف الاختيار عند آخر 50 مريضًا
function bindPatientSearch(inputId, selectId) {
  let t;
  $(inputId).oninput = () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      try {
        const { patients } = await api('/api/patients?q=' + encodeURIComponent($(inputId).value.trim()));
        $(selectId).innerHTML = patients.length ? patients.map(patientOption).join('') : '<option value="">لا توجد نتائج</option>';
      } catch (e) { say(e.message, 'err'); }
    }, 300);
  };
}
bindPatientSearch('a-patient-q', 'a-patient');
bindPatientSearch('inv-patient-q', 'inv-patient');

// خيارات المرضى والأطباء في نماذج الحجز والفواتير (تُحمَّل مرة واحدة لكل تحديث)
async function loadPatientOptions() {
  try {
    const wantAppt = !$('a-form').hidden, wantInv = !$('inv-form').hidden;
    const { patients } = await api('/api/patients');
    const opts = patients.length ? patients.map(patientOption).join('') : '<option value="">لا يوجد مرضى بعد</option>';
    const fill = (id) => { const keep = $(id).value; $(id).innerHTML = opts; if (keep) $(id).value = keep; };
    if (wantInv) fill('inv-patient');
    if (wantAppt) {
      fill('a-patient');
      const { doctors } = await api('/api/staff?role=doctor');
      const keepD = $('a-doctor').value;
      $('a-doctor').innerHTML = doctors.length ? doctors.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('') : `<option value="">${has('staff.manage') ? 'أضف طبيبًا أولًا من قسم الموظفين' : 'لا يوجد أطباء فعّالون. اطلب من مدير المستشفى إضافة طبيب'}</option>`;
      if (keepD) $('a-doctor').value = keepD;
    }
  } catch (e) { say(e.message, 'err'); }
}

async function loadAppts() {
  try {
    const { appointments } = await api('/api/appointments?date=' + encodeURIComponent($('a-day').value));
    const role = session.user.role;
    $('appts').innerHTML = appointments.map((a) => {
      let actions = '';
      if (a.status === 'scheduled') {
        if (has('appointments.complete')) actions = `<button class="mini" data-st="done" data-id="${esc(a.id)}">تمت</button><button class="mini" data-st="no_show" data-id="${esc(a.id)}">لم يحضر</button>`;
        if (has('appointments.cancel')) actions += `<button class="mini" data-st="cancelled" data-id="${esc(a.id)}">إلغاء</button>`;
      } else actions = `<small>${statusNames[a.status]}</small>`;
      const sub = [has('appointments.all') ? a.doctor_name : '', a.reason].filter(Boolean).map(esc).join(' · ');
      return `<tr class="${a.status === 'scheduled' ? '' : 'off'}"><td dir="ltr">${esc(a.starts_at.slice(11))}</td><td>${esc(a.patient_name)}${sub ? '<br><small>' + sub + '</small>' : ''}</td><td>${actions}</td></tr>`;
    }).join('') || '<tr><td colspan="3">لا توجد مواعيد في هذا اليوم</td></tr>';
  } catch (e) { say(e.message, 'err'); }
}

$('a-day').onchange = loadAppts;

function shiftDay(n) {
  const d = new Date($('a-day').value + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  $('a-day').value = d.toISOString().slice(0, 10);
  loadAppts();
}
$('day-prev').onclick = () => shiftDay(-1);
$('day-next').onclick = () => shiftDay(1);
$('day-today').onclick = () => { $('a-day').value = todayKhartoum(); loadAppts(); };

$('do-appt').onclick = async () => {
  try {
    await api('/api/appointments', { method: 'POST', body: { patient_id: $('a-patient').value, doctor_id: $('a-doctor').value, starts_at: $('a-date').value + ' ' + $('a-time').value, reason: $('a-reason').value } });
    say('تم حجز الموعد', 'ok'); $('a-reason').value = ''; $('a-day').value = $('a-date').value; loadAppts(); toList('a-list-title');
  } catch (e) { say(e.message, 'err'); }
};

$('appts').onclick = async (ev) => {
  const b = ev.target.closest('button'); if (!b) return;
  try {
    await api('/api/appointments/' + b.dataset.id, { method: 'PATCH', body: { status: b.dataset.st } });
    say('تم تحديث الموعد', 'ok'); loadAppts();
  } catch (e) { say(e.message, 'err'); }
};

// ===== سجل النشاط (للمدير) =====
const actionNames = {
  'login.ok': 'دخول', 'login.fail': 'محاولة دخول فاشلة', 'patient.create': 'تسجيل مريض', 'patient.view': 'فتح ملف مريض',
  'tenant.create': 'إنشاء مستشفى', 'tenant.update': 'تعديل مستشفى', 'account.password': 'تغيير كلمة مرور', 'platform.setup': 'إعداد المنصة', 'staff.create': 'إضافة موظف', 'staff.update': 'تعديل موظف', 'appointment.create': 'حجز موعد', 'appointment.status': 'تغيير حالة موعد',
  'patient.update': 'تعديل بيانات مريض', 'visit.create': 'تسجيل زيارة طبية', 'visit.view': 'قراءة سجل طبي', 'invoice.create': 'إصدار فاتورة', 'invoice.pay': 'تحصيل دفعة', 'invoice.void': 'إلغاء فاتورة', 'staff.permissions': 'تعديل صلاحيات',
};
const khartoumTime = (utc) => new Date(new Date(utc.replace(' ', 'T') + 'Z').getTime() + 2 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');

async function loadAudit() {
  try {
    const { events } = await api('/api/audit');
    $('audit').innerHTML = events.map((e) => {
      const who = e.user_name ? esc(e.user_name) : (e.action === 'login.fail' && e.detail ? esc(e.detail) : 'مدير المنصة'); // الفاعل الذي لا سجل له داخل المستشفى هو مدير المنصة
      const fieldNames = { name: 'الاسم', role: 'الدور', active: 'الحالة', password: 'كلمة المرور', full_name: 'الاسم', phone: 'الهاتف', birth_date: 'تاريخ الميلاد', gender: 'الجنس', notes: 'ملاحظات', status: 'الحالة', unlock: 'فك القفل', admin_password: 'كلمة مرور المدير' };
      let detail = e.detail || '';
      if (e.action === 'staff.create') detail = roleNames[detail] || detail;
      else if (e.action === 'staff.update' || e.action === 'patient.update' || e.action === 'tenant.update') detail = detail.split(',').map((f) => fieldNames[f] || f).join('، ');
      else if (e.action === 'appointment.status') detail = statusNames[detail] || detail;
      else if (e.action === 'visit.view' || e.action === 'visit.create') detail = '';
      const extra = e.action === 'login.fail' || !detail ? '' : ' · ' + esc(detail);
      return `<tr><td dir="ltr">${esc(khartoumTime(e.created_at))}</td><td>${who}<br><small>${esc(actionNames[e.action] || e.action)}${extra}</small></td></tr>`;
    }).join('') || '<tr><td colspan="2">لا توجد أحداث بعد</td></tr>';
  } catch (e) { say(e.message, 'err'); }
}

document.querySelectorAll('[data-jump]').forEach((b) => { b.onclick = () => { const t = $(b.dataset.jump); t.scrollIntoView({ behavior: 'smooth', block: 'start' }); const f = t.querySelector('input'); if (f) setTimeout(() => f.focus({ preventScroll: true }), 400); }; });
const toList = (id) => $(id).scrollIntoView({ behavior: 'smooth', block: 'start' });

// زر Enter في حقول الدخول يسجّل الدخول
['slug', 'email', 'password'].forEach((id) => $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('do-login').click(); }));

// منع الضغط المزدوج: الزر يتعطل أثناء تنفيذ طلبه، فلا يتكرر مريض أو فاتورة أو حجز بضغطتين متتاليتين
['do-login', 'do-setup', 'do-tenant', 'do-patient', 'do-visit', 'do-appt', 'do-invoice', 'do-staff', 'do-pass'].forEach((id) => {
  const handler = $(id).onclick;
  $(id).onclick = async (ev) => {
    const btn = ev.currentTarget;
    if (btn.disabled) return;
    btn.disabled = true;
    try { await handler(ev); } finally { btn.disabled = false; }
  };
});

// تغيّر حالة الاتصال: ننبّه المستخدم، وعند العودة نحدّث البيانات
window.addEventListener('offline', () => setOfflineBar('غير متصل بالإنترنت. تُعرض آخر بيانات حُمّلت، ولا يمكن حفظ تعديلات الآن.'));
window.addEventListener('online', () => { setOfflineBar(''); if (session) render(); });

// عامل الخدمة: يجعل التطبيق قابلًا للتثبيت على الشاشة الرئيسية ويفتح بلا إنترنت
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

window.addEventListener('hashchange', () => { if (!session) render(); });

// عند فتح الصفحة نحدّث هوية المستخدم وصلاحياته من الخادم، فيرى آخر تعديل أجراه المدير دون إعادة دخول
(async function boot() {
  if (session) {
    try {
      const me = await api('/api/me');
      session = { ...session, user: me.user, tenant: me.tenant, permissions: me.permissions };
      sessionStorage.setItem('session', JSON.stringify(session));
    } catch (e) { say(e.message, 'err'); } // الخطأ 401 يعالجه api() بتسجيل الخروج
  }
  render();
})();
