package expo.modules.sumrakwidget

import android.content.Context
import android.util.Log
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.state.updateAppWidgetState
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * JS-visible half of the widget (T40). `writeSnapshot` commits the snapshot
 * synchronously, then triggers a widget refresh on a background scope. Native
 * failures are logged and never thrown into JS.
 */
class SumrakWidgetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SumrakWidget")

    Function("writeSnapshot") { json: String ->
      val context = appContext.reactContext ?: return@Function
      try {
        SnapshotStore.write(context, json)
      } catch (e: Exception) {
        Log.w(TAG, "writeSnapshot commit failed", e)
        return@Function
      }
      CoroutineScope(Dispatchers.Default).launch {
        try {
          refreshAll(context)
        } catch (e: Exception) {
          Log.w(TAG, "widget refresh failed", e)
        }
      }
    }

    Function("readSnapshot") {
      val context = appContext.reactContext ?: return@Function null
      try {
        SnapshotStore.readRaw(context)
      } catch (e: Exception) {
        Log.w(TAG, "readSnapshot failed", e)
        null
      }
    }
  }

  companion object {
    private const val TAG = "SumrakWidget"

    /** Re-renders every placed instance (Glance 1.1.1 has no `updateAll`; use the manager's ids). */
    internal suspend fun refreshAll(context: Context) {
      val widget = SumrakWidget()
      val manager = GlanceAppWidgetManager(context)
      for (id in manager.getGlanceIds(SumrakWidget::class.java)) {
        // Bump the revision so a live Glance session re-reads the snapshot.
        updateAppWidgetState(context, id) { prefs -> prefs[SNAPSHOT_REV] = System.currentTimeMillis() }
        widget.update(context, id)
      }
    }
  }
}
