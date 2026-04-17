//! Generic graceful-shutdown facility for the core process.
//!
//! Provides a shutdown signal that listens for SIGINT (Ctrl-C) **and** SIGTERM
//! (on Unix), then runs registered cleanup hooks before the process exits.
//! Domain-specific cleanup (autocomplete, voice, etc.) registers itself here
//! so `jsonrpc.rs` stays transport-only.

use std::future::Future;
use std::pin::Pin;
use std::sync::Mutex;

use once_cell::sync::Lazy;

/// A boxed async cleanup function.
type ShutdownHook = Box<dyn Fn() -> Pin<Box<dyn Future<Output = ()> + Send>> + Send + Sync>;

/// Global registry of shutdown hooks.
static HOOKS: Lazy<Mutex<Vec<ShutdownHook>>> = Lazy::new(|| Mutex::new(Vec::new()));

/// Register a cleanup function to run on graceful shutdown.
///
/// Use this to perform necessary cleanup tasks such as stopping background
/// services, flushing caches, or closing database connections when the
/// application is shutting down.
///
/// Hooks execute sequentially in the order they were registered.
///
/// # Arguments
///
/// * `hook` - A function that returns a future. The future will be awaited
///   during the shutdown process.
pub fn register<F, Fut>(hook: F)
where
    F: Fn() -> Fut + Send + Sync + 'static,
    Fut: Future<Output = ()> + Send + 'static,
{
    let boxed: ShutdownHook = Box::new(move || Box::pin(hook()));
    HOOKS.lock().expect("shutdown hooks poisoned").push(boxed);
}

/// Run all registered hooks (called once during shutdown).
///
/// This function drains the global `HOOKS` list and awaits each hook in sequence.
async fn run_hooks() {
    let hooks: Vec<ShutdownHook> = {
        let mut guard = HOOKS.lock().expect("shutdown hooks poisoned");
        // Use mem::take to clear the hooks list and take ownership of the vector.
        std::mem::take(&mut *guard)
    };
    for hook in &hooks {
        hook().await;
    }
}

/// Returns a future that resolves when the process receives a termination
/// signal (SIGINT on all platforms, plus SIGTERM on Unix), then runs all
/// registered shutdown hooks.
///
/// This is intended to be used with [`axum::serve`]'s `with_graceful_shutdown`
/// method or in the main loop to handle clean exits.
pub async fn signal() {
    // Wait for the OS to send a termination signal.
    wait_for_signal().await;
    log::info!("[core] shutdown signal received, cleaning up background services");
    // Once received, run all registered cleanup tasks.
    run_hooks().await;
    log::info!("[core] all shutdown hooks completed");
}

/// Wait for either SIGINT (Ctrl-C) or SIGTERM (Unix termination signal).
///
/// This uses `tokio::signal` to asynchronously wait for these events.
async fn wait_for_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut sigterm =
            signal(SignalKind::terminate()).expect("failed to install SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {
                log::info!("[core] received SIGINT (Ctrl-C)");
            }
            _ = sigterm.recv() => {
                log::info!("[core] received SIGTERM");
            }
        }
    }

    #[cfg(not(unix))]
    {
        // On non-Unix platforms (like Windows), we only listen for Ctrl-C.
        let _ = tokio::signal::ctrl_c().await;
        log::info!("[core] received SIGINT (Ctrl-C)");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    #[test]
    fn register_does_not_panic() {
        register(|| async {});
    }

    #[tokio::test]
    async fn run_hooks_executes_registered_hooks() {
        let called = Arc::new(AtomicBool::new(false));
        let called_clone = called.clone();
        register(move || {
            let flag = called_clone.clone();
            async move {
                flag.store(true, Ordering::SeqCst);
            }
        });
        run_hooks().await;
        assert!(called.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn run_hooks_drains_hooks_so_second_call_is_noop() {
        let counter = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter_clone = counter.clone();
        register(move || {
            let c = counter_clone.clone();
            async move {
                c.fetch_add(1, Ordering::SeqCst);
            }
        });
        run_hooks().await;
        let first_count = counter.load(Ordering::SeqCst);
        run_hooks().await;
        // Second call should not re-run hooks (they were drained)
        assert_eq!(counter.load(Ordering::SeqCst), first_count);
    }
}
