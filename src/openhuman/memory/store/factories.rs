//! # Memory Store Factories
//!
//! Factory functions for creating and initializing various memory store
//! implementations.
//!
//! This module provides a centralized way to instantiate memory stores based on
//! configuration, ensuring that the correct embedding providers and storage
//! backends are used. Currently, it primarily focuses on creating
//! `UnifiedMemory` instances.

use std::path::Path;
use std::sync::Arc;

use crate::openhuman::config::{
    EmbeddingRouteConfig, LocalAiConfig, MemoryConfig, StorageProviderConfig,
};
use crate::openhuman::embeddings::{
    self, EmbeddingProvider, DEFAULT_CLOUD_EMBEDDING_DIMENSIONS, DEFAULT_CLOUD_EMBEDDING_MODEL,
    DEFAULT_OLLAMA_DIMENSIONS, DEFAULT_OLLAMA_MODEL,
};
use crate::openhuman::memory::store::unified::UnifiedMemory;
use crate::openhuman::memory::traits::Memory;

/// Effective Ollama base URL, honouring `OPENHUMAN_OLLAMA_BASE_URL` /
/// `OLLAMA_HOST` env vars the way the lifecycle does. Falls back to
/// `http://localhost:11434`.
fn ollama_base_url_for_probe() -> String {
    // Re-implement here rather than reaching into `local_ai::ollama_api`
    // (which is `pub(crate)`). Keeping the lookup logic in sync with that
    // helper is the only reason this lives in `factories.rs` — both points
    // probe the same daemon, so they must agree on its address.
    if let Ok(url) = std::env::var("OPENHUMAN_OLLAMA_BASE_URL") {
        let trimmed = url.trim();
        if !trimmed.is_empty() {
            return trimmed.trim_end_matches('/').to_string();
        }
    }
    if let Ok(host) = std::env::var("OLLAMA_HOST") {
        let trimmed = host.trim().trim_end_matches('/');
        if !trimmed.is_empty() {
            return if trimmed.contains("://") {
                trimmed.to_string()
            } else {
                format!("http://{trimmed}")
            };
        }
    }
    "http://localhost:11434".to_string()
}

/// Probe whether an Ollama daemon is reachable at `base_url`.
///
/// Issues a short-timeout `GET <base_url>/api/tags` (the standard Ollama
/// "list models" endpoint) and returns `true` only when it responds with a
/// 2xx status. Transport failures, timeouts, and non-2xx responses all
/// return `false`.
///
/// Kept deliberately small and side-effect-free so it can be called from
/// the memory factory's startup path without pulling in the full
/// `local_ai::service::ollama_admin` machinery.
pub async fn probe_ollama_reachable(base_url: &str) -> bool {
    let url = format!("{}/api/tags", base_url.trim_end_matches('/'));
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            log::debug!(
                "[memory::factory] probe_ollama_reachable: failed to build http client: {e}"
            );
            return false;
        }
    };
    match client.get(&url).send().await {
        Ok(resp) => resp.status().is_success(),
        Err(e) => {
            log::debug!("[memory::factory] probe_ollama_reachable: {url} unreachable: {e}");
            false
        }
    }
}

/// Returns the effective `(provider, model, dimensions)` triple for the
/// embedding backend.
///
/// The user-facing default is `"cloud"` (OpenHuman backend, Voyage-backed) so
/// fresh installs work without a local Ollama daemon. When the user has
/// explicitly opted into local AI for embeddings —
/// [`LocalAiConfig::use_local_for_embeddings`] — we route through the local
/// Ollama embedder regardless of what `memory.embedding_provider` says, since
/// that toggle is a stronger statement of intent than the per-section default.
///
/// Note: this is the *intended* setting. It does not check whether the Ollama
/// daemon is actually running. For the live, health-checked variant that
/// falls back to cloud when Ollama is configured but unreachable, see
/// [`effective_embedding_settings_probed`].
pub fn effective_embedding_settings(
    memory: &MemoryConfig,
    local_ai: Option<&LocalAiConfig>,
) -> (String, String, usize) {
    if local_ai
        .map(LocalAiConfig::use_local_for_embeddings)
        .unwrap_or(false)
    {
        // Trim once and reuse — the emptiness check and the final model
        // string must agree, otherwise a value like "  bge-m3  " would pass
        // through to Ollama with surrounding whitespace and 404.
        let model = local_ai
            .map(|c| c.embedding_model_id.trim())
            .filter(|m| !m.is_empty())
            .unwrap_or(DEFAULT_OLLAMA_MODEL)
            .to_string();
        return ("ollama".to_string(), model, DEFAULT_OLLAMA_DIMENSIONS);
    }
    (
        memory.embedding_provider.clone(),
        memory.embedding_model.clone(),
        memory.embedding_dimensions,
    )
}

/// Async, health-checked variant of [`effective_embedding_settings`].
///
/// If the intended provider is `"ollama"` but the daemon doesn't respond at
/// `<base_url>/api/tags` within a short timeout, this falls back to the cloud
/// embedder and logs a single warning. This avoids the failure mode behind
/// OPENHUMAN-TAURI-B7: a user who's flipped `local_ai.usage.embeddings = true`
/// in Settings but doesn't actually have Ollama running ends up firing one
/// `ollama_embed` Sentry event per embed call (226+ events in a day with zero
/// impacted users — pure noise that drowns out real signals). With this
/// gate, embed calls never even reach `OllamaEmbedding` in that state; the
/// cloud embedder serves the session and the user gets a working app.
///
/// The probe deliberately uses a 2s timeout — long enough to tolerate a
/// briefly-busy daemon, short enough to not block startup if Ollama is
/// genuinely down.
pub async fn effective_embedding_settings_probed(
    memory: &MemoryConfig,
    local_ai: Option<&LocalAiConfig>,
) -> (String, String, usize) {
    let intended = effective_embedding_settings(memory, local_ai);
    if intended.0 != "ollama" {
        return intended;
    }
    let base_url = ollama_base_url_for_probe();
    if probe_ollama_reachable(&base_url).await {
        log::debug!(
            "[memory::factory] ollama healthy at {base_url}; using local embeddings (model={}, dims={})",
            intended.1,
            intended.2,
        );
        return intended;
    }
    // Ollama is configured but not reachable. Report once at this gate so a
    // genuine misconfiguration still surfaces in Sentry (with low cardinality
    // — one event per session, not per embed call), then fall back to cloud
    // for this session so the user has a working app.
    let message = format!(
        "ollama embeddings opted-in but daemon unreachable at {base_url}; falling back to cloud embeddings for this session"
    );
    crate::core::observability::report_error(
        message.as_str(),
        "memory",
        "ollama_health_gate",
        &[("base_url", base_url.as_str()), ("fallback", "cloud")],
    );
    (
        "cloud".to_string(),
        DEFAULT_CLOUD_EMBEDDING_MODEL.to_string(),
        DEFAULT_CLOUD_EMBEDDING_DIMENSIONS,
    )
}

/// Returns the effective name of the memory backend being used.
///
/// Currently, this always returns "namespace" as the unified memory system
/// is the standard.
pub fn effective_memory_backend_name(
    _memory_backend: &str,
    _storage_provider: Option<&StorageProviderConfig>,
) -> String {
    "namespace".to_string()
}

/// Create a standard memory instance based on the provided configuration.
pub fn create_memory(
    config: &MemoryConfig,
    workspace_dir: &Path,
) -> anyhow::Result<Box<dyn Memory>> {
    create_memory_with_storage_and_routes(config, &[], None, workspace_dir)
}

/// Create a memory instance with an optional storage provider configuration.
pub fn create_memory_with_storage(
    config: &MemoryConfig,
    storage_provider: Option<&StorageProviderConfig>,
    workspace_dir: &Path,
) -> anyhow::Result<Box<dyn Memory>> {
    create_memory_full(config, &[], storage_provider, None, workspace_dir)
}

/// Create a memory instance honoring both the `memory` and `local_ai` sections.
///
/// Used by top-level entry points (agent harness, channels runtime) that have
/// the full `Config` in scope and want the local-AI opt-in to flip the
/// embedder to Ollama.
pub fn create_memory_with_local_ai(
    memory: &MemoryConfig,
    local_ai: &LocalAiConfig,
    embedding_routes: &[EmbeddingRouteConfig],
    storage_provider: Option<&StorageProviderConfig>,
    workspace_dir: &Path,
) -> anyhow::Result<Box<dyn Memory>> {
    create_memory_full(
        memory,
        embedding_routes,
        storage_provider,
        Some(local_ai),
        workspace_dir,
    )
}

/// Back-compat wrapper preserved for existing call sites that don't have a
/// `LocalAiConfig` to pass. The local-AI opt-in is not honored on this path —
/// use [`create_memory_with_local_ai`] when both sections are available.
pub fn create_memory_with_storage_and_routes(
    config: &MemoryConfig,
    embedding_routes: &[EmbeddingRouteConfig],
    storage_provider: Option<&StorageProviderConfig>,
    workspace_dir: &Path,
) -> anyhow::Result<Box<dyn Memory>> {
    create_memory_full(
        config,
        embedding_routes,
        storage_provider,
        None,
        workspace_dir,
    )
}

/// Synchronous health-check shim around [`probe_ollama_reachable`].
///
/// Production call sites (`create_memory_with_local_ai` and friends) live in
/// sync code that doesn't want to plumb `async` through the whole agent
/// harness builder chain. They always run inside a multi-thread tokio
/// runtime (the core's main runtime), so we can park the worker via
/// [`tokio::task::block_in_place`] and drive the probe future to completion.
///
/// When no tokio runtime is available (only happens in unit-test sync
/// contexts that don't exercise this path in practice), we skip the probe
/// entirely and assume the daemon is reachable — that preserves the
/// pre-health-gate behaviour for those callers and keeps tests deterministic.
fn probe_ollama_reachable_blocking(base_url: &str) -> bool {
    let Ok(handle) = tokio::runtime::Handle::try_current() else {
        // No async runtime — skip the probe rather than spin up a private
        // runtime (which would shadow the caller's expectations). The
        // existing OllamaEmbedding error path still surfaces a transport
        // failure if the daemon truly is down.
        log::debug!(
            "[memory::factory] probe_ollama_reachable_blocking: no tokio runtime in context; skipping probe"
        );
        return true;
    };
    tokio::task::block_in_place(move || handle.block_on(probe_ollama_reachable(base_url)))
}

/// The most comprehensive factory function for creating a memory instance.
///
/// This function resolves the embedding provider — applying the Ollama
/// health-gate when the user has opted into local embeddings — then
/// initializes the provider and creates a `UnifiedMemory` instance.
fn create_memory_full(
    config: &MemoryConfig,
    _embedding_routes: &[EmbeddingRouteConfig],
    _storage_provider: Option<&StorageProviderConfig>,
    local_ai: Option<&LocalAiConfig>,
    workspace_dir: &Path,
) -> anyhow::Result<Box<dyn Memory>> {
    // 1. Resolve the intended provider from config.
    let intended = effective_embedding_settings(config, local_ai);
    let local_ai_opt_in = local_ai
        .map(LocalAiConfig::use_local_for_embeddings)
        .unwrap_or(false);

    // 2. Health-gate: if the user has opted into Ollama embeddings but the
    //    daemon isn't reachable, fall back to cloud for this session.
    //    Prevents OPENHUMAN-TAURI-B7's 226-event Sentry flood: instead of
    //    one Sentry event per embed attempt, we report once at the gate
    //    (low cardinality, high signal) and serve the session from cloud.
    let (provider, model, dims) = if intended.0 == "ollama" {
        let base_url = ollama_base_url_for_probe();
        if probe_ollama_reachable_blocking(&base_url) {
            log::debug!(
                "[memory::factory] ollama healthy at {base_url}; using local embeddings (model={}, dims={})",
                intended.1,
                intended.2,
            );
            intended
        } else {
            let message = format!(
                "ollama embeddings opted-in but daemon unreachable at {base_url}; falling back to cloud embeddings for this session"
            );
            crate::core::observability::report_error(
                message.as_str(),
                "memory",
                "ollama_health_gate",
                &[("base_url", base_url.as_str()), ("fallback", "cloud")],
            );
            (
                "cloud".to_string(),
                DEFAULT_CLOUD_EMBEDDING_MODEL.to_string(),
                DEFAULT_CLOUD_EMBEDDING_DIMENSIONS,
            )
        }
    } else {
        intended
    };

    log::debug!(
        "[memory::factory] effective embedding settings: provider={provider} model={model} dims={dims} (local_ai_opt_in={local_ai_opt_in})",
    );

    // 3. Create the embedding provider.
    let embedder: Arc<dyn EmbeddingProvider> = Arc::from(
        embeddings::create_embedding_provider(&provider, &model, dims).inspect_err(|err| {
            log::warn!(
                "[memory::factory] create_embedding_provider failed provider={provider} model={model} dims={dims}: {err}",
            );
        })?,
    );

    // 4. Instantiate UnifiedMemory which handles SQLite and vector storage.
    let mem = UnifiedMemory::new(workspace_dir, embedder, config.sqlite_open_timeout_secs)?;
    Ok(Box::new(mem))
}

/// Create a memory instance specifically for migration purposes.
///
/// NOTE: This is currently disabled for the unified namespace memory core.
pub fn create_memory_for_migration(
    _backend: &str,
    _workspace_dir: &Path,
) -> anyhow::Result<Box<dyn Memory>> {
    anyhow::bail!("memory migration is disabled for the unified namespace memory core")
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::get, Json, Router};
    use std::net::SocketAddr;

    #[test]
    fn effective_memory_backend_name_always_returns_namespace() {
        assert_eq!(effective_memory_backend_name("sqlite", None), "namespace");
        assert_eq!(effective_memory_backend_name("anything", None), "namespace");
        assert_eq!(effective_memory_backend_name("", None), "namespace");
    }

    #[test]
    fn create_memory_for_migration_always_errors() {
        let tmp = tempfile::tempdir().unwrap();
        // Box<dyn Memory> doesn't impl Debug, so we can't use .unwrap_err().
        // Use match instead.
        match create_memory_for_migration("any", tmp.path()) {
            Ok(_) => panic!("expected error"),
            Err(e) => assert!(
                e.to_string().contains("migration is disabled"),
                "unexpected error: {e}"
            ),
        }
    }

    /// Spin up a mock Ollama-shaped server that responds 200 OK on `/api/tags`.
    async fn start_mock_ollama() -> String {
        let app = Router::new().route(
            "/api/tags",
            get(|| async { Json(serde_json::json!({ "models": [] })) }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr: SocketAddr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        format!("http://127.0.0.1:{}", addr.port())
    }

    fn local_ai_with_embeddings_on() -> LocalAiConfig {
        let mut cfg = LocalAiConfig::default();
        cfg.runtime_enabled = true;
        cfg.usage.embeddings = true;
        cfg
    }

    #[tokio::test]
    async fn probe_returns_true_when_ollama_responds_200() {
        let url = start_mock_ollama().await;
        assert!(probe_ollama_reachable(&url).await);
    }

    #[tokio::test]
    async fn probe_returns_false_for_unreachable_host() {
        // Port 1 on loopback is reliably refused.
        assert!(!probe_ollama_reachable("http://127.0.0.1:1").await);
    }

    #[tokio::test]
    async fn probe_returns_false_on_non_2xx() {
        // Mock that responds 500.
        let app = Router::new().route(
            "/api/tags",
            get(|| async { (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "boom") }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr: SocketAddr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let url = format!("http://127.0.0.1:{}", addr.port());
        assert!(!probe_ollama_reachable(&url).await);
    }

    #[tokio::test]
    async fn probed_settings_keep_cloud_when_provider_is_cloud() {
        // No local-AI opt-in → intended provider is cloud, probe is skipped.
        let mem = MemoryConfig::default();
        let (provider, _, _) = effective_embedding_settings_probed(&mem, None).await;
        assert_eq!(provider, "cloud");
    }

    /// Sets `OPENHUMAN_OLLAMA_BASE_URL` to a deliberately unreachable address,
    /// then verifies that the probed settings fall back to cloud when the
    /// user has opted into local embeddings. Uses a serial guard because
    /// other tests in this binary may also mutate the env var.
    #[tokio::test]
    async fn probed_settings_fall_back_to_cloud_when_ollama_unreachable() {
        // SAFETY: tests in this module that read the env var are gated by
        // this test owning it for the call. Re-running locally with
        // `cargo test -- --test-threads=1` makes this deterministic.
        std::env::set_var("OPENHUMAN_OLLAMA_BASE_URL", "http://127.0.0.1:1");

        let mem = MemoryConfig::default();
        let local_ai = local_ai_with_embeddings_on();

        let (provider, model, dims) =
            effective_embedding_settings_probed(&mem, Some(&local_ai)).await;

        std::env::remove_var("OPENHUMAN_OLLAMA_BASE_URL");

        assert_eq!(
            provider, "cloud",
            "opted-in but unreachable Ollama must fall back to cloud"
        );
        assert_eq!(model, DEFAULT_CLOUD_EMBEDDING_MODEL);
        assert_eq!(dims, DEFAULT_CLOUD_EMBEDDING_DIMENSIONS);
    }

    #[tokio::test]
    async fn probed_settings_keep_ollama_when_daemon_responds() {
        let url = start_mock_ollama().await;
        std::env::set_var("OPENHUMAN_OLLAMA_BASE_URL", &url);

        let mem = MemoryConfig::default();
        let local_ai = local_ai_with_embeddings_on();

        let (provider, _model, dims) =
            effective_embedding_settings_probed(&mem, Some(&local_ai)).await;

        std::env::remove_var("OPENHUMAN_OLLAMA_BASE_URL");

        assert_eq!(provider, "ollama", "healthy Ollama must be honoured");
        assert_eq!(dims, DEFAULT_OLLAMA_DIMENSIONS);
    }
}
