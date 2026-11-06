# ReadAware MCP bridge source

This directory vendors the Rust plugin from
[`hypothesi/mcp-server-tauri`](https://github.com/hypothesi/mcp-server-tauri),
version 0.13.0, with the local revisions already used by ReadAware:

- `016b2d3`: run background automation without activating windows;
- `ab639e2`: use one execution deadline for webview scripts;
- `d0c6543`: decode screenshots once before encoding.

The snapshot was copied from local revision `56b206b` (whose additional changes
only concern workspace tooling). `build.rs`, `src`, `permissions`, the upstream
README, and the MIT license are retained without changes. `Cargo.toml` differs
only in its Windows dependencies, raised to `webview2-com` 0.39.1 and
`windows`/`windows-core` 0.62.2 for Tauri 2.12 — the same versions upstream
0.13.2 uses — because the screenshot code passes these types to the
`ICoreWebView2` that wry provides.

Keeping this source in the repository lets a clean checkout build on every
desktop platform without depending on a developer's filesystem or unpublished
Git commits. ReadAware still initializes the bridge only in debug builds; this
does not enable it in release builds.

When updating, compare the upstream plugin and these three revisions, preserve
the background execution behavior, and update this provenance note. JavaScript
workspace packages and their build artifacts are not needed by the Rust crate.
