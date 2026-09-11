//! Desktop-entry and MIME data transforms, independent of filesystem/process I/O.
use super::catalog::book_types;
use crate::error::CommandError;
use ini::{EscapePolicy, Ini, LineSeparator, ParseOption, WriteOption};
use quick_xml::{
    events::{BytesText, Event},
    Writer,
};

pub(super) fn error(message: impl Into<String>) -> CommandError {
    CommandError::new("settings/unavailable", message)
}

pub(super) struct Identity {
    pub id: String,
    pub name: String,
    pub executable: String,
    pub binary_name: String,
}

impl Identity {
    pub fn new(
        id: &str,
        name: &str,
        executable: &str,
        binary_name: &str,
    ) -> Result<Self, CommandError> {
        if id.is_empty()
            || !id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b".-".contains(&c))
            || name.is_empty()
            || name.trim() != name
            || name.contains(['/', '\\', ';'])
            || name.chars().any(char::is_control)
            || !executable.starts_with('/')
            || executable.contains(['=', '\0'])
            || binary_name.is_empty()
            || binary_name.contains(['/', '\\', '=', '\0'])
        {
            return Err(error("Invalid Linux handler identity or executable path"));
        }
        Ok(Self {
            id: id.into(),
            name: name.into(),
            executable: executable.into(),
            binary_name: binary_name.into(),
        })
    }
    pub fn desktop_id(&self) -> String {
        format!("{}.desktop", self.name)
    }
    pub fn package_name(&self) -> String {
        format!("readaware-{}-books.xml", self.id)
    }
}

fn parse(bytes: &[u8]) -> Result<Ini, CommandError> {
    let text =
        std::str::from_utf8(bytes).map_err(|e| error(format!("Invalid desktop text: {e}")))?;
    let ini = Ini::load_from_str_opt(
        text,
        ParseOption {
            enabled_quote: false,
            enabled_escape: false,
            enabled_indented_mutiline_value: false,
            ..Default::default()
        },
    )
    .map_err(|e| error(format!("Invalid desktop INI: {e}")))?;
    let mut sections = std::collections::HashSet::new();
    for (name, fields) in ini.iter() {
        if !sections.insert(name) {
            return Err(error("Duplicate desktop INI section"));
        }
        let mut keys = std::collections::HashSet::new();
        for (key, _) in fields.iter() {
            if !keys.insert(key) {
                return Err(error("Duplicate desktop INI key"));
            }
        }
    }
    Ok(ini)
}

fn encode(ini: &Ini) -> Result<Vec<u8>, CommandError> {
    let mut bytes = Vec::new();
    ini.write_to_opt(
        &mut bytes,
        WriteOption {
            escape_policy: EscapePolicy::Nothing,
            line_separator: LineSeparator::CR,
            kv_separator: "=",
        },
    )?;
    Ok(bytes)
}

fn string(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}

pub(super) fn executable(value: &str) -> String {
    let mut quoted = String::from("\"");
    for ch in value.chars() {
        match ch {
            '\\' => quoted.push_str("\\\\\\\\"),
            '"' | '`' | '$' => {
                quoted.push_str("\\\\");
                quoted.push(ch);
            }
            '%' => quoted.push_str("%%"),
            '\n' => quoted.push_str("\\n"),
            '\r' => quoted.push_str("\\r"),
            '\t' => quoted.push_str("\\t"),
            _ => quoted.push(ch),
        }
    }
    quoted.push('"');
    quoted
}

fn list(value: Option<&str>) -> Vec<String> {
    value
        .unwrap_or_default()
        .split(';')
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .collect()
}
fn joined(values: &[String]) -> String {
    if values.is_empty() {
        String::new()
    } else {
        format!("{};", values.join(";"))
    }
}

pub(super) fn desktop(
    identity: &Identity,
    previous: Option<&[u8]>,
    enabled: bool,
) -> Result<Vec<u8>, CommandError> {
    let mut ini = previous.map(parse).transpose()?.unwrap_or_default();
    if previous.is_some() {
        let section = ini
            .section(Some("Desktop Entry"))
            .ok_or_else(|| error("Missing Desktop Entry section"))?;
        match section.get("X-ReadAware-Owner") {
            Some(owner) if owner == identity.id => {}
            Some(_) => return Err(error("Desktop entry belongs to another application")),
            None => {
                let exec = section.get("Exec").unwrap_or_default();
                let matches = [&identity.executable, &identity.binary_name]
                    .iter()
                    .any(|path| {
                        ["", " %U", " %u", " %F", " %f"].iter().any(|suffix| {
                            exec == format!("{}{suffix}", executable(path))
                                || (!path
                                    .chars()
                                    .any(|c| c.is_whitespace() || "\\\"'`$%;&|<>".contains(c))
                                    && exec == format!("{path}{suffix}"))
                        })
                    });
                if section.get("Name") != Some(identity.name.as_str()) || !matches {
                    return Err(error(
                        "Unmarked desktop entry cannot be attributed to this installation",
                    ));
                }
            }
        }
    }
    let mimes: Vec<_> = book_types().into_iter().map(|kind| kind.mime).collect();
    let mut types = list(ini.get_from(Some("Desktop Entry"), "MimeType"));
    types.retain(|mime| !mimes.contains(mime));
    if enabled {
        types.extend(mimes);
    }
    ini.with_section(Some("Desktop Entry"))
        .set("Type", "Application")
        .set("Name", string(&identity.name))
        .set("X-ReadAware-Owner", &identity.id)
        .set("Exec", format!("{} %U", executable(&identity.executable)))
        .set("TryExec", string(&identity.executable))
        .set("Icon", string(&identity.binary_name))
        .set("Terminal", "false")
        .set("Hidden", "false")
        .set("DBusActivatable", "false")
        .set("MimeType", joined(&types));
    encode(&ini)
}

pub(super) fn associations(
    identity: &Identity,
    previous: Option<&[u8]>,
    enabled: bool,
) -> Result<Vec<u8>, CommandError> {
    let mut ini = previous.map(parse).transpose()?.unwrap_or_default();
    let id = identity.desktop_id();
    for kind in book_types() {
        for (section, include) in [
            ("Added Associations", enabled),
            ("Removed Associations", !enabled),
        ] {
            let mut ids = list(ini.get_from(Some(section), &kind.mime));
            ids.retain(|entry| entry != &id);
            if include {
                ids.push(id.clone());
            }
            ini.with_section(Some(section))
                .set(&kind.mime, joined(&ids));
        }
    }
    encode(&ini)
}

pub(super) fn mime_package(identity: &Identity) -> Result<Vec<u8>, CommandError> {
    let mut writer = Writer::new(Vec::new());
    writer.write_event(Event::Comment(BytesText::new(&format!(
        "ReadAware owner: {}",
        identity.id
    ))))?;
    writer
        .create_element("mime-info")
        .with_attribute((
            "xmlns",
            "http://www.freedesktop.org/standards/shared-mime-info",
        ))
        .write_inner_content(|writer| {
            for kind in book_types() {
                writer
                    .create_element("mime-type")
                    .with_attribute(("type", kind.mime.as_str()))
                    .write_inner_content(|writer| {
                        writer
                            .create_element("comment")
                            .write_text_content(BytesText::new(&kind.description))?;
                        for ext in &kind.extensions {
                            writer
                                .create_element("glob")
                                .with_attribute(("pattern", format!("*.{ext}").as_str()))
                                .write_empty()?;
                        }
                        Ok(())
                    })?;
            }
            Ok(())
        })?;
    Ok(writer.into_inner())
}

pub(super) fn check_package(identity: &Identity, bytes: &[u8]) -> Result<(), CommandError> {
    let mut reader = quick_xml::Reader::from_reader(bytes);
    let expected = format!("ReadAware owner: {}", identity.id);
    let mut owned = false;
    loop {
        match reader
            .read_event()
            .map_err(|e| error(format!("Invalid owned MIME XML: {e}")))?
        {
            Event::Comment(text) if &*text == expected.as_bytes() => owned = true,
            Event::Eof => break,
            _ => {}
        }
    }
    if owned {
        Ok(())
    } else {
        Err(error("MIME package is not owned by this application"))
    }
}

#[cfg(test)]
mod tests;
