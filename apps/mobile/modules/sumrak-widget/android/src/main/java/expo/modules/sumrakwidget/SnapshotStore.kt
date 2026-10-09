package expo.modules.sumrakwidget

import android.content.Context
import org.json.JSONObject

/** One outcome of reading the snapshot. Missing and Corrupt render the same placeholder but stay distinct for diagnostics. */
sealed class SnapshotResult {
  object Missing : SnapshotResult()
  object Corrupt : SnapshotResult()
  data class Ok(val snapshot: Snapshot) : SnapshotResult()
}

data class ContinueTarget(val packId: String, val storyId: String, val title: String)

data class Snapshot(
  val streak: Int,
  val dueCount: Int,
  val reviewsDone: Int,
  val reviewsTarget: Int,
  val readingMinDone: Int,
  val readingMinTarget: Int,
  val goalMet: Boolean,
  val continueTarget: ContinueTarget?,
  val updatedAtMs: Long,
) {
  /** Mirror of widget-snapshot.ts `goalFraction`: mean of enabled parts, each clamped to 1. */
  fun goalFraction(): Float {
    val parts = ArrayList<Float>(2)
    if (reviewsTarget > 0) parts.add(minOf(1f, reviewsDone.toFloat() / reviewsTarget))
    if (readingMinTarget > 0) parts.add(minOf(1f, readingMinDone.toFloat() / readingMinTarget))
    if (parts.isEmpty()) return if (goalMet) 1f else 0f
    return parts.sum() / parts.size
  }

  /** Mirror of widget-snapshot.ts `isStale`: strictly older than STALE_MS. */
  fun isStale(nowMs: Long): Boolean = nowMs - updatedAtMs > STALE_MS
}

/**
 * Reads and writes the SharedPreferences snapshot. Reading is DEFENSIVE by
 * design: a missing field, a mistyped value, or malformed JSON is reported as
 * [SnapshotResult.Corrupt] and never thrown, so the widget can't crash the launcher.
 */
object SnapshotStore {
  fun read(context: Context): SnapshotResult {
    val raw = context
      .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getString(KEY_SNAPSHOT, null)
    if (raw.isNullOrBlank()) return SnapshotResult.Missing
    return try {
      SnapshotResult.Ok(parse(raw))
    } catch (e: Exception) {
      SnapshotResult.Corrupt
    }
  }

  /** Commits the JSON synchronously. A blank string clears the snapshot (→ Missing). */
  fun write(context: Context, json: String) {
    val editor = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
    if (json.isBlank()) editor.remove(KEY_SNAPSHOT) else editor.putString(KEY_SNAPSHOT, json)
    editor.commit()
  }

  /** Raw stored string (debug/test only). */
  fun readRaw(context: Context): String? =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(KEY_SNAPSHOT, null)

  internal fun parse(raw: String): Snapshot {
    val o = JSONObject(raw)
    require(o.intField("v") == SNAPSHOT_VERSION) { "unsupported snapshot version" }
    val goal = o.getJSONObject("goal")
    val cont = o.get("continueReading")
    val target = when (cont) {
      JSONObject.NULL -> null
      is JSONObject -> ContinueTarget(
        packId = cont.stringField("packId"),
        storyId = cont.stringField("storyId"),
        title = cont.stringField("title"),
      )
      else -> throw IllegalArgumentException("continueReading")
    }
    return Snapshot(
      streak = o.nonNegInt("streak"),
      dueCount = o.nonNegInt("dueCount"),
      reviewsDone = goal.nonNegInt("reviewsDone"),
      reviewsTarget = goal.nonNegInt("reviewsTarget"),
      readingMinDone = goal.nonNegInt("readingMinDone"),
      readingMinTarget = goal.nonNegInt("readingMinTarget"),
      goalMet = goal.boolField("met"),
      continueTarget = target,
      updatedAtMs = o.longField("updatedAtMs"),
    )
  }

  private fun JSONObject.intField(name: String): Int = longField(name).toInt()

  private fun JSONObject.nonNegInt(name: String): Int {
    val v = intField(name)
    require(v >= 0) { "$name negative" }
    return v
  }

  private fun JSONObject.longField(name: String): Long {
    val v = get(name)
    require(v is Int || v is Long) { "$name not an integer" }
    return (v as Number).toLong()
  }

  private fun JSONObject.stringField(name: String): String {
    val v = get(name)
    require(v is String) { "$name not a string" }
    return v
  }

  private fun JSONObject.boolField(name: String): Boolean {
    val v = get(name)
    require(v is Boolean) { "$name not a boolean" }
    return v
  }
}
