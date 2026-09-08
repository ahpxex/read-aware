use std::{borrow::Cow, sync::LazyLock};
use tauri::http::{header::CONTENT_SECURITY_POLICY, HeaderValue, Request, Response};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Policy {
    production_asset_prefix: String,
    content_security_policy: String,
}

static POLICY: LazyLock<Policy> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../web/plugin-sandbox-policy.json"))
        .expect("invalid bundled plugin sandbox policy")
});

/// Enforce at the worker response, below plugin JavaScript and its child realms.
pub fn apply(request: Request<Vec<u8>>, response: &mut Response<Cow<'static, [u8]>>) {
    let uri = request.uri();
    let local = matches!(
        (uri.scheme_str(), uri.host()),
        (Some("tauri"), Some("localhost")) | (Some("http" | "https"), Some("tauri.localhost"))
    );
    if local && uri.path().starts_with(&POLICY.production_asset_prefix) {
        response.headers_mut().insert(
            CONTENT_SECURITY_POLICY,
            HeaderValue::from_str(&POLICY.content_security_policy)
                .expect("invalid bundled plugin sandbox CSP header"),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worker_policy_denies_ambient_network_and_child_realms() {
        for origin in [
            "tauri://localhost",
            "http://tauri.localhost",
            "https://tauri.localhost",
        ] {
            let request = Request::builder()
                .uri(format!(
                    "{origin}/assets/plugin-sandbox/plugin-sandbox.worker-test.js?x=1"
                ))
                .body(Vec::new())
                .unwrap();
            let mut response = Response::new(Cow::Borrowed(&b"worker"[..]));
            apply(request, &mut response);
            let csp = response.headers()[CONTENT_SECURITY_POLICY]
                .to_str()
                .unwrap();
            assert!(csp.contains("connect-src 'none'"));
            assert!(csp.contains("worker-src 'none'"));
            assert!(!csp.contains("blob:"));
            assert!(csp.contains("raplugin:"));
        }
    }

    #[test]
    fn does_not_change_app_reader_assets_or_external_responses() {
        for url in [
            "tauri://localhost/index.html",
            "tauri://localhost/assets/main.js",
            "tauri://localhost/foliate-js/pdf.js",
            "tauri://localhost/assets/plugin-sandbox-other.js",
            "https://example.com/assets/plugin-sandbox/main.js",
            "http://localhost/assets/plugin-sandbox/main.js",
        ] {
            let mut response = Response::new(Cow::Borrowed(&b"app"[..]));
            response.headers_mut().insert(
                CONTENT_SECURITY_POLICY,
                HeaderValue::from_static("original"),
            );
            apply(
                Request::builder().uri(url).body(Vec::new()).unwrap(),
                &mut response,
            );
            assert_eq!(
                response.headers()[CONTENT_SECURITY_POLICY],
                "original",
                "{url}"
            );
        }
    }
}
