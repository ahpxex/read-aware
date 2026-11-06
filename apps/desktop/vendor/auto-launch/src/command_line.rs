//! Encoding belongs at the startup-file boundary, not in caller-supplied paths.
#[cfg(any(windows, test))]
pub(crate) fn windows(path: &str, args: &[String]) -> String {
    let mut output = format!("\"{path}\"");
    for arg in args {
        output.push_str(" \"");
        let mut slashes = 0;
        for ch in arg.chars() {
            if ch == '\\' {
                slashes += 1;
                continue;
            }
            output.push_str(&"\\".repeat(if ch == '"' { slashes * 2 + 1 } else { slashes }));
            slashes = 0;
            output.push(ch);
        }
        output.push_str(&"\\".repeat(slashes * 2));
        output.push('"');
    }
    output
}

#[cfg(any(target_os = "linux", test))]
pub(crate) fn desktop(path: &str, args: &[String]) -> String {
    std::iter::once(path)
        .chain(args.iter().map(String::as_str))
        .map(|arg| {
            let mut quoted = String::from("\"");
            for ch in arg.chars() {
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
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_executable_spaces_and_argument_quotes_are_not_separators() {
        assert_eq!(
            windows(r"C:\Program Files\ReadAware\ReadAware.exe", &[]),
            r#""C:\Program Files\ReadAware\ReadAware.exe""#
        );
        assert_eq!(
            windows(
                "app.exe",
                &[String::new(), "a b".into(), "a\"b".into(), "end\\".into()]
            ),
            r#""app.exe" "" "a b" "a\"b" "end\\""#
        );
    }

    #[test]
    fn desktop_exec_has_two_escape_layers_and_literal_percent() {
        assert_eq!(
            desktop("/opt/Read Aware/app", &[]),
            "\"/opt/Read Aware/app\""
        );
        assert_eq!(
            desktop("/apps/$cash`x`\\%f\"", &["a\nb\tc\r".into(), "".into()]),
            "\"/apps/\\\\$cash\\\\`x\\\\`\\\\\\\\%%f\\\\\"\" \"a\\nb\\tc\\r\" \"\""
        );
    }
}
