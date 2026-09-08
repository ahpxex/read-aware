# Packaged Worker Network Regression

These two packages are manual security diagnostics, not product plugins or W01-W32
composition consumers. They use only a fixed loopback endpoint and fixed test
strings; do not substitute real data or external destinations.

1. Use only the isolated `com.readaware.app.capability-e2e` release `.app` built
   with `src-tauri/tauri.capability-e2e.conf.json`. Do not enable the debug MCP in
   release or change the application CSP to make the test pass.
2. Confirm port 18886 is free, then run
   `bun scripts/fixtures/packaged-sandbox-server.ts`. The server binds only to
   `127.0.0.1`. `/control` returns `loopback-ready`; `/results` exposes the observed
   test requests without adding a request to the recorded list.
3. Through native Settings / Plugins / Install plugin, select
   `scripts/fixtures/packaged-sandbox-probe`. Consent must say no extra permissions.
   Opening its shelf header page must not send a request; click Run loopback checks.
4. With protection active, global fetch is rejected, prototype fetch fails, the
   child blob Worker fails, and HTTP module import fails. No `/probe/*` request
   may be added to the server. A dead server alone is not passing evidence:
   verify `/control` still responds.
5. Install `scripts/fixtures/packaged-network-probe`, approve the explicit Network
   permission, and run its header action. It must return
   `HOST NETWORK: 200 fixed-test-marker`, with one `/probe/host-network` request.
   This verifies the fix does not remove the granted host-mediated operation.
6. Preserve both visible outcomes and the server request list. Uninstall both
   packages through Settings, quit the isolated app, and stop the owned server.

The zero-permission diagnostic is intentionally unchanged across before/after
builds. The first verified before/after run and exact binary/package hashes are
in `docs/evidence/packaged-sandbox-network-2026-09-09.json`.

The policy is shared by Vite development responses and native release asset
responses. Parent-page CSP, JavaScript getters and Bun Worker tests do not replace
this real WebKit test. Other operating systems and other authority paths need
their own evidence.
