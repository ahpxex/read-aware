use crate::error::CommandError;
use image::ImageDecoder;
use serde::Serialize;
use std::fs::File;
use std::io::{BufReader, Cursor};
use tauri_plugin_clipboard_manager::ClipboardExt;

const MAX_ENCODED: u64 = 16 * 1024 * 1024;
const MAX_PIXELS: u64 = 16 * 1024 * 1024;
const MAX_DECODED: u64 = 64 * 1024 * 1024;

fn invalid() -> CommandError {
    CommandError::new(
        "ui/invalid-target",
        "Image is unsupported, invalid or exceeds resource image limits",
    )
}

fn preview(file: File) -> Result<Vec<u8>, CommandError> {
    // Only decoded pixels cross into a plugin view, never active source content.
    let image = image::DynamicImage::ImageRgba8(decode(file)?);
    let image = if image.width() > 2048 || image.height() > 2048 {
        image.thumbnail(2048, 2048)
    } else {
        image
    };
    let mut bytes = Cursor::new(Vec::new());
    image
        .write_to(&mut bytes, image::ImageFormat::Png)
        .map_err(|_| invalid())?;
    Ok(bytes.into_inner())
}

#[tauri::command]
pub async fn resource_image_preview(
    app: tauri::AppHandle,
    id: String,
) -> Result<tauri::ipc::Response, CommandError> {
    crate::storage::blocking("resource_image_preview", move || {
        preview(crate::resources::reader(&app, &id)?).map(tauri::ipc::Response::new)
    })
    .await
}

fn decode(file: File) -> Result<image::RgbaImage, CommandError> {
    if file.metadata()?.len() > MAX_ENCODED {
        return Err(invalid());
    }
    let mut reader = image::ImageReader::new(BufReader::new(file)).with_guessed_format()?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(MAX_DECODED);
    reader.limits(limits);
    let decoder = reader.into_decoder().map_err(|_| invalid())?;
    let (width, height) = decoder.dimensions();
    if u64::from(width) * u64::from(height) > MAX_PIXELS || decoder.total_bytes() > MAX_DECODED {
        return Err(invalid());
    }
    Ok(image::DynamicImage::from_decoder(decoder)
        .map_err(|_| invalid())?
        .to_rgba8())
}

#[derive(Serialize)]
pub struct ImageReceipt {
    copied: bool,
    width: u32,
    height: u32,
}

#[tauri::command]
pub async fn resource_copy_image(
    app: tauri::AppHandle,
    id: String,
) -> Result<ImageReceipt, CommandError> {
    crate::storage::blocking("resource_copy_image", move || {
        let pixels = decode(crate::resources::reader(&app, &id)?)?;
        let (width, height) = pixels.dimensions();
        app.clipboard()
            .write_image(&tauri::image::Image::new_owned(
                pixels.into_raw(),
                width,
                height,
            ))
            .map_err(|error| {
                log::warn!("Image clipboard write failed: {error}");
                CommandError::new("ui/unavailable", "Image clipboard is unavailable")
            })?;
        Ok(ImageReceipt {
            copied: true,
            width,
            height,
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Seek, SeekFrom, Write};
    fn encoded(image: image::DynamicImage, format: image::ImageFormat) -> File {
        let mut file = tempfile::tempfile().unwrap();
        image.write_to(&mut file, format).unwrap();
        file.seek(SeekFrom::Start(0)).unwrap();
        file
    }
    #[test]
    fn raster_pixels_are_decoded_without_trusting_a_filename_or_mime_hint() {
        let png = image::RgbaImage::from_pixel(2, 3, image::Rgba([10, 20, 30, 40]));
        let result = decode(encoded(png.clone().into(), image::ImageFormat::Png)).unwrap();
        assert_eq!(result, png);
        let jpeg = image::RgbImage::from_pixel(2, 3, image::Rgb([10, 20, 30]));
        assert_eq!(
            decode(encoded(jpeg.into(), image::ImageFormat::Jpeg))
                .unwrap()
                .dimensions(),
            (2, 3)
        );
    }
    #[test]
    fn malformed_and_oversized_images_fail_before_clipboard_replacement() {
        let mut bad = tempfile::tempfile().unwrap();
        bad.write_all(b"not an image").unwrap();
        bad.seek(SeekFrom::Start(0)).unwrap();
        assert!(decode(bad).is_err());
        let big = tempfile::tempfile().unwrap();
        big.set_len(MAX_ENCODED + 1).unwrap();
        assert!(decode(big).is_err());
        let wide = image::RgbaImage::new(8193, 1);
        assert!(decode(encoded(wide.into(), image::ImageFormat::Png)).is_err());
    }

    #[test]
    fn previews_are_bounded_png_pixels_and_preserve_aspect_ratio() {
        let small = image::RgbaImage::from_pixel(2, 3, image::Rgba([10, 20, 30, 40]));
        let bytes = preview(encoded(small.clone().into(), image::ImageFormat::Png)).unwrap();
        assert_eq!(
            image::guess_format(&bytes).unwrap(),
            image::ImageFormat::Png
        );
        let pixels = image::load_from_memory(&bytes).unwrap().to_rgba8();
        assert_eq!(pixels.dimensions(), small.dimensions());
        assert_eq!(pixels, small);
        let wide = image::RgbImage::from_pixel(4096, 1024, image::Rgb([10, 20, 30]));
        let bytes = preview(encoded(wide.into(), image::ImageFormat::Jpeg)).unwrap();
        let pixels = image::load_from_memory(&bytes).unwrap();
        assert_eq!((pixels.width(), pixels.height()), (2048, 512));
        let mut svg = tempfile::tempfile().unwrap();
        svg.write_all(b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>")
            .unwrap();
        svg.seek(SeekFrom::Start(0)).unwrap();
        assert!(preview(svg).is_err());
    }
}
