# auto-launch 0.5.0

Source: crates.io auto-launch 0.5.0, MIT, upstream
https://github.com/zzzgydi/auto-launch. Used by tauri-plugin-autostart 2.5.1.
The published crate archive SHA-256 is
`1f012b8cc0c850f34117ec8252a44418f2e34a2cf501de89e29b241ae5f79471`;
the source and license are retained.
Cargo resolves this audited source through the root crate's patch.crates-io.

ReadAware changes:
- macOS LaunchAgent uses the plist serializer rather than raw XML interpolation;
  complete writes; reads parse and match the owned registration, propagating errors.
- Windows quotes the executable and each argument, including trailing backslashes.
- Linux quotes Exec tokens with both Desktop Entry escape layers and percent
  escaping, writes all bytes, uses XDG config dir, and checks command/disabled flags.
- Parent directories are created recursively on macOS/Linux.
- Pure unit tests cover serialization. Upstream integration tests were not copied:
  they operate on actual startup entries. No startup entries are written by our tests.
- AppleScript mode is unchanged and unused by ReadAware.

Encoding references: [Desktop Entry Exec](https://specifications.freedesktop.org/desktop-entry/latest/exec-variables.html)
and [Windows argument parsing](https://learn.microsoft.com/en-us/cpp/c-language/parsing-c-command-line-arguments).
After an upstream release incorporates these changes, remove the patch only after
the same regression tests pass. OS execution remains a stage-three acceptance item.
