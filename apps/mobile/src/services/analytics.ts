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
  // T10 narration + karaoke
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
  // T18 progress dashboard + AI CEFR assessment. Assessment props carry
  // trigger/model/error codes only — never journal text.
  | 'dashboard_opened'
  | 'dashboard_practice_now'
  | 'assessment_requested'
  | 'assessment_completed'
  | 'assessment_failed'
  | 'assessment_screen_opened';

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
