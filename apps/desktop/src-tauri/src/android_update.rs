#![cfg_attr(not(target_os = "android"), allow(dead_code))]

use std::sync::Mutex;

use serde::{Deserialize, Serialize};

const MANIFEST_URL: &str =
    "https://github.com/ahpxex/read-aware/releases/latest/download/latest-android.json";
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_APK_BYTES: u64 = 250 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AndroidUpdateManifest {
    version: String,
    version_code: u64,
    url: String,
    sha256: String,
    size: u64,
}

#[derive(Default)]
pub struct AndroidUpdateState(Mutex<Option<AndroidUpdateManifest>>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableAndroidUpdate {
    current_version: String,
    version: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AndroidInstallDisposition {
    InstallerStarted,
    PermissionRequired,
}

#[cfg(target_os = "android")]
fn validate_manifest(manifest: &AndroidUpdateManifest) -> Result<(), String> {
    let version = semver::Version::parse(&manifest.version)
        .map_err(|err| format!("Invalid Android update version: {err}"))?;
    if manifest.version_code == 0 {
        return Err("Android update versionCode must be positive".into());
    }
    if manifest.size == 0 || manifest.size > MAX_APK_BYTES {
        return Err("Android update APK size is outside the allowed range".into());
    }
    if manifest.sha256.len() != 64
        || !manifest
            .sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("Android update SHA-256 is invalid".into());
    }

    let url = reqwest::Url::parse(&manifest.url)
        .map_err(|err| format!("Invalid Android update URL: {err}"))?;
    let expected_path =
        format!("/ahpxex/read-aware/releases/download/v{version}/ReadAware-v{version}-arm64.apk");
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || url.path() != expected_path
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Android update URL does not match the expected GitHub release asset".into());
    }
    Ok(())
}

#[cfg(target_os = "android")]
fn client(current_version: &str, timeout: std::time::Duration) -> Result<reqwest::Client, String> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder()
        .user_agent(format!("ReadAware/{current_version}"))
        .timeout(timeout)
        .build()
        .map_err(|err| format!("Failed to create Android update client: {err}"))
}

#[cfg(target_os = "android")]
async fn fetch_manifest(current_version: &str) -> Result<AndroidUpdateManifest, String> {
    let response = client(current_version, std::time::Duration::from_secs(15))?
        .get(MANIFEST_URL)
        .send()
        .await
        .map_err(|err| format!("Failed to check for Android updates: {err}"))?
        .error_for_status()
        .map_err(|err| format!("Android update check failed: {err}"))?;

    if response
        .content_length()
        .is_some_and(|size| size > MAX_MANIFEST_BYTES)
    {
        return Err("Android update manifest is too large".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|err| format!("Failed to read Android update manifest: {err}"))?;
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err("Android update manifest is too large".into());
    }
    let manifest: AndroidUpdateManifest = serde_json::from_slice(&bytes)
        .map_err(|err| format!("Invalid Android update manifest: {err}"))?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

#[cfg(target_os = "android")]
async fn download_apk(
    app: &tauri::AppHandle,
    manifest: &AndroidUpdateManifest,
) -> Result<std::path::PathBuf, String> {
    use std::io::Write;

    use sha2::{Digest, Sha256};
    use tauri::Manager;

    let update_dir = app
        .path()
        .app_cache_dir()
        .map_err(|err| format!("Failed to locate the Android update cache: {err}"))?
        .join("updates");
    let apk_path = update_dir.join(format!("ReadAware-v{}-arm64.apk", manifest.version));

    if let Ok(bytes) = std::fs::read(&apk_path) {
        let digest = format!("{:x}", Sha256::digest(&bytes));
        if bytes.len() as u64 == manifest.size && digest == manifest.sha256 {
            return Ok(apk_path);
        }
        let _ = std::fs::remove_file(&apk_path);
    }

    let current_version = app.package_info().version.to_string();
    let mut response = client(&current_version, std::time::Duration::from_secs(300))?
        .get(&manifest.url)
        .send()
        .await
        .map_err(|err| format!("Failed to download the Android update: {err}"))?
        .error_for_status()
        .map_err(|err| format!("Android update download failed: {err}"))?;
    if response
        .content_length()
        .is_some_and(|size| size != manifest.size)
    {
        return Err("Android update download size does not match the release manifest".into());
    }
    std::fs::create_dir_all(&update_dir)
        .map_err(|err| format!("Failed to create the Android update cache: {err}"))?;
    let partial_path = update_dir.join(format!("ReadAware-v{}.apk.part", manifest.version));
    let mut file = std::fs::File::create(&partial_path)
        .map_err(|err| format!("Failed to create the Android update APK: {err}"))?;
    let mut digest = Sha256::new();
    let mut downloaded = 0u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|err| format!("Failed to read the Android update APK: {err}"))?
    {
        downloaded = downloaded.saturating_add(chunk.len() as u64);
        if downloaded > manifest.size {
            let _ = std::fs::remove_file(&partial_path);
            return Err("Android update APK is larger than the release manifest".into());
        }
        file.write_all(&chunk)
            .map_err(|err| format!("Failed to save the Android update APK: {err}"))?;
        digest.update(&chunk);
    }
    file.flush()
        .map_err(|err| format!("Failed to flush the Android update APK: {err}"))?;
    drop(file);

    if downloaded != manifest.size {
        let _ = std::fs::remove_file(&partial_path);
        return Err("Android update APK size does not match the release manifest".into());
    }
    let digest = format!("{:x}", digest.finalize());
    if digest != manifest.sha256 {
        let _ = std::fs::remove_file(&partial_path);
        return Err("Android update APK failed SHA-256 verification".into());
    }
    std::fs::rename(&partial_path, &apk_path)
        .map_err(|err| format!("Failed to finalize the Android update APK: {err}"))?;
    Ok(apk_path)
}

#[cfg(target_os = "android")]
fn launch_installer(
    app: tauri::AppHandle,
    apk_path: std::path::PathBuf,
) -> Result<AndroidInstallDisposition, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let result = (|| {
            use tao::platform::android::prelude::main_android_context;

            let ctx = main_android_context().ok_or("Android activity is not ready")?;
            let vm = unsafe { jni::JavaVM::from_raw(ctx.java_vm.cast()) }
                .map_err(|err| format!("Failed to access the Android VM: {err}"))?;
            let mut env = vm
                .attach_current_thread()
                .map_err(|err| format!("Failed to attach to the Android VM: {err}"))?;
            let activity = unsafe { jni::objects::JObject::from_raw(ctx.context_jobject.cast()) };
            let path = env
                .new_string(apk_path.to_string_lossy().as_ref())
                .map_err(|err| format!("Failed to prepare Android update path: {err}"))?;
            let path_object = jni::objects::JObject::from(path);
            let value = env
                .call_method(
                    &activity,
                    "installUpdateApk",
                    "(Ljava/lang/String;)Ljava/lang/String;",
                    &[jni::objects::JValue::Object(&path_object)],
                )
                .map_err(|err| {
                    let _ = env.exception_clear();
                    format!("Failed to open the Android package installer: {err}")
                })?;
            let object = value
                .l()
                .map_err(|err| format!("Invalid Android installer response: {err}"))?;
            if object.is_null() {
                return Err("Android package installer returned no result".into());
            }
            let response: String = env
                .get_string(&jni::objects::JString::from(object))
                .map_err(|err| format!("Failed to read Android installer response: {err}"))?
                .into();
            match response.as_str() {
                "installer-started" => Ok(AndroidInstallDisposition::InstallerStarted),
                "permission-required" => Ok(AndroidInstallDisposition::PermissionRequired),
                value if value.starts_with("error:") => Err(value[6..].to_string()),
                _ => Err(format!("Unknown Android installer response: {response}")),
            }
        })();
        let _ = tx.send(result);
    })
    .map_err(|err| err.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|err| format!("Android package installer did not respond: {err}"))?
}

#[cfg(target_os = "android")]
fn installed_version_code(app: tauri::AppHandle) -> Result<u64, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let result = (|| {
            use tao::platform::android::prelude::main_android_context;

            let ctx = main_android_context().ok_or("Android activity is not ready")?;
            let vm = unsafe { jni::JavaVM::from_raw(ctx.java_vm.cast()) }
                .map_err(|err| format!("Failed to access the Android VM: {err}"))?;
            let mut env = vm
                .attach_current_thread()
                .map_err(|err| format!("Failed to attach to the Android VM: {err}"))?;
            let activity = unsafe { jni::objects::JObject::from_raw(ctx.context_jobject.cast()) };
            let code = env
                .call_method(&activity, "installedVersionCode", "()J", &[])
                .map_err(|err| {
                    let _ = env.exception_clear();
                    format!("Failed to read the installed Android versionCode: {err}")
                })?
                .j()
                .map_err(|err| format!("Invalid installed Android versionCode: {err}"))?;
            u64::try_from(code).map_err(|_| "Installed Android versionCode is invalid".into())
        })();
        let _ = tx.send(result);
    })
    .map_err(|err| err.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|err| format!("Installed Android versionCode did not respond: {err}"))?
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn android_update_check(
    app: tauri::AppHandle,
    state: tauri::State<'_, AndroidUpdateState>,
) -> Result<Option<AvailableAndroidUpdate>, String> {
    *state.0.lock().map_err(|err| err.to_string())? = None;
    let current_version = app.package_info().version.to_string();
    let manifest = fetch_manifest(&current_version).await?;
    let current = semver::Version::parse(&current_version)
        .map_err(|err| format!("Invalid current app version: {err}"))?;
    let available = semver::Version::parse(&manifest.version)
        .map_err(|err| format!("Invalid Android update version: {err}"))?;

    if available <= current {
        return Ok(None);
    }
    let current_version_code = installed_version_code(app.clone())?;
    if manifest.version_code <= current_version_code {
        return Err(format!(
            "Android release versionCode {} must be greater than the installed versionCode {current_version_code}",
            manifest.version_code
        ));
    }

    let update = AvailableAndroidUpdate {
        current_version,
        version: manifest.version.clone(),
    };
    *state.0.lock().map_err(|err| err.to_string())? = Some(manifest);
    Ok(Some(update))
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn android_update_check(
    _state: tauri::State<'_, AndroidUpdateState>,
) -> Result<Option<AvailableAndroidUpdate>, String> {
    Ok(None)
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn android_update_install(
    app: tauri::AppHandle,
    state: tauri::State<'_, AndroidUpdateState>,
) -> Result<AndroidInstallDisposition, String> {
    let manifest = state
        .0
        .lock()
        .map_err(|err| err.to_string())?
        .clone()
        .ok_or("No Android update is ready to install")?;
    let apk_path = download_apk(&app, &manifest).await?;
    launch_installer(app, apk_path)
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn android_update_install(
    _state: tauri::State<'_, AndroidUpdateState>,
) -> Result<AndroidInstallDisposition, String> {
    Err("Android updates are unavailable on this platform".into())
}
