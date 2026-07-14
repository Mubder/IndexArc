import { Settings } from "../types";

export type UiLanguage = "en" | "ar";

export interface TranslationDict {
  tab_home: string;
  tab_paste: string;
  tab_folders: string;
  tab_ask: string;
  tab_library: string;
  tab_settings: string;
  tab_logs: string;

  app_title: string;
  app_subtitle: string;
  ribbon_portable: string;
  ai_status: string;
  ollama_status_on: string;
  ollama_status_off: string;
  api_key_configured: string;
  api_key_empty: string;

  quick_paste: string;
  paste_placeholder: string;
  analyze_btn: string;
  analyzing: string;
  re_analyze_btn: string;
  paste_multi_extract: string;
  paste_placeholder_generic: string;

  attention_title: string;
  attention_desc: string;
  recent_saved: string;
  no_saved: string;

  hide: string;
  reveal: string;
  copy: string;
  copied: string;
  identify: string;

  identify_modal_title: string;
  identify_modal_desc: string;
  identify_placeholder_name: string;
  identify_placeholder_type: string;
  identify_placeholder_value: string;
  identify_save_btn: string;
  identify_cancel_btn: string;

  ask_placeholder: string;
  ask_header_placeholder: string;
  search_btn: string;
  ask_btn: string;
  assistant_answer: string;
  no_results: string;
  rewrite_mode_btn: string;
  rewrite_style_label: string;
  rewrite_placeholder: string;
  rewrite_btn: string;
  rewriting_btn: string;
  rewrite_original_btn: string;
  rewrite_copied: string;
  rewrite_style_human: string;
  rewrite_style_human_desc: string;
  rewrite_style_professional: string;
  rewrite_style_professional_desc: string;
  rewrite_style_technical: string;
  rewrite_style_technical_desc: string;
  rewrite_style_concise: string;
  rewrite_style_concise_desc: string;
  rewrite_style_formal: string;
  rewrite_style_formal_desc: string;
  rewrite_style_casual: string;
  rewrite_style_casual_desc: string;

  folder_watcher_title: string;
  folder_watcher_desc: string;
  folder_path_placeholder: string;
  browse_btn: string;
  scan_folder_btn: string;
  scanning_btn: string;
  folder_disc_note: string;
  keep_watching: string;
  use_ai_file: string;
  tracked_folders: string;
  not_watching: string;
  last_scan: string;
  use_btn: string;
  remove_btn: string;
  scan_brief: string;
  files_included: string;
  files_skipped: string;
  candidates_ready: string;
  candidates_needs_review: string;
  skipped_files_toggle: string;
  bulk_label: string;
  mark_all_save: string;
  mark_all_park: string;
  mark_all_discard: string;
  apply_changes: string;
  applying: string;
  discard_scan: string;

  library_filter_all: string;
  library_filter_secrets: string;
  library_filter_commands: string;
  library_filter_notes: string;
  library_search_placeholder: string;
  no_library_entries: string;

  ai_provider_choice: string;
  active_now: string;
  auto_desc: string;
  local_ollama_title: string;
  online: string;
  offline: string;
  ollama_base_url: string;
  llm_classify: string;
  embed_search: string;
  ollama_placeholder: string;
  ollama_llm_desc: string;
  load_llm_btn: string;
  cloud_api_title: string;
  api_key_desc: string;
  gemini_api_key_label: string;
  gemini_llm_label: string;
  gemini_embed_label: string;
  vault_data_location: string;
  save_settings_btn: string;
  ui_language_label: string;
  ui_language_desc: string;

  candidates_title: string;
  save_selected_btn: string;
  park_incomplete_title: string;
  park_incomplete_btn: string;
  confidence_label: string;
  needs_type_label: string;
  needs_name_label: string;
  ready_label: string;
  type_label: string;
  type_placeholder: string;
  name_label_secrets: string;
  name_placeholder: string;
  analyze_tab_desc: string;
  assistant_answer_title: string;
  bilingual_synth_footer: string;
  no_ask_results: string;
  folder_watch_title: string;
  folder_watch_desc: string;
  folder_watch_placeholder: string;
  scanning_label: string;
  folder_watch_disk_desc: string;
  folder_watch_keep: string;
  folder_watch_ai: string;
  tracked_folders_title: string;
  live_watch_label: string;
  not_watching_label: string;
  scan_brief_title: string;
  reset_btn: string;
  discard_review_btn: string;
  applying_label: string;
  apply_to_vault_btn: string;
  apply_brief_desc: string;
  no_candidates_msg: string;
  scan_folder_hint: string;
  lib_all: string;
  lib_keys: string;
  lib_commands: string;
  lib_notes: string;
  lib_unidentified: string;
  lib_needs_review: string;
  lib_search_placeholder: string;
  lib_empty: string;
  lib_no_match: string;
  fs_modal_title: string;
  fs_modal_subtitle: string;
  fs_up_btn: string;
  fs_roots_btn: string;
  fs_loading: string;
  fs_no_subfolders: string;
  fs_use_path_btn: string;
  fs_scan_folder_btn: string;
  fs_close_btn: string;
  sec_title: string;
  sec_locked_title: string;
  sec_locked_subtitle: string;
  sec_password_label: string;
  sec_password_placeholder: string;
  sec_unlock_btn: string;
  sec_lock_btn: string;
  sec_setup_title: string;
  sec_setup_subtitle: string;
  sec_setup_btn: string;
  sec_remove_btn: string;
  sec_error_incorrect: string;
  sec_error_length: string;
  sec_status_enabled: string;
  sec_status_disabled: string;
  find_duplicates_btn: string;
  duplicates_found: string;
  duplicates_desc: string;
  remove_duplicate_btn: string;
  select_all: string;
  remove_selected_btn: string;
  lib_archived: string;
}

export const translations: Record<UiLanguage, TranslationDict> = {
  en: {
    tab_home: "Home",
    tab_paste: "Paste & Analyze",
    tab_folders: "Folder Watcher",
    tab_ask: "Ask Assistant",
    tab_library: "Library",
    tab_settings: "Settings",
    tab_logs: "Logs",

    app_title: "IndexArc",
    app_subtitle: "Paste · Extract · Name · Ask · Single-folder portable secure vault",
    ribbon_portable: "IndexArc Vault · Portable",
    ai_status: "AI",
    ollama_status_on: "Ollama on",
    ollama_status_off: "Ollama off",
    api_key_configured: "API key",
    api_key_empty: "—",

    quick_paste: "Quick paste",
    paste_placeholder: "Paste secrets, .env blocks, commands, or notes…",
    analyze_btn: "Analyze & extract",
    analyzing: "Analyzing…",
    re_analyze_btn: "Re-analyze",
    paste_multi_extract: "Paste & multi-extract",
    paste_placeholder_generic: "Whole .env, single key, command, or note…",

    attention_title: "Needs Review",
    attention_desc: "Secrets waiting for type and/or name before they are fully saved.",
    recent_saved: "Recent saved",
    no_saved: "No saved entries yet. Paste something above.",

    hide: "Hide",
    reveal: "Reveal",
    copy: "Copy",
    copied: "Copied",
    identify: "Identify",

    identify_modal_title: "Identify Entry",
    identify_modal_desc: "Clarify the category type and unique name for this vault entry to make it searchable and organized.",
    identify_placeholder_name: "e.g. bAlfaris_1 or MyDatabaseKey",
    identify_placeholder_type: "e.g. telegram bot token or postgres password",
    identify_placeholder_value: "Enter the secret value",
    identify_save_btn: "Save to Vault",
    identify_cancel_btn: "Cancel",

    ask_placeholder: "Search: token name, key type, or ask a question...",
    ask_header_placeholder: "Ask: What is my Telegram token and ID?",
    search_btn: "Search",
    ask_btn: "Ask",
    assistant_answer: "Assistant Answer",
    no_results: "No results yet. Ask a question to your secure vault.",
    rewrite_mode_btn: "Rewrite Text",
    rewrite_style_label: "Rewrite Style",
    rewrite_placeholder: "Paste text to revise, reformat, or rephrase...",
    rewrite_btn: "Rewrite with AI",
    rewriting_btn: "Rewriting...",
    rewrite_original_btn: "Restore Original",
    rewrite_copied: "Copied!",
    rewrite_style_human: "Human",
    rewrite_style_human_desc: "Natural, conversational tone",
    rewrite_style_professional: "Professional",
    rewrite_style_professional_desc: "Clear, business-appropriate language",
    rewrite_style_technical: "Technical",
    rewrite_style_technical_desc: "Precise, developer-focused terminology",
    rewrite_style_concise: "Concise",
    rewrite_style_concise_desc: "Short and to the point",
    rewrite_style_formal: "Formal",
    rewrite_style_formal_desc: "Official, structured writing style",
    rewrite_style_casual: "Casual",
    rewrite_style_casual_desc: "Relaxed, friendly tone",

    folder_watcher_title: "Watch & scan folder into portable vault",
    folder_watcher_desc: "Reads supported text/config files under a folder, extracts secrets, tokens, commands, and notes. Nothing is written to the vault until you review and save.",
    folder_path_placeholder: "Absolute folder path e.g. G:\\secrets or D:\\env",
    browse_btn: "Browse…",
    scan_folder_btn: "Scan folder",
    scanning_btn: "Scanning…",
    folder_disc_note: "The app reads the folder in place on disk (no upload) through the local secure server.",
    keep_watching: "Keep watching for new/changed files",
    use_ai_file: "Use AI per file (slower; default is fast heuristics)",
    tracked_folders: "Tracked folders",
    not_watching: "Not watching",
    last_scan: "last scan",
    use_btn: "Use",
    remove_btn: "Remove",
    scan_brief: "Scan brief",
    files_included: "Files included",
    files_skipped: "Not included",
    candidates_ready: "Ready",
    candidates_needs_review: "Need type/name",
    skipped_files_toggle: "Not included files — click to expand",
    bulk_label: "Bulk actions:",
    mark_all_save: "Mark all save",
    mark_all_park: "Mark all park",
    mark_all_discard: "Mark all discard",
    apply_changes: "Apply and Save to Vault",
    applying: "Applying…",
    discard_scan: "Discard scan session",

    library_filter_all: "All types",
    library_filter_secrets: "Secrets & Keys",
    library_filter_commands: "Commands",
    library_filter_notes: "Notes",
    library_search_placeholder: "Search library by name, type, source file, or value…",
    no_library_entries: "No entries match your filters.",

    ai_provider_choice: "AI provider (user choice)",
    active_now: "Active now",
    auto_desc: "Auto uses Ollama when online, else Gemini API",
    local_ollama_title: "Local Ollama models",
    online: "online",
    offline: "offline",
    ollama_base_url: "Ollama base URL",
    llm_classify: "LLM (classify / extract)",
    embed_search: "Embed (search vectors)",
    ollama_placeholder: "or type model name",
    ollama_llm_desc: "Paste/Analyze uses the LLM. Ask search uses embed. Click Load LLM so ollama ps shows both.",
    load_llm_btn: "Load LLM into memory",
    cloud_api_title: "Cloud API (Gemini)",
    api_key_desc: "Add a Gemini API key below, then Save. Without a key, analyze falls back to heuristics only.",
    gemini_api_key_label: "Gemini API key",
    gemini_llm_label: "Gemini LLM",
    gemini_embed_label: "Gemini embed",
    vault_data_location: "All vault data lives in data/ and settings in config/ next to the app — copy the whole folder to a USB drive and run anywhere.",
    save_settings_btn: "Save settings",
    ui_language_label: "UI Language",
    ui_language_desc: "Select the display language for the application interface.",

    candidates_title: "Extraction Candidates",
    save_selected_btn: "Save Selected to Vault",
    park_incomplete_title: "Park Incomplete Items",
    park_incomplete_btn: "Park & Keep Reviewing",
    confidence_label: "Confidence",
    needs_type_label: "Needs Category Type",
    needs_name_label: "Needs Unique Name",
    ready_label: "Ready",
    type_label: "Category / Type",
    type_placeholder: "e.g. API Token, SSH Key...",
    name_label_secrets: "Unique Name",
    name_placeholder: "e.g. production_db, main_user...",
    analyze_tab_desc: "Paste any config/code snippet and let AI separate and classify secrets cleanly.",
    assistant_answer_title: "Assistant Answer",
    bilingual_synth_footer: "Bilingual Synthesizer",
    no_ask_results: "No results yet. Try searching in Arabic or English.",
    folder_watch_title: "Watch & Scan Local Folders",
    folder_watch_desc: "Scan folders on this system to automatically detect and import keys, scripts, and commands.",
    folder_watch_placeholder: "Select or enter absolute folder path...",
    scanning_label: "Scanning...",
    folder_watch_disk_desc: "Scans are performed locally on your drive. No data is sent to external cloud servers except optional Gemini AI queries.",
    folder_watch_keep: "Keep watching directory",
    folder_watch_ai: "Deep AI File Parsing",
    tracked_folders_title: "Active Folder Watched List",
    live_watch_label: "LIVE WATCHING",
    not_watching_label: "NOT WATCHING",
    scan_brief_title: "Scan Brief & Results",
    reset_btn: "Reset",
    discard_review_btn: "Discard Review Session",
    applying_label: "Applying...",
    apply_to_vault_btn: "Apply to Secure Vault",
    apply_brief_desc: "Apply selections to store reviewed items permanently.",
    no_candidates_msg: "No candidate items found in this scan.",
    scan_folder_hint: "Specify a directory above and click 'Scan folder' to view parsed secrets here.",
    lib_all: "All Items",
    lib_keys: "Secrets & Keys",
    lib_commands: "Commands & Shells",
    lib_notes: "Notes & Clippings",
    lib_unidentified: "Unidentified",
    lib_needs_review: "Needs Review",
    lib_search_placeholder: "Filter by name, type, source file or value...",
    lib_empty: "The vault is currently empty.",
    lib_no_match: "No entries match this filter",
    fs_modal_title: "Select folder on this machine",
    fs_modal_subtitle: "Reads in place · no upload · path the server can access",
    fs_up_btn: "↑ Up",
    fs_roots_btn: "Roots",
    fs_loading: "Loading…",
    fs_no_subfolders: "No subfolders here. You can still select this path.",
    fs_use_path_btn: "Use this path",
    fs_scan_folder_btn: "Scan this folder",
    fs_close_btn: "Close",
    sec_title: "Security & Encryption",
    sec_locked_title: "Vault is Locked",
    sec_locked_subtitle: "Please enter your master password to decrypt and access the vault.",
    sec_password_label: "Master Password",
    sec_password_placeholder: "Enter master password...",
    sec_unlock_btn: "Unlock Vault",
    sec_lock_btn: "Lock Vault",
    sec_setup_title: "Enable Vault Encryption",
    sec_setup_subtitle: "Set a master password to encrypt your vault on disk with AES-256-GCM.",
    sec_setup_btn: "Enable Encryption",
    sec_remove_btn: "Disable Encryption",
    sec_error_incorrect: "Incorrect master password",
    sec_error_length: "Password must be at least 4 characters",
    sec_status_enabled: "Encrypted (AES-256-GCM)",
    sec_status_disabled: "Unencrypted (Plain JSON)",
    find_duplicates_btn: "Find Duplicates",
    duplicates_found: "Duplicates Found",
    duplicates_desc: "These entries have identical values. Consider removing the duplicates.",
    remove_duplicate_btn: "Remove",
    select_all: "Select All",
    remove_selected_btn: "Remove Selected",
    lib_archived: "Archived",
  },
  ar: {
    tab_home: "الرئيسية",
    tab_paste: "لصق وتحليل",
    tab_folders: "مراقب المجلدات",
    tab_ask: "اسأل المساعد",
    tab_library: "المكتبة",
    tab_settings: "الإعدادات",
    tab_logs: "السجلات",

    app_title: "IndexArc",
    app_subtitle: "لصق · استخراج · تسمية · سؤال · خزنة محمولة آمنة لمجلد فردي",
    ribbon_portable: "خزنة IndexArc · نسخة محمولة",
    ai_status: "الذكاء الاصطناعي",
    ollama_status_on: "أولاما متصل",
    ollama_status_off: "أولاما غير متصل",
    api_key_configured: "مفتاح API",
    api_key_empty: "—",

    quick_paste: "لصق سريع",
    paste_placeholder: "قم بلصق الأسرار، كتل .env، الأوامر أو الملاحظات هنا...",
    analyze_btn: "تحليل واستخراج",
    analyzing: "جاري التحليل...",
    re_analyze_btn: "إعادة التحليل",
    paste_multi_extract: "لصق واستخراج متعدد",
    paste_placeholder_generic: "ملف .env كامل، مفتاح فردي، أمر أو ملاحظة...",

    attention_title: "يحتاج مراجعة",
    attention_desc: "أسرار بانتظار تحديد النوع و/أو الاسم قبل حفظها بالكامل في الخزنة.",
    recent_saved: "المحفوظة حديثاً",
    no_saved: "لا توجد مدخلات محفوظة بعد. الصق شيئاً أعلاه.",

    hide: "إخفاء",
    reveal: "إظهار",
    copy: "نسخ",
    copied: "تم النسخ",
    identify: "تعريف",

    identify_modal_title: "تعريف وتعديل المدخل",
    identify_modal_desc: "قم بتوضيح نوع الفئة والاسم الفريد لهذا المدخل لجعله قابلاً للبحث والترتيب بفعالية.",
    identify_placeholder_name: "مثال: bAlfaris_1 أو MyDatabaseKey",
    identify_placeholder_type: "مثال: توكن بوت تيليجرام أو كلمة مرور قاعدة البيانات",
    identify_placeholder_value: "أدخل القيمة",
    identify_save_btn: "حفظ في الخزنة",
    identify_cancel_btn: "إلغاء",

    ask_placeholder: "ابحث: اسم التوكن، نوع المفتاح، أو اطرح سؤالاً...",
    ask_header_placeholder: "اسأل: ما هو توكن ومفتاح التليجرام؟",
    search_btn: "بحث",
    ask_btn: "اسأل",
    assistant_answer: "إجابة المساعد الذكي",
    no_results: "لا توجد نتائج بعد. اسأل سؤالاً للبحث في خزنتك الآمنة.",
    rewrite_mode_btn: "إعادة صياغة",
    rewrite_style_label: "أسلوب إعادة الصياغة",
    rewrite_placeholder: "الصق النص للمراجعة أو إعادة الصياغة...",
    rewrite_btn: "إعادة صياغة بالذكاء الاصطناعي",
    rewriting_btn: "جاري إعادة الصياغة...",
    rewrite_original_btn: "استعادة النص الأصلي",
    rewrite_copied: "تم النسخ!",
    rewrite_style_human: "بشري",
    rewrite_style_human_desc: "نبرة طبيعية محادثة",
    rewrite_style_professional: "مهني",
    rewrite_style_professional_desc: "لغة واضحة مناسبة للأعمال",
    rewrite_style_technical: "تقني",
    rewrite_style_technical_desc: "مصطلحات دقيقة للمطورين",
    rewrite_style_concise: "مختصر",
    rewrite_style_concise_desc: "مباشر وإلى النقطة",
    rewrite_style_formal: "رسمي",
    rewrite_style_formal_desc: "أسلوب كتابة رسمي منظم",
    rewrite_style_casual: "ودي",
    rewrite_style_casual_desc: "نبرة مريحة وودية",

    folder_watcher_title: "مراقبة وفحص المجلد في الخزنة المحمولة",
    folder_watcher_desc: "يقرأ ملفات النصوص والإعدادات المدعومة تحت المجلد، ويستخرج الأسرار، التوكنات، الأوامر والملاحظات. لن يتم كتابة أي شيء في الخزنة حتى تقوم بالمراجعة والحفظ.",
    folder_path_placeholder: "المسار الكامل للمجلد مثال: G:\\secrets أو D:\\env",
    browse_btn: "تصفح...",
    scan_folder_btn: "فحص المجلد",
    scanning_btn: "جاري الفحص...",
    folder_disc_note: "يقرأ التطبيق المجلد في مكانه على القرص (بدون رفع الملفات) عبر خادم محلي آمن.",
    keep_watching: "الاستمرار في مراقبة الملفات الجديدة/المعدلة",
    use_ai_file: "استخدام الذكاء الاصطناعي لكل ملف (أبطأ؛ الافتراضي هو الفحص السريع)",
    tracked_folders: "المجلدات المراقبة",
    not_watching: "غير مراقب",
    last_scan: "آخر فحص",
    use_btn: "استخدام",
    remove_btn: "إزالة",
    scan_brief: "ملخص الفحص",
    files_included: "الملفات المشمولة",
    files_skipped: "الغير مشمولة",
    candidates_ready: "جاهز",
    candidates_needs_review: "بحاجة لاسم/نوع",
    skipped_files_toggle: "الملفات غير المشمولة — اضغط للتوسيع",
    bulk_label: "الإجراءات الجماعية:",
    mark_all_save: "تحديد الكل كحفظ",
    mark_all_park: "تحديد الكل كمراجعة",
    mark_all_discard: "تحديد الكل كتجاهل",
    apply_changes: "تطبيق وحفظ في الخزنة",
    applying: "جاري التطبيق...",
    discard_scan: "إلغاء جلسة الفحص",

    library_filter_all: "جميع الأنواع",
    library_filter_secrets: "الأسرار والمفاتيح",
    library_filter_commands: "الأوامر",
    library_filter_notes: "الملاحظات",
    library_search_placeholder: "ابحث في المكتبة بالاسم، النوع، المصدر أو القيمة...",
    no_library_entries: "لا توجد مدخلات تطابق فلاتر البحث الخاصة بك.",

    ai_provider_choice: "مزود الذكاء الاصطناعي (اختيار المستخدم)",
    active_now: "النشط حالياً",
    auto_desc: "التلقائي يستخدم أولاما محلياً عند الاتصال، وإلا فيستخدم جميناي كلاود",
    local_ollama_title: "نماذج أولاما المحلية (Ollama)",
    online: "متصل",
    offline: "غير متصل",
    ollama_base_url: "رابط أولاما الأساسي (URL)",
    llm_classify: "نموذج التصنيف والاستخراج (LLM)",
    embed_search: "نموذج المتجهات والبحث (Embed)",
    ollama_placeholder: "أو اكتب اسم النموذج يدوياً",
    ollama_llm_desc: "يستخدم اللصق والتحليل نموذج الـ LLM. بينما تستخدم ميزة البحث والأسئلة نموذج الـ embed.",
    load_llm_btn: "تحميل النموذج في الذاكرة",
    cloud_api_title: "جميناي كلاود (Gemini API)",
    api_key_desc: "أدخل مفتاح جميناي API أدناه ثم احفظ. بدون مفتاح، يعتمد التحليل على الفحص السريع والذكي فقط.",
    gemini_api_key_label: "مفتاح جميناي (Gemini API Key)",
    gemini_llm_label: "نموذج جميناي (LLM)",
    gemini_embed_label: "نموذج المتجهات (Embed)",
    vault_data_location: "تخزن جميع بيانات الخزنة في المجلد data/ والإعدادات في المجلد config/ بجانب التطبيق — انسخ المجلد بالكامل لفلاش USB وشغله في أي مكان.",
    save_settings_btn: "حفظ الإعدادات",
    ui_language_label: "لغة الواجهة",
    ui_language_desc: "اختر لغة عرض واجهة المستخدم الخاصة بالتطبيق.",

    candidates_title: "المرشحون المستخرجون",
    save_selected_btn: "حفظ العناصر المحددة في الخزنة",
    park_incomplete_title: "تأجيل العناصر غير المكتملة",
    park_incomplete_btn: "تأجيل ومواصلة المراجعة",
    confidence_label: "مستوى الثقة",
    needs_type_label: "بحاجة لتحديد الفئة",
    needs_name_label: "بحاجة لاسم فريد",
    ready_label: "جاهز",
    type_label: "الفئة / النوع",
    type_placeholder: "مثال: مفتاح API، مفتاح SSH...",
    name_label_secrets: "الاسم الفريد",
    name_placeholder: "مثال: قاعدة بيانات الإنتاج، المستخدم الرئيسي...",
    analyze_tab_desc: "قم بلصق أي كود أو إعدادات ودع الذكاء الاصطناعي يفصل ويصنف الأسرار بشكل نظيف.",
    assistant_answer_title: "إجابة المساعد الذكي",
    bilingual_synth_footer: "المُخلق ثنائي اللغة",
    no_ask_results: "لا توجد نتائج بعد. جرب البحث باللغة العربية أو الإنجليزية.",
    folder_watch_title: "مراقبة وفحص المجلدات المحلية",
    folder_watch_desc: "افحص المجلدات الموجودة على هذا النظام لاكتشاف واستيراد المفاتيح والبرامج النصية والأوامر تلقائيًا.",
    folder_watch_placeholder: "اختر أو أدخل المسار الكامل للمجلد...",
    scanning_label: "جاري الفحص...",
    folder_watch_disk_desc: "يتم إجراء الفحص محليًا على القرص الخاص بك. لا يتم إرسال أي بيانات إلى خوادم سحابية خارجية باستثناء استعلامات Gemini الاختيارية.",
    folder_watch_keep: "استمر في مراقبة المجلد",
    folder_watch_ai: "تحليل الملفات العميق بالذكاء الاصطناعي",
    tracked_folders_title: "قائمة المجلدات المراقبة النشطة",
    live_watch_label: "مراقبة نشطة",
    not_watching_label: "غير مراقب",
    scan_brief_title: "ملخص الفحص والنتائج",
    reset_btn: "إعادة تعيين",
    discard_review_btn: "إلغاء جلسة المراجعة",
    applying_label: "جاري التطبيق...",
    apply_to_vault_btn: "تطبيق وحفظ في الخزنة",
    apply_brief_desc: "تطبيق الخيارات لتخزين العناصر التي تمت مراجعتها بشكل دائم.",
    no_candidates_msg: "لم يتم العثور على أي عناصر مرشحة في هذا الفحص.",
    scan_folder_hint: "حدد مجلدًا أعلاه وانقر على 'فحص المجلد' لعرض الأسرار المستخرجة هنا.",
    lib_all: "كل العناصر",
    lib_keys: "الأسرار والمفاتيح",
    lib_commands: "الأوامر والبرامج النصية",
    lib_notes: "الملاحظات والقصاصات",
    lib_unidentified: "غير معروف",
    lib_needs_review: "بحاجة لمراجعة",
    lib_search_placeholder: "تصفية حسب الاسم، النوع، ملف المصدر أو القيمة...",
    lib_empty: "الخزنة فارغة حالياً.",
    lib_no_match: "لا توجد نتائج تطابق فلاتر البحث",
    fs_modal_title: "اختر مجلدًا على هذا الجهاز",
    fs_modal_subtitle: "القراءة من المصدر مباشرة · لا يتم الرفع · المسار الذي يمكن للخادم الوصول إليه",
    fs_up_btn: "↑ للأعلى",
    fs_roots_btn: "الجذور",
    fs_loading: "جاري التحميل…",
    fs_no_subfolders: "لا توجد مجلدات فرعية هنا. لا يزال بإمكانك اختيار هذا المسار.",
    fs_use_path_btn: "استخدم هذا المسار",
    fs_scan_folder_btn: "افحص هذا المجلد",
    fs_close_btn: "إغلاق",
    sec_title: "الأمان والتشفير",
    sec_locked_title: "الخزنة مقفلة",
    sec_locked_subtitle: "الرجاء إدخال كلمة المرور الرئيسية لفك تشفير الخزنة والوصول إليها.",
    sec_password_label: "كلمة المرور الرئيسية",
    sec_password_placeholder: "أدخل كلمة المرور الرئيسية...",
    sec_unlock_btn: "افتح الخزنة",
    sec_lock_btn: "قفل الخزنة",
    sec_setup_title: "تفعيل تشفير الخزنة",
    sec_setup_subtitle: "قم بتعيين كلمة مرور رئيسية لتشفير خزنتك على القرص باستخدام AES-256-GCM.",
    sec_setup_btn: "تفعيل التشفير",
    sec_remove_btn: "إلغاء التشفير",
    sec_error_incorrect: "كلمة المرور الرئيسية غير صحيحة",
    sec_error_length: "يجب أن تكون كلمة المرور 4 أحرف على الأقل",
    sec_status_enabled: "مشفرة (AES-256-GCM)",
    sec_status_disabled: "غير مشفرة (JSON عادي)",
    find_duplicates_btn: "البحث عن المكررات",
    duplicates_found: "تم العثور على مكررات",
    duplicates_desc: "هذه المدخلات لها قيم متطابقة. يُقترح إزالة المكررات.",
    remove_duplicate_btn: "إزالة",
    select_all: "تحديد الكل",
    remove_selected_btn: "إزالة المحدد",
    lib_archived: "مؤرشف",
  },
};

export function getTranslation(settings: Settings | null, key: keyof TranslationDict): string {
  const lang: UiLanguage = settings?.ui_language || "en";
  const dict = translations[lang] || translations.en;
  return dict[key] || translations.en[key] || "";
}