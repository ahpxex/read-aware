//! What kind of panel the device draws on, for the web layer's e-ink default
//! (`apps/web/src/platform/display-profile.ts` decides; this only reports).
//!
//! Android has no "this is an e-paper display" API. Two kinds of evidence
//! exist: the build identity (`android.os.Build`), which names vendors that
//! only make e-paper devices, and system properties that e-paper display
//! stacks define for their refresh modes. Both are reported as found; the
//! classification lives in one place on the web side.

#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DisplayProfile {
    manufacturer: String,
    brand: String,
    model: String,
    device: String,
    /// Names of system properties whose dotted name carries an `eink`/`epd`
    /// segment — the namespace e-paper display stacks use for their refresh
    /// controls.
    epd_properties: Vec<String>,
}

/// Whether a system property name belongs to an e-paper display stack: one of
/// its `.`/`_`-separated segments is `eink`/`epd`, or starts with one
/// (`einkmode`, `epdc`). Whole segments only, so `keypad` or `deepdive`
/// never match.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn is_epd_property(name: &str) -> bool {
    name.split(['.', '_', '-'])
        .map(str::to_ascii_lowercase)
        .any(|segment| segment.starts_with("eink") || segment.starts_with("epd"))
}

/// The property names in `getprop`'s `[name]: [value]` listing that
/// `is_epd_property` accepts, sorted and deduplicated.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn epd_properties_in(listing: &str) -> Vec<String> {
    let mut names: Vec<String> = listing
        .lines()
        .filter_map(|line| {
            line.strip_prefix('[')?
                .split_once(']')
                .map(|(name, _)| name)
        })
        .filter(|name| is_epd_property(name))
        .map(str::to_owned)
        .collect();
    names.sort();
    names.dedup();
    names
}

#[cfg(target_os = "android")]
fn build_field(env: &mut jni::JNIEnv, field: &str) -> String {
    let read = |env: &mut jni::JNIEnv| -> jni::errors::Result<String> {
        let value = env
            .get_static_field("android/os/Build", field, "Ljava/lang/String;")?
            .l()?;
        if value.is_null() {
            return Ok(String::new());
        }
        Ok(env.get_string(&jni::objects::JString::from(value))?.into())
    };
    read(env).unwrap_or_else(|err| {
        log::warn!("display_profile: Build.{field} unreadable: {err}");
        let _ = env.exception_clear();
        String::new()
    })
}

/// Build identity through JNI (static fields: no activity, permission or UI
/// thread needed) and the e-paper property names from `getprop`, which an
/// app process may run. Either half failing leaves its fields empty: the web
/// side then simply does not detect e-ink, and the user's toggle still works.
#[cfg(target_os = "android")]
#[tauri::command]
pub(crate) async fn display_profile() -> Option<DisplayProfile> {
    use tao::platform::android::prelude::main_android_context;
    let Some(ctx) = main_android_context() else {
        log::warn!("display_profile: no android context yet");
        return None;
    };
    let vm = unsafe { jni::JavaVM::from_raw(ctx.java_vm.cast()) }
        .map_err(|err| log::error!("display_profile: no JVM: {err}"))
        .ok()?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|err| log::error!("display_profile: JVM attach failed: {err}"))
        .ok()?;
    let mut profile = DisplayProfile {
        manufacturer: build_field(&mut env, "MANUFACTURER"),
        brand: build_field(&mut env, "BRAND"),
        model: build_field(&mut env, "MODEL"),
        device: build_field(&mut env, "DEVICE"),
        epd_properties: Vec::new(),
    };
    match std::process::Command::new("/system/bin/getprop").output() {
        Ok(output) if output.status.success() => {
            profile.epd_properties = epd_properties_in(&String::from_utf8_lossy(&output.stdout));
        }
        Ok(output) => log::warn!("display_profile: getprop exited with {}", output.status),
        Err(err) => log::warn!("display_profile: getprop failed: {err}"),
    }
    Some(profile)
}

/// Only Android reports a panel kind; elsewhere the command resolves to
/// nothing (the web layer does not ask off Android).
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub(crate) fn display_profile() -> Option<DisplayProfile> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epd_segments_match_and_lookalikes_do_not() {
        assert!(is_epd_property("sys.eink.mode"));
        assert!(is_epd_property("persist.sys.einkmode"));
        assert!(is_epd_property("ro.epdc.waveform"));
        assert!(is_epd_property("vendor_EPD_refresh"));
        assert!(!is_epd_property("ro.hardware.keypad"));
        assert!(!is_epd_property("persist.deepdive"));
        assert!(!is_epd_property("ro.product.model"));
    }

    #[test]
    fn getprop_listing_yields_sorted_unique_names() {
        let listing = "[ro.product.model]: [Ocean 4]\n\
                       [sys.eink.mode]: [1]\n\
                       garbage line\n\
                       [ro.epd.panel]: [ED103]\n\
                       [sys.eink.mode]: [1]\n";
        assert_eq!(
            epd_properties_in(listing),
            vec!["ro.epd.panel", "sys.eink.mode"]
        );
    }
}
