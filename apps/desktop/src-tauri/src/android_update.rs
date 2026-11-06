#![cfg_attr(not(target_os = "android"), allow(dead_code))]

use serde::{Deserialize, Serialize};

use crate::error::CommandError;
#[cfg(not(target_os = "android"))]
use crate::error::CODE_UPDATE_UNAVAILABLE;
#[cfg(target_os = "android")]
use crate::error::{
    CODE_UPDATE_INSTALL_FAILED, CODE_UPDATE_INVALID_RELEASE, CODE_UPDATE_NETWORK,
    CODE_UPDATE_NOT_READY,
};

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

/// The manifest found by the last check. An async mutex: commands await it
/// instead of blocking a runtime thread.
#[derive(Default)]
pub struct AndroidUpdateState(tokio::sync::Mutex<Option<AndroidUpdateManifest>>);

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
fn invalid_release(message: impl Into<String>) -> CommandError {
    CommandError::new(CODE_UPDATE_INVALID_RELEASE, message)
}

#[cfg(target_os = "android")]
fn network(context: &str, error: impl std::fmt::Display) -> CommandError {
    CommandError::new(CODE_UPDATE_NETWORK, format!("{context}: {error}"))
}

#[cfg(target_os = "android")]
fn installer(message: impl Into<String>) -> CommandError {
    CommandError::new(CODE_UPDATE_INSTALL_FAILED, message)
}

#[cfg(target_os = "android")]
fn validate_manifest(manifest: &AndroidUpdateManifest) -> Result<(), CommandError> {
    let version = semver::Version::parse(&manifest.version)
        .map_err(|err| invalid_release(format!("Invalid Android update version: {err}")))?;
    if manifest.version_code == 0 {
        return Err(invalid_release(
            "Android update versionCode must be positive",
        ));
    }
    if manifest.size == 0 || manifest.size > MAX_APK_BYTES {
        return Err(invalid_release(
            "Android update APK size is outside the allowed range",
        ));
    }
    if manifest.sha256.len() != 64
        || !manifest
            .sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(invalid_release("Android update SHA-256 is invalid"));
    }

    let url = reqwest::Url::parse(&manifest.url)
        .map_err(|err| invalid_release(format!("Invalid Android update URL: {err}")))?;
    // Release assets carry the platform in the name since v0.2.8; the legacy
    // name stays accepted so an older manifest (or a rollback) still validates.
    let expected_path = format!(
        "/ahpxex/read-aware/releases/download/v{version}/ReadAware-v{version}-android-arm64.apk"
    );
    let legacy_path =
        format!("/ahpxex/read-aware/releases/download/v{version}/ReadAware-v{version}-arm64.apk");
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || (url.path() != expected_path && url.path() != legacy_path)
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(invalid_release(
            "Android update URL does not match the expected GitHub release asset",
        ));
    }
    Ok(())
}

#[cfg(target_os = "android")]
fn client(
    current_version: &str,
    timeout: std::time::Duration,
) -> Result<reqwest::Client, CommandError> {
    // reqwest's default rustls verifier here is rustls-platform-verifier, which
    // on Android requires a JVM context that is never initialized under Tauri —
    // the first TLS handshake then panics inside the command, and a panicked
    // command never resolves its invoke (the UI sat on "checking" forever).
    // Hand reqwest a fully explicit rustls config instead: ring provider +
    // bundled Mozilla roots, which covers the GitHub release endpoints.
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let tls = rustls::ClientConfig::builder_with_provider(std::sync::Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(|err| {
        CommandError::internal(format!(
            "Failed to configure TLS for Android updates: {err}"
        ))
    })?
    .with_root_certificates(roots)
    .with_no_client_auth();
    reqwest::Client::builder()
        .tls_backend_preconfigured(tls)
        .user_agent(format!("ReadAware/{current_version}"))
        .timeout(timeout)
        .build()
        .map_err(|err| {
            CommandError::internal(format!("Failed to create Android update client: {err}"))
        })
}

/// Only manifests under our own repo's release assets may override the
/// default (the beta channel points at a specific pre-release's manifest).
#[cfg(target_os = "android")]
fn validate_manifest_source(raw: &str) -> Result<(), CommandError> {
    let url = reqwest::Url::parse(raw)
        .map_err(|err| invalid_release(format!("Invalid manifest URL: {err}")))?;
    // A versioned release or the rolling `beta` pointer release (Beta channel).
    let path_ok = url
        .path()
        .strip_prefix("/ahpxex/read-aware/releases/download/")
        .and_then(|rest| rest.split_once('/'))
        .is_some_and(|(tag, name)| {
            name == "latest-android.json"
                && (tag == "beta"
                    || tag
                        .strip_prefix('v')
                        .is_some_and(|v| v.starts_with(|c: char| c.is_ascii_digit())))
        });
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !path_ok
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(invalid_release(
            "Manifest URL does not match the expected GitHub release asset",
        ));
    }
    Ok(())
}

#[cfg(target_os = "android")]
async fn fetch_manifest(
    current_version: &str,
    manifest_url: Option<&str>,
) -> Result<AndroidUpdateManifest, CommandError> {
    let source = match manifest_url {
        Some(raw) => {
            validate_manifest_source(raw)?;
            raw
        }
        None => MANIFEST_URL,
    };
    let response = client(current_version, std::time::Duration::from_secs(15))?
        .get(source)
        .send()
        .await
        .map_err(|err| network("Failed to check for Android updates", err))?
        .error_for_status()
        .map_err(|err| network("Android update check failed", err))?;

    if response
        .content_length()
        .is_some_and(|size| size > MAX_MANIFEST_BYTES)
    {
        return Err(invalid_release("Android update manifest is too large"));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|err| network("Failed to read Android update manifest", err))?;
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err(invalid_release("Android update manifest is too large"));
    }
    let manifest: AndroidUpdateManifest = serde_json::from_slice(&bytes)
        .map_err(|err| invalid_release(format!("Invalid Android update manifest: {err}")))?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

#[cfg(target_os = "android")]
fn discard_partial(path: &std::path::Path) {
    // The next download recreates it from scratch.
    if let Err(error) = std::fs::remove_file(path) {
        log::warn!("partial Android update APK cleanup failed: {error}");
    }
}

#[cfg(target_os = "android")]
async fn download_apk(
    app: &tauri::AppHandle,
    manifest: &AndroidUpdateManifest,
) -> Result<std::path::PathBuf, CommandError> {
    use std::io::Write;

    use sha2::{Digest, Sha256};
    use tauri::Manager;

    let update_dir = app
        .path()
        .app_cache_dir()
        .map_err(|err| {
            CommandError::context(
                "Failed to locate the Android update cache",
                crate::tauri_error::tauri_error(err),
            )
        })?
        .join("updates");
    let apk_path = update_dir.join(format!("ReadAware-v{}-android-arm64.apk", manifest.version));

    // Hashing a cached APK is up to 250 MB of I/O: keep it off the runtime.
    let cached = {
        let (path, size, sha256) = (apk_path.clone(), manifest.size, manifest.sha256.clone());
        crate::storage::blocking("android_update_cache", move || {
            let Ok(bytes) = std::fs::read(&path) else {
                return Ok(false);
            };
            let digest = format!("{:x}", Sha256::digest(&bytes));
            if bytes.len() as u64 == size && digest == sha256 {
                return Ok(true);
            }
            // A stale or partial download is simply fetched again.
            discard_partial(&path);
            Ok(false)
        })
        .await?
    };
    if cached {
        return Ok(apk_path);
    }

    let current_version = app.package_info().version.to_string();
    let mut response = client(&current_version, std::time::Duration::from_secs(300))?
        .get(&manifest.url)
        .send()
        .await
        .map_err(|err| network("Failed to download the Android update", err))?
        .error_for_status()
        .map_err(|err| network("Android update download failed", err))?;
    if response
        .content_length()
        .is_some_and(|size| size != manifest.size)
    {
        return Err(invalid_release(
            "Android update download size does not match the release manifest",
        ));
    }
    std::fs::create_dir_all(&update_dir)
        .map_err(|err| CommandError::context("Failed to create the Android update cache", err))?;
    let partial_path = update_dir.join(format!("ReadAware-v{}.apk.part", manifest.version));
    let mut file = std::fs::File::create(&partial_path)
        .map_err(|err| CommandError::context("Failed to create the Android update APK", err))?;
    let mut digest = Sha256::new();
    let mut downloaded = 0u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|err| network("Failed to read the Android update APK", err))?
    {
        downloaded = downloaded.saturating_add(chunk.len() as u64);
        if downloaded > manifest.size {
            discard_partial(&partial_path);
            return Err(invalid_release(
                "Android update APK is larger than the release manifest",
            ));
        }
        file.write_all(&chunk)
            .map_err(|err| CommandError::context("Failed to save the Android update APK", err))?;
        digest.update(&chunk);
    }
    file.flush()
        .map_err(|err| CommandError::context("Failed to flush the Android update APK", err))?;
    drop(file);

    if downloaded != manifest.size {
        discard_partial(&partial_path);
        return Err(invalid_release(
            "Android update APK size does not match the release manifest",
        ));
    }
    let digest = format!("{:x}", digest.finalize());
    if digest != manifest.sha256 {
        discard_partial(&partial_path);
        return Err(invalid_release(
            "Android update APK failed SHA-256 verification",
        ));
    }
    std::fs::rename(&partial_path, &apk_path)
        .map_err(|err| CommandError::context("Failed to finalize the Android update APK", err))?;
    Ok(apk_path)
}

/// JNI into the activity runs on the main thread; the command awaits it, with
/// the same bound the old blocking wait had.
#[cfg(target_os = "android")]
async fn on_activity<T: Send + 'static>(
    app: &tauri::AppHandle,
    what: &str,
    task: impl FnOnce() -> Result<T, CommandError> + Send + 'static,
) -> Result<T, CommandError> {
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        crate::storage::on_main_thread(app, task),
    )
    .await
    .map_err(|_| installer(format!("{what} did not respond")))??
}

#[cfg(target_os = "android")]
async fn launch_installer(
    app: &tauri::AppHandle,
    apk_path: std::path::PathBuf,
) -> Result<AndroidInstallDisposition, CommandError> {
    on_activity(app, "Android package installer", move || {
        use tao::platform::android::prelude::main_android_context;

        let ctx =
            main_android_context().ok_or_else(|| installer("Android activity is not ready"))?;
        let vm = unsafe { jni::JavaVM::from_raw(ctx.java_vm.cast()) }
            .map_err(|err| installer(format!("Failed to access the Android VM: {err}")))?;
        let mut env = vm
            .attach_current_thread()
            .map_err(|err| installer(format!("Failed to attach to the Android VM: {err}")))?;
        let activity = unsafe { jni::objects::JObject::from_raw(ctx.context_jobject.cast()) };
        let path = env
            .new_string(apk_path.to_string_lossy().as_ref())
            .map_err(|err| installer(format!("Failed to prepare Android update path: {err}")))?;
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
                installer(format!(
                    "Failed to open the Android package installer: {err}"
                ))
            })?;
        let object = value
            .l()
            .map_err(|err| installer(format!("Invalid Android installer response: {err}")))?;
        if object.is_null() {
            return Err(installer("Android package installer returned no result"));
        }
        let response: String = env
            .get_string(&jni::objects::JString::from(object))
            .map_err(|err| installer(format!("Failed to read Android installer response: {err}")))?
            .into();
        match response.as_str() {
            "installer-started" => Ok(AndroidInstallDisposition::InstallerStarted),
            "permission-required" => Ok(AndroidInstallDisposition::PermissionRequired),
            value if value.starts_with("error:") => Err(installer(&value[6..])),
            _ => Err(installer(format!(
                "Unknown Android installer response: {response}"
            ))),
        }
    })
    .await
}

#[cfg(target_os = "android")]
async fn installed_version_code(app: &tauri::AppHandle) -> Result<u64, CommandError> {
    on_activity(app, "Installed Android versionCode", || {
        use tao::platform::android::prelude::main_android_context;

        let ctx =
            main_android_context().ok_or_else(|| installer("Android activity is not ready"))?;
        let vm = unsafe { jni::JavaVM::from_raw(ctx.java_vm.cast()) }
            .map_err(|err| installer(format!("Failed to access the Android VM: {err}")))?;
        let mut env = vm
            .attach_current_thread()
            .map_err(|err| installer(format!("Failed to attach to the Android VM: {err}")))?;
        let activity = unsafe { jni::objects::JObject::from_raw(ctx.context_jobject.cast()) };
        let code = env
            .call_method(&activity, "installedVersionCode", "()J", &[])
            .map_err(|err| {
                let _ = env.exception_clear();
                installer(format!(
                    "Failed to read the installed Android versionCode: {err}"
                ))
            })?
            .j()
            .map_err(|err| installer(format!("Invalid installed Android versionCode: {err}")))?;
        u64::try_from(code).map_err(|_| installer("Installed Android versionCode is invalid"))
    })
    .await
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn android_update_check(
    app: tauri::AppHandle,
    state: tauri::State<'_, AndroidUpdateState>,
    manifest_url: Option<String>,
) -> Result<Option<AvailableAndroidUpdate>, CommandError> {
    *state.0.lock().await = None;
    let current_version = app.package_info().version.to_string();
    let manifest = fetch_manifest(&current_version, manifest_url.as_deref()).await?;
    let current = semver::Version::parse(&current_version)
        .map_err(|err| CommandError::internal(format!("Invalid current app version: {err}")))?;
    let available = semver::Version::parse(&manifest.version)
        .map_err(|err| invalid_release(format!("Invalid Android update version: {err}")))?;

    if available <= current {
        return Ok(None);
    }
    let current_version_code = installed_version_code(&app).await?;
    if manifest.version_code <= current_version_code {
        return Err(invalid_release(format!(
            "Android release versionCode {} must be greater than the installed versionCode {current_version_code}",
            manifest.version_code
        )));
    }

    let update = AvailableAndroidUpdate {
        current_version,
        version: manifest.version.clone(),
    };
    *state.0.lock().await = Some(manifest);
    Ok(Some(update))
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn android_update_check(
    _state: tauri::State<'_, AndroidUpdateState>,
) -> Result<Option<AvailableAndroidUpdate>, CommandError> {
    Ok(None)
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn android_update_install(
    app: tauri::AppHandle,
    state: tauri::State<'_, AndroidUpdateState>,
) -> Result<AndroidInstallDisposition, CommandError> {
    let manifest = state.0.lock().await.clone().ok_or_else(|| {
        CommandError::new(
            CODE_UPDATE_NOT_READY,
            "No Android update is ready to install",
        )
    })?;
    let apk_path = download_apk(&app, &manifest).await?;
    launch_installer(&app, apk_path).await
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn android_update_install(
    _state: tauri::State<'_, AndroidUpdateState>,
) -> Result<AndroidInstallDisposition, CommandError> {
    Err(CommandError::new(
        CODE_UPDATE_UNAVAILABLE,
        "Android updates are unavailable on this platform",
    ))
}
