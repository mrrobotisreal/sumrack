/**
 * Local analytics (workspace requirement: exceptional tracking even though
 * single-user). track() is safe to call from anywhere at any time: events
 * queue in memory until the DB is ready, then the bootstrap installs a sink
 * that persists every event to the `analytics_events` table (queried by the
 * progress engine / dashboard in T18+).
 */
export type AnalyticsEvent =
  | 'app_opened'
  | 'splash_intro_completed'
  | 'theme_mode_changed'
  | 'tab_viewed'
  | 'settings_opened'
  | 'pack_imported'
  | 'pack_removed'
  | 'debug_db_opened'
  | 'debug_db_search'
  // T44 dev-screen fixture import (__DEV__ only). Props: packId only.
  | 'debug_fixture_imported'
  // Reader (T04/T05). Since M14 (T46) every reader event below through
  // phrase_added_to_bank — and the reader-fired bookmark_added/removed —
  // carries `category` + `genre` (`'none'` when genre-less) from ONE
  // classifyPack() per reader mount (LIBRARY_CATEGORIES §4.5).
  | 'story_opened'
  | 'story_finished'
  | 'reading_session_ended'
  | 'reading_position_restored'
  | 'sentence_reveal_toggled'
  | 'reveal_all_toggled'
  | 'reader_typography_changed'
  | 'word_tapped'
  | 'word_added_to_bank'
  | 'encounter_recorded'
  | 'phrase_selection_completed'
  | 'phrase_added_to_bank'
  | 'lookup_encounter_toggled'
  | 'speech_requested'
  | 'bank_searched'
  | 'bank_filter_changed'
  | 'bank_item_viewed'
  | 'bank_item_edited'
  | 'bank_item_deleted'
  | 'bank_manual_added'
  | 'cards_backfilled'
  | 'review_session_started'
  | 'review_session_empty'
  | 'review_graded'
  | 'review_session_finished'
  | 'review_session_abandoned'
  // T07 content sync. Props must never contain the PAT or any secret value.
  | 'sync_check_started'
  | 'sync_completed'
  | 'sync_failed'
  | 'sync_pack_failed'
  | 'audio_deferred_wifi'
  | 'audio_backfilled'
  | 'sync_config_saved'
  | 'sync_pat_saved'
  | 'sync_pat_cleared'
  | 'wifi_only_audio_toggled'
  | 'packs_screen_opened'
  // T10 narration + karaoke. Since M14 (T46) narration_* and
  // karaoke_fallback_sentence_mode carry `category` + `genre` via
  // useNarration's `eventProps` option (word_segment_played does not).
  | 'narration_track_loaded'
  | 'narration_play'
  | 'narration_pause'
  | 'narration_seek'
  | 'narration_rate_changed'
  | 'narration_track_switched'
  | 'narration_finished'
  | 'karaoke_fallback_sentence_mode'
  | 'word_segment_played'
  // T11 on-device TTS (sherpa-onnx Piper) + voice model manager
  | 'tts_voice_download_started'
  | 'tts_voice_download_completed'
  | 'tts_voice_download_failed'
  | 'tts_voice_deleted'
  | 'tts_voice_selected'
  | 'tts_voice_loaded'
  | 'tts_spoken'
  | 'tts_piper_fallback'
  | 'dev_tts_speak'
  // T12 ASR model manager + pronunciation practice
  | 'asr_model_download_started'
  | 'asr_model_download_completed'
  | 'asr_model_download_failed'
  | 'asr_model_deleted'
  | 'asr_loaded'
  | 'asr_transcribed'
  | 'pron_mic_permission_denied'
  | 'pron_session_needs_model'
  | 'pron_session_empty'
  | 'pron_session_started'
  | 'pron_attempt'
  | 'pron_item_graded'
  | 'pron_session_finished'
  | 'pron_session_abandoned'
  // T13 cloze + sentence builder + games menu
  | 'games_menu_opened'
  | 'game_launched_from_menu'
  | 'games_unseen_stories_toggled'
  // T28 Share-to-Сумрак intake (counts + char counts ONLY — never text
  // content, titles, or title-derived pack ids)
  | 'import_share_received'
  | 'import_intake_opened'
  | 'import_request_created'
  | 'import_request_split'
  | 'import_request_removed'
  | 'import_committed'
  | 'import_pack_removed'
  | 'import_packs_reimported'
  // T29 import AI annotation + review (sentence/flag/retry counts + error
  // codes ONLY — never text content; same policy as T16/T28)
  | 'import_annotate_retry'
  | 'import_annotate_completed'
  | 'import_annotate_failed'
  | 'import_annotate_rerun'
  | 'import_review_opened'
  | 'import_review_merged'
  | 'import_review_split'
  | 'import_review_sentence_deleted'
  | 'import_commit_flagged_excluded'
  // T27 dialogue player (scores/attempt counts/modes only — never transcripts).
  // dialogue_opened carries `category` + `genre` since M14 (T46) — dialogues
  // classify `stories`/`'none'` unless authored.
  | 'dialogue_tap_mode_toggled'
  | 'dialogues_list_opened'
  | 'dialogue_opened'
  | 'dialogue_run_started'
  | 'dialogue_run_finished'
  | 'dialogue_run_abandoned'
  | 'dialogue_choice_attempt'
  | 'dialogue_choice_resolved'
  | 'dialogue_choice_tapped'
  | 'dialogue_tap_unlocked'
  | 'dialogue_hint_revealed'
  | 'dialogue_coach_played'
  | 'dialogue_line_replayed'
  | 'dialogue_ending_found'
  | 'cloze_session_started'
  | 'cloze_session_empty'
  | 'cloze_hint_used'
  | 'cloze_item_graded'
  | 'cloze_session_finished'
  | 'cloze_session_abandoned'
  | 'sb_session_started'
  | 'sb_session_empty'
  | 'sb_item_graded'
  | 'sb_session_finished'
  | 'sb_session_abandoned'
  // T14 listening quiz + unified daily session
  | 'listening_session_started'
  | 'listening_session_empty'
  | 'listening_item_graded'
  | 'listening_session_finished'
  | 'listening_session_abandoned'
  | 'listening_replay'
  | 'listening_audio_resolved'
  | 'daily_session_started'
  | 'daily_session_empty'
  | 'daily_session_composed'
  | 'daily_item_graded'
  | 'daily_session_finished'
  | 'daily_session_abandoned'
  | 'daily_prefs_changed'
  // T15 journal + notes
  | 'journal_section_changed'
  | 'journal_entry_opened'
  | 'journal_entry_created'
  | 'journal_entry_autosaved'
  | 'journal_entry_deleted'
  | 'journal_prompt_used'
  | 'journal_prompt_skipped'
  | 'journal_prompt_dismissed'
  | 'journal_readback_used'
  | 'journal_read_mode_toggled'
  | 'journal_search'
  | 'journal_search_result_opened'
  | 'journal_highlight_saved'
  | 'note_opened'
  | 'note_created'
  | 'note_autosaved'
  | 'note_deleted'
  | 'note_preview_toggled'
  // T16 OpenRouter AI service. Props carry feature tags, error codes, and
  // counts ONLY — never entry/card text and NEVER the API key.
  | 'ai_request_queued'
  | 'ai_request_sent'
  | 'ai_request_succeeded'
  | 'ai_request_failed'
  | 'ai_key_saved'
  | 'ai_key_cleared'
  | 'ai_model_changed'
  | 'ai_key_test'
  | 'journal_feedback_requested'
  | 'journal_feedback_cancelled'
  | 'enrich_screen_opened'
  | 'enrich_proposals_requested'
  | 'enrich_proposals_received'
  | 'enrich_accepted'
  | 'enrich_rejected'
  | 'enrich_apply_failed'
  | 'explain_opened'
  // T17 guided path + checkpoints. story_opened carries a `from` prop
  // ('library' | 'path' | 'today') so path-vs-library entry points — and the
  // out-of-order-credit feature — are measurable.
  | 'path_viewed'
  | 'unit_expanded'
  | 'lesson_opened'
  | 'lesson_completed'
  | 'unit_quiz_started'
  | 'unit_quiz_item_answered'
  | 'unit_quiz_finished'
  | 'unit_quiz_abandoned'
  | 'unit_completed'
  | 'checkpoint_started'
  | 'checkpoint_item_answered'
  | 'checkpoint_finished'
  | 'checkpoint_passed'
  | 'checkpoint_failed'
  | 'checkpoint_abandoned'
  | 'path_continue_tapped'
  | 'checkpoint_threshold_changed'
  | 'path_position_advanced'
  // T30 path tracks + house map. Props are track/level/scene/pack ids only.
  | 'path_track_section_viewed'
  | 'house_map_room_tapped'
  // T18 progress dashboard + AI CEFR assessment. Assessment props carry
  // trigger/model/error codes only — never journal text.
  | 'dashboard_opened'
  | 'dashboard_practice_now'
  | 'assessment_requested'
  | 'assessment_completed'
  | 'assessment_failed'
  | 'assessment_screen_opened'
  // T19 streaks, goals, XP, achievements, notifications. All local — the
  // notification events log delivery *scheduling* and taps, never content.
  | 'daily_goal_changed'
  | 'goal_met'
  | 'streak_freeze_consumed'
  | 'streak_freeze_earned'
  | 'achievement_unlocked'
  | 'achievements_gallery_opened'
  | 'notification_prefs_changed'
  | 'notification_permission_result'
  | 'notifications_replanned'
  | 'notification_new_content'
  | 'notification_tapped'
  | 'notification_prompt_accepted'
  | 'notification_prompt_dismissed'
  // T20 backup & restore. Props carry trigger/code/counts/bytes ONLY —
  // never the passphrase, derived key, PAT, or any table contents.
  | 'backup_setup_completed'
  | 'backup_passphrase_changed'
  | 'backup_prefs_changed'
  | 'backup_started'
  | 'backup_succeeded'
  | 'backup_failed'
  | 'backup_pruned'
  | 'backup_local_exported'
  | 'backup_local_export_failed'
  | 'restore_screen_opened'
  | 'restore_started'
  | 'restore_succeeded'
  | 'restore_failed'
  // T21 syncd target. Props carry target/trigger/code/counts/booleans ONLY —
  // never the bearer token, host contents beyond presence, or archive data.
  | 'backup_target_result'
  | 'syncd_config_saved'
  | 'syncd_token_saved'
  | 'syncd_token_cleared'
  | 'syncd_target_toggled'
  | 'syncd_connection_test_started'
  | 'syncd_reachability_changed'
  // T22 hardening. app_error props carry scope/fatal ONLY — the message and
  // stack live in the on-device error log file, never in analytics.
  | 'app_error'
  | 'error_log_viewed'
  | 'error_log_cleared'
  | 'error_test_triggered'
  // T24 affordance sweep. Search props carry query LENGTH + result counts
  // only — never the query text (privacy-by-shape, same rule as bank_searched).
  | 'global_search_performed'
  | 'global_search_result_opened'
  // bookmark_added/removed carry `category` + `genre` from the reader and
  // the Library (M14, T46); the bookmarks-list removal has no pack row.
  | 'bookmark_added'
  | 'bookmark_removed'
  | 'bookmark_opened'
  | 'bank_mastery_filter_used'
  // T30.1 story-family shelf. Props carry the family slug + CEFR levels
  // (counts/ids only, per convention).
  | 'family_shelf_viewed'
  | 'family_rung_switched'
  | 'family_next_rung_shown'
  | 'family_next_rung_tapped'
  // T31 ambient room scenes. Props carry the scene name / a boolean only.
  | 'room_scene_shown'
  | 'reduce_motion_toggled'
  // M14 library categories (T45/T46). Props are category/genre slugs, pack/story ids and counts only.
  // story_source_link_opened {packId, storyId, category} fires from the reader header's source line.
  | 'library_category_switched'
  | 'library_genre_switched'
  | 'library_empty_category_viewed'
  | 'story_source_link_opened'
  // M15 themed ambience (T48). Props: theme/bed slugs + ms only.
  // ambient_theme_started {theme, bed, resumedMs} — a theme begins (fresh or resumed);
  // ambient_theme_switched {fromTheme, toTheme} — a live switch with fade;
  // ambient_bed_advanced {theme, fromBed, toBed} — rotation stepped on didJustFinish.
  | 'ambient_theme_started'
  | 'ambient_theme_switched'
  | 'ambient_bed_advanced';

export type AnalyticsProps = Record<string, string | number | boolean>;

type Sink = (event: AnalyticsEvent, props?: AnalyticsProps) => void;

let sink: Sink | null = null;
const pending: [AnalyticsEvent, AnalyticsProps | undefined][] = [];

export function track(event: AnalyticsEvent, props?: AnalyticsProps) {
  // typeof-guarded: __DEV__ only exists in the RN runtime — tested logic
  // modules (T14 session builders) may call track() under Node/vitest.
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log(`[analytics] ${event}`, props ?? {});
  }
  if (sink) {
    sink(event, props);
  } else {
    pending.push([event, props]);
  }
}

/** Install the persistence sink (bootstrap) and flush anything queued before it. */
export function initAnalyticsSink(s: Sink) {
  sink = s;
  for (const [event, props] of pending.splice(0)) {
    s(event, props);
  }
}
