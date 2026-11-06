use std::env;
use std::io::Cursor;

use image::imageops::FilterType;
use image::ImageFormat;
use tauri::{Runtime, WebviewWindow};

// Platform-specific modules
#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "linux")]
mod linux;

#[cfg(target_os = "ios")]
mod ios;

#[cfg(target_os = "android")]
mod android;

/// Environment variable name for default max width
const ENV_MAX_WIDTH: &str = "TAURI_MCP_SCREENSHOT_MAX_WIDTH";

/// Screenshot result containing the image data
#[derive(Debug)]
pub struct Screenshot {
    /// The raw PNG bytes
    pub data: Vec<u8>,
}

/// Captured screenshot with metadata about dimensions and scale
#[derive(Debug)]
pub struct CapturedScreenshot {
    /// Base64 data URL of the image
    pub data_url: String,
    /// Image width in pixels (after any resizing)
    pub image_width: u32,
    /// Image height in pixels (after any resizing)
    pub image_height: u32,
    /// Webview viewport width in CSS pixels
    pub css_width: f64,
    /// Webview viewport height in CSS pixels
    pub css_height: f64,
}

/// Screenshot error types
#[derive(Debug, thiserror::Error)]
pub enum ScreenshotError {
    #[error("Platform not supported")]
    PlatformUnsupported,

    #[error("Webview capture failed: {0}")]
    CaptureFailed(String),

    #[error("Encoding failed: {0}")]
    EncodeFailed(String),

    #[error("Resize failed: {0}")]
    ResizeFailed(String),

    #[error("Timeout exceeded")]
    Timeout,
}

/// Get the effective max_width value.
/// Priority: param > env var > None
fn get_effective_max_width(param: Option<u32>) -> Option<u32> {
    if param.is_some() {
        return param;
    }

    env::var(ENV_MAX_WIDTH)
        .ok()
        .and_then(|s| s.parse::<u32>().ok())
}

/// Capture and encode the webview viewport without changing window visibility.
pub async fn capture_viewport_screenshot<R: Runtime>(
    window: &WebviewWindow<R>,
    format: &str,
    quality: u8,
    max_width: Option<u32>,
) -> Result<CapturedScreenshot, ScreenshotError> {
    // Get CSS viewport dimensions before capturing
    let physical_size = window
        .inner_size()
        .map_err(|e| ScreenshotError::CaptureFailed(format!("Failed to get inner size: {e}")))?;
    let scale_factor = window
        .scale_factor()
        .map_err(|e| ScreenshotError::CaptureFailed(format!("Failed to get scale factor: {e}")))?;
    let css_width = physical_size.width as f64 / scale_factor;
    let css_height = physical_size.height as f64 / scale_factor;

    // Dispatch to platform-specific implementation
    #[cfg(target_os = "macos")]
    let screenshot = macos::capture_viewport(window)?;

    #[cfg(target_os = "windows")]
    let screenshot = windows::capture_viewport(window)?;

    #[cfg(target_os = "linux")]
    let screenshot = linux::capture_viewport(window)?;

    #[cfg(target_os = "ios")]
    let screenshot = ios::capture_viewport(window)?;

    #[cfg(target_os = "android")]
    let screenshot = android::capture_viewport(window)?;

    #[cfg(not(any(
        target_os = "macos",
        target_os = "windows",
        target_os = "linux",
        target_os = "ios",
        target_os = "android"
    )))]
    return Err(ScreenshotError::PlatformUnsupported);

    let max_width = get_effective_max_width(max_width);
    let format = format.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        encode_screenshot(
            screenshot, format, quality, max_width, css_width, css_height,
        )
    })
    .await
    .map_err(|error| ScreenshotError::EncodeFailed(error.to_string()))?
}

/// Decode once, resize if necessary, then encode directly to the requested format.
fn encode_screenshot(
    screenshot: Screenshot,
    format: String,
    quality: u8,
    max_width: Option<u32>,
    css_width: f64,
    css_height: f64,
) -> Result<CapturedScreenshot, ScreenshotError> {
    if max_width == Some(0) {
        return Err(ScreenshotError::ResizeFailed(
            "maxWidth must be positive".into(),
        ));
    }

    let mut image = image::load_from_memory_with_format(&screenshot.data, ImageFormat::Png)
        .map_err(|error| ScreenshotError::EncodeFailed(error.to_string()))?;
    let resized = max_width.is_some_and(|width| image.width() > width);
    if let Some(width) = max_width.filter(|_| resized) {
        let height =
            ((image.height() as f64 * width as f64 / image.width() as f64).round() as u32).max(1);
        image = image.resize_exact(width, height, FilterType::Lanczos3);
    }

    let image_width = image.width();
    let image_height = image.height();
    let (data, mime_type) = if format == "jpeg" {
        let mut data = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut data, quality)
            .encode_image(&image.to_rgb8())
            .map_err(|error| ScreenshotError::EncodeFailed(error.to_string()))?;
        (data, "image/jpeg")
    } else if resized {
        let mut data = Cursor::new(Vec::new());
        image
            .write_to(&mut data, ImageFormat::Png)
            .map_err(|error| ScreenshotError::EncodeFailed(error.to_string()))?;
        (data.into_inner(), "image/png")
    } else {
        (screenshot.data, "image/png")
    };

    use base64::Engine as _;
    let base64_data = base64::engine::general_purpose::STANDARD.encode(data);

    Ok(CapturedScreenshot {
        data_url: format!("data:{mime_type};base64,{base64_data}"),
        image_width,
        image_height,
        css_width,
        css_height,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use image::{DynamicImage, Rgba, RgbaImage};

    fn png(width: u32, height: u32) -> Screenshot {
        let image = DynamicImage::ImageRgba8(RgbaImage::from_pixel(
            width,
            height,
            Rgba([20, 120, 220, 255]),
        ));
        let mut data = Cursor::new(Vec::new());
        image.write_to(&mut data, ImageFormat::Png).unwrap();
        Screenshot {
            data: data.into_inner(),
        }
    }

    fn decode(captured: &CapturedScreenshot) -> Vec<u8> {
        base64::engine::general_purpose::STANDARD
            .decode(captured.data_url.split_once(',').unwrap().1)
            .unwrap()
    }

    #[test]
    fn preserves_png_bytes_without_upscaling() {
        let source = png(80, 40);
        let original = source.data.clone();
        let result = encode_screenshot(source, "png".into(), 80, Some(160), 80.0, 40.0).unwrap();
        assert_eq!(decode(&result), original);
        assert_eq!((result.image_width, result.image_height), (80, 40));
    }

    #[test]
    fn encodes_rgba_as_jpeg_and_keeps_viewport_metadata() {
        let result =
            encode_screenshot(png(160, 80), "jpeg".into(), 80, Some(80), 160.0, 80.0).unwrap();
        let data = decode(&result);
        assert_eq!(image::guess_format(&data).unwrap(), ImageFormat::Jpeg);
        let decoded = image::load_from_memory(&data).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (80, 40));
        assert_eq!((result.image_width, result.image_height), (80, 40));
        assert_eq!((result.css_width, result.css_height), (160.0, 80.0));
    }

    #[test]
    fn keeps_extremely_wide_images_at_least_one_pixel_high() {
        let result = encode_screenshot(png(100, 1), "png".into(), 80, Some(1), 100.0, 1.0).unwrap();
        assert_eq!((result.image_width, result.image_height), (1, 1));
        assert_eq!(
            image::guess_format(&decode(&result)).unwrap(),
            ImageFormat::Png
        );
    }

    #[test]
    fn rejects_zero_width_and_corrupt_images() {
        assert!(encode_screenshot(png(2, 2), "png".into(), 80, Some(0), 2.0, 2.0).is_err());
        assert!(encode_screenshot(
            Screenshot { data: vec![] },
            "jpeg".into(),
            80,
            None,
            2.0,
            2.0
        )
        .is_err());
    }
}
