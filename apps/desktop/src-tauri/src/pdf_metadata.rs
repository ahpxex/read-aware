use std::path::Path;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfMetadata {
    pub title: Option<String>,
    pub author: Option<String>,
    pub cover_url: Option<String>,
}

#[cfg(target_os = "macos")]
#[link(name = "PDFKit", kind = "framework")]
extern "C" {}

#[cfg(target_os = "macos")]
unsafe fn bitmap_has_meaningful_content(bitmap: cocoa::base::id) -> bool {
    use cocoa::base::nil;
    use objc::{msg_send, sel, sel_impl};

    if bitmap == nil {
        return false;
    }
    let is_planar: bool = msg_send![bitmap, isPlanar];
    if is_planar {
        // PDFKit normally returns an interleaved bitmap. Do not discard a
        // usable cover merely because a future macOS version changes that.
        return true;
    }
    let width: usize = msg_send![bitmap, pixelsWide];
    let height: usize = msg_send![bitmap, pixelsHigh];
    let bytes_per_row: usize = msg_send![bitmap, bytesPerRow];
    let samples_per_pixel: usize = msg_send![bitmap, samplesPerPixel];
    let data: *const u8 = msg_send![bitmap, bitmapData];
    if width == 0 || height == 0 || bytes_per_row == 0 || samples_per_pixel == 0 || data.is_null() {
        return false;
    }

    let mut samples = 0usize;
    let mut ink = 0usize;
    for y in (0..height).step_by(4) {
        for x in (0..width).step_by(4) {
            let pixel = data.add(y * bytes_per_row + x * samples_per_pixel);
            let channels = if samples_per_pixel >= 3 { 3 } else { 1 };
            let non_white = (0..channels).any(|channel| *pixel.add(channel) < 245);
            samples += 1;
            if non_white {
                ink += 1;
            }
        }
    }
    ink >= 24.max(samples / 1000)
}

#[cfg(target_os = "macos")]
unsafe fn page_thumbnail_png(page: cocoa::base::id) -> Result<Option<Vec<u8>>, String> {
    use cocoa::{base::nil, foundation::NSSize};
    use objc::{class, msg_send, sel, sel_impl};

    // PDFKit preserves the page aspect ratio inside this bound. At 480 px the
    // result is crisp on the shelf without turning import into full-page work.
    let image: cocoa::base::id = msg_send![
        page,
        thumbnailOfSize: NSSize::new(480.0, 720.0)
        forBox: 1usize
    ];
    if image == nil {
        return Ok(None);
    }
    let tiff: cocoa::base::id = msg_send![image, TIFFRepresentation];
    if tiff == nil {
        return Ok(None);
    }
    let bitmap: cocoa::base::id = msg_send![class!(NSBitmapImageRep), imageRepWithData: tiff];
    if !bitmap_has_meaningful_content(bitmap) {
        return Ok(None);
    }
    let properties: cocoa::base::id = msg_send![class!(NSDictionary), dictionary];
    // NSBitmapImageFileTypePNG = 4.
    let png: cocoa::base::id = msg_send![
        bitmap,
        representationUsingType: 4usize
        properties: properties
    ];
    if png == nil {
        return Err("PDFKit could not encode the cover thumbnail".into());
    }
    let length: usize = msg_send![png, length];
    let bytes: *const u8 = msg_send![png, bytes];
    if length == 0 || bytes.is_null() {
        return Err("PDFKit returned an empty cover thumbnail".into());
    }
    Ok(Some(std::slice::from_raw_parts(bytes, length).to_vec()))
}

#[cfg(target_os = "macos")]
pub fn extract_pdf_metadata_from_path(path: &Path) -> Result<PdfMetadata, String> {
    use cocoa::{
        base::{id, nil},
        foundation::{NSAutoreleasePool, NSString},
    };
    use objc::{class, msg_send, sel, sel_impl};

    unsafe {
        let pool = NSAutoreleasePool::new(nil);
        let result = (|| {
            let path_string: id = NSString::alloc(nil).init_str(&path.to_string_lossy());
            let url: id = msg_send![class!(NSURL), fileURLWithPath: path_string];
            let document: id = msg_send![class!(PDFDocument), alloc];
            let document: id = msg_send![document, initWithURL: url];
            let _: () = msg_send![path_string, release];
            if document == nil {
                return Err(format!("PDFKit could not open {}", path.display()));
            }

            let page_count: usize = msg_send![document, pageCount];
            let mut cover_url = None;
            let mut thumbnail_error = None;
            for index in 0..page_count.min(5) {
                let page: id = msg_send![document, pageAtIndex: index];
                if page == nil {
                    continue;
                }
                match page_thumbnail_png(page) {
                    Ok(Some(png)) => {
                        cover_url = Some(format!("data:image/png;base64,{}", STANDARD.encode(png)));
                        break;
                    }
                    Ok(None) => {}
                    Err(error) => {
                        thumbnail_error = Some(error);
                        break;
                    }
                }
            }
            let _: () = msg_send![document, release];
            if let Some(error) = thumbnail_error {
                return Err(error);
            }
            Ok(PdfMetadata {
                title: None,
                author: None,
                cover_url,
            })
        })();
        pool.drain();
        result
    }
}

#[cfg(not(target_os = "macos"))]
pub fn extract_pdf_metadata_from_path(_path: &Path) -> Result<PdfMetadata, String> {
    Err("Native PDF cover extraction is not available on this platform".into())
}

#[tauri::command]
pub async fn extract_pdf_metadata(path: String) -> Result<PdfMetadata, String> {
    tauri::async_runtime::spawn_blocking(move || extract_pdf_metadata_from_path(Path::new(&path)))
        .await
        .map_err(|error| format!("extract_pdf_metadata task failed: {error}"))?
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use std::{fs::File, io::Write};
    use tempfile::tempdir;

    fn minimal_pdf() -> Vec<u8> {
        let stream = b"0 0 0 rg 20 20 160 260 re f\n";
        let objects = [
            b"<< /Type /Catalog /Pages 2 0 R >>".to_vec(),
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_vec(),
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /CropBox [0 0 200 300] /Resources << >> /Contents 4 0 R >>".to_vec(),
            [
                format!("<< /Length {} >>\nstream\n", stream.len()).into_bytes(),
                stream.to_vec(),
                b"endstream".to_vec(),
            ]
            .concat(),
        ];
        let mut pdf = b"%PDF-1.4\n".to_vec();
        let mut offsets = Vec::new();
        for (index, object) in objects.iter().enumerate() {
            offsets.push(pdf.len());
            write!(pdf, "{} 0 obj\n", index + 1).unwrap();
            pdf.extend(object);
            pdf.extend(b"\nendobj\n");
        }
        let xref = pdf.len();
        write!(pdf, "xref\n0 {}\n", objects.len() + 1).unwrap();
        pdf.extend(b"0000000000 65535 f \n");
        for offset in offsets {
            writeln!(pdf, "{offset:010} 00000 n ").unwrap();
        }
        write!(
            pdf,
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            objects.len() + 1
        )
        .unwrap();
        pdf
    }

    #[test]
    fn renders_a_bounded_png_cover_with_pdfkit() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("cover.pdf");
        File::create(&path)
            .unwrap()
            .write_all(&minimal_pdf())
            .unwrap();

        let metadata = extract_pdf_metadata_from_path(&path).unwrap();
        let cover = metadata.cover_url.expect("PDF cover");
        assert!(cover.starts_with("data:image/png;base64,iVBORw0K"));
        assert!(cover.len() > 200);
    }
}
