package expo.modules.sumrakwidget

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF

/**
 * The goal ring as a bitmap. Glance can't draw arcs, so the ring is rendered
 * with `Canvas.drawArc` (stroke ~10 % of the size, round caps, starting at
 * −90°) and shown through an `Image`. Throws on any failure; the caller falls
 * back to a progress bar.
 */
object GoalRing {
  fun render(fraction: Float, sizePx: Int, trackColor: Int, accentColor: Int): Bitmap {
    require(sizePx > 0) { "size" }
    val bitmap = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val stroke = sizePx * 0.10f
    val inset = stroke / 2f + 0.5f
    val rect = RectF(inset, inset, sizePx - inset, sizePx - inset)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeWidth = stroke
      strokeCap = Paint.Cap.ROUND
    }
    paint.color = trackColor
    canvas.drawArc(rect, 0f, 360f, false, paint)
    val sweep = 360f * fraction.coerceIn(0f, 1f)
    if (sweep > 0f) {
      paint.color = accentColor
      canvas.drawArc(rect, -90f, sweep, false, paint)
    }
    return bitmap
  }
}
