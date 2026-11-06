import { Settings } from "../types";

export type UiLanguage = "en" | "ar";

export interface TranslationDict {
  tab_home: string;
  tab_paste: string;
  tab_scratchpad: string;
  tab_folders: string;
  tab_ask: string;
  tab_library: string;
  tab_apps: string;
  apps_search: string;
  apps_new: string;
  apps_name_placeholder: string;
  apps_create: string;
  apps_cancel: string;
  apps_save: string;
  apps_empty_title: string;
  apps_empty_body: string;
  apps_no_match: string;
  apps_count_keys: string;
  apps_paste_env: string;
  apps_copy_env: string;
  apps_copied_env: string;
  apps_add_existing: string;
  apps_rename: string;
  apps_rename_title: string;
  apps_delete: string;
  apps_delete_title: string;
  apps_delete_msg: string;
  apps_env_none: string;
  apps_env_add: string;
  apps_env_placeholder: string;
  apps_col_key: string;
  apps_col_value: string;
  apps_add_key: string;
  apps_value_placeholder: string;
  apps_no_keys_env: string;
  apps_reveal: string;
  apps_hide: string;
  apps_copy: string;
  apps_copied: string;
  apps_edit: string;
  apps_remove_from_app: string;
  apps_delete_key: string;
  apps_delete_key_title: string;
  apps_delete_key_msg: string;
  apps_notes_placeholder: string;
  apps_notes_saved: string;
  apps_paste_title: string;
  apps_paste_hint: string;
  apps_preview: string;
  apps_back: string;
  apps_status_new: string;
  apps_status_update: string;
  apps_status_same: string;
  apps_save_n: string;
  apps_saved_result: string;
  apps_skipped_lines: string;
  apps_nothing_to_save: string;
  apps_existing_title: string;
  apps_existing_hint: string;
  apps_existing_none: string;
  apps_move_n: string;
  apps_moved: string;
  apps_env_label: string;
  apps_app_label: string;
  apps_none_library: string;
  apps_new_option: string;
  apps_new_env_option: string;
  apps_save_secrets_title: string;
  apps_checking: string;
  apps_error: string;
  apps_name_required: string;
  apps_expired: string;
  apps_expiring: string;
  apps_rotation_due: string;
  apps_select_all: string;
  tab_settings: string;
  tab_logs: string;
  logs_copy_all: string;

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
  open_analyze_tab: string;
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
  identify_key_label: string;
  identify_keep_hint: string;
  identify_category_label: string;
  family_secret: string;
  family_command: string;
  family_note: string;
  family_unknown: string;

  ask_placeholder: string;
  ask_header_placeholder: string;
  search_btn: string;
  ask_btn: string;
  built_with_kazma: string;
  kazma_tagline: string;
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
  emergency_title: string;
  emergency_desc: string;
  emergency_create_btn: string;
  emergency_refresh_btn: string;
  emergency_restore_btn: string;
  emergency_confirm_restore: string;
  emergency_created: string;
  emergency_nochange: string;
  emergency_restored: string;
  emergency_empty: string;
  emergency_copies: string;
  save_settings_btn: string;
  ui_language_label: string;
  ui_language_desc: string;
  font_size_en_label: string;
  font_size_en_desc: string;
  font_size_ar_label: string;
  font_size_ar_desc: string;
  
  spellcheck_title: string;
  spellcheck_live_label: string;
  spellcheck_live_desc: string;
  spellcheck_ai_label: string;
  spellcheck_ai_desc: string;
  autolock_minutes_label: string;
  pin_pin: string;
  pin_pinned: string;
  pin_unpin: string;
  protect_protect: string;
  protect_protected: string;
  protect_title: string;
  protect_unprotect_title: string;
  protect_enable: string;
  protect_remove_btn: string;
  protect_confirm_title: string;
  protect_confirm_msg: string;
  protect_remove_title: string;
  protect_remove_msg: string;
  scratchpad_archive_protected: string;
  scratchpad_archive_failed: string;
  scratchpad_close_protected: string;
  scratchpad_close_failed: string;
  autolock_desc: string;
  autolock_minimize_label: string;
  clipboard_clear_label: string;
  clipboard_clear_desc: string;
  autolock_section_title: string;

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
  sec_first_setup_title: string;
  sec_first_setup_subtitle: string;
  sec_first_setup_hint: string;
  sec_confirm_label: string;
  sec_first_setup_btn: string;
  sec_error_mismatch: string;
  sec_encrypt_banner_title: string;
  sec_encrypt_banner_text: string;
  sec_encrypt_banner_btn: string;
  egress_title: string;
  update_title: string;
  update_desc: string;
  update_on_start: string;
  update_check_now: string;
  update_checking: string;
  update_current: string;
  update_available: string;
  update_download: string;
  update_downloading: string;
  update_install: string;
  update_unsigned: string;
  update_portable: string;
  update_unsupported: string;
  update_error: string;
  update_view_release: string;
  egress_cloud_label: string;
  egress_cloud_desc: string;
  egress_lt_label: string;
  egress_lt_desc: string;
  loading_settings: string;
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

  scratchpad_add: string;
  scratchpad_placeholder: string;
  scratchpad_detect: string;
  scratchpad_detecting: string;
  scratchpad_save_secret: string;
  scratchpad_save_note: string;
  scratchpad_saving: string;
  scratchpad_saved_ok: string;
  scratchpad_save_err: string;
  scratchpad_rephrase: string;
  scratchpad_rephrase_undo: string;
  scratchpad_rephrase_undone: string;
  scratchpad_rewriting: string;
  scratchpad_rephrased: string;
  scratchpad_conflict_msg: string;
  scratchpad_conflict_load: string;
  scratchpad_conflict_keep: string;
  scratchpad_rewrite_err: string;
  scratchpad_proofread: string;
  scratchpad_proofreading: string;
  scratchpad_proofread_ok: string;
  scratchpad_proofread_err: string;
  scratchpad_clear: string;
  scratchpad_copy: string;
  scratchpad_copied: string;
  scratchpad_go_to_top: string;
  scratchpad_go_to_bottom: string;
  scratchpad_bidi_auto: string;
  scratchpad_bidi_ltr: string;
  scratchpad_bidi_rtl: string;
  scratchpad_bidi_hint: string;
  scratchpad_rename: string;
  scratchpad_archive: string;
  scratchpad_drag_to_reorder: string;
  scratchpad_archived: string;
  scratchpad_restore: string;
  scratchpad_delete: string;
  scratchpad_ai_detected: string;
  scratchpad_no_detection: string;
  scratchpad_bold: string;
  scratchpad_italic: string;
  scratchpad_underline: string;
  scratchpad_highlight: string;
  scratchpad_text_color: string;
  scratchpad_clear_format: string;
  paste_plain_on: string;
  paste_plain_off: string;
  scratchpad_undo: string;
  scratchpad_redo: string;
  scratchpad_history: string;
  scratchpad_history_title: string;
  scratchpad_history_empty: string;
  scratchpad_history_restore: string;
  scratchpad_history_restored: string;
  scratchpad_compare: string;
  scratchpad_compare_title: string;
  scratchpad_compare_desc: string;
  scratchpad_compare_identical: string;
  scratchpad_compare_pick_two: string;
  scratchpad_rescue: string;
  scratchpad_rescue_title: string;
  scratchpad_rescue_desc: string;
  scratchpad_rescue_empty: string;
  scratchpad_rescue_restore: string;
  scratchpad_rescue_restored: string;
  scratchpad_save_failed: string;
  scratchpad_content_cleared: string;
  scratchpad_restore_undo: string;
  highlight_yellow: string;
  highlight_green: string;
  highlight_blue: string;
  highlight_red: string;
  highlight_purple: string;
  text_color_white: string;
  text_color_red: string;
  text_color_orange: string;
  text_color_yellow: string;
  text_color_green: string;
  text_color_blue: string;
  text_color_purple: string;

  setup_title: string;
  setup_collapse: string;
  setup_all_set: string;
  setup_needs_attention: string;
  setup_ollama: string;
  setup_ollama_installed: string;
  setup_ollama_not_installed: string;
  setup_ollama_online: string;
  setup_ollama_offline: string;
  setup_ollama_no_model: string;
  setup_install_ollama: string;
  setup_start_ollama: string;
  setup_pull_model: string;
  setup_configure_ai: string;
  setup_ai_ready: string;
  setup_ai_missing: string;
  setup_installing: string;
  setup_starting: string;
  setup_pulling: string;
  setup_install_failed: string;
  setup_open_download: string;
  setup_howto_title: string;
  setup_portable_note: string;
  setup_installer_note: string;
  setup_dismiss: string;
  setup_pull_done: string;

  health_title: string;
  health_subtitle: string;
  health_open_btn: string;
  health_refresh_btn: string;
  health_copy_btn: string;
  health_copied: string;
  health_healthy: string;
  health_degraded: string;
  health_attention: string;
  nav_section_vault: string;
  vault_overview: string;
  stat_saved: string;
  stat_pending: string;
  stat_secrets: string;
  stat_commands: string;
  stat_open_in_library: string;
  brand_tagline: string;
  new_entry_btn: string;
  search_btn_short: string;
  search_btn_title: string;
  theme_to_light: string;
  theme_to_dark: string;
  lang_switch_title: string;
  menu_open: string;
  menu_close: string;
  integrity_title: string;
  integrity_hint: string;
  dismiss_btn: string;
  setup_vault_locked: string;
  setup_vault_counts: string;
  health_more_issues: string;
  home_good_morning: string;
  home_good_afternoon: string;
  home_good_evening: string;
  home_sub_healthy: string;
  home_sub_attention: string;
  home_sub_locked: string;
  kpi_entries: string;
  kpi_secrets: string;
  kpi_commands: string;
  kpi_review: string;
  kpi_added_week: string;
  kpi_entries_note: string;
  kpi_secrets_enc: string;
  kpi_secrets_plain: string;
  kpi_commands_note: string;
  kpi_review_note: string;
  kpi_review_none: string;
  kpi_open_title: string;
  health_card_title: string;
  health_card_ok: string;
  health_card_issues: string;
  health_card_run: string;
  health_card_details: string;
  health_card_score: string;
  mix_title: string;
  mix_empty: string;
  mix_commands: string;
  mix_notes: string;
  mix_secrets: string;
  mix_other: string;
  services_title: string;
  services_basic: string;
  services_rules: string;
  services_ai: string;
  services_ready: string;
  services_offline: string;
  services_watcher: string;
  services_watching: string;
  services_idle: string;
  services_to_review: string;
  services_no_scan: string;
  open_btn: string;
  recent_open_library: string;
  quick_capture_hint: string;
  lock_card_unlocked: string;
  lock_card_autolock: string;
  lock_card_autolock_off: string;
  lock_card_plain: string;
  lock_card_encrypt: string;
  lock_now: string;
  health_data_label: string;
  health_vault_label: string;
  health_go_emergency: string;
  health_banner_action: string;

  // R4: UI strings moved out of components (dialogs, toasts, settings panels).
  close_btn: string;
  fs_drives_home: string;
  palette_dialog_label: string;
  palette_search_placeholder: string;
  palette_quick_nav: string;
  palette_vault_results: string;
  palette_no_matches: string;
  palette_hint_use: string;
  palette_hint_toggle: string;
  palette_hint_navigate: string;
  palette_hint_select: string;
  palette_footer_brand: string;
  health_check_failed: string;
  health_check_unreachable: string;
  health_entries_unit: string;
  health_locked: string;
  health_encrypted: string;
  health_notes_label: string;
  health_active_unit: string;
  health_backups_label: string;
  health_snapshots_label: string;
  health_no_results: string;
  health_alternates_title: string;
  health_encrypted_vault: string;
  health_notes_unit: string;
  health_alternates_hint: string;
  copied_bang: string;
  note_untitled: string;
  note_save_failed_retry: string;
  note_title_label: string;
  note_body_label: string;
  note_words: string;
  note_min_read: string;
  note_restore_size: string;
  note_maximize: string;
  note_reopen_scratchpad: string;
  note_copy_text: string;
  note_copy_html: string;
  note_saving: string;
  note_save_changes: string;
  note_edit: string;
  note_characters: string;
  note_created: string;
  archive_preview_untitled: string;
  archive_reference_only: string;
  archive_archived_on: string;
  copied_to_clipboard: string;
  archive_empty_note: string;
  archive_delete_permanently: string;
  archive_restore_to_active: string;
  compare_swap_sides: string;
  compare_left_note: string;
  compare_right_note: string;
  rescue_search_placeholder: string;
  rescue_scanning: string;
  rescue_snapshot_one: string;
  rescue_snapshot_many: string;
  history_version_one: string;
  history_version_many: string;
  history_saved_suffix: string;
  history_latest_snapshot: string;
  history_version_label: string;
  chars_unit: string;
  history_preview_label: string;
  history_empty: string;
  history_select_version: string;
  history_footer_hint: string;
  protect_show: string;
  scratchpad_paragraphs_restored: string;
  scratchpad_content_restored: string;
  scratchpad_retry_now: string;
  scratchpad_cleared_detected: string;
  connection_failed: string;
  update_toast_available: string;
  ask_failed: string;
  loading_scratchpad: string;
  folder_remove_failed: string;
  toast_copied_name: string;
  copy_failed: string;
  save_failed: string;
  more_count: string;
  toast_name_required: string;
  toast_network_error: string;
  confirm_delete_entry_title: string;
  confirm_delete_entry_msg: string;
  delete_failed: string;
  delete_btn: string;
  confirm_delete_entries_title: string;
  confirm_delete_entries_one: string;
  confirm_delete_entries_many: string;
  dup_confirm_title: string;
  dup_confirm_msg: string;
  dup_save_anyway: string;
  dup_deselected: string;
  fs_cannot_list: string;
  fs_list_failed: string;
  scan_apply_failed: string;
  scan_applied_summary: string;
  confirm_discard_scan_title: string;
  confirm_discard_scan_msg: string;
  discard_btn: string;
  toast_settings_saved: string;
  toast_settings_save_failed: string;
  toast_loading_llm: string;
  toast_warm_failed: string;
  toast_models_loaded: string;
  toast_llm_load_failed: string;
  toast_settings_patch_failed: string;
  protect_confirm_failed: string;
  request_failed: string;
  spell_added_to_dict: string;
  spell_ignored: string;
  scratchpad_already_in_vault: string;
  confirm_archive_note: string;
  confirm_delete_archived_note: string;
  untitled: string;
  confirm_delete_note: string;
  confirm_clear_note: string;
  predictions_enabled_title: string;
  predictions_disabled_title: string;
  predictions_label: string;
  state_on: string;
  state_off: string;
  format_paragraphs_title: string;
  format_paragraphs: string;
  slash_commands_hint: string;
  slash_heading_1: string;
  slash_heading_2: string;
  slash_bullet_list: string;
  slash_quote: string;
  loading_editor: string;
  prediction_label: string;
  prediction_accept: string;
  spell_label: string;
  spell_finding: string;
  spell_no_suggestions: string;
  spell_add_to_dict: string;
  spell_ignore: string;
  archive_cold_storage: string;
  archive_loading: string;
  archive_none: string;
  archive_click_preview: string;
  archive_view_note: string;
  archive_view: string;
  scratchpad_close_tab: string;
  ask_synthesizing: string;
  copy_to_clipboard: string;
  rewrite_show_original: string;
  rewrite_copy_result: string;
  rewrite_again: string;
  entry_hide_value: string;
  entry_reveal_value: string;
  entry_open_full_note: string;
  entry_click_to_reveal: string;
  candidate_discard_title: string;
  candidate_discard_label: string;
  via_provider: string;
  health_vault_unavailable: string;
  key_saved_type_to_replace: string;
  key_saved_badge: string;
  provider_api_key_label: string;
  provider_model_label: string;
  local_openai_title: string;
  local_openai_base_url: string;
  local_openai_api_key: string;
  local_openai_model: string;
  local_openai_embed_model: string;
  local_openai_embed_default: string;
  adv_ai_title: string;
  adv_ai_desc: string;
  adv_ai_llm_override: string;
  adv_ai_embed_override: string;
  adv_ai_default_auto: string;
  adv_ai_tip: string;
  provider_auto: string;
  provider_local_ollama: string;
  provider_cloud_gemini: string;
  provider_custom_local_openai: string;
  provider_custom_openai_lmstudio: string;
  provider_heuristic: string;
  sec_encryption_status: string;
  sec_remove_desc: string;
  sec_set_password_placeholder: string;
  sec_setup_failed: string;
  emergency_empty_snapshot_title: string;
  emergency_empty_badge: string;
  emergency_empty_snapshot: string;
  emergency_snapshot_failed: string;
  emergency_restored_counts: string;
  emergency_restored_locked: string;
  emergency_restore_failed: string;
  failed_generic: string;
  logs_empty: string;
  update_download_failed: string;
  // R5: password change + recovery key
  pw_change_title: string;
  pw_change_desc: string;
  pw_current: string;
  pw_new: string;
  pw_confirm: string;
  pw_change_btn: string;
  pw_mismatch: string;
  pw_too_short: string;
  pw_show: string;
  pw_hide: string;
  pw_strength_label: string;
  pw_strength_0: string;
  pw_strength_1: string;
  pw_strength_2: string;
  pw_strength_3: string;
  pw_strength_4: string;
  pw_problem_common: string;
  pw_problem_weak: string;
  pw_hint_phrase: string;
  pw_changed: string;
  rk_title: string;
  rk_desc: string;
  rk_status_none: string;
  rk_status_ok: string;
  rk_status_stale: string;
  rk_create_btn: string;
  rk_replace_btn: string;
  rk_remove_btn: string;
  rk_password_prompt: string;
  rk_shown_once: string;
  rk_copy: string;
  rk_download: string;
  rk_saved_confirm: string;
  rk_replaced_note: string;
  rk_forgot: string;
  rk_recover_title: string;
  rk_code_label: string;
  rk_recover_btn: string;
  rk_back: string;
  rk_file_header: string;
  health_download_btn: string;
  health_download_hint: string;
  crash_reports_label: string;
  crash_reports_desc: string;
  hyg_title: string;
  hyg_expires: string;
  hyg_rotate_days: string;
  hyg_save: string;
  hyg_saved: string;
  hyg_mark_rotated: string;
  hyg_marked_rotated: string;
  hyg_where_used: string;
  hyg_last_rotated: string;
  hyg_no_folders: string;
  hyg_not_found: string;
  hyg_truncated: string;
  hyg_state_expired: string;
  hyg_state_rotation_due: string;
  hyg_state_expiring: string;
  hyg_card_title: string;
  hyg_all_good: string;
  hyg_none_tracked: string;
  port_title: string;
  port_import_title: string;
  port_import_desc: string;
  port_choose_file: string;
  port_passphrase: string;
  port_open: string;
  port_found: string;
  port_import_btn: string;
  port_imported: string;
  port_export_title: string;
  port_fmt_encrypted: string;
  port_fmt_env: string;
  port_new_passphrase: string;
  port_pass_short: string;
  port_plain_warning: string;
  port_plain_confirm: string;
  port_export_btn: string;
  port_exported: string;
  cli_title: string;
  cli_desc: string;
  cli_token_name: string;
  cli_create: string;
  cli_token_once: string;
  cli_done: string;
  cli_none: string;
  cli_last_used: string;
  cli_never_used: string;
  cli_revoke: string;
  cli_note: string;
}

export const translations: Record<UiLanguage, TranslationDict> = {
  en: {
    tab_home: "Home",
    tab_paste: "Paste & Analyze",
    tab_scratchpad: "Scratchpad",
    tab_folders: "Folder Watcher",
    tab_ask: "Ask Assistant",
    tab_library: "Library",
    tab_apps: "Applications",
    apps_search: "Search apps and keys",
    apps_new: "New application",
    apps_name_placeholder: "Application name",
    apps_create: "Create",
    apps_cancel: "Cancel",
    apps_save: "Save",
    apps_empty_title: "Keep each application's secrets together",
    apps_empty_body: "Create an application, then paste its .env file or add keys one by one. Secrets you already saved can be moved in.",
    apps_no_match: "No application or key matches your search.",
    apps_count_keys: "{n} keys",
    apps_paste_env: "Paste .env",
    apps_copy_env: "Copy as .env",
    apps_copied_env: "Copied {n} keys as .env. The clipboard clears itself.",
    apps_add_existing: "Add existing secrets",
    apps_rename: "Rename",
    apps_rename_title: "Rename application",
    apps_delete: "Delete application",
    apps_delete_title: "Delete {app}?",
    apps_delete_msg: "This deletes its {n} keys and its notes from the vault.",
    apps_env_none: "No environment",
    apps_env_add: "Add environment",
    apps_env_placeholder: "Environment name",
    apps_col_key: "Key",
    apps_col_value: "Value",
    apps_add_key: "Add key",
    apps_value_placeholder: "Value",
    apps_no_keys_env: "No keys in this environment yet.",
    apps_reveal: "Reveal",
    apps_hide: "Hide",
    apps_copy: "Copy value",
    apps_copied: "Copied",
    apps_edit: "Edit",
    apps_remove_from_app: "Remove from application (keeps it in the Library)",
    apps_delete_key: "Delete key",
    apps_delete_key_title: "Delete {key}?",
    apps_delete_key_msg: "The key is removed from the vault.",
    apps_notes_placeholder: "Notes for this application: logins, URLs, how to rotate keys",
    apps_notes_saved: "Notes saved",
    apps_paste_title: "Paste .env into {app}",
    apps_paste_hint: "One KEY=value per line. Lines starting with # are ignored. Existing keys with the same name are updated.",
    apps_preview: "Preview",
    apps_back: "Back",
    apps_status_new: "new",
    apps_status_update: "update",
    apps_status_same: "unchanged",
    apps_save_n: "Save {n}",
    apps_saved_result: "{created} added, {updated} updated",
    apps_skipped_lines: "{n} lines skipped",
    apps_nothing_to_save: "Nothing to save: every key is unchanged.",
    apps_existing_title: "Add existing secrets to {app}",
    apps_existing_hint: "Secrets that aren't in any application yet.",
    apps_existing_none: "Every secret already belongs to an application.",
    apps_move_n: "Move {n}",
    apps_moved: "Moved {n} secrets",
    apps_env_label: "Environment",
    apps_app_label: "Application",
    apps_none_library: "No application (Library only)",
    apps_new_option: "+ New application…",
    apps_new_env_option: "+ New environment…",
    apps_save_secrets_title: "Save {n} secrets",
    apps_checking: "Checking…",
    apps_error: "Couldn't save. Try again.",
    apps_name_required: "Enter a name",
    apps_expired: "expired",
    apps_expiring: "expires soon",
    apps_rotation_due: "rotation due",
    apps_select_all: "Select all",
    tab_settings: "Settings",
    tab_logs: "Logs",
    logs_copy_all: "Copy all",

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
    open_analyze_tab: "Open Analyze tab",
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
    identify_key_label: "Key / Value",
    identify_keep_hint: "Leave empty to keep the current secret",
    identify_category_label: "Category",
    family_secret: "Secret",
    family_command: "Command",
    family_note: "Note",
    family_unknown: "Unidentified",

    ask_placeholder: "Search: token name, key type, or ask a question...",
    ask_header_placeholder: "Ask: What is my Telegram token and ID?",
    search_btn: "Search",
    ask_btn: "Ask",
    built_with_kazma: "Built with Kazma.ai",
    kazma_tagline: "Autonomous AI agent framework — LangGraph brain, swarm orchestration, Arabic-first, human-in-the-loop safety.",
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
    emergency_title: "Emergency Plan",
    emergency_desc: "Self-contained snapshots of everything (vault, notes, settings) are saved automatically to several safe locations that survive uninstalls, updates, and moving the app folder. Restore any snapshot below if data is ever lost.",
    emergency_create_btn: "Create snapshot now",
    emergency_refresh_btn: "Refresh",
    emergency_restore_btn: "Restore",
    emergency_confirm_restore: "Confirm restore",
    emergency_created: "Snapshot created and copied to all safe locations.",
    emergency_nochange: "No changes since the last snapshot.",
    emergency_restored: "Restored. Reloading...",
    emergency_empty: "No snapshots yet — one is created automatically on startup.",
    emergency_copies: "safe copies",
    save_settings_btn: "Save settings",
    ui_language_label: "UI Language",
    ui_language_desc: "Select the display language for the application interface.",
    font_size_en_label: "English Font Size",
    font_size_en_desc: "Adjust the font size for English text.",
    font_size_ar_label: "Arabic Font Size",
    font_size_ar_desc: "Adjust the font size for Arabic text.",

    spellcheck_title: "Spellchecking & Proofreading",
    spellcheck_live_label: "Live Spellcheck (Red Squiggles)",
    spellcheck_live_desc: "Show red squiggles under misspelled words as you type using high-speed local dictionaries.",
    spellcheck_ai_label: "AI Proofreader",
    spellcheck_ai_desc: "Show the 'Proofread' button in the Scratchpad to fix grammar and spelling using local AI.",
    autolock_section_title: "Auto-Lock",
    pin_pin: "Pin",
    pin_pinned: "Pinned",
    pin_unpin: "Unpin",
    protect_protect: "Protect",
    protect_protected: "Protected",
    protect_title: "Protect this note from edit/delete",
    protect_unprotect_title: "Remove protection",
    protect_enable: "Protect note",
    protect_remove_btn: "Remove protection",
    protect_confirm_title: "Protect this note?",
    protect_confirm_msg: "A protected note cannot be edited, renamed, deleted, archived, or sent to AI. Remove protection anytime with your confirmation word.",
    protect_remove_title: "Remove protection",
    protect_remove_msg: "Type UNPROTECT (or your master password if the vault is encrypted) to allow edits and deletion again.",
    scratchpad_archive_protected: "This note is protected — unprotect it before archiving.",
    scratchpad_archive_failed: "Archive failed — nothing was changed.",
    scratchpad_close_protected: "This note is protected — unprotect it before deleting.",
    scratchpad_close_failed: "Delete failed — nothing was changed.",
    autolock_minutes_label: "Lock after inactivity (minutes, 0 = off)",
    autolock_desc: "Locks the vault automatically after the chosen number of minutes without activity. Requires vault encryption.",
    autolock_minimize_label: "Lock when the window is minimized",
    clipboard_clear_label: "Clear copied secrets from the clipboard after (seconds)",
    clipboard_clear_desc: "Only cleared if the clipboard still holds the copied value. 0 = never.",

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
    sec_first_setup_title: "Create Your Master Password",
    sec_first_setup_subtitle: "IndexArc encrypts everything at rest by default. This password is the only key to your vault — it never leaves this device and cannot be recovered if lost.",
    sec_first_setup_hint: "Minimum 12 characters; a passphrase of four or more unrelated words is ideal.",
    sec_confirm_label: "Confirm Password",
    sec_first_setup_btn: "Create Encrypted Vault",
    sec_error_mismatch: "Passwords do not match",
    sec_encrypt_banner_title: "Your vault is not encrypted",
    sec_encrypt_banner_text: "Entries and notes are currently stored as plain JSON. Enable encryption in Settings → Security.",
    sec_encrypt_banner_btn: "Set Master Password",
    egress_title: "Data Egress Control",
    update_title: "Updates",
    update_desc: "Checks GitHub Releases for a newer version. Nothing is sent except a normal web request.",
    update_on_start: "Check for updates when the app starts",
    update_check_now: "Check now",
    update_checking: "Checking…",
    update_current: "You have the latest version ({v}).",
    update_available: "Version {v} is available.",
    update_download: "Download update",
    update_downloading: "Downloading… {n}%",
    update_install: "Restart and install",
    update_unsigned: "This build is not code-signed, so it cannot verify and install updates itself. Download the new version from the release page.",
    update_portable: "The portable version cannot update itself. Download the new version from the release page.",
    update_unsupported: "Updates are only available in the installed desktop app.",
    update_error: "Could not check for updates: {m}",
    update_view_release: "Open release page",
    egress_cloud_label: "Allow cloud AI providers",
    egress_cloud_desc: "OFF by default. When ON, cloud providers (Gemini/OpenAI/Groq/OpenRouter/Anthropic) receive vault-derived text for search and answers — secret values are never included, only names/types/labels.",
    egress_lt_label: "Allow public LanguageTool API",
    egress_lt_desc: "OFF by default. When ON, note words are sent to languagetool.org for proofreading when the local engine is unavailable.",
    loading_settings: "Loading settings…",
    sec_error_incorrect: "Incorrect master password",
    sec_error_length: "Password must be at least 12 characters",
    sec_status_enabled: "Encrypted (AES-256-GCM)",
    sec_status_disabled: "Unencrypted (Plain JSON)",
    find_duplicates_btn: "Find Duplicates",
    duplicates_found: "Duplicates Found",
    duplicates_desc: "These entries have identical values. Consider removing the duplicates.",
    remove_duplicate_btn: "Remove",
    select_all: "Select All",
    remove_selected_btn: "Remove Selected",
    lib_archived: "Archived",

    scratchpad_add: "New scratch",
    scratchpad_placeholder: "Paste anything — secrets, notes, code, commands. AI auto-detects on paste.",
    scratchpad_detect: "Detect",
    scratchpad_detecting: "Detecting…",
    scratchpad_save_secret: "Save secret to Vault",
    scratchpad_save_note: "Save as Note",
    scratchpad_saving: "Saving…",
    scratchpad_saved_ok: "Saved to vault",
    scratchpad_save_err: "Save failed",
    scratchpad_rephrase: "Rephrase",
    scratchpad_rephrase_undo: "Undo",
    scratchpad_rephrase_undone: "Reverted to previous text",
    scratchpad_rewriting: "Rephrasing…",
    scratchpad_rephrased: "Rephrased",
    scratchpad_conflict_msg: "These notes were changed in another window. Whose version should win?",
    scratchpad_conflict_load: "Load saved version",
    scratchpad_conflict_keep: "Keep mine",
    scratchpad_rewrite_err: "Rewrite failed",
    scratchpad_proofread: "Proofread",
    scratchpad_proofreading: "Proofreading...",
    scratchpad_proofread_ok: "Proofread complete",
    scratchpad_proofread_err: "Proofread failed",
    scratchpad_clear: "Clear",
    scratchpad_copy: "Copy",
    scratchpad_copied: "Copied!",
    scratchpad_go_to_top: "Go to top",
    scratchpad_go_to_bottom: "Go to bottom",
    scratchpad_bidi_auto: "Auto direction",
    scratchpad_bidi_ltr: "Left to right",
    scratchpad_bidi_rtl: "Right to left",
    scratchpad_bidi_hint: "Text direction for dual-language notes",
    scratchpad_rename: "Rename tab",
    scratchpad_archive: "Archive tab",
    scratchpad_drag_to_reorder: "Drag to reorder",
    scratchpad_archived: "Archived",
    scratchpad_restore: "Restore tab",
    scratchpad_delete: "Delete tab",
    scratchpad_ai_detected: "AI detected",
    scratchpad_no_detection: "Nothing detected yet — paste or click Detect",
    scratchpad_bold: "Bold",
    scratchpad_italic: "Italic",
    scratchpad_underline: "Underline",
    scratchpad_highlight: "Highlight",
    scratchpad_text_color: "Text color",
    scratchpad_clear_format: "Clear formatting",
    paste_plain_on: "Paste as plain text (ON)",
    paste_plain_off: "Paste as plain text (OFF — keep formatting)",
    scratchpad_undo: "Undo",
    scratchpad_redo: "Redo",
    scratchpad_history: "Version History",
    scratchpad_history_title: "Note Revision History",
    scratchpad_history_empty: "No saved revisions for this note yet. Snapshots are recorded automatically as you write.",
    scratchpad_history_restore: "Restore this version",
    scratchpad_history_restored: "Version restored successfully!",
    scratchpad_compare: "Compare",
    scratchpad_compare_title: "Compare Two Notes",
    scratchpad_compare_desc: "Red lines exist only in the left note, green lines only in the right one — highlighted words are the edits inside changed lines.",
    scratchpad_compare_identical: "These two notes are identical.",
    scratchpad_compare_pick_two: "Pick two different notes to compare them.",
    scratchpad_rescue: "Rescue Notes",
    scratchpad_rescue_title: "Rescue Unsaved Notes",
    scratchpad_rescue_desc: "Snapshots recorded for notes that no longer exist — content that was typed but never saved. Restore any of them back as a note.",
    scratchpad_rescue_empty: "No orphaned snapshots found — nothing to rescue.",
    scratchpad_rescue_restore: "Restore as note",
    scratchpad_rescue_restored: "Note restored!",
    scratchpad_save_failed: "Notes are NOT saving — recent changes exist only in this window. Do NOT close the app; saving retries automatically.",
    scratchpad_content_cleared: "Note content was cleared.",
    scratchpad_restore_undo: "Undo / Restore",
    highlight_yellow: "Yellow",
    highlight_green: "Green",
    highlight_blue: "Blue",
    highlight_red: "Red",
    highlight_purple: "Purple",
    text_color_white: "White",
    text_color_red: "Red",
    text_color_orange: "Orange",
    text_color_yellow: "Yellow",
    text_color_green: "Green",
    text_color_blue: "Blue",
    text_color_purple: "Purple",

    setup_title: "Setup & Dependencies",
    setup_collapse: "Details",
    setup_all_set: "Everything is set up — you're ready to go",
    setup_needs_attention: "Setup needs attention",
    setup_ollama: "Local AI (Ollama)",
    setup_ollama_installed: "Ollama installed",
    setup_ollama_not_installed: "Ollama not installed",
    setup_ollama_online: "Running with local models",
    setup_ollama_offline: "Installed but not running",
    setup_ollama_no_model: "No model pulled yet",
    setup_install_ollama: "Install Ollama",
    setup_start_ollama: "Start Ollama",
    setup_pull_model: "Pull {model}",
    setup_configure_ai: "Configure AI provider",
    setup_ai_ready: "AI provider ready",
    setup_ai_missing: "No AI provider configured",
    setup_installing: "Installing Ollama…",
    setup_starting: "Starting Ollama…",
    setup_pulling: "Pulling model… (this may take a few minutes)",
    setup_install_failed: "Automatic install failed",
    setup_open_download: "Open Ollama download page",
    setup_howto_title: "How to run IndexArc",
    setup_portable_note: "Portable: runs from the .exe, data lives next to it (USB-friendly).",
    setup_installer_note: "Installer: installs to your PC, data stored in AppData.",
    setup_dismiss: "Dismiss",
    setup_pull_done: "Model pulled — local AI is ready",

    health_title: "App health",
    health_subtitle: "Server, data folder, vault, notes, backups & AI — one check.",
    health_open_btn: "Check app health",
    health_refresh_btn: "Re-check",
    health_copy_btn: "Copy diagnostics",
    health_copied: "Diagnostics copied",
    health_healthy: "Healthy",
    health_degraded: "Degraded",
    health_attention: "Needs attention",
    nav_section_vault: "Vault",
    vault_overview: "Vault overview",
    stat_saved: "Saved",
    stat_pending: "Pending",
    stat_secrets: "Secrets",
    stat_commands: "Commands",
    stat_open_in_library: "Open in Library",
    brand_tagline: "Portable Vault",
    new_entry_btn: "New",
    search_btn_short: "Search…",
    search_btn_title: "Search everything (Ctrl+K)",
    theme_to_light: "Switch to light theme",
    theme_to_dark: "Switch to dark theme",
    lang_switch_title: "التبديل إلى العربية",
    menu_open: "Open menu",
    menu_close: "Close menu",
    integrity_title: "Data integrity warning",
    integrity_hint: "Check Settings → Logs for details. Corrupt copies are quarantined, never deleted.",
    dismiss_btn: "Dismiss",
    setup_vault_locked: "Locked — unlock to load entries",
    setup_vault_counts: "{entries} entries · {notes} notes",
    health_more_issues: "+{n} more",
    home_good_morning: "Good morning",
    home_good_afternoon: "Good afternoon",
    home_good_evening: "Good evening",
    home_sub_healthy: "Your vault is healthy.",
    home_sub_attention: "A few things need a look.",
    home_sub_locked: "Your vault is locked.",
    kpi_entries: "Entries",
    kpi_secrets: "Secrets",
    kpi_commands: "Commands",
    kpi_review: "Needs review",
    kpi_added_week: "+{n} this week",
    kpi_entries_note: "{n} notes saved",
    kpi_secrets_enc: "Encrypted at rest",
    kpi_secrets_plain: "Not encrypted yet",
    kpi_commands_note: "Ready to copy",
    kpi_review_note: "Waiting for a name or type",
    kpi_review_none: "Nothing waiting",
    kpi_open_title: "Open in Library",
    health_card_title: "Vault health",
    health_card_ok: "Everything checks out",
    health_card_issues: "{n} need a look",
    health_card_run: "Run check",
    health_card_details: "Details",
    health_card_score: "Health score {n} of 100",
    mix_title: "What's in the vault",
    mix_empty: "Nothing saved yet",
    mix_commands: "Commands",
    mix_notes: "Notes",
    mix_secrets: "Secrets",
    mix_other: "Other",
    services_title: "Background services",
    services_basic: "Basic",
    services_rules: "Built-in detection rules",
    services_ai: "AI engine",
    services_ready: "Ready",
    services_offline: "Offline",
    services_watcher: "Folder watcher",
    services_watching: "Watching",
    services_idle: "Idle",
    services_to_review: "{n} to review",
    services_no_scan: "No folder scanned yet",
    open_btn: "Open",
    recent_open_library: "Open library",
    quick_capture_hint: "Paste anything. IndexArc finds the secrets, commands and links.",
    lock_card_unlocked: "Unlocked",
    lock_card_autolock: "Auto-lock after {n} min idle",
    lock_card_autolock_off: "Auto-lock is off",
    lock_card_plain: "Vault is not encrypted",
    lock_card_encrypt: "Set a master password",
    lock_now: "Lock now",
    health_data_label: "Data folder",
    health_vault_label: "Vault data",
    health_go_emergency: "Open Emergency Plan (Settings)",
    health_banner_action: "Check health",

    // R4: UI strings moved out of components (dialogs, toasts, settings panels).
    close_btn: "Close",
    fs_drives_home: "(drives & home)",
    palette_dialog_label: "Search everything",
    palette_search_placeholder: "Search notes, secrets, commands, or tabs... (Esc to close)",
    palette_quick_nav: "Quick Navigation",
    palette_vault_results: "Vault Results",
    palette_no_matches: "No matching notes, secrets, or commands found.",
    palette_hint_use: "Use",
    palette_hint_toggle: "anytime to toggle",
    palette_hint_navigate: "navigate",
    palette_hint_select: "select",
    palette_footer_brand: "IndexArc Search",
    health_check_failed: "Health check failed",
    health_check_unreachable: "Health check failed — is the vault server running?",
    health_entries_unit: "entries",
    health_locked: "locked",
    health_encrypted: "encrypted",
    health_notes_label: "Notes",
    health_active_unit: "active",
    health_backups_label: "Backups",
    health_snapshots_label: "Snapshots",
    health_no_results: "No check results.",
    health_alternates_title: "Other data folders on this machine",
    health_encrypted_vault: "encrypted vault",
    health_notes_unit: "notes",
    health_alternates_hint: "If this folder looks empty, your data is probably in one of these. Relaunch that build/folder — or restore a snapshot below.",
    copied_bang: "Copied!",
    note_untitled: "Untitled Note",
    note_save_failed_retry: "Save failed — your edits are still here, retry when the vault is reachable.",
    note_title_label: "Note title",
    note_body_label: "Note content",
    note_words: "words",
    note_min_read: "min read",
    note_restore_size: "Restore Size",
    note_maximize: "Maximize View",
    note_reopen_scratchpad: "Reopen in Scratchpad",
    note_copy_text: "Copy Text",
    note_copy_html: "Copy HTML",
    note_saving: "Saving...",
    note_save_changes: "Save Changes",
    note_edit: "Edit Note",
    note_characters: "characters",
    note_created: "Created",
    archive_preview_untitled: "Archived Note",
    archive_reference_only: "Reference Only",
    archive_archived_on: "Archived on",
    copied_to_clipboard: "Copied to clipboard",
    archive_empty_note: "Empty note",
    archive_delete_permanently: "Delete Permanently",
    archive_restore_to_active: "Restore to Active Notes",
    compare_swap_sides: "Swap sides",
    compare_left_note: "Left note",
    compare_right_note: "Right note",
    rescue_search_placeholder: "Search snapshots…",
    rescue_scanning: "Scanning snapshots…",
    rescue_snapshot_one: "snapshot",
    rescue_snapshot_many: "snapshots",
    history_version_one: "version",
    history_version_many: "versions",
    history_saved_suffix: "saved",
    history_latest_snapshot: "Latest Snapshot",
    history_version_label: "Version",
    chars_unit: "chars",
    history_preview_label: "Preview",
    history_empty: "Empty",
    history_select_version: "Select a version to preview",
    history_footer_hint: "Auto-saved snapshots protect your work from accidental undos or wipes.",
    protect_show: "Show",
    scratchpad_paragraphs_restored: "Restored multiline paragraph formatting!",
    scratchpad_content_restored: "Note content restored!",
    scratchpad_retry_now: "Retry now",
    scratchpad_cleared_detected: "Accidental Ctrl+Z or clear detected.",
    connection_failed: "Connection failed",
    update_toast_available: "IndexArc {v} is available — Settings → Updates",
    ask_failed: "Ask failed",
    loading_scratchpad: "Loading scratchpad…",
    folder_remove_failed: "Failed to remove watched folder",
    toast_copied_name: "Copied {name}",
    copy_failed: "Copy failed",
    save_failed: "Save failed",
    more_count: "+{n} more",
    toast_name_required: "Name is required",
    toast_network_error: "Network error",
    confirm_delete_entry_title: "Delete Entry",
    confirm_delete_entry_msg: "Delete this entry permanently?",
    delete_failed: "Delete failed",
    delete_btn: "Delete",
    confirm_delete_entries_title: "Delete Entries",
    confirm_delete_entries_one: "Delete {n} selected entry permanently?",
    confirm_delete_entries_many: "Delete {n} selected entries permanently?",
    dup_confirm_title: "Possible duplicates",
    dup_confirm_msg: "{n} of {total} already exist in the vault ({names}). Save anyway?",
    dup_save_anyway: "Save anyway",
    dup_deselected: "Duplicates deselected — save again for the {n} new one(s)",
    fs_cannot_list: "Cannot list folder",
    fs_list_failed: "Failed to list directory",
    scan_apply_failed: "Apply failed",
    scan_applied_summary: "Saved {saved} · Unidentified {parked} · Discarded {discarded}",
    confirm_discard_scan_title: "Discard Scan",
    confirm_discard_scan_msg: "Discard this entire scan review? Nothing will be saved.",
    discard_btn: "Discard",
    toast_settings_saved: "Settings saved",
    toast_settings_save_failed: "Settings save failed",
    toast_loading_llm: "Loading LLM into memory...",
    toast_warm_failed: "Warm failed",
    toast_models_loaded: "Models loaded",
    toast_llm_load_failed: "Could not load Ollama LLM",
    toast_settings_patch_failed: "Settings change may not have saved",
    protect_confirm_failed: "Confirmation failed",
    request_failed: "Request failed",
    spell_added_to_dict: "Added \"{word}\" to dictionary",
    spell_ignored: "Ignored \"{word}\"",
    scratchpad_already_in_vault: "Already in vault: {names} — click Save again to save anyway",
    confirm_archive_note: "Are you sure you want to archive note \"{title}\"?",
    confirm_delete_archived_note: "Are you sure you want to permanently delete \"{title}\"?",
    untitled: "Untitled",
    confirm_delete_note: "Are you sure you want to delete \"{title}\"?",
    confirm_clear_note: "Are you sure you want to clear this note's content?",
    predictions_enabled_title: "AI Predictions Enabled (Click to Disable)",
    predictions_disabled_title: "AI Predictions Disabled (Click to Enable)",
    predictions_label: "Predictions",
    state_on: "ON",
    state_off: "OFF",
    format_paragraphs_title: "Restore multi-line paragraphs & auto-format structure",
    format_paragraphs: "Format Paragraphs",
    slash_commands_hint: "Slash commands — type \"/\"",
    slash_heading_1: "Heading 1",
    slash_heading_2: "Heading 2",
    slash_bullet_list: "Bullet list",
    slash_quote: "Quote",
    loading_editor: "Loading editor…",
    prediction_label: "Prediction",
    prediction_accept: "Accept",
    spell_label: "Spelling",
    spell_finding: "Finding suggestions...",
    spell_no_suggestions: "No suggestions",
    spell_add_to_dict: "Add \"{word}\" to Dictionary",
    spell_ignore: "Ignore \"{word}\"",
    archive_cold_storage: "Cold Storage",
    archive_loading: "Loading archive...",
    archive_none: "No archived notes",
    archive_click_preview: "Click to preview (read-only)",
    archive_view_note: "View note",
    archive_view: "View",
    scratchpad_close_tab: "Close tab",
    ask_synthesizing: "Synthesizing answer...",
    copy_to_clipboard: "Copy to clipboard",
    rewrite_show_original: "Show original",
    rewrite_copy_result: "Copy Result",
    rewrite_again: "Rewrite Again",
    entry_hide_value: "Hide Value",
    entry_reveal_value: "Reveal Value",
    entry_open_full_note: "Open Full Note",
    entry_click_to_reveal: "Click to reveal",
    candidate_discard_title: "Discard — remove this candidate",
    candidate_discard_label: "Discard candidate",
    via_provider: "via",
    health_vault_unavailable: "Vault data unavailable in this data folder.",
    key_saved_type_to_replace: "saved — type to replace",
    key_saved_badge: "saved",
    provider_api_key_label: "{p} API key",
    provider_model_label: "{p} model (classify / extract)",
    local_openai_title: "Custom OpenAI Endpoint",
    local_openai_base_url: "Base URL",
    local_openai_api_key: "API Key (optional)",
    local_openai_model: "Model name",
    local_openai_embed_model: "Embed Model name (optional)",
    local_openai_embed_default: "defaults to LLM model",
    adv_ai_title: "Advanced AI Settings",
    adv_ai_desc: "Override which provider is used for LLM generation and embeddings. Useful for using LM Studio for LLMs while keeping Ollama for embeddings.",
    adv_ai_llm_override: "LLM Provider Override",
    adv_ai_embed_override: "Embed Provider Override",
    adv_ai_default_auto: "Default (auto)",
    adv_ai_tip: "Tip: Use LM Studio (local_openai) for LLM and Ollama (local) for embeddings for mixed local models.",
    provider_auto: "Auto",
    provider_local_ollama: "Local Ollama",
    provider_cloud_gemini: "Cloud Gemini",
    provider_custom_local_openai: "Custom Local OpenAI",
    provider_custom_openai_lmstudio: "Custom OpenAI (LM Studio)",
    provider_heuristic: "Heuristic (no AI)",
    sec_encryption_status: "Vault Encryption Status",
    sec_remove_desc: "Your vault is fully encrypted with AES-256-GCM. To remove encryption and convert data back to plain text, enter your current master password:",
    sec_set_password_placeholder: "Set master password...",
    sec_setup_failed: "Failed to setup password",
    emergency_empty_snapshot_title: "This snapshot contains no vault entries and no notes — restoring it changes nothing. Pick an older, larger snapshot.",
    emergency_empty_badge: "empty",
    emergency_empty_snapshot: "Empty snapshot — restores nothing.",
    emergency_snapshot_failed: "Snapshot failed",
    emergency_restored_counts: "Restored ({parts}). Reloading...",
    emergency_restored_locked: "Restored (encrypted — unlock to load). Reloading...",
    emergency_restore_failed: "Restore failed",
    failed_generic: "Failed",
    logs_empty: "No logs yet",
    update_download_failed: "download failed",
    // R5: password change + recovery key
    pw_change_title: "Change master password",
    pw_change_desc: "Re-encrypts every file and record under the new password.",
    pw_current: "Current password",
    pw_new: "New password (12+ characters)",
    pw_confirm: "Repeat new password",
    pw_change_btn: "Change password",
    pw_mismatch: "The new passwords do not match",
    pw_too_short: "Password must be at least 12 characters",
    pw_show: "Show password",
    pw_hide: "Hide password",
    pw_strength_label: "Strength",
    pw_strength_0: "Very weak",
    pw_strength_1: "Weak",
    pw_strength_2: "Fair",
    pw_strength_3: "Strong",
    pw_strength_4: "Very strong",
    pw_problem_common: "This is a commonly used password. Choose another.",
    pw_problem_weak: "Too easy to guess. Try a longer phrase of unrelated words.",
    pw_hint_phrase: "Tip: a phrase of four or more unrelated words is strong and easy to remember.",
    pw_changed: "Master password changed",
    rk_title: "Recovery key",
    rk_desc: "A one-time code that resets a forgotten master password. Anyone with this code and your vault files can open the vault, so keep it offline, like the password itself.",
    rk_status_none: "Not set up. A forgotten password means lost data.",
    rk_status_ok: "Set up",
    rk_status_stale: "Out of date. Create a new one.",
    rk_create_btn: "Create recovery key",
    rk_replace_btn: "Replace recovery key",
    rk_remove_btn: "Remove",
    rk_password_prompt: "Master password (to confirm)",
    rk_shown_once: "Write this down or save it now. It will not be shown again.",
    rk_copy: "Copy",
    rk_download: "Save as file",
    rk_saved_confirm: "I saved it",
    rk_replaced_note: "Any previous recovery key no longer works.",
    rk_forgot: "Forgot password? Use your recovery key",
    rk_recover_title: "Reset with recovery key",
    rk_code_label: "Recovery key",
    rk_recover_btn: "Reset password and unlock",
    rk_back: "Back to password",
    rk_file_header: "IndexArc recovery key",
    health_download_btn: "Download report",
    health_download_hint: "Redacted diagnostics for a bug report: no secrets, e-mail addresses or your user name",
    crash_reports_label: "Keep a crash log for bug reports",
    crash_reports_desc: "Records error messages and stack traces only, redacted on this device. Nothing is sent anywhere; the log goes into Download report in App health.",
    hyg_title: "Expiry and rotation",
    hyg_expires: "Expires on",
    hyg_rotate_days: "Rotate every (days)",
    hyg_save: "Save",
    hyg_saved: "Saved",
    hyg_mark_rotated: "Mark rotated",
    hyg_marked_rotated: "Marked as rotated today",
    hyg_where_used: "Where used",
    hyg_last_rotated: "Last rotated",
    hyg_no_folders: "No folders to search. Add a watched folder in Settings.",
    hyg_not_found: "Not found in {n} files.",
    hyg_truncated: "The search stopped early; there may be more.",
    hyg_state_expired: "Expired",
    hyg_state_rotation_due: "Rotate now",
    hyg_state_expiring: "Expires soon",
    hyg_card_title: "Expiry and rotation",
    hyg_all_good: "Nothing has expired or is due for rotation.",
    hyg_none_tracked: "Set an expiry date or rotation period on a secret to track it here.",
    port_title: "Import and export",
    port_import_title: "Import",
    port_import_desc: "From a .env file, Bitwarden JSON, 1Password or generic CSV, KeePass XML, or an IndexArc encrypted export. You review everything before it is saved.",
    port_choose_file: "Choose file…",
    port_passphrase: "Export passphrase",
    port_open: "Open",
    port_found: "Found {n} secrets ({format})",
    port_import_btn: "Import {n} selected",
    port_imported: "Imported {n} entries.",
    port_export_title: "Export",
    port_fmt_encrypted: "Encrypted (.iaexport)",
    port_fmt_env: "Plain .env",
    port_new_passphrase: "New passphrase (12+ characters)",
    port_pass_short: "The passphrase must be at least 12 characters.",
    port_plain_warning: "I understand a .env file is plain text: anyone who gets the file can read every secret in it.",
    port_plain_confirm: "Confirm the plain-text warning first.",
    port_export_btn: "Export",
    port_exported: "Exported {n} entries.",
    cli_title: "CLI access",
    cli_desc: "Use your secrets from a terminal or script with the indexarc command. It reads from this app, only while the vault is unlocked, using a token you create here.",
    cli_token_name: "Token name (e.g. laptop, CI)",
    cli_create: "Create token",
    cli_token_once: "Copy this token now. It is shown only once. Paste it into `indexarc login`.",
    cli_done: "I've copied it",
    cli_none: "No CLI tokens yet.",
    cli_last_used: "Last used",
    cli_never_used: "Never used",
    cli_revoke: "Revoke",
    cli_note: "A CLI token can only read secrets; it cannot change the vault, unlock it, or make new tokens. Changing the master password revokes all CLI tokens.",
  },
  ar: {
    tab_home: "الرئيسية",
    tab_paste: "لصق وتحليل",
    tab_scratchpad: "المسودة",
    tab_folders: "مراقب المجلدات",
    tab_ask: "اسأل المساعد",
    tab_library: "المكتبة",
    tab_apps: "التطبيقات",
    apps_search: "ابحث في التطبيقات والمفاتيح",
    apps_new: "تطبيق جديد",
    apps_name_placeholder: "اسم التطبيق",
    apps_create: "إنشاء",
    apps_cancel: "إلغاء",
    apps_save: "حفظ",
    apps_empty_title: "اجمع أسرار كل تطبيق في مكان واحد",
    apps_empty_body: "أنشئ تطبيقًا، ثم الصق ملف ‎.env‎ الخاص به أو أضف المفاتيح واحدًا تلو الآخر. ويمكنك نقل الأسرار المحفوظة سابقًا إليه.",
    apps_no_match: "لا يوجد تطبيق أو مفتاح يطابق بحثك.",
    apps_count_keys: "{n} مفاتيح",
    apps_paste_env: "لصق ‎.env‎",
    apps_copy_env: "نسخ بصيغة ‎.env‎",
    apps_copied_env: "تم نسخ {n} مفاتيح بصيغة ‎.env‎. ستُمسح الحافظة تلقائيًا.",
    apps_add_existing: "إضافة أسرار موجودة",
    apps_rename: "إعادة تسمية",
    apps_rename_title: "إعادة تسمية التطبيق",
    apps_delete: "حذف التطبيق",
    apps_delete_title: "حذف {app}؟",
    apps_delete_msg: "سيؤدي هذا إلى حذف مفاتيحه ({n}) وملاحظاته من الخزنة.",
    apps_env_none: "بدون بيئة",
    apps_env_add: "إضافة بيئة",
    apps_env_placeholder: "اسم البيئة",
    apps_col_key: "المفتاح",
    apps_col_value: "القيمة",
    apps_add_key: "إضافة مفتاح",
    apps_value_placeholder: "القيمة",
    apps_no_keys_env: "لا توجد مفاتيح في هذه البيئة بعد.",
    apps_reveal: "إظهار",
    apps_hide: "إخفاء",
    apps_copy: "نسخ القيمة",
    apps_copied: "تم النسخ",
    apps_edit: "تعديل",
    apps_remove_from_app: "إزالة من التطبيق (يبقى في المكتبة)",
    apps_delete_key: "حذف المفتاح",
    apps_delete_key_title: "حذف {key}؟",
    apps_delete_key_msg: "سيُحذف المفتاح من الخزنة.",
    apps_notes_placeholder: "ملاحظات لهذا التطبيق: بيانات الدخول، الروابط، طريقة تدوير المفاتيح",
    apps_notes_saved: "تم حفظ الملاحظات",
    apps_paste_title: "لصق ‎.env‎ في {app}",
    apps_paste_hint: "سطر واحد لكل KEY=value. تُتجاهل الأسطر التي تبدأ بـ #. تُحدَّث المفاتيح الموجودة بالاسم نفسه.",
    apps_preview: "معاينة",
    apps_back: "رجوع",
    apps_status_new: "جديد",
    apps_status_update: "تحديث",
    apps_status_same: "بلا تغيير",
    apps_save_n: "حفظ {n}",
    apps_saved_result: "أُضيف {created}، وحُدِّث {updated}",
    apps_skipped_lines: "تُخطّي {n} أسطر",
    apps_nothing_to_save: "لا شيء للحفظ: كل المفاتيح بلا تغيير.",
    apps_existing_title: "إضافة أسرار موجودة إلى {app}",
    apps_existing_hint: "الأسرار غير المرتبطة بأي تطبيق بعد.",
    apps_existing_none: "كل الأسرار مرتبطة بتطبيقات بالفعل.",
    apps_move_n: "نقل {n}",
    apps_moved: "تم نقل {n} أسرار",
    apps_env_label: "البيئة",
    apps_app_label: "التطبيق",
    apps_none_library: "بدون تطبيق (المكتبة فقط)",
    apps_new_option: "+ تطبيق جديد…",
    apps_new_env_option: "+ بيئة جديدة…",
    apps_save_secrets_title: "حفظ {n} أسرار",
    apps_checking: "جارٍ التحقق…",
    apps_error: "تعذّر الحفظ. حاول مرة أخرى.",
    apps_name_required: "أدخل اسمًا",
    apps_expired: "منتهي",
    apps_expiring: "ينتهي قريبًا",
    apps_rotation_due: "حان التدوير",
    apps_select_all: "تحديد الكل",
    tab_settings: "الإعدادات",
    tab_logs: "السجلات",
    logs_copy_all: "نسخ الكل",

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
    analyzing: "جاري التحليل…",
    re_analyze_btn: "إعادة التحليل",
    open_analyze_tab: "فتح تبويب التحليل",
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
    identify_key_label: "المفتاح / القيمة",
    identify_keep_hint: "اتركه فارغاً للاحتفاظ بالسر الحالي",
    identify_category_label: "الفئة",
    family_secret: "سر",
    family_command: "أمر",
    family_note: "ملاحظة",
    family_unknown: "غير محدد",

    ask_placeholder: "ابحث: اسم التوكن، نوع المفتاح، أو اطرح سؤالاً...",
    ask_header_placeholder: "اسأل: ما هو توكن ومفتاح التليجرام؟",
    search_btn: "بحث",
    ask_btn: "اسأل",
    built_with_kazma: "صُنع باستخدام Kazma.ai",
    kazma_tagline: "إطار عمل وكلاء ذكاء اصطناعي مستقل — عقل LangGraph، تنسيق سربي، عربي أولاً، مع أمان بوجود الإنسان في الحلقة.",
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
    emergency_title: "خطة الطوارئ",
    emergency_desc: "يتم حفظ نسخ احتياطية كاملة ومستقلة لكل شيء (الخزنة، الملاحظات، الإعدادات) تلقائياً في عدة مواقع آمنة تبقى رغم إلغاء التثبيت والتحديثات ونقل مجلد التطبيق. استعد أي نسخة أدناه إذا فُقدت البيانات.",
    emergency_create_btn: "إنشاء نسخة الآن",
    emergency_refresh_btn: "تحديث",
    emergency_restore_btn: "استعادة",
    emergency_confirm_restore: "تأكيد الاستعادة",
    emergency_created: "تم إنشاء النسخة ونسخها إلى جميع المواقع الآمنة.",
    emergency_nochange: "لا تغييرات منذ آخر نسخة.",
    emergency_restored: "تمت الاستعادة. جارٍ إعادة التحميل...",
    emergency_empty: "لا توجد نسخ بعد — تُنشأ واحدة تلقائياً عند بدء التشغيل.",
    emergency_copies: "نسخ آمنة",
    save_settings_btn: "حفظ الإعدادات",
    ui_language_label: "لغة الواجهة",
    ui_language_desc: "اختر لغة عرض واجهة المستخدم الخاصة بالتطبيق.",
    font_size_en_label: "حجم الخط الإنجليزي",
    font_size_en_desc: "ضبط حجم الخط للنص الإنجليزي.",
    font_size_ar_label: "حجم الخط العربي",
    font_size_ar_desc: "ضبط حجم الخط للنص العربي.",

    spellcheck_title: "التدقيق الإملائي والمراجعة اللغوية",
    spellcheck_live_label: "التدقيق الإملائي المباشر (خطوط حمراء متعرجة)",
    spellcheck_live_desc: "إظهار خطوط حمراء متعرجة أسفل الكلمات التي بها أخطاء إملائية أثناء الكتابة باستخدام قواميس محلية عالية السرعة.",
    spellcheck_ai_label: "مصحح لغوي بالذكاء الاصطناعي",
    spellcheck_ai_desc: "إظهار زر 'مراجعة' في المسودة لتصحيح القواعد والإملاء باستخدام الذكاء الاصطناعي المحلي.",
    autolock_section_title: "القفل التلقائي",
    pin_pin: "تثبيت",
    pin_pinned: "مثبتة",
    pin_unpin: "إلغاء التثبيت",
    protect_protect: "حماية",
    protect_protected: "محمية",
    protect_title: "حماية هذه الملاحظة من التعديل والحذف",
    protect_unprotect_title: "إزالة الحماية",
    protect_enable: "حماية الملاحظة",
    protect_remove_btn: "إزالة الحماية",
    protect_confirm_title: "حماية هذه الملاحظة؟",
    protect_confirm_msg: "لا يمكن تعديل الملاحظة المحمية أو إعادة تسميتها أو حذفها أو أرشفتها أو إرسالها إلى الذكاء الاصطناعي. يمكنك إزالة الحماية في أي وقت بكلمة التأكيد.",
    protect_remove_title: "إزالة الحماية",
    protect_remove_msg: "اكتب UNPROTECT (أو كلمة المرور الرئيسية إذا كانت الخزنة مشفرة) للسماح بالتعديل والحذف مرة أخرى.",
    scratchpad_archive_protected: "هذه الملاحظة محمية — أزل الحماية قبل الأرشفة.",
    scratchpad_archive_failed: "فشل الأرشفة — لم يتغير شيء.",
    scratchpad_close_protected: "هذه الملاحظة محمية — أزل الحماية قبل الحذف.",
    scratchpad_close_failed: "فشل الحذف — لم يتغير شيء.",
    autolock_minutes_label: "القفل بعد فترة عدم النشاط (بالدقائق، 0 = إيقاف)",
    autolock_desc: "يقفل الخزنة تلقائيًا بعد عدد الدقائق المحدد دون نشاط. يتطلب تشفير الخزنة.",
    autolock_minimize_label: "القفل عند تصغير النافذة",
    clipboard_clear_label: "مسح الأسرار المنسوخة من الحافظة بعد (ثوانٍ)",
    clipboard_clear_desc: "تُمسح فقط إذا كانت الحافظة لا تزال تحتوي على القيمة المنسوخة. 0 = أبداً.",

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
    sec_first_setup_title: "أنشئ كلمة المرور الرئيسية",
    sec_first_setup_subtitle: "يقوم IndexArc بتشفير كل شيء افتراضيًا. كلمة المرور هذه هي المفتاح الوحيد لخزنتك — لا تخرج من هذا الجهاز ولا يمكن استعادتها إذا فُقدت.",
    sec_first_setup_hint: "12 حرفًا على الأقل؛ وعبارة من أربع كلمات غير مترابطة أو أكثر هي الخيار الأفضل.",
    sec_confirm_label: "تأكيد كلمة المرور",
    sec_first_setup_btn: "إنشاء خزنة مشفرة",
    sec_error_mismatch: "كلمتا المرور غير متطابقتين",
    sec_encrypt_banner_title: "خزنتك غير مشفرة",
    sec_encrypt_banner_text: "المدخلات والملاحظات محفوظة حاليًا كملفات JSON نصية. فعّل التشفير من الإعدادات ← الأمان.",
    sec_encrypt_banner_btn: "عيّن كلمة المرور الرئيسية",
    egress_title: "التحكم في خروج البيانات",
    update_title: "التحديثات",
    update_desc: "يتحقق من إصدارات GitHub بحثًا عن نسخة أحدث. لا يُرسل شيء سوى طلب ويب عادي.",
    update_on_start: "التحقق من التحديثات عند بدء التطبيق",
    update_check_now: "تحقق الآن",
    update_checking: "جارٍ التحقق…",
    update_current: "لديك أحدث إصدار ({v}).",
    update_available: "الإصدار {v} متاح.",
    update_download: "تنزيل التحديث",
    update_downloading: "جارٍ التنزيل… {n}%",
    update_install: "إعادة التشغيل والتثبيت",
    update_unsigned: "هذه النسخة غير موقّعة رقميًا، لذا لا يمكنها التحقق من التحديثات وتثبيتها بنفسها. نزّل الإصدار الجديد من صفحة الإصدارات.",
    update_portable: "النسخة المحمولة لا تحدّث نفسها. نزّل الإصدار الجديد من صفحة الإصدارات.",
    update_unsupported: "التحديثات متاحة فقط في تطبيق سطح المكتب المثبّت.",
    update_error: "تعذّر التحقق من التحديثات: {m}",
    update_view_release: "فتح صفحة الإصدارات",
    egress_cloud_label: "السماح بمزودي الذكاء الاصطناعي السحابيين",
    egress_cloud_desc: "معطّل افتراضيًا. عند التفعيل، تستقبل المزودات السحابية (Gemini/OpenAI/Groq/OpenRouter/Anthropic) نصوصًا مشتقة من الخزنة للبحث والإجابات — دون تضمين قيم الأسرار مطلقًا، فقط الأسماء والأنواع والوسوم.",
    egress_lt_label: "السماح بواجهة LanguageTool العامة",
    egress_lt_desc: "معطّل افتراضيًا. عند التفعيل، تُرسل كلمات الملاحظات إلى languagetool.org للتدقيق اللغوي عند عدم توفر المحرك المحلي.",
    loading_settings: "جارٍ تحميل الإعدادات…",
    sec_error_incorrect: "كلمة المرور الرئيسية غير صحيحة",
    sec_error_length: "يجب أن تكون كلمة المرور 12 حرفًا على الأقل",
    sec_status_enabled: "مشفرة (AES-256-GCM)",
    sec_status_disabled: "غير مشفرة (JSON عادي)",
    find_duplicates_btn: "البحث عن المكررات",
    duplicates_found: "تم العثور على مكررات",
    duplicates_desc: "هذه المدخلات لها قيم متطابقة. يُقترح إزالة المكررات.",
    remove_duplicate_btn: "إزالة",
    select_all: "تحديد الكل",
    remove_selected_btn: "إزالة المحدد",
    lib_archived: "مؤرشف",

    scratchpad_add: "مسودة جديدة",
    scratchpad_placeholder: "الصق أي شيء — أسرار، ملاحظات، أكواد، أوامر. الذكاء يكتشف تلقائياً عند اللصق.",
    scratchpad_detect: "اكتشاف",
    scratchpad_detecting: "جاري الاكتشاف…",
    scratchpad_save_secret: "حفظ السر في الخزنة",
    scratchpad_save_note: "حفظ كملاحظة",
    scratchpad_saving: "جاري الحفظ…",
    scratchpad_saved_ok: "تم الحفظ في الخزنة",
    scratchpad_save_err: "فشل الحفظ",
    scratchpad_rephrase: "إعادة صياغة",
    scratchpad_rephrase_undo: "تراجع",
    scratchpad_rephrase_undone: "تم الرجوع إلى النص السابق",
    scratchpad_rewriting: "جاري إعادة الصياغة…",
    scratchpad_rephrased: "تمت إعادة الصياغة",
    scratchpad_conflict_msg: "تم تعديل هذه الملاحظات في نافذة أخرى. أي إصدار تريد الاحتفاظ به؟",
    scratchpad_conflict_load: "تحميل النسخة المحفوظة",
    scratchpad_conflict_keep: "الاحتفاظ بنسختي",
    scratchpad_rewrite_err: "فشلت إعادة الصياغة",
    scratchpad_proofread: "تدقيق لغوي",
    scratchpad_proofreading: "جاري التدقيق...",
    scratchpad_proofread_ok: "اكتمل التدقيق",
    scratchpad_proofread_err: "فشل التدقيق",
    scratchpad_clear: "مسح",
    scratchpad_copy: "نسخ",
    scratchpad_copied: "تم النسخ!",
    scratchpad_go_to_top: "انتقال إلى الأعلى",
    scratchpad_go_to_bottom: "انتقال إلى الأسفل",
    scratchpad_bidi_auto: "اتجاه تلقائي",
    scratchpad_bidi_ltr: "من اليسار لليمين",
    scratchpad_bidi_rtl: "من اليمين لليسار",
    scratchpad_bidi_hint: "اتجاه النص للملاحظات ثنائية اللغة",
    scratchpad_rename: "إعادة تسمية التبويب",
    scratchpad_archive: "أرشفة التبويب",
    scratchpad_drag_to_reorder: "اسحب لإعادة الترتيب",
    scratchpad_archived: "مؤرشف",
    scratchpad_restore: "استعادة التبويب",
    scratchpad_delete: "حذف التبويب",
    scratchpad_ai_detected: "اكتشف الذكاء",
    scratchpad_no_detection: "لم يُكتشف شيء بعد — الصق أو اضغط اكتشاف",
    scratchpad_bold: "عريض",
    scratchpad_italic: "مائل",
    scratchpad_underline: "تحته خط",
    scratchpad_highlight: "تمييز",
    scratchpad_text_color: "لون النص",
    scratchpad_clear_format: "إزالة التنسيق",
    paste_plain_on: "اللصق كنص عادي (مفعّل)",
    paste_plain_off: "اللصق كنص عادي (معطل — إبقاء التنسيق)",
    scratchpad_undo: "تراجع",
    scratchpad_redo: "إعادة",
    scratchpad_history: "سجل النسخ",
    scratchpad_history_title: "سجل تعديلات الملاحظة",
    scratchpad_history_empty: "لا توجد نسخ سابقة مسجلة لهذه الملاحظة بعد. يتم حفظ النسخ تلقائياً أثناء الكتابة.",
    scratchpad_history_restore: "استعادة هذه النسخة",
    scratchpad_history_restored: "تمت استعادة النسخة بنجاح!",
    scratchpad_compare: "مقارنة",
    scratchpad_compare_title: "مقارنة ملاحظتين",
    scratchpad_compare_desc: "الأسطر الحمراء موجودة فقط في الملاحظة اليسرى، والأسطر الخضراء موجودة فقط في اليمنى — والكلمات المظللة هي التعديلات داخل الأسطر المتغيرة.",
    scratchpad_compare_identical: "الملاحظتان متطابقتان تماماً.",
    scratchpad_compare_pick_two: "اختر ملاحظتين مختلفتين للمقارنة بينهما.",
    scratchpad_rescue: "استعادة ملاحظات",
    scratchpad_rescue_title: "استعادة الملاحظات غير المحفوظة",
    scratchpad_rescue_desc: "نسخ محفوظة تلقائياً لملاحظات لم يعد لها أثر — محتوى تمت كتابته لكنه لم يُحفظ. يمكنك استعادة أي منها كملاحظة.",
    scratchpad_rescue_empty: "لا توجد نسخ يتيمة يمكن استعادتها.",
    scratchpad_rescue_restore: "استعادة كملاحظة",
    scratchpad_rescue_restored: "تمت استعادة الملاحظة!",
    scratchpad_save_failed: "الملاحظات لا تُحفظ — التعديلات الحديثة موجودة في هذه النافذة فقط. لا تغلق التطبيق؛ تُعاد المحاولة تلقائياً.",
    scratchpad_content_cleared: "تم مسح محتوى الملاحظة.",
    scratchpad_restore_undo: "تراجع / استعادة",
    highlight_yellow: "أصفر",
    highlight_green: "أخضر",
    highlight_blue: "أزرق",
    highlight_red: "أحمر",
    highlight_purple: "بنفسجي",
    text_color_white: "أبيض",
    text_color_red: "أحمر",
    text_color_orange: "برتقالي",
    text_color_yellow: "أصفر",
    text_color_green: "أخضر",
    text_color_blue: "أزرق",
    text_color_purple: "بنفسجي",

    setup_title: "الإعداد والاعتماديات",
    setup_collapse: "التفاصيل",
    setup_all_set: "كل شيء جاهز — يمكنك البدء",
    setup_needs_attention: "الإعداد يحتاج اهتماماً",
    setup_ollama: "الذكاء المحلي (Ollama)",
    setup_ollama_installed: "أولاما مثبّت",
    setup_ollama_not_installed: "أولاما غير مثبّت",
    setup_ollama_online: "يعمل بنماذج محلية",
    setup_ollama_offline: "مثبّت لكنه لا يعمل",
    setup_ollama_no_model: "لم يتم تنزيل أي نموذج بعد",
    setup_install_ollama: "تثبيت Ollama",
    setup_start_ollama: "تشغيل Ollama",
    setup_pull_model: "تنزيل {model}",
    setup_configure_ai: "إعداد مزود الذكاء",
    setup_ai_ready: "مزود الذكاء جاهز",
    setup_ai_missing: "لم يتم إعداد أي مزود ذكاء",
    setup_installing: "جاري تثبيت أولاما…",
    setup_starting: "جاري تشغيل أولاما…",
    setup_pulling: "جاري تنزيل النموذج… (قد يستغرق بضع دقائق)",
    setup_install_failed: "فشل التثبيت التلقائي",
    setup_open_download: "فتح صفحة تنزيل Ollama",
    setup_howto_title: "طريقة تشغيل IndexArc",
    setup_portable_note: "النسخة المحمولة: تعمل من ملف .exe، والبيانات بجانبها (مناسبة للفلاش).",
    setup_installer_note: "المثبّت: يثبّت على جهازك، والبيانات في AppData.",
    setup_dismiss: "تجاهل",
    setup_pull_done: "تم تنزيل النموذج — الذكاء المحلي جاهز",

    health_title: "صحة التطبيق",
    health_subtitle: "الخادم ومجلد البيانات والخزنة والملاحظات والنسخ والذكاء — فحص واحد.",
    health_open_btn: "فحص صحة التطبيق",
    health_refresh_btn: "إعادة الفحص",
    health_copy_btn: "نسخ التشخيص",
    health_copied: "تم نسخ التشخيص",
    health_healthy: "سليم",
    health_degraded: "متدهور",
    health_attention: "يحتاج اهتماماً",
    nav_section_vault: "الخزنة",
    vault_overview: "نظرة عامة",
    stat_saved: "محفوظ",
    stat_pending: "قيد المراجعة",
    stat_secrets: "أسرار",
    stat_commands: "أوامر",
    stat_open_in_library: "افتح في المكتبة",
    brand_tagline: "خزنة محمولة",
    new_entry_btn: "جديد",
    search_btn_short: "بحث…",
    search_btn_title: "بحث في كل شيء (Ctrl+K)",
    theme_to_light: "التبديل إلى المظهر الفاتح",
    theme_to_dark: "التبديل إلى المظهر الداكن",
    lang_switch_title: "Switch to English",
    menu_open: "فتح القائمة",
    menu_close: "إغلاق القائمة",
    integrity_title: "تحذير سلامة البيانات",
    integrity_hint: "راجع الإعدادات ← السجلات للتفاصيل. النسخ التالفة تُعزل ولا تُحذف أبداً.",
    dismiss_btn: "إخفاء",
    setup_vault_locked: "مقفلة — افتحها لتحميل العناصر",
    setup_vault_counts: "{entries} عنصر · {notes} ملاحظة",
    health_more_issues: "+{n} أخرى",
    home_good_morning: "صباح الخير",
    home_good_afternoon: "مساء الخير",
    home_good_evening: "مساء الخير",
    home_sub_healthy: "خزنتك بحالة جيدة.",
    home_sub_attention: "بعض الأمور تحتاج نظرة.",
    home_sub_locked: "خزنتك مقفلة.",
    kpi_entries: "العناصر",
    kpi_secrets: "الأسرار",
    kpi_commands: "الأوامر",
    kpi_review: "تحتاج مراجعة",
    kpi_added_week: "+{n} هذا الأسبوع",
    kpi_entries_note: "{n} ملاحظة محفوظة",
    kpi_secrets_enc: "مشفّرة على القرص",
    kpi_secrets_plain: "غير مشفّرة بعد",
    kpi_commands_note: "جاهزة للنسخ",
    kpi_review_note: "بانتظار اسم أو نوع",
    kpi_review_none: "لا شيء بالانتظار",
    kpi_open_title: "فتح في المكتبة",
    health_card_title: "صحة الخزنة",
    health_card_ok: "كل شيء سليم",
    health_card_issues: "{n} تحتاج نظرة",
    health_card_run: "فحص",
    health_card_details: "التفاصيل",
    health_card_score: "درجة الصحة {n} من 100",
    mix_title: "محتوى الخزنة",
    mix_empty: "لا شيء محفوظ بعد",
    mix_commands: "أوامر",
    mix_notes: "ملاحظات",
    mix_secrets: "أسرار",
    mix_other: "أخرى",
    services_title: "الخدمات الخلفية",
    services_basic: "أساسي",
    services_rules: "قواعد الكشف المدمجة",
    services_ai: "محرك الذكاء الاصطناعي",
    services_ready: "جاهز",
    services_offline: "غير متصل",
    services_watcher: "مراقب المجلدات",
    services_watching: "يراقب",
    services_idle: "خامل",
    services_to_review: "{n} للمراجعة",
    services_no_scan: "لم يُفحص أي مجلد بعد",
    open_btn: "فتح",
    recent_open_library: "فتح المكتبة",
    quick_capture_hint: "الصق أي نص، وسيجد IndexArc الأسرار والأوامر والروابط.",
    lock_card_unlocked: "مفتوحة",
    lock_card_autolock: "قفل تلقائي بعد {n} دقيقة خمول",
    lock_card_autolock_off: "القفل التلقائي متوقف",
    lock_card_plain: "الخزنة غير مشفّرة",
    lock_card_encrypt: "تعيين كلمة مرور رئيسية",
    lock_now: "اقفل الآن",
    health_data_label: "مجلد البيانات",
    health_vault_label: "بيانات الخزنة",
    health_go_emergency: "فتح خطة الطوارئ (الإعدادات)",
    health_banner_action: "فحص الصحة",

    // R4: UI strings moved out of components (dialogs, toasts, settings panels).
    close_btn: "إغلاق",
    fs_drives_home: "(الأقراص والمجلد الرئيسي)",
    palette_dialog_label: "البحث في كل شيء",
    palette_search_placeholder: "ابحث في الملاحظات والأسرار والأوامر والتبويبات... (Esc للإغلاق)",
    palette_quick_nav: "تنقل سريع",
    palette_vault_results: "نتائج الخزنة",
    palette_no_matches: "لم يتم العثور على ملاحظات أو أسرار أو أوامر مطابقة.",
    palette_hint_use: "استخدم",
    palette_hint_toggle: "في أي وقت للفتح والإغلاق",
    palette_hint_navigate: "للتنقل",
    palette_hint_select: "للاختيار",
    palette_footer_brand: "بحث IndexArc",
    health_check_failed: "فشل فحص الصحة",
    health_check_unreachable: "فشل فحص الصحة — هل خادم الخزنة يعمل؟",
    health_entries_unit: "عنصر",
    health_locked: "مقفلة",
    health_encrypted: "مشفّرة",
    health_notes_label: "الملاحظات",
    health_active_unit: "نشطة",
    health_backups_label: "النسخ الاحتياطية",
    health_snapshots_label: "اللقطات",
    health_no_results: "لا توجد نتائج فحص.",
    health_alternates_title: "مجلدات بيانات أخرى على هذا الجهاز",
    health_encrypted_vault: "خزنة مشفّرة",
    health_notes_unit: "ملاحظة",
    health_alternates_hint: "إذا بدا هذا المجلد فارغاً، فبياناتك على الأرجح في أحد هذه المجلدات. أعد تشغيل تلك النسخة أو ذلك المجلد — أو استعد لقطة من الأسفل.",
    copied_bang: "تم النسخ!",
    note_untitled: "ملاحظة بدون عنوان",
    note_save_failed_retry: "فشل الحفظ — تعديلاتك ما زالت هنا، أعد المحاولة عندما تصبح الخزنة متاحة.",
    note_title_label: "عنوان الملاحظة",
    note_body_label: "محتوى الملاحظة",
    note_words: "كلمة",
    note_min_read: "دقيقة قراءة",
    note_restore_size: "استعادة الحجم",
    note_maximize: "تكبير العرض",
    note_reopen_scratchpad: "إعادة الفتح في المسودة",
    note_copy_text: "نسخ النص",
    note_copy_html: "نسخ HTML",
    note_saving: "جاري الحفظ...",
    note_save_changes: "حفظ التغييرات",
    note_edit: "تعديل الملاحظة",
    note_characters: "حرف",
    note_created: "أُنشئت",
    archive_preview_untitled: "ملاحظة مؤرشفة",
    archive_reference_only: "للاطلاع فقط",
    archive_archived_on: "أُرشفت في",
    copied_to_clipboard: "تم النسخ إلى الحافظة",
    archive_empty_note: "ملاحظة فارغة",
    archive_delete_permanently: "حذف نهائي",
    archive_restore_to_active: "استعادة إلى الملاحظات النشطة",
    compare_swap_sides: "تبديل الجانبين",
    compare_left_note: "الملاحظة اليسرى",
    compare_right_note: "الملاحظة اليمنى",
    rescue_search_placeholder: "ابحث في اللقطات…",
    rescue_scanning: "جاري فحص اللقطات…",
    rescue_snapshot_one: "لقطة",
    rescue_snapshot_many: "لقطات",
    history_version_one: "نسخة",
    history_version_many: "نسخ",
    history_saved_suffix: "محفوظة",
    history_latest_snapshot: "أحدث لقطة",
    history_version_label: "النسخة",
    chars_unit: "حرف",
    history_preview_label: "معاينة",
    history_empty: "فارغة",
    history_select_version: "اختر نسخة لمعاينتها",
    history_footer_hint: "اللقطات المحفوظة تلقائياً تحمي عملك من التراجع أو المسح غير المقصود.",
    protect_show: "إظهار",
    scratchpad_paragraphs_restored: "تمت استعادة تنسيق الفقرات متعددة الأسطر!",
    scratchpad_content_restored: "تمت استعادة محتوى الملاحظة!",
    scratchpad_retry_now: "أعد المحاولة الآن",
    scratchpad_cleared_detected: "تم رصد ضغط Ctrl+Z أو مسح غير مقصود.",
    connection_failed: "فشل الاتصال",
    update_toast_available: "يتوفر IndexArc {v} — الإعدادات ← التحديثات",
    ask_failed: "فشل البحث",
    loading_scratchpad: "جاري تحميل المسودة…",
    folder_remove_failed: "فشل إزالة المجلد المراقَب",
    toast_copied_name: "تم نسخ {name}",
    copy_failed: "فشل النسخ",
    save_failed: "فشل الحفظ",
    more_count: "+{n} أخرى",
    toast_name_required: "الاسم مطلوب",
    toast_network_error: "خطأ في الاتصال",
    confirm_delete_entry_title: "حذف العنصر",
    confirm_delete_entry_msg: "هل تريد حذف هذا العنصر نهائياً؟",
    delete_failed: "فشل الحذف",
    delete_btn: "حذف",
    confirm_delete_entries_title: "حذف العناصر",
    confirm_delete_entries_one: "هل تريد حذف العنصر المحدد نهائياً؟",
    confirm_delete_entries_many: "هل تريد حذف العناصر المحددة ({n}) نهائياً؟",
    dup_confirm_title: "تكرارات محتملة",
    dup_confirm_msg: "{n} من {total} موجودة مسبقاً في الخزنة ({names}). هل تريد الحفظ على أي حال؟",
    dup_save_anyway: "احفظ على أي حال",
    dup_deselected: "أُلغي تحديد العناصر المكررة — احفظ مرة أخرى لحفظ العناصر الجديدة ({n})",
    fs_cannot_list: "تعذّر عرض محتويات المجلد",
    fs_list_failed: "فشل عرض محتويات المجلد",
    scan_apply_failed: "فشل التطبيق",
    scan_applied_summary: "حُفظ {saved} · غير محدد {parked} · مُستبعد {discarded}",
    confirm_discard_scan_title: "تجاهل الفحص",
    confirm_discard_scan_msg: "هل تريد تجاهل مراجعة الفحص بالكامل؟ لن يُحفظ أي شيء.",
    discard_btn: "تجاهل",
    toast_settings_saved: "تم حفظ الإعدادات",
    toast_settings_save_failed: "فشل حفظ الإعدادات",
    toast_loading_llm: "جارٍ تحميل نموذج اللغة في الذاكرة...",
    toast_warm_failed: "فشل تحميل النموذج",
    toast_models_loaded: "تم تحميل النماذج",
    toast_llm_load_failed: "تعذّر تحميل نموذج Ollama",
    toast_settings_patch_failed: "قد لا يكون تغيير الإعدادات قد حُفظ",
    protect_confirm_failed: "فشل التأكيد",
    request_failed: "فشل الطلب",
    spell_added_to_dict: "تمت إضافة \"{word}\" إلى القاموس",
    spell_ignored: "تم تجاهل \"{word}\"",
    scratchpad_already_in_vault: "موجود مسبقاً في الخزنة: {names} — انقر حفظ مرة أخرى للحفظ على أي حال",
    confirm_archive_note: "هل أنت متأكد أنك تريد أرشفة الملاحظة \"{title}\"؟",
    confirm_delete_archived_note: "هل أنت متأكد أنك تريد حذف \"{title}\" نهائياً؟",
    untitled: "بدون عنوان",
    confirm_delete_note: "هل أنت متأكد أنك تريد حذف \"{title}\"؟",
    confirm_clear_note: "هل أنت متأكد أنك تريد مسح محتوى هذه الملاحظة؟",
    predictions_enabled_title: "توقعات الذكاء الاصطناعي مفعّلة (انقر للتعطيل)",
    predictions_disabled_title: "توقعات الذكاء الاصطناعي معطّلة (انقر للتفعيل)",
    predictions_label: "التوقعات",
    state_on: "تشغيل",
    state_off: "إيقاف",
    format_paragraphs_title: "استعادة الفقرات متعددة الأسطر وتنسيق البنية تلقائياً",
    format_paragraphs: "تنسيق الفقرات",
    slash_commands_hint: "أوامر الشرطة المائلة — اكتب \"/\"",
    slash_heading_1: "عنوان 1",
    slash_heading_2: "عنوان 2",
    slash_bullet_list: "قائمة نقطية",
    slash_quote: "اقتباس",
    loading_editor: "جاري تحميل المحرر…",
    prediction_label: "التوقع",
    prediction_accept: "قبول",
    spell_label: "الإملاء",
    spell_finding: "جاري البحث عن اقتراحات...",
    spell_no_suggestions: "لا توجد اقتراحات",
    spell_add_to_dict: "إضافة \"{word}\" إلى القاموس",
    spell_ignore: "تجاهل \"{word}\"",
    archive_cold_storage: "تخزين بارد",
    archive_loading: "جاري تحميل الأرشيف...",
    archive_none: "لا توجد ملاحظات مؤرشفة",
    archive_click_preview: "انقر للمعاينة (للقراءة فقط)",
    archive_view_note: "عرض الملاحظة",
    archive_view: "عرض",
    scratchpad_close_tab: "إغلاق التبويب",
    ask_synthesizing: "جاري صياغة الإجابة...",
    copy_to_clipboard: "نسخ إلى الحافظة",
    rewrite_show_original: "عرض النص الأصلي",
    rewrite_copy_result: "نسخ النتيجة",
    rewrite_again: "إعادة الصياغة مجدداً",
    entry_hide_value: "إخفاء القيمة",
    entry_reveal_value: "إظهار القيمة",
    entry_open_full_note: "فتح الملاحظة كاملة",
    entry_click_to_reveal: "انقر للإظهار",
    candidate_discard_title: "تجاهل — إزالة هذا العنصر المرشّح",
    candidate_discard_label: "تجاهل العنصر المرشّح",
    via_provider: "عبر",
    health_vault_unavailable: "بيانات الخزنة غير متاحة في مجلد البيانات هذا.",
    key_saved_type_to_replace: "محفوظ — اكتب للاستبدال",
    key_saved_badge: "محفوظ",
    provider_api_key_label: "مفتاح {p} API",
    provider_model_label: "نموذج {p} (التصنيف / الاستخراج)",
    local_openai_title: "نقطة اتصال OpenAI مخصصة",
    local_openai_base_url: "عنوان URL الأساسي",
    local_openai_api_key: "مفتاح API (اختياري)",
    local_openai_model: "اسم النموذج",
    local_openai_embed_model: "اسم نموذج التضمين (اختياري)",
    local_openai_embed_default: "الافتراضي هو نموذج LLM",
    adv_ai_title: "إعدادات الذكاء الاصطناعي المتقدمة",
    adv_ai_desc: "تجاوز المزوّد المستخدم لتوليد النصوص (LLM) وللتضمينات. مفيد لاستخدام LM Studio لنماذج اللغة مع الإبقاء على Ollama للتضمينات.",
    adv_ai_llm_override: "تجاوز مزوّد نموذج اللغة",
    adv_ai_embed_override: "تجاوز مزوّد التضمين",
    adv_ai_default_auto: "افتراضي (تلقائي)",
    adv_ai_tip: "نصيحة: استخدم LM Studio (local_openai) لنموذج اللغة وOllama (local) للتضمينات لمزج النماذج المحلية.",
    provider_auto: "تلقائي",
    provider_local_ollama: "Ollama محلي",
    provider_cloud_gemini: "Gemini سحابي",
    provider_custom_local_openai: "OpenAI محلي مخصص",
    provider_custom_openai_lmstudio: "OpenAI مخصص (LM Studio)",
    provider_heuristic: "قواعد تلقائية (بدون ذكاء اصطناعي)",
    sec_encryption_status: "حالة تشفير الخزنة",
    sec_remove_desc: "خزنتك مشفّرة بالكامل باستخدام AES-256-GCM. لإزالة التشفير وإعادة البيانات إلى نص عادي، أدخل كلمة المرور الرئيسية الحالية:",
    sec_set_password_placeholder: "عيّن كلمة المرور الرئيسية...",
    sec_setup_failed: "فشل إعداد كلمة المرور",
    emergency_empty_snapshot_title: "لا تحتوي هذه اللقطة على أي عناصر في الخزنة ولا ملاحظات — استعادتها لن تغيّر شيئاً. اختر لقطة أقدم وأكبر.",
    emergency_empty_badge: "فارغة",
    emergency_empty_snapshot: "لقطة فارغة — لن تستعيد شيئاً.",
    emergency_snapshot_failed: "فشل إنشاء اللقطة",
    emergency_restored_counts: "تمت الاستعادة ({parts}). جاري إعادة التحميل...",
    emergency_restored_locked: "تمت الاستعادة (مشفّرة — افتح القفل للتحميل). جاري إعادة التحميل...",
    emergency_restore_failed: "فشلت الاستعادة",
    failed_generic: "فشل",
    logs_empty: "لا توجد سجلات بعد",
    update_download_failed: "فشل التنزيل",
    // R5: password change + recovery key
    pw_change_title: "تغيير كلمة المرور الرئيسية",
    pw_change_desc: "يعيد تشفير كل ملف وسجل بكلمة المرور الجديدة.",
    pw_current: "كلمة المرور الحالية",
    pw_new: "كلمة المرور الجديدة (12 حرفًا على الأقل)",
    pw_confirm: "أعد كتابة كلمة المرور الجديدة",
    pw_change_btn: "تغيير كلمة المرور",
    pw_mismatch: "كلمتا المرور الجديدتان غير متطابقتين",
    pw_too_short: "يجب أن تتكون كلمة المرور من 12 حرفًا على الأقل",
    pw_show: "إظهار كلمة المرور",
    pw_hide: "إخفاء كلمة المرور",
    pw_strength_label: "القوة",
    pw_strength_0: "ضعيفة جدًا",
    pw_strength_1: "ضعيفة",
    pw_strength_2: "مقبولة",
    pw_strength_3: "قوية",
    pw_strength_4: "قوية جدًا",
    pw_problem_common: "هذه كلمة مرور شائعة الاستخدام. اختر غيرها.",
    pw_problem_weak: "سهلة التخمين. جرّب عبارة أطول من كلمات غير مترابطة.",
    pw_hint_phrase: "نصيحة: عبارة من أربع كلمات غير مترابطة أو أكثر قوية وسهلة التذكر.",
    pw_changed: "تم تغيير كلمة المرور الرئيسية",
    rk_title: "مفتاح الاسترداد",
    rk_desc: "رمز يُستخدم لمرة واحدة لإعادة تعيين كلمة مرور منسية. من يملك هذا الرمز وملفات الخزنة يستطيع فتحها، لذا احفظه بعيدًا عن الإنترنت مثل كلمة المرور نفسها.",
    rk_status_none: "غير مُعدّ. نسيان كلمة المرور يعني فقدان البيانات.",
    rk_status_ok: "مُعدّ",
    rk_status_stale: "قديم. أنشئ مفتاحًا جديدًا.",
    rk_create_btn: "إنشاء مفتاح استرداد",
    rk_replace_btn: "استبدال مفتاح الاسترداد",
    rk_remove_btn: "إزالة",
    rk_password_prompt: "كلمة المرور الرئيسية (للتأكيد)",
    rk_shown_once: "دوّن هذا الرمز أو احفظه الآن. لن يُعرض مرة أخرى.",
    rk_copy: "نسخ",
    rk_download: "حفظ كملف",
    rk_saved_confirm: "لقد حفظته",
    rk_replaced_note: "أي مفتاح استرداد سابق لم يعد يعمل.",
    rk_forgot: "نسيت كلمة المرور؟ استخدم مفتاح الاسترداد",
    rk_recover_title: "إعادة التعيين بمفتاح الاسترداد",
    rk_code_label: "مفتاح الاسترداد",
    rk_recover_btn: "إعادة تعيين كلمة المرور وفتح الخزنة",
    rk_back: "العودة إلى كلمة المرور",
    rk_file_header: "مفتاح استرداد IndexArc",
    health_download_btn: "تنزيل التقرير",
    health_download_hint: "تشخيص منقّح لإرفاقه ببلاغ خطأ: بلا أسرار أو عناوين بريد أو اسم المستخدم",
    crash_reports_label: "الاحتفاظ بسجل الأعطال لبلاغات الأخطاء",
    crash_reports_desc: "يسجّل رسائل الأخطاء وتتبّع المكدّس فقط، بعد تنقيحها على هذا الجهاز. لا يُرسل أي شيء؛ يُضاف السجل إلى «تنزيل التقرير» في صحة التطبيق.",
    hyg_title: "انتهاء الصلاحية والتدوير",
    hyg_expires: "ينتهي في",
    hyg_rotate_days: "التدوير كل (أيام)",
    hyg_save: "حفظ",
    hyg_saved: "تم الحفظ",
    hyg_mark_rotated: "تعليم كمُدوَّر",
    hyg_marked_rotated: "عُلّم كمُدوَّر اليوم",
    hyg_where_used: "أين يُستخدم",
    hyg_last_rotated: "آخر تدوير",
    hyg_no_folders: "لا توجد مجلدات للبحث. أضف مجلدًا مراقبًا في الإعدادات.",
    hyg_not_found: "غير موجود في {n} ملف.",
    hyg_truncated: "توقف البحث مبكرًا؛ قد توجد نتائج أخرى.",
    hyg_state_expired: "منتهي",
    hyg_state_rotation_due: "دوّره الآن",
    hyg_state_expiring: "ينتهي قريبًا",
    hyg_card_title: "انتهاء الصلاحية والتدوير",
    hyg_all_good: "لا شيء منتهٍ أو مستحق للتدوير.",
    hyg_none_tracked: "حدّد تاريخ انتهاء أو فترة تدوير لسرّ لتتبعه هنا.",
    port_title: "الاستيراد والتصدير",
    port_import_title: "استيراد",
    port_import_desc: "من ملف ‎.env أو Bitwarden JSON أو 1Password أو CSV عام أو KeePass XML أو تصدير IndexArc مشفّر. تراجع كل شيء قبل الحفظ.",
    port_choose_file: "اختر ملفًا…",
    port_passphrase: "عبارة مرور التصدير",
    port_open: "فتح",
    port_found: "عُثر على {n} سرًّا ({format})",
    port_import_btn: "استيراد {n} محدد",
    port_imported: "تم استيراد {n} عنصرًا.",
    port_export_title: "تصدير",
    port_fmt_encrypted: "مشفّر (‎.iaexport)",
    port_fmt_env: "‎.env نصّي",
    port_new_passphrase: "عبارة مرور جديدة (12 حرفًا على الأقل)",
    port_pass_short: "يجب أن تكون عبارة المرور 12 حرفًا على الأقل.",
    port_plain_warning: "أفهم أن ملف ‎.env نص عادي: أي شخص يحصل على الملف يمكنه قراءة كل الأسرار فيه.",
    port_plain_confirm: "أكّد تحذير النص العادي أولًا.",
    port_export_btn: "تصدير",
    port_exported: "تم تصدير {n} عنصرًا.",
    cli_title: "الوصول عبر سطر الأوامر",
    cli_desc: "استخدم أسرارك من الطرفية أو السكربتات عبر الأمر indexarc. يقرأ من هذا التطبيق فقط أثناء فتح الخزنة، باستخدام رمز تنشئه هنا.",
    cli_token_name: "اسم الرمز (مثل: الحاسوب، CI)",
    cli_create: "إنشاء رمز",
    cli_token_once: "انسخ هذا الرمز الآن؛ لن يظهر مرة أخرى. الصقه في ‎`indexarc login`.",
    cli_done: "نسخته",
    cli_none: "لا توجد رموز بعد.",
    cli_last_used: "آخر استخدام",
    cli_never_used: "لم يُستخدم",
    cli_revoke: "إلغاء",
    cli_note: "رمز سطر الأوامر يقرأ الأسرار فقط؛ لا يغيّر الخزنة ولا يفتحها ولا ينشئ رموزًا جديدة. تغيير كلمة المرور الرئيسية يلغي كل الرموز.",
  },
};

export function getTranslation(settings: Settings | null, key: keyof TranslationDict): string {
  const lang: UiLanguage = settings?.ui_language || "en";
  const dict = translations[lang] || translations.en;
  return dict[key] || translations.en[key] || "";
}