//! App Store storefront lookup (iOS only).
//!
//! External purchase links (the Stripe checkout / billing portal the settings
//! page opens) are storefront-gated on iOS: Apple's guideline 3.1.1 permits
//! them on the United States storefront (2025 Epic v. Apple injunction) and
//! forbids them everywhere else. The webview asks which storefront the
//! signed-in App Store account belongs to and hides the purchase surfaces
//! outside the US (`platform/purchase-gate.ts`).
//!
//! The lookup uses StoreKit 1's `SKPaymentQueue.storefront` — the only
//! storefront API visible to Objective-C (StoreKit 2's `Storefront.current`
//! is Swift-only, unreachable from Rust). SK1 is deprecated since iOS 18 but
//! functional, and reading the storefront requires no in-app-purchase setup.

/// Three-letter App Store storefront code of the signed-in account (`"USA"`,
/// `"CHN"`, …), or `None` when no App Store account is available (signed out,
/// some simulators). Callers treat `None` as "not the US storefront".
#[cfg(target_os = "ios")]
#[tauri::command]
pub fn app_store_storefront() -> Option<String> {
    use objc2_store_kit::SKPaymentQueue;
    unsafe {
        let queue = SKPaymentQueue::defaultQueue();
        queue
            .storefront()
            .map(|storefront| storefront.countryCode().to_string())
    }
}

/// Off iOS every platform may sell externally; the command still resolves for
/// `generate_handler!` and the webview short-circuits before calling it.
#[cfg(not(target_os = "ios"))]
#[tauri::command]
pub fn app_store_storefront() -> Option<String> {
    None
}
