# اختبار الواجهة في متصفح فعلي بحجم الجوال (390x844)
import json, urllib.request, sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8799"
def api(path, method="GET", body=None, token=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body else None,
        headers={"content-type": "application/json", **({"authorization": "Bearer " + token} if token else {})})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read())

# تجهيز البيانات عبر الواجهات
api("/api/setup", "POST", {"key": "ui-key", "name": "مدير", "email": "root@x.com", "password": "rootpass123"})
plat = api("/api/auth/login", "POST", {"slug": "platform", "email": "root@x.com", "password": "rootpass123"})[1]["token"]
api("/api/platform/tenants", "POST", {"name": "مستشفى العافية", "slug": "alafia", "admin_name": "عبدالله علي", "admin_email": "admin@alafia.com", "admin_password": "hospital123"}, plat)
adm = api("/api/auth/login", "POST", {"slug": "alafia", "email": "admin@alafia.com", "password": "hospital123"})[1]["token"]
api("/api/staff", "POST", {"name": "د. منتصر", "email": "doc@alafia.com", "password": "doctor1234", "role": "doctor"}, adm)
api("/api/staff", "POST", {"name": "معاذ", "email": "rec@alafia.com", "password": "recept1234", "role": "reception"}, adm)
api("/api/staff", "POST", {"name": "عمر", "email": "acc@alafia.com", "password": "account1234", "role": "accountant"}, adm)
api("/api/patients", "POST", {"full_name": "محمد آدم", "phone": "0918155613"}, adm)
api("/api/patients", "POST", {"full_name": "سارة عثمان", "phone": "0912345678"}, adm)

def login(page, email, password):
    page.goto(BASE); page.fill("#slug", "alafia"); page.fill("#email", email); page.fill("#password", password)
    page.click("#do-login"); page.wait_for_selector("#logout:not([hidden])")

results = []
def check(name, cond):
    results.append((name, bool(cond))); print(("✔ " if cond else "✘ ") + name)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="ar")
    page = ctx.new_page()
    errors = []; page.on("pageerror", lambda e: errors.append(str(e)))

    # الاستقبال: يحجز ويرى الأقسام المناسبة
    login(page, "rec@alafia.com", "recept1234")
    check("الاستقبال يرى قسم المواعيد", page.is_visible("#s-appts"))
    check("الاستقبال يرى نموذج الحجز", page.is_visible("#a-form"))
    check("الاستقبال لا يرى قسم الموظفين", not page.is_visible("#s-staff"))
    page.wait_for_function("document.querySelectorAll('#a-patient option').length >= 2")
    day = page.input_value("#a-day")
    page.select_option("#a-time", "10:00"); page.fill("#a-reason", "كشف")
    page.click("#do-appt"); page.wait_for_function("document.getElementById('appts').innerText.includes('10:00')")
    check("ظهر الموعد في القائمة", "10:00" in page.inner_text("#appts"))
    page.click("#do-appt"); page.wait_for_function("document.getElementById('msg').classList.contains('err')")
    check("حجز مزدوج: ظهرت رسالة الرفض", "محجوز" in page.inner_text("#msg"))
    page.screenshot(path="/tmp/ui-reception.png", full_page=True)

    # الطبيب: يرى مواعيده بدون نموذج حجز، ولا يرى زر الإلغاء
    page.click("#logout"); login(page, "doc@alafia.com", "doctor1234")
    check("الطبيب يرى قسم المواعيد", page.is_visible("#s-appts"))
    check("الطبيب لا يرى نموذج الحجز", not page.is_visible("#a-form"))
    check("الطبيب لا يرى زر الإلغاء", page.locator("#appts button[data-st=cancelled]").count() == 0)
    page.click("#appts button[data-st=done]"); page.wait_for_function("document.querySelector('#appts small')")
    check("الطبيب أنهى الموعد", "تمت" in page.inner_text("#appts"))

    # المحاسب: يقرأ المرضى فقط
    page.click("#logout"); login(page, "acc@alafia.com", "account1234")
    check("المحاسب لا يرى نموذج تسجيل مريض", not page.is_visible("#p-form"))
    check("المحاسب لا يرى المواعيد", not page.is_visible("#s-appts"))
    check("المحاسب يرى قائمة المرضى", "محمد آدم" in page.inner_text("#patients"))

    # المدير: يرى كل شيء
    page.click("#logout"); login(page, "admin@alafia.com", "hospital123")
    check("المدير يرى الأقسام الأربعة", all(page.is_visible(s) for s in ["#s-patients", "#s-appts", "#a-form", "#s-staff"]))
    page.screenshot(path="/tmp/ui-admin.png", full_page=True)
    check("لا أخطاء جافاسكربت في الصفحة", not errors)
    b.close()

failed = [n for n, ok in results if not ok]
print("\nالنتيجة:", "نجحت كل الفحوص" if not failed else f"فشل: {failed}")
sys.exit(1 if failed else 0)
