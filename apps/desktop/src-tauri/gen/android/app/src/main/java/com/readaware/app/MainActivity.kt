package com.readaware.app

import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  companion object {
    /** Classic requestCode for the book picker — distinct from the
     *  ActivityResult launchers Tauri's PluginManager registers. */
    private const val BOOK_PICK_REQUEST = 51733
  }

  /** Generation of the pick currently in flight; 0 = none. */
  @Volatile private var bookPickGeneration = 0

  /** Parked pick result: "<generation>" alone = cancelled, else
   *  "<generation>\n<uri>\n<uri>…". The webview collects it by POLLING
   *  (`book_pick_poll` over ordinary request/response IPC) instead of
   *  receiving a push: Tauri's own dialog plugin delivers activity results
   *  through a single mutable callback slot whose response can be dropped
   *  while the webview is paused mid round-trip — a cancel is lost nearly
   *  every time, a successful pick intermittently. Parked state + polling
   *  cannot lose the result. */
  @Volatile private var bookPickResult: String? = null
  /** While true, volume keys step the reader's sentence navigator instead of
   *  changing the volume. Toggled from Rust (`set_volume_key_capture`) as the
   *  navigator mode starts/stops, so media volume works normally otherwise. */
  @Volatile private var volumeKeysCaptured = false
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
    // Hand the back button/gesture to the web layer, which unwinds its own
    // navigation one layer at a time (dialogs → reader → shelf surfaces) and
    // calls `move_task_to_back` at the root. The default would finish() the
    // activity — tearing down the whole Tauri process, so every return to the
    // app became a cold start. (TauriActivity opts out of wry's own handler
    // via handleBackNavigation = false; the SPA has no WebView history anyway.)
    onBackPressedDispatcher.addCallback(
      this,
      object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
          // Keep the event name in step with platform/back-navigation.ts.
          findWebView(findViewById(android.R.id.content))?.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('ra-back-request', { cancelable: true }));",
            null,
          )
        }
      },
    )
    installBookPickBridge()
  }

  /** Called from Rust (the `move_task_to_back` command): background the app
   *  like Home does, keeping the process (and the loaded book) warm. */
  fun sendToBackground() {
    runOnUiThread { moveTaskToBack(true) }
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

  /** Called from Rust (the `set_volume_key_capture` command). */
  fun setVolumeKeyCapture(captured: Boolean) {
    volumeKeysCaptured = captured
  }

  /** Called from Rust (`book_pick_start`) or the webview JS bridge: launch the system document picker
   *  for book files. The result is parked in [bookPickResult] rather than
   *  pushed to the webview — see that field's comment. */
  @JavascriptInterface
  fun startBookPick(generation: Int) {
    bookPickGeneration = generation
    bookPickResult = null
    runOnUiThread {
      try {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
          addCategory(Intent.CATEGORY_OPENABLE)
          type = "*/*"
          putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
          putExtra(
            Intent.EXTRA_MIME_TYPES,
            arrayOf(
              "application/epub+zip",
              "application/pdf",
              "application/x-mobipocket-ebook",
              "application/vnd.amazon.ebook",
              "application/x-fictionbook+xml",
              "application/octet-stream",
            ),
          )
        }
        @Suppress("DEPRECATION")
        startActivityForResult(intent, BOOK_PICK_REQUEST)
      } catch (error: Throwable) {
        bookPickResult = listOf(
          generation.toString(),
          "__ERROR__:${error.message ?: error.javaClass.name}",
        ).joinToString("\n")
        bookPickGeneration = 0
      }
    }
  }

  /** Called from Rust (`book_pick_poll`) or the webview JS bridge: hand over the parked pick result
   *  (and clear it), or null while the picker is still open. */
  @JavascriptInterface
  fun takeBookPickResult(): String? {
    val result = bookPickResult
    if (result != null) bookPickResult = null
    return result
  }

  @Deprecated("classic result API is intentional here")
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    @Suppress("DEPRECATION")
    super.onActivityResult(requestCode, resultCode, data)
    if (requestCode != BOOK_PICK_REQUEST) return
    val uris = mutableListOf<String>()
    if (resultCode == RESULT_OK && data != null) {
      val clip = data.clipData
      if (clip != null) {
        for (i in 0 until clip.itemCount) uris.add(clip.getItemAt(i).uri.toString())
      } else {
        data.data?.let { uris.add(it.toString()) }
      }
    }
    bookPickResult = (listOf(bookPickGeneration.toString()) + uris).joinToString("\n")
    bookPickGeneration = 0
  }

  /**
   * While captured, turn volume-key presses into sentence-navigator steps:
   * volume down moves forward, volume up moves back (the e-reader convention).
   * Key auto-repeat comes through as repeated ACTION_DOWNs, so holding a key
   * steps continuously. Both actions are consumed so the volume HUD stays away;
   * everything else falls through to the system.
   */
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    val isVolumeKey =
      event.keyCode == KeyEvent.KEYCODE_VOLUME_DOWN ||
        event.keyCode == KeyEvent.KEYCODE_VOLUME_UP
    if (!volumeKeysCaptured || !isVolumeKey) return super.dispatchKeyEvent(event)
    if (event.action == KeyEvent.ACTION_DOWN) {
      val direction = if (event.keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) "next" else "prev"
      // Keep the event name in step with platform/volume-keys.ts.
      findWebView(findViewById(android.R.id.content))?.evaluateJavascript(
        "window.dispatchEvent(new CustomEvent('ra-volume-step', { detail: '$direction' }));",
        null,
      )
    }
    return true
  }

  private fun installBookPickBridge() {
    val root = findViewById<View>(android.R.id.content)
    fun install(attemptsLeft: Int) {
      val webView = findWebView(root)
      if (webView != null) {
        webView.addJavascriptInterface(this, "ReadAwareAndroid")
        return
      }
      if (attemptsLeft > 0) root.postDelayed({ install(attemptsLeft - 1) }, 50)
    }
    install(20)
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
