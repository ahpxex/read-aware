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

#[derive(Default)]
struct ExecutionBoundary {
    inside_pool: usize,
    pools: usize,
    outside_locks: usize,
}
impl<'ast> Visit<'ast> for ExecutionBoundary {
    fn visit_expr_call(&mut self, node: &'ast ExprCall) {
        let pooled = matches!(&*node.func, Expr::Path(path) if path.path.segments.last()
            .is_some_and(|segment| segment.ident == "blocking" || segment.ident == "spawn_blocking"));
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
        if node.method == "lock" && self.inside_pool == 0 {
            self.outside_locks += 1;
        }
        visit::visit_expr_method_call(self, node);
    }
}

#[test]
fn every_storage_command_keeps_lock_waits_off_ui_dispatch() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/storage");
    let mut audited = 0;
    let mut paths = fs::read_dir(&root)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect::<Vec<_>>();
    // Database consumers outside storage must use the same execution contract.
    paths.extend(
        ["covers.rs", "import.rs", "secrets.rs"].map(|name| root.parent().unwrap().join(name)),
    );
    for path in paths {
        if !path.extension().is_some_and(|ext| ext == "rs") {
            continue;
        }
        let source = fs::read_to_string(&path).unwrap();
        for item in syn::parse_file(&source).unwrap().items {
            let Item::Fn(function) = item else { continue };
            if !function.attrs.iter().any(|attr| {
                attr.path()
                    .segments
                    .iter()
                    .map(|segment| segment.ident.to_string())
                    .collect::<Vec<_>>()
                    == ["tauri", "command"]
            }) {
                continue;
            }
            let name = function.sig.ident.to_string();
            if name == "checkpoint_schema_version" {
                assert_eq!(function.block.stmts.len(), 1);
                assert!(
                    matches!(&function.block.stmts[0], syn::Stmt::Expr(Expr::Path(path), None)
                    if path.path.is_ident("SCHEMA_VERSION"))
                );
                continue;
            }
            assert!(
                function.sig.asyncness.is_some(),
                "{name} can block UI dispatch"
            );
            let mut audit = ExecutionBoundary::default();
            audit.visit_block(&function.block);
            assert!(
                audit.pools > 0,
                "{name} needs an explicit blocking executor"
            );
            assert_eq!(
                audit.outside_locks, 0,
                "{name} locks outside the blocking executor"
            );
            audited += 1;
        }
    }
    assert!(
        audited > 100,
        "storage command inventory unexpectedly incomplete"
    );
}
