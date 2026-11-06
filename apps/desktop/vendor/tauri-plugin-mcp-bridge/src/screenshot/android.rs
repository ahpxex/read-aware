use super::{Screenshot, ScreenshotError};
use tauri::{Runtime, WebviewWindow};

/// Android-specific screenshot implementation using WebView.draw()
///
/// This implementation captures the visible viewport by:
/// 1. Getting the WebView dimensions via JNI
/// 2. Creating a Bitmap with those dimensions
/// 3. Creating a Canvas from the Bitmap
/// 4. Drawing the WebView to the Canvas
/// 5. Compressing the Bitmap to PNG bytes
pub fn capture_viewport<R: Runtime>(
    window: &WebviewWindow<R>,
) -> Result<Screenshot, ScreenshotError> {
    #[cfg(target_os = "android")]
    {
        use jni::objects::{JByteArray, JValue};
        use std::sync::mpsc;

        let (tx, rx) = mpsc::channel::<Result<Screenshot, ScreenshotError>>();

        // Use Tauri's with_webview to access the Android WebView via JNI
        window
            .with_webview(move |webview| {
                webview
                    .jni_handle()
                    .exec(move |env, _activity, webview_obj| {
                        let result: Result<Screenshot, ScreenshotError> = (|| {
                            // Get WebView dimensions
                            let width = env
                                .call_method(webview_obj, "getWidth", "()I", &[])
                                .map_err(|e| {
                                    ScreenshotError::CaptureFailed(format!(
                                        "Failed to get width: {e}"
                                    ))
                                })?
                                .i()
                                .map_err(|e| {
                                    ScreenshotError::CaptureFailed(format!("Invalid width: {e}"))
                                })?;

                            let height = env
                                .call_method(webview_obj, "getHeight", "()I", &[])
                                .map_err(|e| {
                                    ScreenshotError::CaptureFailed(format!(
                                        "Failed to get height: {e}"
                                    ))
                                })?
                                .i()
                                .map_err(|e| {
                                    ScreenshotError::CaptureFailed(format!("Invalid height: {e}"))
                                })?;

                            if width <= 0 || height <= 0 {
                                return Err(ScreenshotError::CaptureFailed(format!(
                                    "Invalid WebView dimensions: {width}x{height}"
                                )));
                            }

                            // Create Bitmap with ARGB_8888 config
                            let bitmap_class =
                                env.find_class("android/graphics/Bitmap").map_err(|e| {
                                    ScreenshotError::CaptureFailed(format!(
                                        "Failed to find Bitmap class: {e}"
                                    ))
                                })?;

                            let config_class = env
                                .find_class("android/graphics/Bitmap$Config")
                                .map_err(|e| {
                                    ScreenshotError::CaptureFailed(format!(
                                        "Failed to find Bitmap.Config class: {e}"
                                    ))
                                })?;

                            let argb_8888 = env
                                .get_static_field(
                                    &config_class,
                                    "ARGB_8888",
                                    "Landroid/graphics/Bitmap$Config;",
                                )
                                .map_err(|e| {
                                    ScreenshotError::CaptureFailed(format!(
                                        "Failed to get ARGB_8888: {e}"
                                    ))
                                })?
                                .l()
                                .map_err(|e| {
                                    ScreenshotError::CaptureFailed(format!(
                                        "Invalid ARGB_8888: {e}"
                                    ))
                                })?;

                            let bitmap = env
                                .call_static_method(
                                    &bitmap_class,
                                    "createBitmap",
                                    "(IILandroid/graphics/Bitmap$Config;)Landroid/graphics/Bitmap;",
                                    &[
                                        JValue::Int(width),
                                        JValue::Int(height),
                                        JValue::Object(&argb_8888),
                                    ],
                                )
                                .map_err(|e| {
                                    ScreenshotError::CaptureFailed(format!(
                                        "Failed to create Bitmap: {e}"
                                    ))
                                })?
                                .l()
                                .map_err(|e| {
                                    ScreenshotError::CaptureFailed(format!("Invalid Bitmap: {e}"))
                                })?;

                            // Create Canvas from Bitmap
                            let canvas_class =
                                env.find_class("android/graphics/Canvas").map_err(|e| {
                                    ScreenshotError::CaptureFailed(format!(
                                        "Failed to find Canvas class: {e}"
                                    ))
                                })?;

                            let canvas = env
                                .new_object(
                                    &canvas_class,
                                    "(Landroid/graphics/Bitmap;)V",
                                    &[JValue::Object(&bitmap)],
                                )
                                .map_err(|e| {
                                    ScreenshotError::CaptureFailed(format!(
                                        "Failed to create Canvas: {e}"
                                    ))
                                })?;

                            // Draw WebView to Canvas
                            env.call_method(
                                webview_obj,
                                "draw",
                                "(Landroid/graphics/Canvas;)V",
                                &[JValue::Object(&canvas)],
                            )
                            .map_err(|e| {
                                ScreenshotError::CaptureFailed(format!(
                                    "Failed to draw WebView: {e}"
                                ))
                            })?;

                            // Compress Bitmap to PNG bytes
                            let baos_class = env
                                .find_class("java/io/ByteArrayOutputStream")
                                .map_err(|e| {
                                    ScreenshotError::CaptureFailed(format!(
                                        "Failed to find ByteArrayOutputStream class: {e}"
                                    ))
                                })?;

                            let baos =
                                env.new_object(&baos_class, "()V", &[]).map_err(|e| {
                                    ScreenshotError::CaptureFailed(format!(
                                        "Failed to create ByteArrayOutputStream: {e}"
                                    ))
                                })?;

                            let compress_format_class = env
                                .find_class("android/graphics/Bitmap$CompressFormat")
                                .map_err(|e| {
                                    ScreenshotError::CaptureFailed(format!(
                                        "Failed to find CompressFormat class: {e}"
                                    ))
                                })?;

                            let png_format = env
                                .get_static_field(
                                    &compress_format_class,
                                    "PNG",
                                    "Landroid/graphics/Bitmap$CompressFormat;",
                                )
                                .map_err(|e| {
                                    ScreenshotError::CaptureFailed(format!(
                                        "Failed to get PNG format: {e}"
                                    ))
                                })?
                                .l()
                                .map_err(|e| {
                                    ScreenshotError::CaptureFailed(format!(
                                        "Invalid PNG format: {e}"
                                    ))
                                })?;

                            env.call_method(
                                &bitmap,
                                "compress",
                                "(Landroid/graphics/Bitmap$CompressFormat;ILjava/io/OutputStream;)Z",
                                &[
                                    JValue::Object(&png_format),
                                    JValue::Int(100),
                                    JValue::Object(&baos),
                                ],
                            )
                            .map_err(|e| {
                                ScreenshotError::CaptureFailed(format!(
                                    "Failed to compress Bitmap: {e}"
                                ))
                            })?;

                            // Get byte array from ByteArrayOutputStream
                            let byte_array = env
                                .call_method(&baos, "toByteArray", "()[B", &[])
                                .map_err(|e| {
                                    ScreenshotError::CaptureFailed(format!(
                                        "Failed to get byte array: {e}"
                                    ))
                                })?
                                .l()
                                .map_err(|e| {
                                    ScreenshotError::CaptureFailed(format!(
                                        "Invalid byte array: {e}"
                                    ))
                                })?;

                            // Convert Java byte array to Rust Vec<u8>
                            let byte_array = JByteArray::from(byte_array);
                            let len = env.get_array_length(&byte_array).map_err(|e| {
                                ScreenshotError::CaptureFailed(format!(
                                    "Failed to get array length: {e}"
                                ))
                            })? as usize;

                            let mut data = vec![0i8; len];
                            env.get_byte_array_region(&byte_array, 0, &mut data)
                                .map_err(|e| {
                                    ScreenshotError::CaptureFailed(format!(
                                        "Failed to copy byte array: {e}"
                                    ))
                                })?;

                            // Convert i8 to u8 (safe reinterpret)
                            let data: Vec<u8> = data.into_iter().map(|b| b as u8).collect();

                            // Clean up: recycle the bitmap to free memory
                            let _ = env.call_method(&bitmap, "recycle", "()V", &[]);

                            Ok(Screenshot { data })
                        })();

                        let _ = tx.send(result);
                    });
            })
            .map_err(|e| {
                ScreenshotError::CaptureFailed(format!("Failed to access webview: {e}"))
            })?;

        // Wait for result with timeout
        match rx.recv_timeout(std::time::Duration::from_secs(10)) {
            Ok(result) => result,
            Err(_) => Err(ScreenshotError::Timeout),
        }
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = window;
        Err(ScreenshotError::PlatformUnsupported)
    }
}
