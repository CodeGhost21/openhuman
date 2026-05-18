//! Known model context-window sizes for pre-inference budgeting.
//!
//! Provider `/models` responses may include `context_length` / `context_window`,
//! but the agent harness must enforce limits **before** the first dispatch —
//! otherwise long histories produce upstream `400 Bad Request` errors when usage
//! metadata is not yet available.

use crate::openhuman::config::{
    MODEL_AGENTIC_V1, MODEL_CODING_V1, MODEL_REASONING_QUICK_V1, MODEL_REASONING_V1,
};

/// Conservative default for OpenHuman abstract tier models (tokens).
const TIER_LARGE_CONTEXT: u64 = 200_000;
const TIER_STANDARD_CONTEXT: u64 = 128_000;
const TIER_LOCAL_CONTEXT: u64 = 8_192;

/// `(substring pattern, context window in tokens)` — first match wins.
const MODEL_CONTEXT_PATTERNS: &[(&str, u64)] = &[
    ("claude-haiku-4.5", 200_000),
    ("claude-haiku-4", 200_000),
    ("claude-haiku", 200_000),
    ("claude-sonnet-4", 200_000),
    ("claude-opus-4", 200_000),
    ("claude-3-5-sonnet", 200_000),
    ("claude-3-5-haiku", 200_000),
    ("claude-3-opus", 200_000),
    ("gpt-4.1", 1_047_576),
    ("gpt-4o", 128_000),
    ("gpt-4-turbo", 128_000),
    ("gpt-4", 128_000),
    ("gpt-3.5", 16_385),
    ("o1", 200_000),
    ("o3", 200_000),
    ("deepseek", 128_000),
    ("gemma3", 8_192),
    ("gemma", 8_192),
    ("llama-3", 128_000),
    ("llama3", 128_000),
];

/// Resolve the context window (in tokens) for a model id or OpenHuman tier alias.
///
/// Returns `None` when the model is unknown — callers should skip pre-dispatch
/// trimming rather than guess.
pub fn context_window_for_model(model: &str) -> Option<u64> {
    let normalized = model.trim();
    if normalized.is_empty() {
        return None;
    }

    if let Some(window) = tier_context_window(normalized) {
        return Some(window);
    }

    let lower = normalized.to_ascii_lowercase();
    for (pattern, window) in MODEL_CONTEXT_PATTERNS {
        if lower.contains(pattern) {
            tracing::debug!(
                model = normalized,
                pattern,
                context_window = window,
                "[model_context] matched known model pattern"
            );
            return Some(*window);
        }
    }

    None
}

fn tier_context_window(model: &str) -> Option<u64> {
    match model {
        MODEL_REASONING_V1 | MODEL_AGENTIC_V1 | MODEL_CODING_V1 => Some(TIER_LARGE_CONTEXT),
        MODEL_REASONING_QUICK_V1 | "summarization-v1" | "chat" => Some(TIER_STANDARD_CONTEXT),
        m if m.starts_with("gemma") || m.contains(":1b") || m.contains("270m") => {
            Some(TIER_LOCAL_CONTEXT)
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tier_aliases_resolve() {
        assert_eq!(context_window_for_model("reasoning-v1"), Some(200_000));
        assert_eq!(context_window_for_model("agentic-v1"), Some(200_000));
        assert_eq!(
            context_window_for_model("reasoning-quick-v1"),
            Some(128_000)
        );
    }

    #[test]
    fn copilot_haiku_resolves_to_200k() {
        assert_eq!(
            context_window_for_model("github_copilot/claude-haiku-4.5"),
            Some(200_000)
        );
    }

    #[test]
    fn unknown_model_returns_none() {
        assert_eq!(context_window_for_model("totally-unknown-model-xyz"), None);
    }

    #[test]
    fn empty_model_returns_none() {
        assert_eq!(context_window_for_model("   "), None);
    }
}
