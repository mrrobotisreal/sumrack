package expo.modules.sumrakwidget

import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.util.Log
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextAlign
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import androidx.glance.appwidget.LinearProgressIndicator
import androidx.compose.ui.unit.sp
import java.net.URLEncoder

/**
 * The Сумрак home-screen widget (T40). Renders ONLY from the SharedPreferences
 * snapshot — never the DB. Every failure path renders the fallback, never throws.
 * Colours mirror `src/theme/colors.ts`.
 */

/** One palette per scheme, mirror of `colors.ts` (bg, surface, text, textMuted, accent). */
internal data class WidgetPalette(
  val bg: Int,
  val surface: Int,
  val text: Int,
  val textMuted: Int,
  val accent: Int,
  val border: Int,
) {
  companion object {
    val DARK = WidgetPalette(
      bg = 0xFF0B0B0E.toInt(),
      surface = 0xFF141419.toInt(),
      text = 0xFFE8E6E3.toInt(),
      textMuted = 0xFF9A97A0.toInt(),
      accent = 0xFFB3402F.toInt(),
      border = 0xFF26262E.toInt(),
    )
    val LIGHT = WidgetPalette(
      bg = 0xFFF7F5F2.toInt(),
      surface = 0xFFFFFFFF.toInt(),
      text = 0xFF1A1A1F.toInt(),
      textMuted = 0xFF6B6870.toInt(),
      accent = 0xFFA03828.toInt(),
      border = 0xFFE2DED8.toInt(),
    )
  }
}

internal fun paletteFor(context: Context): WidgetPalette {
  val night = context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
  return if (night == Configuration.UI_MODE_NIGHT_YES) WidgetPalette.DARK else WidgetPalette.LIGHT
}

internal fun appUri(path: String, from: String? = "widget"): Uri {
  val query = if (from != null) "?from=$from" else ""
  return Uri.parse("sumrak://$path$query")
}

class SumrakWidget : GlanceAppWidget() {

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    // Read the snapshot here, not in Compose, so every failure is caught before composition.
    val result = try {
      SnapshotStore.read(context)
    } catch (e: Exception) {
      Log.w(TAG, "snapshot read failed", e)
      SnapshotResult.Corrupt
    }
    val palette = paletteFor(context)
    provideContent {
      WidgetBody(context, palette, result)
    }
  }

  companion object {
    private const val TAG = "SumrakWidget"
  }
}

@Composable
private fun WidgetBody(context: Context, palette: WidgetPalette, result: SnapshotResult) {
  when (result) {
    is SnapshotResult.Ok -> {
      val now = System.currentTimeMillis()
      val snap = result.snapshot
      val stale = snap.isStale(now)
      Normal(context, palette, snap, stale)
    }
    else -> Placeholder(palette, appUri(""))
  }
}

@Composable
private fun Placeholder(palette: WidgetPalette, uri: Uri) {
  Box(
    modifier = GlanceModifier
      .fillMaxSize()
      .background(ColorProvider(Color(palette.bg)))
      .cornerRadius(20.dp)
      .clickable(actionStartActivity(Intent(Intent.ACTION_VIEW, uri)))
      .padding(12.dp),
    contentAlignment = Alignment.Center,
  ) {
    Text(
      text = "Открой Сумрак",
      style = TextStyle(
        color = ColorProvider(Color(palette.text)),
        fontWeight = FontWeight.Medium,
        textAlign = TextAlign.Center,
      ),
    )
  }
}

@Composable
private fun Normal(
  context: Context,
  palette: WidgetPalette,
  snap: Snapshot,
  stale: Boolean,
) {
  val numberColor = if (stale) palette.textMuted else palette.text
  val dailyUri = appUri("review/daily")
  val readingUri = snap.continueTarget?.let {
    appUri("reader/${encode(it.packId)}/${encode(it.storyId)}")
  }
  val cardUri = readingUri ?: dailyUri

  Column(
    modifier = GlanceModifier
      .fillMaxSize()
      .background(ColorProvider(Color(palette.surface)))
      .cornerRadius(20.dp)
      .padding(12.dp)
      .clickable(actionStartActivity(Intent(Intent.ACTION_VIEW, cardUri))),
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Box(contentAlignment = Alignment.Center, modifier = GlanceModifier.size(64.dp)) {
        GoalRingImage(context, snap.goalFraction(), palette)
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
          Text(
            text = "🔥",
            style = TextStyle(fontSize = 12.sp, textAlign = TextAlign.Center),
          )
          Text(
            text = snap.streak.toString(),
            style = TextStyle(
              color = ColorProvider(Color(numberColor)),
              fontWeight = FontWeight.Bold,
              fontSize = 18.sp,
              textAlign = TextAlign.Center,
            ),
          )
        }
      }
    }
    Spacer(GlanceModifier.height(6.dp))
    Text(
      text = "${snap.dueCount} к повторению",
      modifier = GlanceModifier.clickable(actionStartActivity(Intent(Intent.ACTION_VIEW, dailyUri))),
      style = TextStyle(
        color = ColorProvider(Color(numberColor)),
        fontSize = 13.sp,
        textAlign = TextAlign.Center,
      ),
    )
    if (snap.continueTarget != null) {
      Spacer(GlanceModifier.height(4.dp))
      Text(
        text = snap.continueTarget.title,
        maxLines = 1,
        style = TextStyle(
          color = ColorProvider(Color(palette.textMuted)),
          fontSize = 11.sp,
          textAlign = TextAlign.Center,
        ),
      )
    }
    if (stale) {
      Spacer(GlanceModifier.height(4.dp))
      Text(
        text = "открой приложение",
        style = TextStyle(
          color = ColorProvider(Color(palette.textMuted)),
          fontSize = 10.sp,
          textAlign = TextAlign.Center,
        ),
      )
    }
  }
}

/** Renders the ring as a bitmap; falls back to a Glance linear bar if the bitmap route fails. */
@Composable
private fun GoalRingImage(context: Context, fraction: Float, palette: WidgetPalette) {
  val bitmap = runCatching {
    GoalRing.render(fraction, sizePx = 192, trackColor = palette.border, accentColor = palette.accent)
  }.onFailure { Log.w("SumrakWidget", "ring render failed, using bar", it) }.getOrNull()
  if (bitmap != null) {
    Image(
      provider = ImageProvider(bitmap),
      contentDescription = "Daily goal ${(fraction * 100).toInt()}%",
      modifier = GlanceModifier.size(64.dp),
    )
  } else {
    LinearProgressIndicator(
      progress = fraction,
      modifier = GlanceModifier.fillMaxWidth().height(6.dp),
    )
  }
}

private fun encode(s: String): String = URLEncoder.encode(s, "UTF-8").replace("+", "%20")
