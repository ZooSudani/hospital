const $ = (id) => document.getElementById(id);
let session = JSON.parse(sessionStorage.getItem('session') || 'null');

function say(text, kind = '') { const m = $('msg'); m.textContent = text; m.className = kind; }

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', ...(session ? { authorization: 'Bearer ' + session.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && session) { logout(); say('انتهت الجلسة. سجّل الدخول مرة أخرى', 'err'); }
  if (!res.ok) throw new Error(data.error || 'حدث خطأ غير متوقع');
  return data;
}

// ما يحق لكل دور رؤيته أو فعله في الواجهة. الخادم يفرض الصلاحيات فعليًا، وهذه الخريطة تمنع إظهار ما لا يخص المستخدم.
const CAN = {
  viewPatients: ['admin', 'reception', 'doctor', 'accountant'],
  registerPatient: ['admin', 'reception'],
  viewAppts: ['admin', 'reception', 'doctor'],
  bookAppt: ['admin', 'reception'],
  markAppt: ['admin', 'reception', 'doctor'],
  cancelAppt: ['admin', 'reception'],
  manageStaff: ['admin'],
  viewAudit: ['admin'],
};
const can = (cap) => !!session && CAN[cap].includes(session.user.role);
const adminMode = () => location.hash === '#admin';

const roleNames = { platform_admin: 'مدير المنصة', admin: 'مدير المستشفى', doctor: 'طبيب', reception: 'استقبال', accountant: 'محاسب' };

function render() {
  const on = !!session;
  const tenant = on && !!session.tenant;
  $('s-login').hidden = on; $('logout').hidden = !on;
  $('setup-link').hidden = on || !adminMode();
  $('platform-hint').hidden = !adminMode();
  if (on || !adminMode()) $('s-setup').hidden = true;
  $('s-platform').hidden = !(on && session.user.role === 'platform_admin');
  $('s-patients').hidden = !(tenant && can('viewPatients'));
  $('p-form').hidden = !(tenant && can('registerPatient'));
  $('p-list-title').classList.toggle('mt', !$('p-form').hidden);
  $('s-appts').hidden = !(tenant && can('viewAppts'));
  $('a-form').hidden = !(tenant && can('bookAppt'));
  $('a-list-title').classList.toggle('mt', !$('a-form').hidden);
  $('s-staff').hidden = !(tenant && can('manageStaff'));
  $('s-audit').hidden = !(tenant && can('viewAudit'));
  $('s-account').hidden = !on;
  $('appts-th').textContent = on && session.user.role === 'doctor' ? 'المريض' : 'المريض والطبيب';
  $('who').textContent = on ? `${session.user.name} · ${roleNames[session.user.role]}${session.tenant ? ' · ' + session.tenant.name : ''}` : 'لم تسجل الدخول';
  if (!$('s-platform').hidden) loadTenants();
  if (!$('s-patients').hidden) loadPatients();
  if (!$('s-staff').hidden) loadStaff();
  if (!$('s-audit').hidden) loadAudit();
  if (!$('s-appts').hidden) { initApptDates(); loadAppts(); }
  if (!$('a-form').hidden) loadApptForm();
}

function logout() { session = null; sessionStorage.removeItem('session'); render(); }

$('logout').onclick = logout;
$('toggle-setup').onclick = () => { $('s-setup').hidden = !$('s-setup').hidden; };

$('do-login').onclick = async () => {
  try {
    session = await api('/api/auth/login', { method: 'POST', body: { slug: $('slug').value, email: $('email').value, password: $('password').value } });
    sessionStorage.setItem('session', JSON.stringify(session));
    $('password').value = ''; say('تم تسجيل الدخول', 'ok'); render();
  } catch (e) { say(e.message, 'err'); }
};

$('do-setup').onclick = async () => {
  try {
    await api('/api/setup', { method: 'POST', body: { key: $('su-key').value, name: $('su-name').value, email: $('su-email').value, password: $('su-pass').value } });
    say('تم إنشاء مدير المنصة. سجّل الدخول برمز platform', 'ok'); $('s-setup').hidden = true; $('slug').value = 'platform'; $('email').value = $('su-email').value;
  } catch (e) { say(e.message, 'err'); }
};

async function loadTenants() {
  try {
    const { tenants } = await api('/api/platform/tenants');
    $('tenants').innerHTML = tenants.map((t) => {
      const on = t.status === 'active';
      return `<tr class="${on ? '' : 'off'}"><td>${esc(t.name)}<br><small dir="ltr">${esc(t.slug)}</small><br><small dir="ltr">${esc(t.admin_email || '')}</small></td><td>${on ? 'فعّال' : 'موقوف'}</td><td><button class="mini" data-act="toggle" data-id="${esc(t.id)}" data-status="${esc(t.status)}">${on ? 'إيقاف' : 'تفعيل'}</button><button class="mini" data-act="pass" data-id="${esc(t.id)}">كلمة مرور المدير</button></td></tr>`;
    }).join('') || '<tr><td colspan="3">لا توجد مستشفيات بعد. أضف أول مستشفى من النموذج أعلاه</td></tr>';
  } catch (e) { say(e.message, 'err'); }
}

$('tenants').onclick = async (ev) => {
  const b = ev.target.closest('button'); if (!b) return;
  try {
    if (b.dataset.act === 'toggle') {
      const next = b.dataset.status === 'active' ? 'suspended' : 'active';
      if (next === 'suspended' && !confirm('سيُمنع كل موظفي هذا المستشفى من الدخول فورًا. متابعة؟')) return;
      await api('/api/platform/tenants/' + b.dataset.id, { method: 'PATCH', body: { status: next } });
      say(next === 'active' ? 'تم تفعيل المستشفى' : 'تم إيقاف المستشفى', 'ok');
    } else if (b.dataset.act === 'pass') {
      const pw = prompt('كلمة المرور الجديدة لمدير المستشفى (8 أحرف على الأقل)');
      if (!pw) return;
      const r = await api('/api/platform/tenants/' + b.dataset.id, { method: 'PATCH', body: { admin_password: pw } });
      say('تم تعيين كلمة مرور جديدة للمدير: ' + r.admin_email, 'ok');
    }
    loadTenants();
  } catch (e) { say(e.message, 'err'); }
};

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

async function loadPatients() {
  try {
    const { patients } = await api('/api/patients?q=' + encodeURIComponent($('q').value));
    $('patients').innerHTML = patients.map((p) => `<tr><td dir="ltr">${esc(p.file_no)}</td><td>${esc(p.full_name)}</td><td dir="ltr">${esc(p.phone || '')}</td></tr>`).join('') || `<tr><td colspan="3">${can('registerPatient') ? 'لا يوجد مرضى. سجّل أول مريض من النموذج أعلاه' : 'لا يوجد مرضى بعد'}</td></tr>`;
  } catch (e) { say(e.message, 'err'); }
}

$('do-patient').onclick = async () => {
  try {
    const r = await api('/api/patients', { method: 'POST', body: { full_name: $('p-name').value, phone: $('p-phone').value, birth_date: $('p-birth').value, gender: $('p-gender').value } });
    say('تم حفظ المريض، رقم الملف ' + r.file_no, 'ok'); ['p-name','p-phone','p-birth','p-gender'].forEach((i) => ($(i).value = '')); loadPatients(); if (!$('a-form').hidden) loadApptForm();
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
        `<button class="mini" data-act="toggle" data-id="${esc(u.id)}" data-active="${u.active}">${u.active ? 'إيقاف' : 'تفعيل'}</button><button class="mini" data-act="pass" data-id="${esc(u.id)}">كلمة مرور</button>`;
      return `<tr class="${u.active ? '' : 'off'}"><td>${esc(u.name)}<br><small dir="ltr">${esc(u.email)}</small></td><td>${roleNames[u.role] || esc(u.role)}${u.active ? '' : ' (موقوف)'}</td><td>${actions}</td></tr>`;
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
    if (b.dataset.act === 'toggle') {
      await api('/api/staff/' + b.dataset.id, { method: 'PATCH', body: { active: b.dataset.active !== '1' } });
      say('تم تحديث الحالة', 'ok');
    } else if (b.dataset.act === 'pass') {
      const pw = prompt('كلمة المرور الجديدة (8 أحرف على الأقل)');
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

async function loadApptForm() {
  try {
    const [{ patients }, { doctors }] = await Promise.all([api('/api/patients'), api('/api/staff?role=doctor')]);
    const keepP = $('a-patient').value, keepD = $('a-doctor').value;
    $('a-patient').innerHTML = patients.length ? patients.map((p) => `<option value="${esc(p.id)}">${esc(p.full_name)} (ملف ${esc(p.file_no)})</option>`).join('') : '<option value="">لا يوجد مرضى بعد</option>';
    $('a-doctor').innerHTML = doctors.length ? doctors.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('') : `<option value="">${can('manageStaff') ? 'أضف طبيبًا أولًا من قسم الموظفين' : 'لا يوجد أطباء فعّالون. اطلب من مدير المستشفى إضافة طبيب'}</option>`;
    if (keepP) $('a-patient').value = keepP; if (keepD) $('a-doctor').value = keepD;
  } catch (e) { say(e.message, 'err'); }
}

async function loadAppts() {
  try {
    const { appointments } = await api('/api/appointments?date=' + encodeURIComponent($('a-day').value));
    const role = session.user.role;
    $('appts').innerHTML = appointments.map((a) => {
      let actions = '';
      if (a.status === 'scheduled') {
        actions = `<button class="mini" data-st="done" data-id="${esc(a.id)}">تمت</button><button class="mini" data-st="no_show" data-id="${esc(a.id)}">لم يحضر</button>`;
        if (can('cancelAppt')) actions += `<button class="mini" data-st="cancelled" data-id="${esc(a.id)}">إلغاء</button>`;
      } else actions = `<small>${statusNames[a.status]}</small>`;
      const sub = [role === 'doctor' ? '' : a.doctor_name, a.reason].filter(Boolean).map(esc).join(' · ');
      return `<tr class="${a.status === 'scheduled' ? '' : 'off'}"><td dir="ltr">${esc(a.starts_at.slice(11))}</td><td>${esc(a.patient_name)}${sub ? '<br><small>' + sub + '</small>' : ''}</td><td>${actions}</td></tr>`;
    }).join('') || '<tr><td colspan="3">لا توجد مواعيد في هذا اليوم</td></tr>';
  } catch (e) { say(e.message, 'err'); }
}

$('a-day').onchange = loadAppts;

$('do-appt').onclick = async () => {
  try {
    await api('/api/appointments', { method: 'POST', body: { patient_id: $('a-patient').value, doctor_id: $('a-doctor').value, starts_at: $('a-date').value + ' ' + $('a-time').value, reason: $('a-reason').value } });
    say('تم حجز الموعد', 'ok'); $('a-reason').value = ''; $('a-day').value = $('a-date').value; loadAppts();
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
  'tenant.create': 'إنشاء مستشفى', 'platform.setup': 'إعداد المنصة', 'staff.create': 'إضافة موظف', 'staff.update': 'تعديل موظف', 'appointment.create': 'حجز موعد', 'appointment.status': 'تغيير حالة موعد',
};
const khartoumTime = (utc) => new Date(new Date(utc.replace(' ', 'T') + 'Z').getTime() + 2 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');

async function loadAudit() {
  try {
    const { events } = await api('/api/audit');
    $('audit').innerHTML = events.map((e) => {
      const who = e.user_name ? esc(e.user_name) : (e.action === 'login.fail' && e.detail ? esc(e.detail) : (e.action === 'tenant.create' || e.action === 'platform.setup' ? 'مدير المنصة' : 'غير معروف'));
      const fieldNames = { name: 'الاسم', role: 'الدور', active: 'الحالة', password: 'كلمة المرور' };
      let detail = e.detail || '';
      if (e.action === 'staff.create') detail = roleNames[detail] || detail;
      else if (e.action === 'staff.update') detail = detail.split(',').map((f) => fieldNames[f] || f).join('، ');
      else if (e.action === 'appointment.status') detail = statusNames[detail] || detail;
      const extra = e.action === 'login.fail' || !detail ? '' : ' · ' + esc(detail);
      return `<tr><td dir="ltr">${esc(khartoumTime(e.created_at))}</td><td>${who}<br><small>${esc(actionNames[e.action] || e.action)}${extra}</small></td></tr>`;
    }).join('') || '<tr><td colspan="2">لا توجد أحداث بعد</td></tr>';
  } catch (e) { say(e.message, 'err'); }
}

window.addEventListener('hashchange', () => { if (!session) render(); });
render();
