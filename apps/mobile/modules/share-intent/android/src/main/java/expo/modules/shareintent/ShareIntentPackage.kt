package expo.modules.shareintent

import android.app.Activity
import android.content.Context
import android.os.Bundle
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener

/**
 * Cold-start capture for the share target (T28): `onCreate` runs inside
 * MainActivity's creation — before expo-dev-launcher (dev builds) bounces
 * the activity, and before JS exists — so the SEND intent's text survives
 * into [ShareIntentStore] for `consumePendingShare()`. A non-share create
 * (including the dev-launcher's plain relaunch) leaves the stash alone.
 * Discovered by expo-modules autolinking via the *Package.kt convention.
 */
class ShareIntentPackage : Package {
  override fun createReactActivityLifecycleListeners(
    activityContext: Context,
  ): List<ReactActivityLifecycleListener> = listOf(ShareIntentLifecycleListener())
}

internal class ShareIntentLifecycleListener : ReactActivityLifecycleListener {
  override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
    sharedTextFrom(activity.intent)?.let { ShareIntentStore.pendingText = it }
  }
}
