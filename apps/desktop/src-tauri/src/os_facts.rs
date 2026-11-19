//! Build and operating-system facts for the diagnostics bundle.
//!
//! The webview's user agent cannot carry them: desktop engines freeze the OS
//! version in it (WebKit always says macOS 10.15.7, WebView2 says Windows NT
//! 10.0), it never says whether the build is a minified release, and on
//! Android it shows the compatibility level a HarmonyOS device reports, not
//! the system it runs. Every field is what the platform answered, or `None`
//! when it would not; nothing is inferred here.

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OsFacts {
    /// `release` or `debug`. Release Android builds are minified by R8 and
    /// fail where unminified dev builds work, so a report must say which.
    pub build_profile: &'static str,
    /// Rust's name for the OS and CPU the binary was built for.
    pub os: &'static str,
    pub arch: &'static str,
    /// Product version: `15.1` (macOS/iOS), `12` (Android),
    /// `Windows 10 Pro 23H2` (Windows, whose product name stays "Windows 10"
    /// on Windows 11 — `os_build` 22000+ tells them apart), the distribution
    /// name on Linux.
    pub os_version: Option<String>,
    /// Build number: Apple's `24B83`, Windows' `22631.4460`, the Linux kernel.
    pub os_build: Option<String>,
    pub android: Option<AndroidFacts>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidFacts {
    /// `Build.VERSION.SDK_INT`: behavior gates on this, not on `release`.
    pub sdk_int: Option<i32>,
    pub manufacturer: String,
    pub brand: String,
    pub model: String,
    /// The raw `hw_sc.build.platform.version` system property, which Huawei's
    /// HarmonyOS 2–4 builds are documented to set to their HarmonyOS version.
    /// Reported as read (`None` when absent); not verified on a device.
    pub harmony_os_property: Option<String>,
}

pub fn read() -> OsFacts {
    let (os_version, os_build) = platform_version();
    OsFacts {
        build_profile: if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        },
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        os_version,
        os_build,
        android: android_facts(),
    }
}

fn non_empty(value: String) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_owned())
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn platform_version() -> (Option<String>, Option<String>) {
    (
        apple_sysctl("kern.osproductversion"),
        apple_sysctl("kern.osversion"),
    )
}

/// A string-valued `sysctl`, read in two calls: size, then value.
#[cfg(any(target_os = "macos", target_os = "ios"))]
fn apple_sysctl(name: &str) -> Option<String> {
    let name = std::ffi::CString::new(name).ok()?;
    let mut size = 0usize;
    // SAFETY: a null buffer asks for the value's size; `name` is NUL-terminated.
    let sized = unsafe {
        libc::sysctlbyname(
            name.as_ptr(),
            std::ptr::null_mut(),
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    if sized != 0 || size == 0 {
        return None;
    }
    let mut buffer = vec![0u8; size];
    // SAFETY: `buffer` holds `size` writable bytes, and `size` is updated to
    // the length written.
    let read = unsafe {
        libc::sysctlbyname(
            name.as_ptr(),
            buffer.as_mut_ptr().cast(),
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    if read != 0 {
        return None;
    }
    buffer.truncate(size);
    let text = String::from_utf8_lossy(&buffer);
    non_empty(text.trim_end_matches('\0').to_owned())
}

#[cfg(target_os = "windows")]
fn platform_version() -> (Option<String>, Option<String>) {
    use winreg::{enums::HKEY_LOCAL_MACHINE, RegKey};
    let Ok(key) = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion")
    else {
        return (None, None);
    };
    let text = |name: &str| key.get_value::<String, _>(name).ok().and_then(non_empty);
    let version = match (text("ProductName"), text("DisplayVersion")) {
        (Some(product), Some(display)) => Some(format!("{product} {display}")),
        (product, _) => product,
    };
    let build = text("CurrentBuild").map(|build| match key.get_value::<u32, _>("UBR") {
        Ok(revision) => format!("{build}.{revision}"),
        Err(_) => build,
    });
    (version, build)
}

#[cfg(target_os = "linux")]
fn platform_version() -> (Option<String>, Option<String>) {
    let distribution = std::fs::read_to_string("/etc/os-release")
        .ok()
        .and_then(|release| os_release_pretty_name(&release));
    (distribution, kernel_release())
}

/// `PRETTY_NAME` from an os-release file, unquoted.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn os_release_pretty_name(release: &str) -> Option<String> {
    release.lines().find_map(|line| {
        let value = line.strip_prefix("PRETTY_NAME=")?;
        non_empty(value.trim().trim_matches(['"', '\'']).to_owned())
    })
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn kernel_release() -> Option<String> {
    // SAFETY: `uname` fills a zeroed `utsname` whose fields are NUL-terminated.
    let mut name: libc::utsname = unsafe { std::mem::zeroed() };
    if unsafe { libc::uname(&mut name) } != 0 {
        return None;
    }
    let release = unsafe { std::ffi::CStr::from_ptr(name.release.as_ptr()) };
    non_empty(release.to_string_lossy().into_owned())
}

#[cfg(target_os = "android")]
fn platform_version() -> (Option<String>, Option<String>) {
    let release = with_build_env(|env| build_version_string(env, "RELEASE")).flatten();
    (release, kernel_release())
}

#[cfg(not(any(
    target_os = "macos",
    target_os = "ios",
    target_os = "windows",
    target_os = "linux",
    target_os = "android"
)))]
fn platform_version() -> (Option<String>, Option<String>) {
    (None, None)
}

#[cfg(target_os = "android")]
fn with_build_env<T>(read: impl FnOnce(&mut jni::JNIEnv) -> T) -> Option<T> {
    use tao::platform::android::prelude::main_android_context;
    let ctx = main_android_context()?;
    let vm = unsafe { jni::JavaVM::from_raw(ctx.java_vm.cast()) }.ok()?;
    let mut env = vm.attach_current_thread().ok()?;
    Some(read(&mut env))
}

#[cfg(target_os = "android")]
fn build_version_string(env: &mut jni::JNIEnv, field: &str) -> Option<String> {
    let value = env
        .get_static_field("android/os/Build$VERSION", field, "Ljava/lang/String;")
        .and_then(|value| value.l());
    match value {
        Ok(object) if !object.is_null() => env
            .get_string(&jni::objects::JString::from(object))
            .ok()
            .and_then(|text| non_empty(text.into())),
        Ok(_) => None,
        Err(err) => {
            let failure = crate::android_jni::take_failure(env, err);
            log::warn!("os_facts: Build.VERSION.{field} unreadable: {failure}");
            None
        }
    }
}

#[cfg(target_os = "android")]
fn android_facts() -> Option<AndroidFacts> {
    use crate::display_profile::build_field;
    let mut facts = with_build_env(|env| {
        let sdk_int = match env
            .get_static_field("android/os/Build$VERSION", "SDK_INT", "I")
            .and_then(|value| value.i())
        {
            Ok(level) => Some(level),
            Err(err) => {
                let failure = crate::android_jni::take_failure(env, err);
                log::warn!("os_facts: Build.VERSION.SDK_INT unreadable: {failure}");
                None
            }
        };
        AndroidFacts {
            sdk_int,
            manufacturer: build_field(env, "MANUFACTURER"),
            brand: build_field(env, "BRAND"),
            model: build_field(env, "MODEL"),
            harmony_os_property: None,
        }
    })?;
    facts.harmony_os_property = system_property("hw_sc.build.platform.version");
    Some(facts)
}

#[cfg(not(target_os = "android"))]
fn android_facts() -> Option<AndroidFacts> {
    None
}

/// One system property through `getprop`, which an app process may run.
#[cfg(target_os = "android")]
fn system_property(name: &str) -> Option<String> {
    match std::process::Command::new("/system/bin/getprop")
        .arg(name)
        .output()
    {
        Ok(output) if output.status.success() => {
            non_empty(String::from_utf8_lossy(&output.stdout).into_owned())
        }
        Ok(output) => {
            log::warn!("os_facts: getprop {name} exited with {}", output.status);
            None
        }
        Err(err) => {
            log::warn!("os_facts: getprop {name} failed: {err}");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_this_build_and_host() {
        let facts = read();
        assert_eq!(facts.build_profile, "debug");
        assert_eq!(facts.os, std::env::consts::OS);
        assert!(facts.android.is_none());
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        assert!(facts.os_version.is_some(), "{facts:?}");
    }

    #[test]
    fn os_release_pretty_name_is_unquoted() {
        let release = "NAME=\"Ubuntu\"\nPRETTY_NAME=\"Ubuntu 24.04.1 LTS\"\nID=ubuntu\n";
        assert_eq!(
            os_release_pretty_name(release).as_deref(),
            Some("Ubuntu 24.04.1 LTS")
        );
        assert_eq!(os_release_pretty_name("ID=arch\n"), None);
        assert_eq!(os_release_pretty_name("PRETTY_NAME=\"\"\n"), None);
    }
}
