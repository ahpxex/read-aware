//! Per-user registry I/O. No merged HKCR writes and no UserChoice changes.
use super::registry::{self, unavailable, Identity, Registry};
use crate::error::CommandError;
use std::io;
use winreg::{
    enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WRITE, REG_SZ},
    RegKey,
};

pub(super) struct UserRegistry;
struct MachineRegistry;

fn read(root: RegKey, key: &str, name: &str) -> Result<Option<String>, CommandError> {
    let key = match root.open_subkey_with_flags(format!("Software\\Classes\\{key}"), KEY_READ) {
        Ok(key) => key,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(unavailable(format!(
                "Reading file association key: {error}"
            )))
        }
    };
    match key.get_raw_value(name) {
        Ok(value) if value.vtype == REG_SZ => {
            use winreg::types::FromRegValue;
            String::from_reg_value(&value)
                .map(Some)
                .map_err(|error| unavailable(format!("Reading file association value: {error}")))
        }
        Ok(_) => Err(unavailable(
            "File association value has an unexpected registry type",
        )),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(unavailable(format!(
            "Reading file association value: {error}"
        ))),
    }
}

impl Registry for UserRegistry {
    fn read(&self, key: &str, name: &str) -> Result<Option<String>, CommandError> {
        read(RegKey::predef(HKEY_CURRENT_USER), key, name)
    }

    fn write(&self, key: &str, name: &str, value: Option<&str>) -> Result<(), CommandError> {
        let root = RegKey::predef(HKEY_CURRENT_USER);
        let path = format!("Software\\Classes\\{key}");
        let result = if let Some(value) = value {
            root.create_subkey_with_flags(&path, KEY_WRITE)
                .and_then(|(key, _)| key.set_value(name, &value))
        } else {
            match root.open_subkey_with_flags(&path, KEY_WRITE) {
                Ok(key) => key.delete_value(name),
                Err(error) => Err(error),
            }
        };
        match result {
            Ok(()) => Ok(()),
            Err(error) if value.is_none() && error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(unavailable(format!("Writing file association: {error}"))),
        }
    }

    fn notify(&self) -> Result<(), CommandError> {
        use windows::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
        // SHChangeNotify has no failure return. Registry read-back, not this
        // notification, establishes that the requested values were retained.
        unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None) };
        Ok(())
    }
}

impl Registry for MachineRegistry {
    fn read(&self, key: &str, name: &str) -> Result<Option<String>, CommandError> {
        read(RegKey::predef(HKEY_LOCAL_MACHINE), key, name)
    }
    fn write(&self, _: &str, _: &str, _: Option<&str>) -> Result<(), CommandError> {
        Err(unavailable(
            "Machine-wide file association writes are not permitted",
        ))
    }
    fn notify(&self) -> Result<(), CommandError> {
        Ok(())
    }
}

pub(super) fn check_machine_legacy(identity: &Identity) -> Result<(), CommandError> {
    for kind in registry::book_types() {
        if registry::owns_legacy(&MachineRegistry, identity, &kind.legacy_class)? {
            return Err(unavailable("A machine-wide legacy file association requires migration to the per-user installer"));
        }
    }
    Ok(())
}
