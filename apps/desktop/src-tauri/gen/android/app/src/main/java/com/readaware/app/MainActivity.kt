package com.readaware.app

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
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
}
