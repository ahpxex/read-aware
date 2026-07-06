package com.readaware.app

import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // The app draws edge-to-edge, but Android's WebView never surfaces the
    // system-bar/cutout insets through CSS `env(safe-area-inset-*)` the way
    // iOS does — so the web layer's `--ra-safe-*` variables resolve to 0 and
    // fixed chrome (the reader header, most visibly) lays out under the
    // status bar, where its buttons can never receive touches. Bridge the
    // real insets into those variables instead. Attached to the content view
    // (not the decor view) so the window's own insets handling is untouched.
    ViewCompat.setOnApplyWindowInsetsListener(
      findViewById<View>(android.R.id.content)
    ) { _, insets ->
      applySafeAreaToWebView(insets)
      insets
    }
  }

  /**
   * Show/hide the system status bar. Called from Rust (the
   * `set_status_bar_hidden` command) while the reader is open, for an
   * immersive reading surface. A swipe from the top edge reveals the bar
   * transiently while hidden.
   */
  fun setStatusBarHidden(hidden: Boolean) {
    runOnUiThread {
      val controller = WindowCompat.getInsetsController(window, window.decorView)
      if (hidden) {
        controller.systemBarsBehavior =
          WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsetsCompat.Type.statusBars())
      } else {
        controller.show(WindowInsetsCompat.Type.statusBars())
      }
    }
  }

  /**
   * Re-dispatch the current window insets. Called from Rust (the
   * `sync_safe_area` command) once the web app has booted: a freshly loaded
   * document starts back at the CSS defaults (0), and the insets listener
   * above only fires again when the insets themselves change.
   */
  fun syncSafeArea() {
    runOnUiThread { findViewById<View>(android.R.id.content).requestApplyInsets() }
  }

  /** Push the system-bar + cutout insets into the web layer's CSS variables. */
  private fun applySafeAreaToWebView(insets: WindowInsetsCompat) {
    val bars = insets.getInsets(
      WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
    )
    // WebView CSS pixels are physical pixels over the display density.
    val density = resources.displayMetrics.density
    val js = """
      (function () {
        var s = document.documentElement.style;
        s.setProperty('--ra-safe-top', '${bars.top / density}px');
        s.setProperty('--ra-safe-right', '${bars.right / density}px');
        s.setProperty('--ra-safe-bottom', '${bars.bottom / density}px');
        s.setProperty('--ra-safe-left', '${bars.left / density}px');
      })();
    """.trimIndent()
    findWebView(findViewById(android.R.id.content))?.evaluateJavascript(js, null)
  }

  private fun findWebView(root: View): WebView? {
    if (root is WebView) return root
    if (root is ViewGroup) {
      for (i in 0 until root.childCount) {
        findWebView(root.getChildAt(i))?.let { return it }
      }
    }
    return null
  }
}
