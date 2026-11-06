//! JavaScript execution in webview.

use super::script_executor::ScriptExecutor;
use crate::logging::mcp_log_error;
use serde_json::Value;
use std::time::Duration;
use tauri::{command, Listener, Runtime, State, WebviewWindow};
use tokio::sync::oneshot;
use uuid::Uuid;

/// Executes JavaScript code in the webview context.
///
/// On macOS, uses WKWebView's native evaluateJavaScript:completionHandler:
/// to get results directly via the completion handler, bypassing the
/// eval-and-IPC-callback approach which fails on some setups.
///
/// On other platforms, falls back to the eval + event listener approach.
#[command]
pub async fn execute_js<R: Runtime>(
    window: WebviewWindow<R>,
    script: String,
    state: State<'_, ScriptExecutor>,
    timeout: Option<u64>,
) -> Result<Value, String> {
    let timeout = Duration::from_millis(timeout.unwrap_or(5_000));
    // Synchronous macOS scripts return through the native completion handler.
    #[cfg(target_os = "macos")]
    {
        let prepared_script = prepare_script(&script);

        // Wrap the user script to return a JSON string.
        // Avoid async/await here since WKWebView's evaluateJavaScript
        // doesn't handle Promise results well in the completion handler.
        let wrapped_script = format!(
            r#"
            (function() {{
                try {{
                    var __result = (function() {{ {prepared_script} }})();
                    return __result !== undefined ? JSON.stringify(__result) : "null";
                }} catch (error) {{
                    return JSON.stringify({{ "__mcp_error__": error.message || String(error) }});
                }}
            }})()
            "#
        );

        if should_use_native_evaluation(&script) {
            // Do not retry a native failure: the script may already have made changes.
            return native_evaluate_js(&window, &wrapped_script, timeout).await;
        }
    }

    // Async scripts and other platforms return through IPC.
    eval_with_ipc_callback(&window, &script, &state, timeout).await
}

/// macOS: Use WKWebView's evaluateJavaScript:completionHandler: directly
/// to get results without needing IPC callbacks.
#[cfg(target_os = "macos")]
async fn native_evaluate_js<R: Runtime>(
    window: &WebviewWindow<R>,
    script: &str,
    timeout: Duration,
) -> Result<Value, String> {
    use block2::RcBlock;
    use objc2_foundation::{NSError, NSString};
    use objc2_web_kit::WKWebView;
    use std::sync::{Arc, Mutex};

    let (tx, rx) = oneshot::channel::<Result<Value, String>>();
    let tx = Arc::new(Mutex::new(Some(tx)));

    let script_ns = NSString::from_str(script);
    let script_ptr = Arc::new(script_ns);

    let script_for_closure = Arc::clone(&script_ptr);

    window
        .with_webview(move |webview| {
            unsafe {
                let wkwebview: &WKWebView = &*(webview.inner() as *const _ as *const WKWebView);

                let tx_clone = tx.clone();
                let handler = RcBlock::new(
                    move |result: *mut objc2::runtime::AnyObject, error: *mut NSError| {
                        if let Some(tx) = tx_clone.lock().unwrap().take() {
                            if !error.is_null() {
                                let err = &*error;
                                let desc = err.localizedDescription();
                                let _ = tx.send(Err(desc.to_string()));
                            } else if !result.is_null() {
                                let result_str = result_to_string(result);
                                match result_str {
                                    Some(s) => {
                                        // Check for error sentinel
                                        if let Ok(val) = serde_json::from_str::<Value>(&s) {
                                            if let Some(err) =
                                                val.get("__mcp_error__").and_then(|v| v.as_str())
                                            {
                                                let _ = tx.send(Ok(serde_json::json!({
                                                    "success": false,
                                                    "error": err
                                                })));
                                            } else {
                                                let _ = tx.send(Ok(serde_json::json!({
                                                    "success": true,
                                                    "data": val
                                                })));
                                            }
                                        } else {
                                            let _ = tx.send(Ok(serde_json::json!({
                                                "success": true,
                                                "data": s
                                            })));
                                        }
                                    }
                                    None => {
                                        let _ = tx.send(Ok(serde_json::json!({
                                            "success": true,
                                            "data": null
                                        })));
                                    }
                                }
                            } else {
                                let _ = tx.send(Ok(serde_json::json!({
                                    "success": true,
                                    "data": null
                                })));
                            }
                        }
                    },
                );

                wkwebview.evaluateJavaScript_completionHandler(&script_for_closure, Some(&handler));
            }
        })
        .map_err(|e| format!("Failed to access webview: {e}"))?;

    match tokio::time::timeout(timeout, rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("Native script callback closed".to_string()),
        Err(_) => Err(format!(
            "Script execution timeout after {}ms (native)",
            timeout.as_millis()
        )),
    }
}

/// Convert an ObjC result object to a Rust String.
#[cfg(target_os = "macos")]
unsafe fn result_to_string(obj: *mut objc2::runtime::AnyObject) -> Option<String> {
    use objc2_foundation::NSString;

    if obj.is_null() {
        return None;
    }

    // Try to get description (works for NSString, NSNumber, etc.)
    let desc: *mut NSString = objc2::msg_send![obj, description];
    if !desc.is_null() {
        Some((*desc).to_string())
    } else {
        None
    }
}

#[cfg(target_os = "macos")]
fn should_use_native_evaluation(script: &str) -> bool {
    let trimmed = script.trim();

    !trimmed.contains("await ")
        && !trimmed.contains("async ")
        && !trimmed.contains("(async")
        && !trimmed.contains(".then(")
        && !trimmed.contains("Promise.")
        && !trimmed.contains("new Promise(")
}

/// Fallback: eval + IPC event listener approach.
/// Used on non-macOS platforms.
async fn eval_with_ipc_callback<R: Runtime>(
    window: &WebviewWindow<R>,
    script: &str,
    state: &State<'_, ScriptExecutor>,
    timeout: Duration,
) -> Result<Value, String> {
    let exec_id = Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel();

    {
        let mut pending = state.pending_results.lock().await;
        pending.insert(exec_id.clone(), tx);
    }

    let exec_id_clone = exec_id.clone();
    let pending_clone = state.pending_results.clone();

    let unlisten = window.listen("__script_result", move |event| {
        let raw_payload = event.payload();
        match serde_json::from_str::<serde_json::Map<String, Value>>(raw_payload) {
            Ok(payload) => {
                if let Some(Value::String(event_exec_id)) = payload.get("exec_id") {
                    if event_exec_id == &exec_id_clone {
                        let pending = pending_clone.clone();
                        let payload = payload.clone();
                        let exec_id_for_task = exec_id_clone.clone();
                        tokio::spawn(async move {
                            let mut pending_guard = pending.lock().await;
                            if let Some(sender) = pending_guard.remove(&exec_id_for_task) {
                                let result = if payload
                                    .get("success")
                                    .and_then(|v| v.as_bool())
                                    .unwrap_or(false)
                                {
                                    serde_json::json!({
                                        "success": true,
                                        "data": payload.get("data").cloned().unwrap_or(Value::Null)
                                    })
                                } else {
                                    serde_json::json!({
                                        "success": false,
                                        "error": payload.get("error")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("Unknown error")
                                    })
                                };
                                let _ = sender.send(result);
                            }
                        });
                    }
                }
            }
            Err(e) => {
                mcp_log_error(
                    "EXECUTE_JS",
                    &format!("Failed to parse __script_result payload: {e}. Raw: {raw_payload}"),
                );
            }
        }
    });

    let prepared_script = prepare_script(script);

    let wrapped_script = format!(
        r#"
        (function() {{
            function __sendResult(success, data, error) {{
                try {{
                    if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {{
                        window.__TAURI__.core.invoke('plugin:mcp-bridge|script_result', {{
                            execId: '{exec_id}',
                            success: success,
                            data: data !== undefined ? data : null,
                            error: error
                        }}).catch(function(e) {{
                            console.error('[MCP] Failed to invoke script_result:', e);
                        }});
                    }} else if (window.__TAURI__ && window.__TAURI__.event) {{
                        window.__TAURI__.event.emit('__script_result', {{
                            exec_id: '{exec_id}',
                            success: success,
                            data: data,
                            error: error
                        }});
                    }} else {{
                        console.error('[MCP] __TAURI__ not available, cannot send result');
                    }}
                }} catch (e) {{
                    console.error('[MCP] Failed to send result:', e);
                }}
            }}

            (async () => {{
                try {{
                    const __executeScript = async () => {{
                        {prepared_script}
                    }};
                    const __result = await __executeScript();
                    __sendResult(true, __result !== undefined ? __result : null, null);
                }} catch (error) {{
                    __sendResult(false, null, error.message || String(error));
                }}
            }})().catch(function(error) {{
                __sendResult(false, null, error.message || String(error));
            }});
        }})();
        "#
    );

    let result = if let Err(error) = window.eval(&wrapped_script) {
        Err(format!("Failed to execute script: {error}"))
    } else {
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(result)) => Ok(result),
            Ok(Err(_)) => Err("Script result channel closed".to_string()),
            Err(_) => Err(format!(
                "Script execution timeout after {}ms (bridge)",
                timeout.as_millis()
            )),
        }
    };

    window.unlisten(unlisten);
    state.pending_results.lock().await.remove(&exec_id);
    result
}

/// Prepare script by adding return statement if needed.
fn prepare_script(script: &str) -> String {
    let trimmed = script.trim();
    let needs_return = !trimmed.starts_with("return ");

    let has_real_semicolons = if let Some(without_trailing) = trimmed.strip_suffix(';') {
        without_trailing.contains(';')
    } else {
        trimmed.contains(';')
    };

    let is_multi_statement = has_real_semicolons
        || trimmed.starts_with("const ")
        || trimmed.starts_with("let ")
        || trimmed.starts_with("var ")
        || trimmed.starts_with("if ")
        || trimmed.starts_with("for ")
        || trimmed.starts_with("while ")
        || trimmed.starts_with("function ")
        || trimmed.starts_with("class ")
        || trimmed.starts_with("try ");

    let is_single_expression = trimmed.starts_with("await ")
        || trimmed.starts_with("(")
        || trimmed.starts_with("JSON.")
        || trimmed.starts_with("{")
        || trimmed.starts_with("[")
        || trimmed.ends_with(")()");

    let is_wrapped_expression = (trimmed.starts_with("(") && trimmed.ends_with(")"))
        || (trimmed.starts_with("(") && trimmed.ends_with(")()"))
        || (trimmed.starts_with("JSON.") && trimmed.ends_with(")"))
        || (trimmed.starts_with("await "));

    if needs_return && (is_single_expression || is_wrapped_expression || !is_multi_statement) {
        format!("return {trimmed}")
    } else {
        script.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::prepare_script;

    #[cfg(target_os = "macos")]
    use super::should_use_native_evaluation;

    #[test]
    fn adds_return_for_simple_expression() {
        assert_eq!(prepare_script("document.title"), "return document.title");
    }

    #[test]
    fn keeps_multi_statement_script_unchanged() {
        let script = "const title = document.title; return title;";
        assert_eq!(prepare_script(script), script);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn skips_native_eval_for_async_scripts() {
        assert!(!should_use_native_evaluation(
            "return (async () => await document.title)();"
        ));
        assert!(!should_use_native_evaluation(
            "return fetch('/').then((r) => r.text());"
        ));
        assert!(should_use_native_evaluation("return document.title;"));
    }
}
