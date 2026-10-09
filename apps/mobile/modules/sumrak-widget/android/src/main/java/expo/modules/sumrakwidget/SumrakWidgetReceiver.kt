package expo.modules.sumrakwidget

import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver

/** The AppWidget provider. Declared in this module's own manifest (survives `prebuild --clean`). */
class SumrakWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = SumrakWidget()
}
