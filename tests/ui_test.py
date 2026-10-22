# اختبار الواجهة في متصفح فعلي بحجم الجوال (390x844): لكل دور ما يخصه فقط
import json, urllib.request, sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8799"
def api(path, method="GET", body=None, token=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body else None,
        headers={"content-type": "application/json", **({"authorization": "Bearer " + token} if token else {})})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read())

api("/api/setup", "POST", {"key": "ui-key", "name": "مدير المنصة", "email": "root@x.com", "password": "Zebra-5521-kx"})
plat = api("/api/auth/login", "POST", {"slug": "platform", "email": "root@x.com", "password": "Zebra-5521-kx"})[1]["token"]
api("/api/platform/tenants", "POST", {"name": "مستشفى العافية", "slug": "alafia", "admin_name": "عبدالله علي", "admin_email": "admin@alafia.com", "admin_password": "hospital123"}, plat)
adm = api("/api/auth/login", "POST", {"slug": "alafia", "email": "admin@alafia.com", "password": "hospital123"})[1]["token"]
doc_id = api("/api/staff", "POST", {"name": "د. منتصر", "email": "doc@alafia.com", "password": "doctor1234", "role": "doctor"}, adm)[1]["id"]
api("/api/staff", "POST", {"name": "معاذ", "email": "rec@alafia.com", "password": "recept1234", "role": "reception"}, adm)
api("/api/staff", "POST", {"name": "عمر", "email": "acc@alafia.com", "password": "account1234", "role": "accountant"}, adm)
pid = api("/api/patients", "POST", {"full_name": "محمد آدم", "phone": "0918155613"}, adm)[1]["id"]
api("/api/patients", "POST", {"full_name": "سارة عثمان", "phone": "0912345678"}, adm)
api("/api/patients", "POST", {"full_name": "<img src=x onerror=window.__xss=1>", "phone": "<b>0900</b>"}, adm)

results = []
def check(name, cond):
    results.append((name, bool(cond))); print(("✔ " if cond else "✘ ") + name)

SECTIONS = {"patients": "#s-patients", "p-form": "#p-form", "appts": "#s-appts", "a-form": "#a-form", "staff": "#s-staff", "audit": "#s-audit", "platform": "#s-platform", "paudit": "#s-paudit", "account": "#s-account"}

def visible(page):
    return {k for k, sel in SECTIONS.items() if page.is_visible(sel)}

def login(page, slug, email, password):
    page.goto(BASE); page.fill("#slug", slug); page.fill("#email", email); page.fill("#password", password)
    page.click("#do-login"); page.wait_for_selector("#logout:not([hidden])"); page.wait_for_timeout(300)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="ar")
    page = ctx.new_page()
    errors = []; page.on("pageerror", lambda e: errors.append(str(e)))
    csp_msgs = []; page.on("console", lambda m: csp_msgs.append(m.text) if "Content Security Policy" in m.text or "Refused to" in m.text else None)

    # رؤوس الأمان وسياسة CSP
    resp = page.goto(BASE)
    h = resp.headers
    check("CSP يمنع السكربت المضمّن", "script-src 'self'" in h.get("content-security-policy", "") and "unsafe-inline" not in h.get("content-security-policy", ""))
    check("رؤوس الأمان موجودة", h.get("x-content-type-options") == "nosniff" and h.get("x-frame-options") == "DENY" and h.get("referrer-policy") == "no-referrer")
    page.evaluate("() => { const s = document.createElement('script'); s.textContent = 'window.__pwned = true'; document.body.appendChild(s); }")
    check("سكربت مُحقن يدويًا لا يُنفَّذ (CSP)", page.evaluate("() => window.__pwned") is None)
    check("الصفحة تعمل رغم CSP (تحمّلت app.js)", page.is_visible("#do-login"))

    # شاشة الدخول العامة: لا أثر لمدير المنصة
    page.goto(BASE)
    check("الدخول: لا زر إعداد ظاهر للعامة", not page.is_visible("#setup-link"))
    check("الدخول: لا تلميح لرمز platform", not page.is_visible("#platform-hint"))
    check("الدخول: لا قسم إعداد", not page.is_visible("#s-setup"))
    page.goto(BASE + "/#admin"); page.reload()
    check("#admin: يظهر زر الإعداد والتلميح", page.is_visible("#setup-link") and page.is_visible("#platform-hint"))

    # مدير المنصة: المستشفيات فقط
    login(page, "platform", "root@x.com", "Zebra-5521-kx")
    check("مدير المنصة يرى المستشفيات فقط", visible(page) == {"platform", "paudit", "account"})
    body = page.inner_text("body")
    check("مدير المنصة لا يرى كلمة مرضى أو مواعيد", "المرضى" not in body and "المواعيد" not in body)
    page.locator("#tenants", has_text="admin@alafia.com").wait_for()
    txt = page.inner_text("#tenants")
    check("لوحة المنصة: بطاقة المستشفى بإحصاءاتها وبريد المدير", page.locator("#tenants .card").count() == 1 and "موظفون" in txt and "مرضى" in txt and "مواعيد" in txt)
    check("لوحة المنصة: أزرار الإدارة الخمسة", all(page.locator(f"#tenants button[data-act={a}]").count() == 1 for a in ["manage", "toggle", "rename", "unlock", "pass"]))
    check("لوحة المنصة: لا أسماء مرضى (تجميع فقط)", "محمد" not in txt and "سارة" not in txt)
    page.screenshot(path="/tmp/ui-platform.png", full_page=True)
    page.once("dialog", lambda d: d.accept("Platform-reset-pass-9"))
    page.click("#tenants button[data-act=pass]")
    page.locator("#msg", has_text="admin@alafia.com").wait_for()
    check("إعادة تعيين كلمة مرور المدير من لوحة المنصة", "تم تعيين" in page.inner_text("#msg"))
    page.once("dialog", lambda d: d.accept())
    page.click("#tenants button[data-act=toggle]")
    page.locator("#tenants", has_text="موقوف").wait_for()
    check("إيقاف المستشفى من لوحة المنصة", "موقوف" in page.inner_text("#tenants"))
    page.click("#tenants button[data-act=toggle]")
    page.locator("#tenants", has_text="فعّال").wait_for()
    check("إعادة تفعيل المستشفى", "فعّال" in page.inner_text("#tenants"))
    # إدارة موظفي مستشفى من لوحة المنصة
    page.click("#tenants button[data-act=manage]")
    page.locator("#tenants .detail", has_text="admin@alafia.com").wait_for()
    check("إدارة الموظفين: تظهر قائمة موظفي المستشفى بآخر دخول", "آخر دخول" in page.inner_text("#tenants .detail") and "د. منتصر" in page.inner_text("#tenants .detail"))
    page.fill("#tenants .s-name", "لينا"); page.fill("#tenants .s-email", "lina@alafia.com"); page.fill("#tenants .s-pass", "Zebra-pass-5532")
    page.select_option("#tenants .s-role", "reception"); page.click("#tenants button[data-act=s-add]")
    page.locator("#tenants .detail", has_text="lina@alafia.com").wait_for()
    check("إضافة موظف من لوحة المنصة", "لينا" in page.inner_text("#tenants .detail"))
    page.screenshot(path="/tmp/ui-platform-manage.png", full_page=True)
    page.once("dialog", lambda d: d.accept("Violet-new-7788"))
    page.locator("#tenants .detail tr", has_text="lina@alafia.com").locator("button[data-act=s-pass]").click()
    page.locator("#msg", has_text="تم تغيير كلمة مرور الموظف").wait_for()
    page.locator("#tenants .detail tr", has_text="lina@alafia.com").locator("button[data-act=s-toggle]").click()
    page.locator("#tenants .detail tr.off", has_text="lina@alafia.com").wait_for()
    check("إيقاف موظف من لوحة المنصة", "موقوف" in page.inner_text("#tenants .detail"))
    page.click("#tenants button[data-act=unlock]")
    page.locator("#msg", has_text="فك قفل الدخول").wait_for()
    check("فك قفل المستشفى", True)
    page.locator("#paudit", has_text="إنشاء مستشفى").wait_for()
    check("نشاط المنصة يعرض الأحداث باسم المستشفى", "مستشفى العافية" in page.inner_text("#paudit"))

    # مدير المستشفى: كل أقسام مستشفاه
    page.click("#logout"); login(page, "alafia", "admin@alafia.com", "Platform-reset-pass-9")
    check("المدير يرى المرضى والنموذج والمواعيد والحجز والموظفين والسجل", visible(page) == {"patients", "p-form", "appts", "a-form", "staff", "audit", "account"})
    page.locator("#audit", has_text="دخول").wait_for()
    check("سجل النشاط يعرض أحداثًا بأسماء عربية", "دخول" in page.inner_text("#audit"))
    page.screenshot(path="/tmp/ui-admin.png", full_page=True)

    # الاستقبال: بلا موظفين
    page.click("#logout"); login(page, "alafia", "rec@alafia.com", "recept1234")
    check("الاستقبال: مرضى ونموذج ومواعيد وحجز بلا موظفين", visible(page) == {"patients", "p-form", "appts", "a-form", "account"})
    page.wait_for_selector("#a-patient option:nth-child(2)", state="attached")
    page.select_option("#a-doctor", doc_id); page.select_option("#a-time", "10:00"); page.fill("#a-reason", "كشف")
    page.click("#do-appt"); page.locator("#appts", has_text="10:00").wait_for()
    check("الاستقبال يرى اسم الطبيب في صف الموعد", "د. منتصر" in page.inner_text("#appts"))
    check("اسم مريض خبيث يُعرض نصًا لا وسومًا (XSS)", page.locator("#patients img, #patients b").count() == 0 and page.evaluate("() => window.__xss") is None and "onerror" in page.inner_text("#patients"))
    check("الاستقبال يرى زر الإلغاء", page.locator("#appts button[data-st=cancelled]").count() == 1)
    page.screenshot(path="/tmp/ui-reception.png", full_page=True)

    # الطبيب: قوائم قراءة فقط، ومواعيده هو
    page.click("#logout"); login(page, "alafia", "doc@alafia.com", "doctor1234")
    check("الطبيب: قائمة المرضى والمواعيد فقط", visible(page) == {"patients", "appts", "account"})
    check("الطبيب: لا نموذج تسجيل مريض ولا حجز ولا موظفين", not any(page.is_visible(SECTIONS[k]) for k in ["p-form", "a-form", "staff"]))
    check("الطبيب: لا زر إلغاء", page.locator("#appts button[data-st=cancelled]").count() == 0)
    check("الطبيب: رأس الجدول المريض فقط", page.inner_text("#appts-th").strip() == "المريض")
    check("الطبيب: لا يرى اسمه في كل صف", "د. منتصر" not in page.inner_text("#appts"))
    check("الطبيب: يرى سبب الزيارة", "كشف" in page.inner_text("#appts"))
    page.screenshot(path="/tmp/ui-doctor.png", full_page=True)

    # المحاسب: قائمة المرضى فقط
    page.click("#logout"); login(page, "alafia", "acc@alafia.com", "account1234")
    check("المحاسب: قائمة المرضى فقط", visible(page) == {"patients", "account"})
    body = page.inner_text("body")
    check("المحاسب: لا يرى كلمات الحجز أو الموظفين", all(w not in body for w in ["حجز موعد", "إضافة موظف", "تسجيل مريض"]))
    page.screenshot(path="/tmp/ui-accountant.png", full_page=True)
    page.fill("#acc-current", "account1234"); page.fill("#acc-new", "Account-new-9915"); page.click("#do-pass")
    page.locator("#msg", has_text="تم تغيير كلمة المرور").wait_for()
    check("المحاسب غيّر كلمة مروره وبقي داخل الجلسة", page.is_visible("#s-patients") and page.input_value("#acc-new") == "")
    page.click("#logout"); login(page, "alafia", "acc@alafia.com", "Account-new-9915")
    check("الدخول بكلمة المرور الجديدة", page.is_visible("#s-patients"))

    # خروج: لا بقايا بيانات على الشاشة
    page.click("#logout")
    check("بعد الخروج: لا أقسام ظاهرة", visible(page) == set())
    check("لا أخطاء جافاسكربت في الصفحة", not errors)
    check("لا انتهاكات CSP غير المقصودة (ما عدا حقن الاختبار)", len([m for m in csp_msgs if "inline script" not in m.lower()]) == 0)
    b.close()

failed = [n for n, ok in results if not ok]
print("\nالنتيجة:", "نجحت كل الفحوص" if not failed else f"فشل: {failed}")
sys.exit(1 if failed else 0)
