use super::*;
use std::{fs, path::Path, sync::mpsc, time::Duration};
use syn::{
    visit::{self, Visit},
    Expr, ExprCall, ExprMethodCall, Item,
};

#[test]
fn blocking_storage_runs_elsewhere_and_preserves_errors() {
    let caller = std::thread::current().id();
    let worker =
        tauri::async_runtime::block_on(blocking(
            "thread-check",
            || Ok(std::thread::current().id()),
        ))
        .unwrap();
    assert_ne!(caller, worker);
    let error = tauri::async_runtime::block_on(blocking::<()>("error-check", || {
        Err(CommandError::new("db/locked", "held by another writer"))
    }))
    .unwrap_err();
    assert_eq!(error.code, "db/locked");
    assert_eq!(error.message, "held by another writer");
}

#[test]
fn dropping_an_accepted_waiter_does_not_cancel_its_write() {
    let (started_tx, started_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let (committed_tx, committed_rx) = mpsc::channel();
    let waiter = tauri::async_runtime::spawn(blocking("detached-write", move || {
        started_tx.send(()).unwrap();
        release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        committed_tx.send(()).unwrap();
        Ok(())
    }));
    started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    waiter.abort();
    release_tx.send(()).unwrap();
    committed_rx.recv_timeout(Duration::from_secs(5)).unwrap();
}

#[test]
fn worker_panic_returns_a_stable_failure_without_panic_payload() {
    let error = tauri::async_runtime::block_on(blocking::<()>("panic-check", || {
        panic!("private diagnostic payload")
    }))
    .unwrap_err();
    assert_eq!(error.code, "internal");
    assert_eq!(error.message, "panic-check storage task failed");
}

/// Sync commands run on the main (UI) thread. Each one here does no I/O and
/// takes no lock that is ever held across I/O, or must touch main-thread-only
/// OS state; everything else is async and names its executor.
const SYNC_COMMANDS: &[(&str, &str)] = &[
    (
        "app_exit_confirm",
        "flips two atomics and requests the exit",
    ),
    ("window_input_revision", "reads two atomics"),
    (
        "external_open_take",
        "drains an in-memory queue; its lock never spans I/O",
    ),
    (
        "external_open_is_current",
        "compares an in-memory epoch; its lock never spans I/O",
    ),
    (
        "diagnostics_log_dir",
        "computes a path; no filesystem access",
    ),
    (
        "app_store_storefront",
        "iOS: a StoreKit property read, kept on the main thread",
    ),
    (
        "set_status_bar_hidden",
        "iOS: the ObjC bridge hops to the main queue itself",
    ),
    (
        "battery_status",
        "iOS: a UIDevice property read via the ObjC bridge, kept on the main thread",
    ),
    (
        "book_folder_pick_start",
        "iOS: the ObjC bridge hops to the main queue itself",
    ),
    (
        "book_folder_pick_poll",
        "iOS: copies the bridge's parked string; no I/O",
    ),
    (
        "book_folder_release",
        "iOS: ends a security-scoped grant; no I/O",
    ),
];

/// Async commands that only await non-blocking futures — HTTP clients,
/// async mutexes, pooled helpers — and so need no executor of their own.
const ASYNC_ONLY: &[(&str, &str)] = &[
    (
        "desktop_update_check",
        "the updater's manifest fetch is an async HTTP future",
    ),
    (
        "desktop_update_install",
        "download and install are async updater futures",
    ),
    (
        "android_update_check",
        "async HTTP; JNI round trips go through on_main_thread",
    ),
    (
        "android_update_install",
        "async HTTP; JNI round trips go through on_main_thread",
    ),
    (
        "battery_status",
        "Android: JNI attach plus BatteryManager property reads; no UI-thread state",
    ),
    (
        "local_api_status",
        "awaits an async mutex and pooled secret reads",
    ),
    (
        "local_api_attach",
        "awaits an async mutex, pooled secret reads and the async server",
    ),
    (
        "local_api_set_enabled",
        "awaits an async mutex, pooled secret I/O and the async server",
    ),
    (
        "local_api_token",
        "awaits an async mutex and pooled secret reads",
    ),
    (
        "local_api_rotate_token",
        "awaits an async mutex, pooled secret I/O and the async server",
    ),
    ("local_api_complete", "hands a response to an async channel"),
    (
        "export_choose_target",
        "awaits the dialog plugin's callback; the dialog runs off the runtime",
    ),
    (
        "backup_export_choose_destination",
        "awaits the dialog plugin's callback; the dialog runs off the runtime",
    ),
];

/// Async commands that briefly take a std mutex on plain in-memory state that
/// no holder ever keeps across I/O or an await, so waiting on it is bounded.
const IN_MEMORY_LOCKS: &[(&str, &str)] = &[
    (
        "local_api_attach",
        "resets the bridge's pending-request map",
    ),
    (
        "local_api_complete",
        "removes one sender from the bridge's pending-request map",
    ),
];

#[derive(Default)]
struct ExecutionBoundary {
    inside_pool: usize,
    pools: usize,
    main_thread: usize,
    outside_locks: usize,
    work: usize,
}
impl<'ast> Visit<'ast> for ExecutionBoundary {
    fn visit_expr_call(&mut self, node: &'ast ExprCall) {
        let callee = match &*node.func {
            Expr::Path(path) => path
                .path
                .segments
                .last()
                .map(|segment| segment.ident.to_string()),
            _ => None,
        };
        // Enum/struct constructors (`Ok(..)`, `Some(..)`) are values, not work.
        if !callee
            .as_deref()
            .is_some_and(|name| name.starts_with(char::is_uppercase))
        {
            self.work += 1;
        }
        let pooled = matches!(callee.as_deref(), Some("blocking" | "spawn_blocking"));
        if callee.as_deref() == Some("on_main_thread") {
            self.main_thread += 1;
        }
        if pooled {
            self.pools += 1;
            self.inside_pool += 1;
        }
        visit::visit_expr_call(self, node);
        if pooled {
            self.inside_pool -= 1;
        }
    }
    fn visit_expr_method_call(&mut self, node: &'ast ExprMethodCall) {
        self.work += 1;
        if node.method == "run_on_main_thread" {
            self.main_thread += 1;
        }
        if node.method == "lock" && self.inside_pool == 0 {
            self.outside_locks += 1;
        }
        visit::visit_expr_method_call(self, node);
    }
    fn visit_expr_await(&mut self, node: &'ast syn::ExprAwait) {
        // `.lock().await` is an async mutex: waiting suspends, never blocks.
        if let Expr::MethodCall(call) = &*node.base {
            if call.method == "lock" {
                self.work += 1;
                self.visit_expr(&call.receiver);
                return;
            }
        }
        visit::visit_expr_await(self, node);
    }
    fn visit_macro(&mut self, node: &'ast syn::Macro) {
        self.work += 1;
        visit::visit_macro(self, node);
    }
}

fn tauri_commands(items: Vec<Item>, found: &mut Vec<syn::ItemFn>) {
    for item in items {
        match item {
            Item::Fn(function)
                if function.attrs.iter().any(|attr| {
                    attr.path()
                        .segments
                        .iter()
                        .map(|segment| segment.ident.to_string())
                        .collect::<Vec<_>>()
                        == ["tauri", "command"]
                }) =>
            {
                found.push(function)
            }
            Item::Mod(module) => {
                if let Some((_, items)) = module.content {
                    tauri_commands(items, found);
                }
            }
            _ => {}
        }
    }
}

fn source_files(dir: &Path, files: &mut Vec<std::path::PathBuf>) {
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            source_files(&path, files);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            files.push(path);
        }
    }
}

/// Every `#[tauri::command]` in the crate (all platforms' variants: syn sees
/// through `cfg`) must keep the UI thread free: async, with its blocking work
/// on the pool (`blocking`/`spawn_blocking`) or main-thread-only OS calls
/// marshalled through `run_on_main_thread`, and no blocking lock outside the
/// pool. Exceptions are the two commented lists above, plus pure stubs whose
/// bodies perform no calls at all.
#[test]
fn every_command_keeps_blocking_work_off_ui_dispatch() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files = Vec::new();
    source_files(&root, &mut files);
    let mut commands = Vec::new();
    for path in files {
        let source = fs::read_to_string(&path).unwrap();
        tauri_commands(syn::parse_file(&source).unwrap().items, &mut commands);
    }
    let listed = |list: &[(&str, &str)], name: &str| list.iter().any(|(entry, _)| *entry == name);
    let mut used = std::collections::HashSet::new();
    let mut violations = Vec::new();
    for function in &commands {
        let name = function.sig.ident.to_string();
        let mut audit = ExecutionBoundary::default();
        audit.visit_block(&function.block);
        if audit.work == 0 {
            continue; // A constant or no-op stub: nothing to schedule.
        }
        if function.sig.asyncness.is_none() {
            if !listed(SYNC_COMMANDS, &name) {
                violations.push(format!("{name} can block UI dispatch"));
            }
            used.insert(name);
            continue;
        }
        if audit.pools + audit.main_thread == 0 {
            if !listed(ASYNC_ONLY, &name) {
                violations.push(format!("{name} needs an explicit blocking executor"));
            }
            used.insert(name.clone());
        }
        if audit.outside_locks != 0 && listed(IN_MEMORY_LOCKS, &name) {
            used.insert(format!("lock:{name}"));
        } else if audit.outside_locks != 0 {
            violations.push(format!("{name} locks outside the blocking executor"));
        }
    }
    for (name, _) in SYNC_COMMANDS.iter().chain(ASYNC_ONLY) {
        if !used.contains(*name) {
            violations.push(format!("{name} is listed but no longer needs an exception"));
        }
    }
    for (name, _) in IN_MEMORY_LOCKS {
        if !used.contains(&format!("lock:{name}")) {
            violations.push(format!(
                "{name} no longer needs its in-memory lock exception"
            ));
        }
    }
    assert!(violations.is_empty(), "{}", violations.join("\n"));
    assert!(
        commands.len() > 250,
        "command inventory unexpectedly incomplete: {}",
        commands.len()
    );
}
