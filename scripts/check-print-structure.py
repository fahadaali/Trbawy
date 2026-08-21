#!/usr/bin/env python3
# تدقيق بنية المحضر المطبوع على ملف PDF مُخرَج فعلًا:
#   • كل قسم يفتتح صفحة، بترتيبه ومرة واحدة داخل كل محضر (الحزمة تضمّ عدّة محاضر).
#   • لا صفحة بلا محتوى — مع تجاهل شريطَي هامش المتصفح اللذين يطبع فيهما تاريخه ورابطه.
# يحرس ما انكسر فعلًا من قبل: التحام الأقسام حين حُوِّلت من عناصر كتلية إلى صفوف جدول،
# والصفحة الفارغة حين كان فاصل نهاية القسم عنصرًا مستقلًّا يُدفع وحده إلى صفحة.
#
#   الاستعمال:  python3 scripts/check-print-structure.py محضر.pdf [...]
#   يتطلّب:     pip install pymupdf
import sys, pymupdf
SECTIONS = ['محضر اجتماع', 'جدول الأعمال والبنود', 'متابعة بنود المحاضر السابقة',
            'القرارات والتوصيات والمهام', 'التوقيعات']
import unicodedata, re
def _fold(t):
    t = unicodedata.normalize('NFKC', t)
    t = re.sub('[\u064B-\u0652\u0670]', '', t)          # التشكيل
    t = t.replace('\u0623','\u0627').replace('\u0625','\u0627').replace('\u0622','\u0627')
    t = t.replace('\u0649','\u064a').replace('\u0629','\u0647')
    return re.sub(r'\s+', ' ', t).strip()
# استخراج النص العربي من PDF يعكس ترتيب الكلمات وقد يخلط ترتيب الحروف داخل
# الكلمة، فالمقارنة على «بصمة الحروف»: الحروف نفسها مرتّبة بلا مسافات.
def norm(t): return _fold(' '.join(reversed(t.split())))
def key(t): return ''.join(sorted(_fold(t).replace(' ', '')))
def head_lines(p, n=3):
    out=[]
    for l in p.get_text().split('\n'):
        l=l.strip()
        if l: out.append(l)
        if len(out)>=n: break
    return out
def spans(p):
    """مقاطع النص داخل متن الصفحة وحدها. نستبعد شريطي الهامش العلوي والسفلي
    لأن المتصفح يطبع فيهما تاريخه ورابطه ورقم الصفحة، فتبدو صفحة فارغة عامرة."""
    h = p.rect.height; lo, hi = h * 0.12, h * 0.88
    n = 0
    for b in p.get_text("dict")["blocks"]:
        if b.get("type") != 0: continue
        for l in b["lines"]:
            for sp in l["spans"]:
                if not sp["text"].strip(): continue
                yc = (sp["bbox"][1] + sp["bbox"][3]) / 2
                if lo <= yc <= hi: n += 1
    return n
bad=0
for path in sys.argv[1:]:
    d=pymupdf.open(path); print(f"=== {path} ({d.page_count} صفحة) ===")
    seen=[]
    for i,p in enumerate(d,1):
        heads=head_lines(p)
        if spans(p) < 3:
            print(f"  ✘ صفحة {i}: بلا محتوى"); bad+=1; continue
        hit=[s for s in SECTIONS if any(key(h)==key(s) for h in heads)]
        if hit: seen.append((i,hit[0]))
    print('   الأقسام وبداياتها:', ' · '.join(f"{s}(ص{i})" for i,s in seen) or 'لا شيء')
    # الحزمة تضمّ عدّة محاضر: نتحقّق داخل كل محضر على حدة (يبدأ بـ «محضر اجتماع»)
    names=[s for _,s in seen]
    groups=[]
    for n in names:
        if n == SECTIONS[0] or not groups: groups.append([])
        groups[-1].append(n)
    for g in groups:
        if len(g)!=len(set(g)): print('  ✘ قسم يبدأ أكثر من مرة داخل محضر واحد'); bad+=1
        order=[SECTIONS.index(x) for x in g]
        if order!=sorted(order): print('  ✘ ترتيب الأقسام مختلّ'); bad+=1
    # وكل قسم موجود في المحضر يجب أن يفتتح صفحة
    lines=[l.strip() for pg in d for l in pg.get_text().split('\n') if l.strip()]
    present={s for s in SECTIONS for l in lines if key(l)==key(s)}
    for s in SECTIONS:
        if s in present and s not in names:
            print(f'  ✘ «{s}» موجود لكنه لا يفتتح صفحة — التحم بقسم قبله'); bad+=1
print('المحصّلة:', 'سليم' if not bad else f'{bad} خلل')
sys.exit(1 if bad else 0)
