/**
 * Shared bilingual spellcheck helpers for Electron main + Express server.
 *
 * English: nspell + en-US Hunspell dictionary (works well).
 * Arabic: dedicated ArabicSpellEngine (SymSpell-style index + morphology)
 *         — NOT Hunspell/nspell, whose Arabic suggestions are unusable.
 */

"use strict";

const { loadArabicEngine } = require("./arabic-spell-engine.cjs");

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
const LATIN_WORD_RE = /^[A-Za-z]+(?:['\u2019-][A-Za-z]+)*$/;
// Invisible BIDI controls, Tatweel, Arabic diacritics (tashkeel)
const CLEAN_TOKEN_RE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\u0640\u064B-\u0652\u0670]/g;
const DIACRITICS_RE = /[\u064B-\u0652\u0640\u0670]/g;

// Multi-character proclitics only (used freely in the morphology BFS).
// Single-letter و/ف/ب/ل/ك/س are handled separately — one optional strip —
// so chains like ال+س don't invent stems (e.g. السسلام ↛ سلام).
const AR_PREFIXES_LONG = [
  "وبال",
  "فبال",
  "وكال",
  "فكال",
  "ولل",
  "فلل",
  "بال",
  "كال",
  "وال",
  "فال",
  "لل",
  "ال",
  "وس",
  "فس",
  "وب",
  "فب",
  "ول",
  "فل",
  "وك",
  "فك",
];

// At most ONE of these may be stripped from a form (not inside the BFS).
const AR_PREFIXES_SHORT = ["و", "ف", "ب", "ل", "ك", "س"];

// Back-compat: full list longest-first
const AR_PREFIXES = [...AR_PREFIXES_LONG, ...AR_PREFIXES_SHORT];

// Attached pronoun enclitics (longest first). Single-letter ك/ه/ي/ت are
// included but only applied when the remaining stem is long enough AND known
// — so تعديلاتك / حقوقه / لإنصافه work without masking short typos.
const AR_ENCLITICS = [
  "يهما",
  "يهن",
  "هما",
  "كما",
  "تما",
  "تهم",
  "كم",
  "كن",
  "هم",
  "هن",
  "ها",
  "نا",
  "ني",
  "ته",
  "تي",
  "ك",
  "ه",
  "ي",
  "ت",
];

// Inflectional / derivational endings (plurals, dual, feminine, adverbial يا).
const AR_ENDINGS = [
  "يات",
  "تين",
  "تان",
  "ون",
  "ين",
  "ات",
  "ان",
  "ية",
  "يا", // تعسفياً / علنياً (diacritics already stripped)
  "وا",
  "تم",
  "تن",
  "ة",
  "ا",
];

// Back-compat alias used by older call sites / tests
const AR_SUFFIXES = [...AR_ENCLITICS, ...AR_ENDINGS];

// Frequent modern / UI words that older Ayaspell packs miss even after stem
// stripping. Kept small and high-precision — not a second dictionary.
const AR_EXTRA_WORDS = new Set(
  [
    "مرحبا",
    "أهلا",
    "شكرا",
    "من فضلك",
    "لو سمحت",
    "السلام",
    "عليكم",
    "ورحمة",
    "وبركاته",
    "السعودية",
    "المملكة",
    "العربية",
    "الامارات",
    "الإمارات",
    "الكويت",
    "قطر",
    "البحرين",
    "عمان",
    "مصر",
    "المغرب",
    "تونس",
    "الجزائر",
    "العراق",
    "سوريا",
    "لبنان",
    "الاردن",
    "الأردن",
    "فلسطين",
    "اليمن",
    "السودان",
    "ليبيا",
    "تطبيق",
    "التطبيق",
    "مستخدم",
    "المستخدم",
    "مستخدمين",
    "المستخدمين",
    "كلمة",
    "كلمات",
    "مرور",
    "البريد",
    "الكتروني",
    "إلكتروني",
    "الايميل",
    "الإيميل",
    "ايميل",
    "إيميل",
    "حساب",
    "الحساب",
    "كلمةالسر",
    "الباسورد",
    "باسورد",
    "مشكلة",
    "المشكلة",
    "حل",
    "الحل",
    "اليوم",
    "الوقت",
    "الساعة",
    "التاريخ",
    "ملاحظة",
    "ملاحظات",
    "سجل",
    "السجل",
    "بحث",
    "البحث",
    "حفظ",
    "الحفظ",
    "حذف",
    "الحذف",
    "تعديل",
    "التعديل",
    "إضافة",
    "الاضافة",
    "الإضافة",
    "إعدادات",
    "الاعدادات",
    "الإعدادات",
    "لغة",
    "اللغة",
    "عربي",
    "العربي",
    "انجليزي",
    "الإنجليزي",
    "الانجليزي",
    "مختلط",
    "ثنائي",
    "كلمة",
    "جملة",
    "نص",
    "النصوص",
    "عنوان",
    "العنوان",
    "وصف",
    "الوصف",
    "قيمة",
    "القيمة",
    "نوع",
    "النوع",
    "سر",
    "السر",
    "أسرار",
    "الاسرار",
    "الأسرار",
    "خزنة",
    "الخزنة",
    "قبو",
    "القبو",
    "مجلد",
    "المجلد",
    "ملفات",
    "الملفات",
    "ملف",
    "الملف",
    "رابط",
    "الرابط",
    "موقع",
    "الموقع",
    "شبكة",
    "الشبكة",
    "انترنت",
    "الإنترنت",
    "الانترنت",
    "جهاز",
    "الجهاز",
    "هاتف",
    "الهاتف",
    "حاسوب",
    "الحاسوب",
    "كمبيوتر",
    "الكمبيوتر",
    "نظام",
    "النظام",
    "برنامج",
    "البرنامج",
    "برامج",
    "البرامج",
    "تحديث",
    "التحديث",
    "نسخة",
    "النسخة",
    "احتياطي",
    "الاحتياطي",
    "استعادة",
    "الاستعادة",
    "تشفير",
    "التشفير",
    "مفتاح",
    "المفتاح",
    "رمز",
    "الرمز",
    "رموز",
    "الرموز",
    "تحقق",
    "التحقق",
    "تأكيد",
    "التأكيد",
    "إلغاء",
    "الالغاء",
    "الإلغاء",
    "موافق",
    "نعم",
    "لا",
    "حسنا",
    "حسناً",
    "تمام",
    "جيد",
    "سيء",
    "مهم",
    "عاجل",
    "شخصي",
    "العمل",
    "عمل",
    "منزل",
    "المنزل",
    "عنواني",
    "رقمي",
    "رقمك",
    "هاتفي",
    "اسم",
    "الاسم",
    "اسمي",
    "عائلي",
    "العائلي",
    "مولود",
    "المولود",
    "تاريخ",
    "مدينة",
    "المدينة",
    "دولة",
    "الدولة",
    "شارع",
    "الشارع",
    "حي",
    "الحي",
    "رقم",
    "الرقم",
    "أرقام",
    "الارقام",
    "الأرقام",
    "بطاقة",
    "البطاقة",
    "ائتمان",
    "الائتمان",
    "بنك",
    "البنك",
    "حسابي",
    "رصيد",
    "الرصيد",
    "تحويل",
    "التحويل",
    "فاتورة",
    "الفاتورة",
    "فواتير",
    "الفواتير",
    "دفع",
    "الدفع",
    "اشتراك",
    "الاشتراك",
    "خدمة",
    "الخدمة",
    "خدمات",
    "الخدمات",
    "دعم",
    "الدعم",
    "مساعدة",
    "المساعدة",
    "سؤال",
    "السؤال",
    "أسئلة",
    "الاسئلة",
    "الأسئلة",
    "جواب",
    "الجواب",
    "إجابة",
    "الاجابة",
    "الإجابة",
    "معلومة",
    "المعلومة",
    "معلومات",
    "المعلومات",
    "بيانات",
    "البيانات",
    "خصوصية",
    "الخصوصية",
    "أمان",
    "الامان",
    "الأمان",
    "حماية",
    "الحماية",
    "نسخ",
    "النسخ",
    "لصق",
    "اللصق",
    "قص",
    "القص",
    "تراجع",
    "التراجع",
    "إعادة",
    "الاعادة",
    "الإعادة",
    "مسح",
    "المسح",
    "تنظيف",
    "التنظيف",
    "فرز",
    "الفرز",
    "تصفية",
    "التصفية",
    "ترتيب",
    "الترتيب",
    "قائمة",
    "القائمة",
    "قوائم",
    "القوائم",
    "تبويب",
    "التبويب",
    "صفحة",
    "الصفحة",
    "صفحات",
    "الصفحات",
    "واجهة",
    "الواجهة",
    "سمة",
    "السمة",
    "مظهر",
    "المظهر",
    "داكن",
    "فاتح",
    "الوضع",
    "وضع",
    "حجم",
    "الحجم",
    "خط",
    "الخط",
    "خطوط",
    "الخطوط",
    "لون",
    "اللون",
    "ألوان",
    "الالوان",
    "الألوان",
    "تمييز",
    "التمييز",
    "غامق",
    "مائل",
    "تحته",
    "خط",
    "مسودة",
    "المسودة",
    "مسودات",
    "المسودات",
    "ملاحظة",
    "ملاحظاتي",
    "مذكرة",
    "المذكرة",
    "يوميات",
    "اليوميات",
    "تذكير",
    "التذكير",
    "مهمة",
    "المهمة",
    "مهام",
    "المهام",
    "مشروع",
    "المشروع",
    "مشاريع",
    "المشاريع",
    "فريق",
    "الفريق",
    "عميل",
    "العميل",
    "عملاء",
    "العملاء",
    "مورد",
    "المورد",
    "موردين",
    "الموردين",
    "فاتورتي",
    "إيصال",
    "الايصال",
    "الإيصال",
    "سند",
    "السند",
    "عقد",
    "العقد",
    "عقود",
    "العقود",
    "وثيقة",
    "الوثيقة",
    "وثائق",
    "الوثائق",
    "صورة",
    "الصورة",
    "صور",
    "الصور",
    "مرفق",
    "المرفق",
    "مرفقات",
    "المرفقات",
    "تحميل",
    "التحميل",
    "رفع",
    "الرفع",
    "تنزيل",
    "التنزيل",
    "مزامنة",
    "المزامنة",
    "سحابة",
    "السحابة",
    "محلي",
    "المحلي",
    "محمول",
    "المحمول",
    "محمول",
    "جوال",
    "الجوال",
    "لوحي",
    "اللس",
    "لمس",
    "فأرة",
    "الفأرة",
    "لوحة",
    "اللوحة",
    "مفاتيح",
    "المفاتيح",
    "اختصار",
    "الاختصار",
    "اختصارات",
    "الاختصارات",
    "إشعار",
    "الاشعار",
    "الإشعار",
    "إشعارات",
    "الاشعارات",
    "الإشعارات",
    "تنبيه",
    "التنبيه",
    "تنبيهات",
    "التنبيهات",
    "خطأ",
    "الخطأ",
    "أخطاء",
    "الاخطاء",
    "الأخطاء",
    "تحذير",
    "التحذير",
    "نجاح",
    "النجاح",
    "فشل",
    "الفشل",
    "انتظار",
    "الانتظار",
    "جاري",
    "الجاري",
    "تحميل",
    "معالجة",
    "المعالجة",
    "جاهز",
    "الجاهز",
    "متاح",
    "المتاح",
    "غير",
    "متوفر",
    "المتوفّر",
    "المتوفرة",
    "مفعل",
    "المفعل",
    "معطل",
    "المعطل",
    "مفعّل",
    "معطّل",
    "اختياري",
    "الاختياري",
    "إلزامي",
    "الالزامي",
    "الإلزامي",
    "مطلوب",
    "المطلوب",
    "افتراضي",
    "الافتراضي",
    "مخصص",
    "المخصص",
    "عام",
    "العام",
    "خاص",
    "الخاص",
    "مشترك",
    "المشترك",
    "مخفي",
    "المخفي",
    "ظاهر",
    "الظاهر",
    "مفتوح",
    "المفتوح",
    "مغلق",
    "المغلق",
    "مؤرشف",
    "المؤرشف",
    "أرشفة",
    "الارشفة",
    "الأرشفة",
    "استعادة",
    "استرجاع",
    "الاسترجاع",
    "نهائي",
    "النهائي",
    "نهائية",
    "النهائية",
    "مؤقت",
    "المؤقت",
    "دائم",
    "الدائم",
    "سريع",
    "السريع",
    "بطيء",
    "البطيء",
    "كبير",
    "الكبير",
    "كبيرة",
    "الكبيرة",
    "صغير",
    "الصغير",
    "صغيرة",
    "الصغيرة",
    "طويل",
    "الطويل",
    "قصيرة",
    "القصيرة",
    "قصير",
    "القصير",
    "جديد",
    "الجديد",
    "جديدة",
    "الجديدة",
    "قديم",
    "القديم",
    "قديمة",
    "القديمة",
    "أول",
    "الاول",
    "الأول",
    "آخر",
    "الاخر",
    "الآخر",
    "التالي",
    "السابق",
    "الحالي",
    "التالي",
    "السابق",
    "أعلى",
    "الأعلى",
    "أسفل",
    "الأسفل",
    "يمين",
    "اليمين",
    "يسار",
    "اليسار",
    "وسط",
    "الوسط",
    "كامل",
    "الكامل",
    "جزئي",
    "الجزئي",
    "نصفي",
    "النصف",
    "نصف",
    "كل",
    "الكل",
    "بعض",
    "البعض",
    "أي",
    "اي",
    "لاشيء",
    "شيء",
    "الشيء",
    "أشياء",
    "الاشياء",
    "الأشياء",
    "هنا",
    "هناك",
    "الآن",
    "الان",
    "غدا",
    "غداً",
    "أمس",
    "امس",
    "اليوم",
    "الأسبوع",
    "الاسبوع",
    "الشهر",
    "السنة",
    "عام",
    "دقيقة",
    "الدقيقة",
    "دقائق",
    "الدقائق",
    "ثانية",
    "الثانية",
    "ثوان",
    "الثواني",
    "ساعة",
    "ساعات",
    "الساعات",
    "يوم",
    "أيام",
    "الايام",
    "الأيام",
    "أسبوع",
    "أسابيع",
    "الاسابيع",
    "الأسابيع",
    "شهر",
    "أشهر",
    "الاشهر",
    "الأشهر",
    "سنة",
    "سنوات",
    "السنوات",
    "مرة",
    "مرات",
    "المرات",
    "دائما",
    "دائماً",
    "أبدا",
    "أبداً",
    "ابدا",
    "احيانا",
    "أحيانا",
    "أحياناً",
    "غالبا",
    "غالباً",
    "نادرا",
    "نادراً",
    "جدا",
    "جداً",
    "كثيرا",
    "كثيراً",
    "قليلا",
    "قليلاً",
    "فقط",
    "أيضا",
    "أيضاً",
    "ايضا",
    "كذلك",
    "لكن",
    "ولكن",
    "لأن",
    "لان",
    "إذا",
    "اذا",
    "عندما",
    "بينما",
    "حيث",
    "حتى",
    "قبل",
    "بعد",
    "أثناء",
    "اثناء",
    "خلال",
    "بدون",
    "مع",
    "ضد",
    "حول",
    "قرب",
    "بعيد",
    "قريب",
    "داخل",
    "خارج",
    "فوق",
    "تحت",
    "بين",
    "أمام",
    "امام",
    "خلف",
    "جانب",
    "نحو",
    "صوب",
    "إلى",
    "الى",
    "من",
    "عن",
    "على",
    "في",
    "بـ",
    "لـ",
    "كـ",
    "و",
    "ف",
    "ثم",
    "أو",
    "او",
    "أم",
    "ام",
    "هل",
    "ماذا",
    "لماذا",
    "كيف",
    "متى",
    "أين",
    "اين",
    "من",
    "كم",
    "أي",
    "اي",
    "هذا",
    "هذه",
    "ذلك",
    "تلك",
    "هؤلاء",
    "أولئك",
    "اولئك",
    "أنا",
    "انا",
    "أنت",
    "انت",
    "أنتم",
    "انتم",
    "أنتن",
    "انتن",
    "هو",
    "هي",
    "هم",
    "هن",
    "نحن",
    "كان",
    "كانت",
    "يكون",
    "تكون",
    "ليس",
    "ليست",
    "لدي",
    "عندي",
    "عندك",
    "عنده",
    "عندها",
    "لدينا",
    "يوجد",
    "توجد",
    "يمكن",
    "يجب",
    "ينبغي",
    "أريد",
    "اريد",
    "نريد",
    "يحتاج",
    "تحتاج",
    "يعمل",
    "تعمل",
    "يستخدم",
    "تستخدم",
    "يفتح",
    "يغلق",
    "يحفظ",
    "يحذف",
    "يعدل",
    "يضيف",
    "يبحث",
    "يكتب",
    "يقرأ",
    "يقرأ",
    "يقول",
    "يفعل",
    "يرى",
    "يعرف",
    "يفهم",
    "يفكر",
    "يتذكر",
    "ينسى",
    "يبدأ",
    "ينتهي",
    "يستمر",
    "يتوقف",
    "يرسل",
    "يستقبل",
    "يحمّل",
    "يرفع",
    "ينزّل",
    "يتصل",
    "يفصل",
    "يسجّل",
    "يدخل",
    "يخرج",
    "يعود",
    "يذهب",
    "يأتي",
    "ياتي",
    "يجري",
    "يمشي",
    "يقف",
    "يجلس",
    "ينام",
    "يستيقظ",
    "يأكل",
    "يشرب",
    "يعمل",
    "يلعب",
    "يدرس",
    "يتعلم",
    "يعلّم",
    "يساعد",
    "يطلب",
    "يجيب",
    "يسأل",
    "يسال",
    "يتحدث",
    "يسمع",
    "ينظر",
    "يراقب",
    "يفحص",
    "يختبر",
    "يجرّب",
    "يصلح",
    "يكسر",
    "يبني",
    "ينشئ",
    "ينشىء",
    "يصمّم",
    "يطوّر",
    "يحسّن",
    "يغيّر",
    "يستبدل",
    "ينقل",
    "ينسخ",
    "يلصق",
    "يقص",
    "يمسح",
    "يملأ",
    "يفرغ",
    "يفتح",
    "يغلق",
    "يقفل",
    "يفك",
    "يربط",
    "يفصل",
    "يجمع",
    "يفرّق",
    "يقارن",
    "يختار",
    "يحدّد",
    "يلغي",
    "يؤكد",
    "يرفض",
    "يقبل",
    "يوافق",
    "يعارض",
    "يقترح",
    "ينصح",
    "يحذّر",
    "يخبر",
    "يشرح",
    "يوضح",
    "يلخّص",
    "يترجم",
    "يفسّر",
    "يعرّف",
    "يسمّي",
    "يصنّف",
    "يرقّم",
    "يعدّ",
    "يحسب",
    "يقيس",
    "يزن",
    "يدفع",
    "يقبض",
    "يشتري",
    "يبيع",
    "يستأجر",
    "يؤجّر",
    "يملك",
    "يمتلك",
    "يفقد",
    "يجد",
    "يبحث",
    "يعثر",
    "يضيّع",
    "يحمي",
    "يهاجم",
    "يدافع",
    "يفوز",
    "يخسر",
    "ينجح",
    "يفشل",
    "يحاول",
    "ينجح",
    "يستطيع",
    "يقدر",
    "يعجز",
    "يريد",
    "يرغب",
    "يحتاج",
    "يفتقر",
    "يمتلك",
    "يحتوي",
    "يشمل",
    "يستثني",
    "يضيف",
    "يزيل",
    "يزيد",
    "ينقص",
    "يكبّر",
    "يصغّر",
    "يطيل",
    "يقصّر",
    "يوسّع",
    "يضيّق",
    "يرفع",
    "يخفض",
    "يقدّم",
    "يؤخّر",
    "يسرع",
    "يبطئ",
    "يسهّل",
    "يصعّب",
    "يحسّن",
    "يسيء",
    "يصحّح",
    "يخطئ",
    "يتأكد",
    "يشك",
    "يثق",
    "يرتبط",
    "ينفصل",
    "يتّصل",
    "يتواصل",
    "يتفاعل",
    "يستجيب",
    "يتجاهل",
    "يهتم",
    "يهمل",
    "يركّز",
    "يتشتت",
    "يتذكّر",
    "ينسى",
    "يفهم",
    "يسيء",
    "الفهم",
    "يتعلّم",
    "يدرّس",
    "يدرّب",
    "يتدرّب",
    "يمارس",
    "يطبّق",
    "ينفّذ",
    "يشغّل",
    "يوقف",
    "يعلّق",
    "يستأنف",
    "يعيد",
    "يكرّر",
    "يتابع",
    "يتخطّى",
    "يتجاوز",
    "يرجع",
    "يعود",
    "يغادر",
    "يصل",
    "يغادر",
    "يدخل",
    "يخرج",
    "يصعد",
    "ينزل",
    "يقفز",
    "يسقط",
    "يقع",
    "ينهض",
    "يستلقي",
    "يجلس",
    "يقف",
  ].filter(Boolean)
);

function sanitizeToken(token) {
  return typeof token === "string" ? token.replace(CLEAN_TOKEN_RE, "") : "";
}

function stripArabicDiacritics(str) {
  return str.replace(DIACRITICS_RE, "");
}

function isArabicToken(token) {
  return typeof token === "string" && ARABIC_RE.test(token);
}

function isLatinToken(token) {
  return typeof token === "string" && LATIN_WORD_RE.test(token);
}

function arabicWordVariants(word) {
  const out = new Set([word]);
  // Alef / yeh / teh-marbuta orthographic variants (very common)
  out.add(word.replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه"));
  out.add(word.replace(/[أإآ]/g, "ا"));
  out.add(word.replace(/ى/g, "ي"));
  out.add(word.replace(/ي/g, "ى"));
  out.add(word.replace(/ة/g, "ه"));
  out.add(word.replace(/ه$/g, "ة"));
  // Hamza seat shifts when a suffix is attached: أصدقاء → أصدقائهم
  if (word.endsWith("ائ")) out.add(word.slice(0, -2) + "اء");
  if (word.endsWith("اء")) out.add(word.slice(0, -2) + "ائ");
  return out;
}

function arabicWordIsKnown(word, arSpell) {
  if (!word || word.length <= 1) return false;
  if (AR_EXTRA_WORDS.has(word)) return true;
  for (const v of arabicWordVariants(word)) {
    if (AR_EXTRA_WORDS.has(v)) return true;
    if (arSpell && arSpell.correct(v)) return true;
  }
  return false;
}

function pushStemCandidate(queue, seen, stem, minLen) {
  if (!stem || stem.length < minLen || seen.has(stem)) return;
  seen.add(stem);
  queue.push(stem);
}

/**
 * Expand one form by stripping multi-char proclitics + enclitics + endings.
 * Single-letter prefixes are NOT expanded here (too greedy in a BFS).
 */
function expandArabicMorphology(cur, queue, seen) {
  for (const p of AR_PREFIXES_LONG) {
    if (cur.startsWith(p) && cur.length - p.length >= 2) {
      pushStemCandidate(queue, seen, cur.slice(p.length), 2);
    }
  }
  for (const s of AR_ENCLITICS) {
    if (!cur.endsWith(s)) continue;
    // Single-letter pronouns need a longer stem so short typos aren't swallowed.
    const minLen = s.length === 1 ? 3 : 2;
    if (cur.length - s.length >= minLen) {
      pushStemCandidate(queue, seen, cur.slice(0, cur.length - s.length), minLen);
    }
  }
  for (const s of AR_ENDINGS) {
    if (!cur.endsWith(s)) continue;
    if (cur.length - s.length >= 2) {
      pushStemCandidate(queue, seen, cur.slice(0, cur.length - s.length), 2);
    }
  }
}

/** Core morph check without short-prefix fan-out. */
function checkArabicCore(clean, arSpell) {
  if (arabicWordIsKnown(clean, arSpell)) return true;
  const seen = new Set([clean]);
  const queue = [];
  expandArabicMorphology(clean, queue, seen);
  let steps = 0;
  const MAX_STEPS = 80;
  while (queue.length && steps < MAX_STEPS) {
    const cur = queue.shift();
    steps++;
    if (!cur || cur.length <= 1) continue;
    if (arabicWordIsKnown(cur, arSpell)) return true;
    expandArabicMorphology(cur, queue, seen);
  }
  return false;
}

/** True when `ar` is our ArabicSpellEngine (not nspell). */
function isArabicEngine(ar) {
  return !!(ar && ar.deleteIndex instanceof Map && typeof ar.correct === "function");
}

/**
 * Arabic correctness. Prefers ArabicSpellEngine; falls back to nspell+morph.
 */
function checkArabicWord(w, arSpell) {
  if (!arSpell) return true;
  // New engine: full morph + word-set membership
  if (isArabicEngine(arSpell)) {
    return arSpell.correct(w);
  }
  // Legacy nspell path
  const clean = stripArabicDiacritics(sanitizeToken(w));
  if (!clean || clean.length <= 1) return true;
  if (checkArabicCore(clean, arSpell)) return true;

  for (const p of AR_PREFIXES_SHORT) {
    if (clean.startsWith(p) && clean.length - p.length >= 3) {
      if (checkArabicCore(clean.slice(p.length), arSpell)) return true;
    }
  }
  return false;
}

/** Damerau–Levenshtein distance (insert/delete/substitute/transpose). */
function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  // Cap work for long tokens
  if (Math.abs(m - n) > 4) return Math.abs(m - n) + 4;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + cost);
      }
    }
  }
  return dp[m][n];
}

// Letters commonly confused in Arabic typing / orthography.
const AR_CONFUSABLES = {
  ا: "أإآى",
  أ: "اإآ",
  إ: "اأآ",
  آ: "اأإ",
  ى: "يائ",
  ي: "ىئ",
  ئ: "يى",
  ة: "هت",
  ه: "ة",
  ت: "ةط",
  ث: "ت",
  س: "صش",
  ص: "س",
  ض: "ظد",
  ظ: "ضط",
  د: "ذض",
  ذ: "د",
  ق: "كف",
  ك: "ق",
  ف: "قڤ",
  و: "ؤ",
  ؤ: "و",
  ج: "حخ",
  ح: "جهخ",
  خ: "جح",
  ع: "غ",
  غ: "ع",
  ن: "ت",
  ر: "ز",
  ز: "ر",
};

/**
 * Arabic suggestions. Delegates to ArabicSpellEngine (SymSpell + edit-distance
 * ranking). Legacy nspell path kept as a thin fallback.
 *
 * Example: تنظرك + accidental س → تنظرسك → suggestion "تنظرك" (distance 1).
 */
function suggestArabicWord(w, arSpell, limit) {
  const max = typeof limit === "number" && limit > 0 ? limit : 8;
  if (!arSpell) return [];
  if (isArabicEngine(arSpell)) {
    return arSpell.suggest(w, max);
  }
  const clean = stripArabicDiacritics(sanitizeToken(w));
  if (!clean || clean.length <= 1) return [];

  // score = editDistance (+ quality bias); lower is better.
  const best = new Map(); // candidate -> score

  const isDictHit = (cand) => {
    if (AR_EXTRA_WORDS.has(cand)) return true;
    try {
      if (arSpell.correct(cand)) return true;
      for (const v of arabicWordVariants(cand)) {
        if (v !== cand && arSpell.correct(v)) return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  };

  const consider = (cand, bonus) => {
    if (!cand || cand === clean || cand === w) return;
    if (cand.length < 2) return;
    // Must be a real accepted form (dict + our morph)
    if (!checkArabicWord(cand, arSpell)) return;
    const dist = editDistance(clean, cand);
    // Reject far-away junk from nspell (e.g. تنظرسك vs تندرس)
    if (dist > 3) return;
    let score = dist + (typeof bonus === "number" ? bonus : 0);
    // Prefer true dictionary hits over morph-only recoveries
    if (isDictHit(cand)) score -= 0.55;
    // Prefer forms whose bare stem (drop one pronoun) is in the raw dict
    // e.g. تنظرك → تنظر (dict) ranks above ترسك → ترس (also dict but farther)
    for (const suf of ["كما", "هما", "ها", "هم", "هن", "كم", "كن", "نا", "ك", "ه", "ي"]) {
      if (cand.length - suf.length >= 3 && cand.endsWith(suf)) {
        const stem = cand.slice(0, cand.length - suf.length);
        if (isDictHit(stem)) {
          score -= 0.35;
          break;
        }
      }
    }
    // Mild preference for similar length
    score += Math.abs(cand.length - clean.length) * 0.05;
    const prev = best.get(cand);
    if (prev === undefined || score < prev) best.set(cand, score);
  };

  // --- 1) Single-character deletions (extra typed letter: تنظرسك → تنظرك) ---
  for (let i = 0; i < clean.length; i++) {
    consider(clean.slice(0, i) + clean.slice(i + 1), 0);
  }

  // --- 2) Adjacent transposition ---
  for (let i = 0; i < clean.length - 1; i++) {
    consider(
      clean.slice(0, i) + clean[i + 1] + clean[i] + clean.slice(i + 2),
      0
    );
  }

  // --- 3) Confusable single substitutions ---
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    const alts = AR_CONFUSABLES[ch] || "";
    for (const a of alts) {
      consider(clean.slice(0, i) + a + clean.slice(i + 1), 0);
    }
  }

  // --- 4) Double deletion only if few hits so far (two extra chars) ---
  if (clean.length >= 5 && best.size < 4) {
    for (let i = 0; i < clean.length; i++) {
      const one = clean.slice(0, i) + clean.slice(i + 1);
      for (let j = 0; j < one.length; j++) {
        consider(one.slice(0, j) + one.slice(j + 1), 0.15);
      }
    }
  }

  // --- 5) Strip one enclitic / ending, fix stem, re-attach ---
  // e.g. تنظرسك → strip ك → تنظرس → delete س → تنظر → reattach ك → تنظرك
  const tryReattach = (stem, suffix) => {
    if (!stem || stem.length < 2) return;
    // stem as-is
    if (checkArabicWord(stem, arSpell)) {
      consider(stem, 0.25);
      if (suffix) consider(stem + suffix, 0.1);
    }
    // delete one from stem
    for (let i = 0; i < stem.length; i++) {
      const s2 = stem.slice(0, i) + stem.slice(i + 1);
      if (checkArabicWord(s2, arSpell)) {
        consider(s2, 0.3);
        if (suffix) consider(s2 + suffix, 0.05);
      }
    }
  };

  for (const s of AR_ENCLITICS) {
    if (clean.endsWith(s) && clean.length - s.length >= 3) {
      tryReattach(clean.slice(0, clean.length - s.length), s);
    }
  }
  for (const s of AR_ENDINGS) {
    if (clean.endsWith(s) && clean.length - s.length >= 3) {
      tryReattach(clean.slice(0, clean.length - s.length), s);
    }
  }

  // --- 6) Orthographic variants of the whole token ---
  for (const v of arabicWordVariants(clean)) {
    consider(v, 0);
  }

  // --- 7) nspell suggestions ONLY if they are near the input ---
  try {
    for (const s of arSpell.suggest(clean) || []) {
      const d = editDistance(clean, stripArabicDiacritics(s));
      if (d <= 2) consider(s, 0.2);
    }
  } catch {
    /* ignore */
  }

  // --- 8) Known morphological stems of near-neighbors (bare form) ---
  // Prefer offering the clean verb/noun if a clitic form is also suggested.
  const near = [...best.keys()];
  for (const cand of near) {
    const morphSeen = new Set([cand]);
    const morphQ = [];
    expandArabicMorphology(cand, morphQ, morphSeen);
    let steps = 0;
    while (morphQ.length && steps < 12) {
      const cur = morphQ.shift();
      steps++;
      if (arabicWordIsKnown(cur, arSpell)) consider(cur, 0.4);
    }
  }

  // Sort: lower score first, then shorter forms, then lexicographic.
  const ranked = [...best.entries()]
    .sort((a, b) => {
      if (a[1] !== b[1]) return a[1] - b[1];
      // Prefer candidates closer in length to the typo
      const da = Math.abs(a[0].length - clean.length);
      const db = Math.abs(b[0].length - clean.length);
      if (da !== db) return da - db;
      return a[0].localeCompare(b[0], "ar");
    })
    .map(([s]) => s);

  return ranked.slice(0, max);
}

// App / product names common in this vault + bilingual notes.
const EN_EXTRA_WORDS = new Set([
  "indexarc",
  "ollama",
  "openai",
  "chatgpt",
  "gemini",
  "anthropic",
  "claude",
  "github",
  "gitlab",
  "bitbucket",
  "javascript",
  "typescript",
  "nodejs",
  "powershell",
  "kubernetes",
  "docker",
  "mongodb",
  "postgresql",
  "sqlite",
  "redis",
  "json",
  "yaml",
  "xml",
  "html",
  "css",
  "http",
  "https",
  "url",
  "uri",
  "api",
  "uuid",
  "oauth",
  "jwt",
  "ssh",
  "ssl",
  "tls",
  "vpn",
  "wifi",
  "macos",
  "ios",
  "android",
  "linux",
  "windows",
  "ubuntu",
  "debian",
]);

function checkEnglishWord(w, enSpell) {
  if (!enSpell) return true;
  const clean = sanitizeToken(w);
  if (!clean || clean.length <= 1) return true;

  // Short ALL-CAPS tokens are almost always acronyms (API, JSON, ID, …)
  if (/^[A-Z]{2,6}$/.test(clean)) return true;
  // Mixed camel/Pascal identifiers and product names — skip
  if (/[a-z][A-Z]/.test(clean) || /[A-Z]{2,}[a-z]/.test(clean)) return true;

  const lower = clean.toLowerCase();
  if (EN_EXTRA_WORDS.has(lower)) return true;

  if (enSpell.correct(clean)) return true;
  if (lower !== clean && enSpell.correct(lower)) return true;

  // British orthography → American for the bundled en-US dictionary
  if (lower.endsWith("our") && enSpell.correct(lower.replace(/our$/, "or"))) return true;
  if (lower.endsWith("ise") && enSpell.correct(lower.replace(/ise$/, "ize"))) return true;
  if (lower.endsWith("isation") && enSpell.correct(lower.replace(/isation$/, "ization"))) return true;
  if (lower.endsWith("yse") && enSpell.correct(lower.replace(/yse$/, "yze"))) return true;
  if (lower.endsWith("re") && lower.length > 4 && enSpell.correct(lower.replace(/re$/, "er"))) return true;

  // Hyphenated / apostrophe compounds: accept if every segment is known
  if (/[-']/.test(clean) || /\u2019/.test(clean)) {
    const parts = clean.split(/[-'\u2019]+/).filter(Boolean);
    if (parts.length > 1 && parts.every((p) => checkEnglishWord(p, enSpell))) {
      return true;
    }
  }

  // Mild plural / possessive tolerance for bare stems missing from dict
  if (lower.endsWith("'s") || lower.endsWith("\u2019s")) {
    const stem = lower.slice(0, -2);
    if (stem.length > 1 && enSpell.correct(stem)) return true;
  }
  if (lower.endsWith("s") && lower.length > 3) {
    const stem = lower.slice(0, -1);
    if (enSpell.correct(stem)) return true;
  }
  if (lower.endsWith("es") && lower.length > 4) {
    const stem = lower.slice(0, -2);
    if (enSpell.correct(stem)) return true;
  }
  if (lower.endsWith("ies") && lower.length > 5) {
    const stem = lower.slice(0, -3) + "y";
    if (enSpell.correct(stem)) return true;
  }

  return false;
}

/**
 * Batch-check words. Returns only the misspelled ones (original token form
 * as provided by the client, after sanitize).
 */
function findMisspelled(words, arSpell, enSpell) {
  if (!Array.isArray(words)) return [];
  const bad = [];
  const seen = new Set();
  for (const w of words) {
    if (typeof w !== "string" || seen.has(w)) continue;
    seen.add(w);
    const clean = sanitizeToken(w);
    if (!clean || clean.length <= 1) continue;
    if (isArabicToken(clean)) {
      if (arSpell && !checkArabicWord(clean, arSpell)) bad.push(clean);
    } else if (isLatinToken(clean)) {
      if (enSpell && !checkEnglishWord(clean, enSpell)) bad.push(clean);
    }
  }
  return bad;
}

module.exports = {
  ARABIC_RE,
  LATIN_WORD_RE,
  CLEAN_TOKEN_RE,
  sanitizeToken,
  stripArabicDiacritics,
  isArabicToken,
  isLatinToken,
  arabicWordVariants,
  checkArabicWord,
  suggestArabicWord,
  checkEnglishWord,
  findMisspelled,
  isArabicEngine,
  loadArabicEngine,
  AR_PREFIXES,
  AR_SUFFIXES,
  AR_ENCLITICS,
  AR_ENDINGS,
};
