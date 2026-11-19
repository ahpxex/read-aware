//! Failure reporting for JNI calls into the Android activity.

use jni::{errors::Error, objects::JString, JNIEnv};

/// Clear the Java exception pending behind `error` and describe it.
///
/// A failed call leaves its exception pending on the thread, and every later
/// JNI call on that thread fails until it is cleared, so each failure path
/// clears it here. `error` itself only says "Java exception was thrown"; the
/// description is the throwable's `toString()` (its class and message), which
/// is what makes a device-specific failure diagnosable from the log.
pub(crate) fn take_failure(env: &mut JNIEnv, error: Error) -> String {
    let throwable = match &error {
        Error::JavaException => env.exception_occurred().ok(),
        _ => None,
    };
    let _ = env.exception_clear();
    let Some(throwable) = throwable.filter(|throwable| !throwable.is_null()) else {
        return error.to_string();
    };
    let described = env
        .call_method(&throwable, "toString", "()Ljava/lang/String;", &[])
        .and_then(|value| value.l())
        .and_then(|text| Ok(String::from(env.get_string(&JString::from(text))?)));
    match described {
        Ok(text) => text,
        Err(_) => {
            // `toString()` itself threw; keep the thread usable.
            let _ = env.exception_clear();
            error.to_string()
        }
    }
}
