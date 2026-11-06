use crate::{AutoLaunch, Error, Result};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

/// macOS implement
impl AutoLaunch {
    /// Create a new AutoLaunch instance
    /// - `app_name`: application name
    /// - `app_path`: application path
    /// - `use_launch_agent`: whether use Launch Agent or AppleScript
    /// - `args`: startup args passed to the binary
    ///
    /// ## Notes
    ///
    /// The parameters of `AutoLaunch::new` are different on each platform.
    ///
    /// The `app_name` should be same as the basename of the `app_path`
    ///     when `use_launch_agent` is false, or it will be corrected automatically.
    ///
    /// The `app_path` should be the **absolute path** and **exists**,
    ///     otherwise it will cause an error when `enable`.
    ///
    /// In case using AppleScript (`use_launch_agent=false`),
    ///     only `"--hidden"` and `"--minimized"` in `args` are valid.
    pub fn new(
        app_name: &str,
        app_path: &str,
        use_launch_agent: bool,
        args: &[impl AsRef<str>],
    ) -> AutoLaunch {
        let mut name = app_name;
        if !use_launch_agent {
            // the app_name should be same as the executable's name
            // when using login item
            let end = if app_path.ends_with(".app") { 4 } else { 0 };
            let end = app_path.len() - end;
            let begin = match app_path.rfind('/') {
                Some(i) => i + 1,
                None => 0,
            };
            name = &app_path[begin..end];
        }

        AutoLaunch {
            app_name: name.into(),
            app_path: app_path.into(),
            use_launch_agent,
            args: args.iter().map(|s| s.as_ref().to_string()).collect(),
        }
    }

    /// Enable the AutoLaunch setting
    ///
    /// ## Errors
    ///
    /// - `app_path` does not exist
    /// - `app_path` is not absolute
    ///
    /// #### Launch Agent
    ///
    /// - failed to create dir `~/Library/LaunchAgents`
    /// - failed to create file `~/Library/LaunchAgents/{app_name}.plist`
    /// - failed to write bytes to the file
    ///
    /// #### AppleScript
    ///
    /// - failed to execute the `osascript` command, check the exit status or stderr for details
    pub fn enable(&self) -> Result<()> {
        let path = Path::new(&self.app_path);

        if !path.exists() {
            return Err(Error::AppPathDoesntExist(path.to_path_buf()));
        }

        if !path.is_absolute() {
            return Err(Error::AppPathIsNotAbsolute(path.to_path_buf()));
        }

        if self.use_launch_agent {
            let dir = get_dir();
            if !dir.exists() {
                fs::create_dir_all(&dir)?;
            }

            let mut args = vec![self.app_path.clone()];
            args.extend_from_slice(&self.args);

            let mut data = Vec::new();
            launch_agent(&self.app_name, args).to_writer_xml(&mut data)
                .map_err(std::io::Error::other)?;
            fs::write(self.get_file(), data)?;
        } else {
            let hidden = self
                .args
                .iter()
                .find(|arg| *arg == "--hidden" || *arg == "--minimized");

            let props = format!(
                "{{name:\"{}\",path:\"{}\",hidden:{}}}",
                self.app_name,
                self.app_path,
                hidden.is_some()
            );
            let command = format!("make login item at end with properties {}", props);
            let output = exec_apple_script(&command)?;
            if !output.status.success() {
                return Err(Error::AppleScriptFailed(output.status.code().unwrap_or(1)));
            }
        }
        Ok(())
    }

    /// Disable the AutoLaunch setting
    ///
    /// ## Errors
    ///
    /// #### Launch Agent
    ///
    /// - failed to remove file `~/Library/LaunchAgents/{app_name}.plist`
    ///
    /// #### AppleScript
    ///
    /// - failed to execute the `osascript` command, check the exit status or stderr for details
    pub fn disable(&self) -> Result<()> {
        if self.use_launch_agent {
            let file = self.get_file();
            if file.exists() {
                fs::remove_file(file)?;
            }
        } else {
            let command = format!("delete login item \"{}\"", self.app_name);
            let output = exec_apple_script(&command)?;
            if !output.status.success() {
                return Err(Error::AppleScriptFailed(output.status.code().unwrap_or(1)));
            }
        }
        Ok(())
    }

    /// Check whether the AutoLaunch setting is enabled
    pub fn is_enabled(&self) -> Result<bool> {
        if self.use_launch_agent {
            match fs::read(self.get_file()) {
                Ok(data) => {
                    let value = plist::Value::from_reader(std::io::Cursor::new(data)).map_err(std::io::Error::other)?;
                    registered(&value, &self.app_name)
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
                Err(error) => Err(error.into()),
            }
        } else {
            let command = "get the name of every login item";
            let output = exec_apple_script(command)?;
            let mut enable = false;
            if output.status.success() {
                let stdout = std::str::from_utf8(&output.stdout).unwrap_or("");
                let mut stdout = stdout.split(",").map(|x| x.trim());
                enable = stdout.find(|x| x == &self.app_name).is_some();
            }
            Ok(enable)
        }
    }

    /// get the plist file path
    fn get_file(&self) -> PathBuf {
        get_dir().join(format!("{}.plist", self.app_name))
    }
}

fn launch_agent(label: &str, args: Vec<String>) -> plist::Value {
    let mut dictionary = plist::Dictionary::new();
    dictionary.insert("Label".into(), label.into());
    dictionary.insert("ProgramArguments".into(), plist::Value::Array(args.into_iter().map(plist::Value::String).collect()));
    dictionary.insert("RunAtLoad".into(), true.into());
    plist::Value::Dictionary(dictionary)
}

fn registered(value: &plist::Value, label: &str) -> Result<bool> {
    let invalid = || std::io::Error::new(std::io::ErrorKind::InvalidData, "Invalid owned startup registration");
    let fields = value.as_dictionary().ok_or_else(invalid)?;
    let args = fields.get("ProgramArguments").and_then(plist::Value::as_array).ok_or_else(invalid)?;
    if fields.get("Label").and_then(plist::Value::as_string) != Some(label)
        || args.is_empty() || args.iter().any(|value| value.as_string().is_none()) {
        return Err(invalid().into());
    }
    // Moving/updating the installation must not make an existing login entry
    // invisible: it still needs to be switchable off by this application ID.
    fields.get("RunAtLoad").and_then(plist::Value::as_boolean).ok_or_else(|| invalid().into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_agent_round_trips_xml_sensitive_install_paths_and_arguments() {
        let args = vec!["/Applications/Read & <Aware>/ReadAware.app/Contents/MacOS/app".into(), "\"quoted\" & <arg>".into()];
        let value = launch_agent("com.readaware.test", args.clone());
        let mut bytes = Vec::new();
        value.to_writer_xml(&mut bytes).unwrap();
        let decoded = plist::Value::from_reader(std::io::Cursor::new(bytes)).unwrap();
        assert_eq!(decoded, value);
        assert_eq!(decoded.as_dictionary().unwrap()["ProgramArguments"], plist::Value::Array(args.into_iter().map(plist::Value::String).collect()));
    }

    #[test]
    fn registration_survives_install_moves_and_unrelated_metadata() {
        let mut value = launch_agent("com.readaware.test", vec!["/old/ReadAware.app/Contents/MacOS/app".into()]);
        value.as_dictionary_mut().unwrap().insert("WorkingDirectory".into(), "/tmp".into());
        assert!(registered(&value, "com.readaware.test").unwrap());
        assert!(registered(&value, "another.app").is_err());
        value.as_dictionary_mut().unwrap().insert("RunAtLoad".into(), false.into());
        assert!(!registered(&value, "com.readaware.test").unwrap());
    }
}

/// Get the Launch Agent Dir
fn get_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap()
        .join("Library")
        .join("LaunchAgents")
}

/// Execute the specific AppleScript
fn exec_apple_script(cmd_suffix: &str) -> Result<Output> {
    let command = format!("tell application \"System Events\" to {}", cmd_suffix);
    let output = Command::new("osascript")
        .args(vec!["-e", &command])
        .output()?;
    Ok(output)
}
