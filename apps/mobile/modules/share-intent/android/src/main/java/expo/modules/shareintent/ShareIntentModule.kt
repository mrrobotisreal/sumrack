package expo.modules.shareintent

import android.content.Intent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Sumrak's share-target receiver (T28, design V2 §4.1).
 *
 * The `android.intentFilters` entry in app.json puts a text/plain SEND
 * filter on MainActivity; this module is the JS-visible half that actually
 * reads `Intent.EXTRA_TEXT` (RN's Linking layer only surfaces URL intents).
 *
 * Delivery paths:
 * - **Warm start** (activity alive, `singleTask` relaunch): `OnNewIntent`
 *   fires — the text is stashed AND emitted as an event, so a mounted JS
 *   listener navigates immediately.
 * - **Cold start** (activity created by the share): no event fires before
 *   JS is up; the intake gate calls `consumePendingShare()` on mount, which
 *   falls back to reading the launch activity's intent exactly once.
 *
 * Consumption is one-shot by design: rotations/re-renders re-running the
 * gate must not re-deliver the same share.
 */
class ShareIntentModule : Module() {
  private var pending: String? = null
  private var initialIntentConsumed = false

  override fun definition() = ModuleDefinition {
    Name("ShareIntent")
    Events("onShareReceived")

    OnNewIntent { intent ->
      sharedTextFrom(intent)?.let { text ->
        pending = text
        sendEvent("onShareReceived", mapOf("text" to text))
      }
    }

    Function("consumePendingShare") {
      val stashed = pending
      if (stashed != null) {
        pending = null
        return@Function stashed
      }
      if (!initialIntentConsumed) {
        initialIntentConsumed = true
        return@Function appContext.currentActivity?.intent?.let { sharedTextFrom(it) }
      }
      return@Function null
    }
  }

  private fun sharedTextFrom(intent: Intent): String? {
    if (intent.action != Intent.ACTION_SEND) return null
    if (intent.type?.startsWith("text/") != true) return null
    return intent.getStringExtra(Intent.EXTRA_TEXT)?.takeIf { it.isNotBlank() }
  }
}
