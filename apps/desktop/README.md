# @read-aware/desktop

Tauri 2 desktop shell that wraps the `@read-aware/web` frontend. In development it
points at the web dev server (`http://localhost:5173`); in production it bundles
the static build from `apps/web/dist`.

## Prerequisites

Tauri needs the Rust toolchain plus your platform's native webview/build deps.

1. Install Rust: https://www.rust-lang.org/tools/install
2. Install platform dependencies: https://tauri.app/start/prerequisites/

## Develop

From the repo root:

```sh
bun run dev:desktop
```

This runs `tauri dev`, which auto-starts the web dev server via
`beforeDevCommand` and opens the native window.

## Build

```sh
bun run build:desktop
```

Runs `tauri build`, which builds the web app first (`beforeBuildCommand`) and
then produces native installers.

## Icons

`app-icon.svg` is the source of truth — an editorial, paper-toned open-book
mark. `src-tauri/icons/*` are the platform icons generated from it. After
editing the SVG, regenerate (run from this directory):

```sh
bun run tauri icon app-icon.svg
```

`tauri icon` also emits iOS/Android/Windows-Store assets; this desktop app only
keeps the macOS/Windows desktop set (`32x32.png`, `128x128.png`,
`128x128@2x.png`, `icon.icns`, `icon.ico`, `icon.png`), so prune the rest.

`scripts/generate-icons.mjs` only produced the original solid-color placeholders
and is superseded — do not run it, it would overwrite the real icons.
