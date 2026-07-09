# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# Rust and the Android WebView call these MainActivity methods by exact names
# (JNI strings / @JavascriptInterface). R8 cannot see those native edges, so
# release minification must keep the members and their runtime annotations.
-keepattributes RuntimeVisibleAnnotations
-keepclassmembers class com.readaware.app.MainActivity {
    public void sendToBackground();
    public void setStatusBarHidden(boolean);
    public void syncSafeArea();
    public void setVolumeKeyCapture(boolean);
    public void startBookPick(int);
    public java.lang.String takeBookPickResult();
}
