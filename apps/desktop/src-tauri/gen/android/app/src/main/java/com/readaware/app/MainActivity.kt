package com.readaware.app

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.io.File

class MainActivity : TauriActivity() {
  companion object {
    /** Classic requestCode for the book picker — distinct from the
     *  ActivityResult launchers Tauri's PluginManager registers. */
    private const val BOOK_PICK_REQUEST = 51733
    /** The folder (SAF tree) picker for folder imports. */
    private const val FOLDER_PICK_REQUEST = 51734
    /** The font-file picker (custom reading fonts). */
    private const val FONT_PICK_REQUEST = 51735
    /** Mirrors `MAX_FOLDER_BOOKS` / `MAX_FOLDER_DEPTH` in book_folders.rs. */
    private const val FOLDER_PICK_MAX_BOOKS = 5000
    private const val FOLDER_PICK_MAX_DEPTH = 32
    /** Importable suffixes — mirror `is_book_path` in external_open.rs (the
     *  real book formats, not the picker's broader ZIP candidates). */
    private val FOLDER_BOOK_SUFFIXES = listOf(
      ".epub", ".mobi", ".prc", ".azw3", ".azw", ".kf8", ".fb2", ".fb2.zip", ".fbz",
      ".cbz", ".cbr", ".txt", ".text", ".html", ".htm", ".xhtml", ".pdf",
    )
  }

  /** Generation of the pick currently in flight; 0 = none. */
  @Volatile private var bookPickGeneration = 0

  /** Parked pick result: "<generation>" alone = cancelled, else
   *  "<generation>\n<uri>\t<displayName>\t<size>\n…" — name/size resolved
   *  from the content provider here, where the grant is certain, so the
   *  webview never has to query SAF. The webview collects it by POLLING
   *  (`book_pick_poll` over ordinary request/response IPC) instead of
   *  receiving a push: Tauri's own dialog plugin delivers activity results
   *  through a single mutable callback slot whose response can be dropped
   *  while the webview is paused mid round-trip — a cancel is lost nearly
   *  every time, a successful pick intermittently. Parked state + polling
   *  cannot lose the result. */
  @Volatile private var bookPickResult: String? = null
  /** While true, volume keys navigate the reader (page turns, or text-unit
   *  steps) instead of changing the volume. Toggled from Rust
   *  (`set_volume_key_capture`) while the web layer holds a claim on the keys,
   *  so media volume works normally otherwise. */
  @Volatile private var volumeKeysCaptured = false
  /** Generation of the font pick currently in flight; 0 = none. */
  @Volatile private var fontPickGeneration = 0
  /** Parked font-pick result in [bookPickResult]'s wire shape — collected by
   *  polling (`font_pick_poll`) for exactly the same reliability reason. */
  @Volatile private var fontPickResult: String? = null
  /** Generation of the folder pick in flight; 0 = none. */
  @Volatile private var folderPickGeneration = 0
  /** Parked folder-pick outcome as JSON (see book_folders.rs), collected by
   *  polling for the same reason as [bookPickResult]. Null while the picker
   *  is open or the walk is still running. */
  @Volatile private var folderPickResult: String? = null
  /** APK waiting for the user to grant this app install-source permission. */
  @Volatile private var pendingUpdateApkPath: String? = null

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
    ) { view, insets ->
      // Keyboard avoidance: edge-to-edge opts the window out of adjustResize,
      // so the IME just overlays the webview and bottom-anchored inputs (the
      // chat composer, search fields) end up behind it — the webview never
      // learns the keyboard exists. Shrink it ourselves: pad the content view
      // by the IME inset so the app-shell layout reflows above the keyboard.
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(0, 0, 0, ime.bottom)
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

  /**
   * The app window is never zoomable. The stock WebView only pinch-zooms
   * with built-in zoom controls on, yet the whole app zoomed on users'
   * devices, so state the settings rather than inherit the device's defaults.
   * The viewport meta in index.html fixes the scale on the web side as well,
   * and fixed-layout books zoom through their own pinch handling.
   */
  override fun onWebViewCreate(webView: WebView) {
    webView.settings.apply {
      setSupportZoom(false)
      builtInZoomControls = false
      displayZoomControls = false
    }
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

  /** Current Android build number, used to reject non-upgrade release APKs. */
  fun installedVersionCode(): Long {
    @Suppress("DEPRECATION")
    val packageInfo = packageManager.getPackageInfo(packageName, 0)
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      packageInfo.longVersionCode
    } else {
      @Suppress("DEPRECATION")
      packageInfo.versionCode.toLong()
    }
  }

  /** Open Android's system package installer for an update verified by Rust. */
  fun installUpdateApk(apkPath: String): String {
    val apk = File(apkPath)
    if (!apk.isFile) return "error:Downloaded update APK does not exist"

    pendingUpdateApkPath = apkPath
    if (
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
        !packageManager.canRequestPackageInstalls()
    ) {
      return try {
        startActivity(
          Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:$packageName"),
          ),
        )
        "permission-required"
      } catch (error: Throwable) {
        pendingUpdateApkPath = null
        "error:${error.message ?: error.javaClass.name}"
      }
    }

    return openPackageInstaller(apk)
  }

  override fun onResume() {
    super.onResume()
    val apkPath = pendingUpdateApkPath ?: return
    if (
      Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
        packageManager.canRequestPackageInstalls()
    ) {
      openPackageInstaller(File(apkPath))
    }
  }

  private fun openPackageInstaller(apk: File): String {
    pendingUpdateApkPath = null
    return try {
      val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", apk)
      startActivity(
        Intent(Intent.ACTION_VIEW).apply {
          setDataAndType(uri, "application/vnd.android.package-archive")
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        },
      )
      findWebView(findViewById(android.R.id.content))?.evaluateJavascript(
        "window.dispatchEvent(new CustomEvent('ra-android-installer-opened'));",
        null,
      )
      "installer-started"
    } catch (error: Throwable) {
      "error:${error.message ?: error.javaClass.name}"
    }
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
            // Must cover every importable format (mirror BOOK_FILE_ACCEPT in
            // pick-book-files.ts): SAF greys out anything not listed here.
            // txt/html/cbz/cbr were missing for months after those formats
            // landed — "Android can't import TXT" was this list, not the app.
            arrayOf(
              "application/epub+zip",
              "application/pdf",
              "application/x-mobipocket-ebook",
              "application/vnd.amazon.ebook",
              "application/x-fictionbook+xml",
              "application/vnd.comicbook+zip",
              "application/vnd.comicbook-rar",
              "text/plain",
              "text/html",
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

  /** Called from Rust (`font_pick_start`) or the webview JS bridge: launch
   *  the system document picker for font files. Result parks in
   *  [fontPickResult]; the webview polls (`font_pick_poll`). */
  @JavascriptInterface
  fun startFontPick(generation: Int) {
    fontPickGeneration = generation
    fontPickResult = null
    runOnUiThread {
      try {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
          addCategory(Intent.CATEGORY_OPENABLE)
          type = "*/*"
          putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
          putExtra(
            Intent.EXTRA_MIME_TYPES,
            // Font MIME types are notoriously inconsistent across providers
            // (font/*, application/x-font-*, octet-stream all appear in the
            // wild); the broad list keeps real font files ungreyed. Actual
            // validation is the native magic-byte parse in fonts.rs.
            arrayOf(
              "font/ttf",
              "font/otf",
              "font/woff",
              "font/woff2",
              "font/collection",
              "font/sfnt",
              "application/x-font-ttf",
              "application/x-font-otf",
              "application/x-font-ttc",
              "application/x-font-opentype",
              "application/x-font-truetype",
              "application/x-font-woff",
              "application/x-font-woff2",
              "application/vnd.ms-opentype",
              "application/font-sfnt",
              "application/octet-stream",
            ),
          )
        }
        @Suppress("DEPRECATION")
        startActivityForResult(intent, FONT_PICK_REQUEST)
      } catch (error: Throwable) {
        fontPickResult = listOf(
          generation.toString(),
          "__ERROR__:${error.message ?: error.javaClass.name}",
        ).joinToString("\n")
        fontPickGeneration = 0
      }
    }
  }

  /** Called from Rust (`font_pick_poll`) or the webview JS bridge: hand over
   *  (and clear) the parked pick result, or null while it is still open. */
  @JavascriptInterface
  fun takeFontPickResult(): String? {
    val result = fontPickResult
    if (result != null) fontPickResult = null
    return result
  }

  /** Called from Rust (`book_folder_pick_start`): open the system folder
   *  picker. Once the user picks, the granted tree is walked off the UI
   *  thread and the outcome parked in [folderPickResult]. */
  fun startFolderPick(generation: Int) {
    folderPickGeneration = generation
    folderPickResult = null
    runOnUiThread {
      try {
        @Suppress("DEPRECATION")
        startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), FOLDER_PICK_REQUEST)
      } catch (error: Throwable) {
        folderPickResult = folderPickOutcome(generation, "error")
          .put("error", error.message ?: error.javaClass.name)
          .toString()
        folderPickGeneration = 0
      }
    }
  }

  /** Called from Rust (`book_folder_pick_poll`): hand over (and clear) the
   *  parked folder pick, or null while it is still in progress. */
  fun takeFolderPickResult(): String? {
    val result = folderPickResult
    if (result != null) folderPickResult = null
    return result
  }

  private fun folderPickOutcome(generation: Int, status: String) =
    org.json.JSONObject().put("generation", generation).put("status", status)

  private fun onFolderPicked(resultCode: Int, data: Intent?) {
    val generation = folderPickGeneration
    folderPickGeneration = 0
    val tree = data?.data
    if (resultCode != RESULT_OK || tree == null) {
      folderPickResult = folderPickOutcome(generation, "cancelled").toString()
      return
    }
    // A big library is thousands of provider queries: never on the UI thread.
    Thread {
      folderPickResult = try {
        walkBookFolder(tree, generation).toString()
      } catch (error: Throwable) {
        folderPickOutcome(generation, "error").put("error", error.message ?: error.javaClass.name).toString()
      }
    }.start()
  }

  /** Every importable book below the picked tree, as document URIs plus their
   *  `/`-separated path under it. Skips dotfiles, dot-folders and `__MACOSX`
   *  like the desktop walk; stops (truncated) past FOLDER_PICK_MAX_BOOKS. */
  private fun walkBookFolder(tree: Uri, generation: Int): org.json.JSONObject {
    val rootId = android.provider.DocumentsContract.getTreeDocumentId(tree)
    val rootName = queryDisplayName(
      android.provider.DocumentsContract.buildDocumentUriUsingTree(tree, rootId)
    ) ?: rootId.substringAfterLast(':').substringAfterLast('/')
    val files = org.json.JSONArray()
    var truncated = false
    val pending = ArrayDeque<Pair<String, List<String>>>()
    pending.addLast(rootId to emptyList())
    val columns = arrayOf(
      android.provider.DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      android.provider.DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      android.provider.DocumentsContract.Document.COLUMN_MIME_TYPE,
      android.provider.DocumentsContract.Document.COLUMN_SIZE,
    )
    walk@ while (pending.isNotEmpty()) {
      val (documentId, segments) = pending.removeLast()
      val children = android.provider.DocumentsContract.buildChildDocumentsUriUsingTree(tree, documentId)
      // An unreadable subfolder costs only its own books.
      val cursor = contentResolver.query(children, columns, null, null, null) ?: continue
      try {
        while (cursor.moveToNext()) {
          val childId = cursor.getString(0) ?: continue
          val name = cursor.getString(1) ?: continue
          if (name.startsWith('.') || name == "__MACOSX") continue
          val mime = cursor.getString(2)
          if (mime == android.provider.DocumentsContract.Document.MIME_TYPE_DIR) {
            if (segments.size + 1 < FOLDER_PICK_MAX_DEPTH) pending.addLast(childId to segments + name)
            continue
          }
          val lower = name.lowercase()
          if (FOLDER_BOOK_SUFFIXES.none { lower.endsWith(it) }) continue
          if (files.length() == FOLDER_PICK_MAX_BOOKS) {
            truncated = true
            break@walk
          }
          val size = if (cursor.isNull(3)) -1L else cursor.getLong(3)
          files.put(
            org.json.JSONObject()
              .put("path", android.provider.DocumentsContract.buildDocumentUriUsingTree(tree, childId).toString())
              .put("relativePath", (segments + name).joinToString("/"))
              .put("size", size)
          )
        }
      } finally {
        cursor.close()
      }
    }
    return folderPickOutcome(generation, "picked")
      .put("rootName", rootName)
      .put("files", files)
      .put("truncated", truncated)
  }

  private fun queryDisplayName(uri: Uri): String? = try {
    contentResolver.query(
      uri,
      arrayOf(android.provider.OpenableColumns.DISPLAY_NAME),
      null,
      null,
      null,
    )?.use { cursor -> if (cursor.moveToFirst() && !cursor.isNull(0)) cursor.getString(0) else null }
  } catch (_: Throwable) {
    // The tree's own name is cosmetic: fall back to its document id.
    null
  }

  @Deprecated("classic result API is intentional here")
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    @Suppress("DEPRECATION")
    super.onActivityResult(requestCode, resultCode, data)
    if (requestCode == FOLDER_PICK_REQUEST) {
      onFolderPicked(resultCode, data)
      return
    }
    if (requestCode == FONT_PICK_REQUEST) {
      val uris = mutableListOf<Uri>()
      if (resultCode == RESULT_OK && data != null) {
        val clip = data.clipData
        if (clip != null) {
          for (i in 0 until clip.itemCount) uris.add(clip.getItemAt(i).uri)
        } else {
          data.data?.let { uris.add(it) }
        }
      }
      val picks = uris.map { uri -> describePick(uri) }
      fontPickResult = (listOf(fontPickGeneration.toString()) + picks).joinToString("\n")
      fontPickGeneration = 0
      return
    }
    if (requestCode != BOOK_PICK_REQUEST) return
    val uris = mutableListOf<Uri>()
    if (resultCode == RESULT_OK && data != null) {
      val clip = data.clipData
      if (clip != null) {
        for (i in 0 until clip.itemCount) uris.add(clip.getItemAt(i).uri)
      } else {
        data.data?.let { uris.add(it) }
      }
    }
    val picks = uris.map { uri -> describePick(uri) }
    bookPickResult = (listOf(bookPickGeneration.toString()) + picks).joinToString("\n")
    bookPickGeneration = 0
  }

  /** "<uri>\t<displayName>\t<size>" — name empty / size -1 when the provider
   *  won't say. Tabs cannot survive inside either field: URIs are encoded,
   *  and a display name containing a tab is sanitized rather than parked. */
  private fun describePick(uri: Uri): String {
    var name = ""
    var size = -1L
    try {
      contentResolver.query(
        uri,
        arrayOf(
          android.provider.OpenableColumns.DISPLAY_NAME,
          android.provider.OpenableColumns.SIZE,
        ),
        null,
        null,
        null,
      )?.use { cursor ->
        if (cursor.moveToFirst()) {
          val nameIndex = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
          if (nameIndex >= 0 && !cursor.isNull(nameIndex)) {
            name = cursor.getString(nameIndex).replace('\t', ' ').replace('\n', ' ')
          }
          val sizeIndex = cursor.getColumnIndex(android.provider.OpenableColumns.SIZE)
          if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) size = cursor.getLong(sizeIndex)
        }
      }
    } catch (_: Throwable) {
      // A provider that refuses to answer still yields a usable pick.
    }
    return "$uri\t$name\t$size"
  }

  /**
   * While captured, relay volume-key presses to the reader: volume down as
   * "next", volume up as "prev" (the e-reader convention; the web layer may
   * flip the pair per the reader's volume-key direction preference).
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
    // While the IME is up, the content view is already padded past it (see the
    // insets listener), so the webview's bottom edge sits above the keyboard —
    // and above the nav bar the keyboard covers. Keeping the nav-bar value in
    // --ra-safe-bottom would double the clearance under bottom-anchored chrome.
    val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
    val safeBottom = maxOf(bars.bottom - ime.bottom, 0)
    // WebView CSS pixels are physical pixels over the display density.
    val density = resources.displayMetrics.density
    val js = """
      (function () {
        var s = document.documentElement.style;
        s.setProperty('--ra-safe-top', '${bars.top / density}px');
        s.setProperty('--ra-safe-right', '${bars.right / density}px');
        s.setProperty('--ra-safe-bottom', '${safeBottom / density}px');
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
