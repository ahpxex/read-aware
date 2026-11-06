//! The general-preferences record the desktop host publishes to the OS
//! (launch at startup, file associations). Pure model: parsing only; the OS
//! side effects stay in the desktop app.
use crate::error::CommandError;

pub const GENERAL_KEY: &str = "read-aware-general-settings";

#[derive(serde::Deserialize, Debug)]
#[serde(default, rename_all = "camelCase")]
pub struct DesktopPreferences {
    pub launch_at_startup: bool,
    pub file_associations: bool,
}

impl Default for DesktopPreferences {
    fn default() -> Self {
        Self {
            launch_at_startup: false,
            file_associations: true,
        }
    }
}

pub fn parse(value: Option<&str>) -> Result<DesktopPreferences, CommandError> {
    value.map_or_else(
        || Ok(DesktopPreferences::default()),
        |value| {
            let parsed: serde_json::Value = serde_json::from_str(value).map_err(|error| {
                CommandError::new(
                    "plugin/invalid-argument",
                    format!("Invalid general settings: {error}"),
                )
            })?;
            if !parsed.is_object() {
                return Err(CommandError::new(
                    "plugin/invalid-argument",
                    "General settings must be an object",
                ));
            }
            serde_json::from_value(parsed).map_err(|error| {
                CommandError::new(
                    "plugin/invalid-argument",
                    format!("Invalid desktop preferences: {error}"),
                )
            })
        },
    )
}
