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
 * - **Cold start**: `ShareIntentLifecycleListener.onCreate` (see
 *   ShareIntentPackage.kt) stashes the text into [ShareIntentStore] the
 *   moment MainActivity is created — BEFORE expo-dev-launcher (dev builds)
 *   can bounce the activity and replace its intent. The intake gate calls
 *   `consumePendingShare()` once JS is up.
 * - **Warm start** (activity alive, `singleTask` relaunch): `OnNewIntent`
 *   fires — emitted as an event so the mounted JS gate navigates
 *   immediately; the store is not involved (nothing stale survives).
 *
 * Consumption is one-shot by design: rotations/re-renders re-running the
 * gate must not re-deliver the same share.
 */

internal object ShareIntentStore {
  @Volatile var pendingText: String? = null
}

/** The share text of a SEND intent, or null for anything else. Relaunches
 * from recents redeliver the original intent — the history flag filters
 * those out so an old share never resurfaces. */
internal fun sharedTextFrom(intent: Intent?): String? {
  if (intent == null) return null
  if (intent.action != Intent.ACTION_SEND) return null
  if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return null
  if (intent.type?.startsWith("text/") != true) return null
  return intent.getStringExtra(Intent.EXTRA_TEXT)?.takeIf { it.isNotBlank() }
}

class ShareIntentModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ShareIntent")
    Events("onShareReceived")

    OnNewIntent { intent ->
      sharedTextFrom(intent)?.let { text ->
        sendEvent("onShareReceived", mapOf("text" to text))
      }
    }

    Function("consumePendingShare") {
      val stashed = ShareIntentStore.pendingText
      ShareIntentStore.pendingText = null
      return@Function stashed
    }
  }
}
