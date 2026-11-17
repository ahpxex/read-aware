//! Check identity before plugins, single-instance dispatch or storage can touch
//! an existing installation. Frontend dev mode alone cannot isolate native data.
pub(crate) const PRODUCTION_ID: &str = "com.readaware.app";

/// One extra identity a local dev launch may run under, named explicitly at
/// build time (`READAWARE_ACCEPTANCE_IDENTITY=com.readaware.app.capability-e2e`
/// with `tauri.capability-e2e.conf.json`): an acceptance harness with its own
/// disposable data root. Ordinary builds name none, so no harness identity is
/// compiled into the app.
const ACCEPTANCE_ID: Option<&str> = option_env!("READAWARE_ACCEPTANCE_IDENTITY");

pub(crate) fn validate(config: &tauri::Config, local_dev: bool) -> Result<(), &'static str> {
    validate_with(config, local_dev, ACCEPTANCE_ID)
}

fn validate_with(
    config: &tauri::Config,
    local_dev: bool,
    acceptance: Option<&str>,
) -> Result<(), &'static str> {
    let identifier = config.identifier.as_str();
    let dev_name = config
        .product_name
        .as_deref()
        .unwrap_or("")
        .starts_with("ReadAware Dev");
    let dev_id = identifier == "com.readaware.app.dev" || identifier == "com.readaware.app.dev2";
    if dev_name != dev_id {
        return Err("ReadAware Dev must use an isolated development bundle identifier");
    }
    let acceptance = acceptance.is_some_and(|id| {
        id == identifier && id != PRODUCTION_ID && id.starts_with("com.readaware.app.")
    });
    if local_dev && !dev_id && !acceptance {
        return Err("Local dev requires the development identity. Start with `bun run dev`.");
    }
    Ok(())
}

pub(crate) fn can_update(identifier: &str) -> bool {
    identifier == PRODUCTION_ID
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(identifier: &str, name: &str) -> tauri::Config {
        tauri::Config {
            identifier: identifier.into(),
            product_name: Some(name.into()),
            ..Default::default()
        }
    }

    #[test]
    fn local_dev_cannot_open_production_identity_even_with_a_dev_name() {
        assert!(validate_with(&config(PRODUCTION_ID, "ReadAware"), true, None).is_err());
        assert!(validate_with(&config(PRODUCTION_ID, "ReadAware Dev"), true, None).is_err());
        assert!(validate_with(&config("com.readaware.app.dev", "ReadAware"), true, None).is_err());
        assert!(validate_with(
            &config("com.readaware.app.dev", "ReadAware Dev"),
            true,
            None
        )
        .is_ok());
        assert!(validate_with(
            &config("com.readaware.app.anything-else", "ReadAware"),
            true,
            None
        )
        .is_err());
    }

    #[test]
    fn an_acceptance_identity_runs_only_when_the_build_names_it() {
        let harness = config(
            "com.readaware.app.capability-e2e",
            "ReadAware Capability Tests",
        );
        assert!(validate_with(&harness, true, None).is_err());
        assert!(validate_with(&harness, true, Some("com.readaware.app.capability-e2e")).is_ok());
        assert!(validate_with(&harness, true, Some("com.readaware.app.other")).is_err());
        // The build flag cannot open production data or a dev-named bundle.
        assert!(validate_with(
            &config(PRODUCTION_ID, "ReadAware"),
            true,
            Some(PRODUCTION_ID)
        )
        .is_err());
        assert!(validate_with(
            &config("com.readaware.app.capability-e2e", "ReadAware Dev Tests"),
            true,
            Some("com.readaware.app.capability-e2e")
        )
        .is_err());
    }

    #[test]
    fn release_builds_preserve_identity_and_only_production_can_update() {
        for (id, name) in [
            (PRODUCTION_ID, "ReadAware"),
            ("com.readaware.app.dev", "ReadAware Dev"),
        ] {
            assert!(validate(&config(id, name), false).is_ok());
        }
        assert!(can_update(PRODUCTION_ID));
        assert!(!can_update("com.readaware.app.dev"));
        assert!(!can_update("com.readaware.app.capability-e2e"));
    }
}
