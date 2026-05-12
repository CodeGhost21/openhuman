//! Typed error variants for backend API calls.
//!
//! The hosted backend now returns a structured JSON error envelope on non-2xx
//! responses:
//!
//! ```json
//! { "success": false, "code": "<machine_code>", "error": "<human message>" }
//! ```
//!
//! HTTP 402 with `code="billing_config_missing"` means the account is not
//! provisioned for AI features — retrying will not help. HTTP 5xx means a
//! transient backend fault — safe to retry with backoff (bounded). 429 carries
//! a `Retry-After` header indicating how long to wait before retrying.
//!
//! [`BackendApiError`] is the canonical typed surface; [`parse_backend_error`]
//! converts a raw HTTP response into it.

use reqwest::header::HeaderMap;

/// Machine-readable billing error codes returned by the backend.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BillingErrorCode {
    /// HTTP 402: `billing_config_missing` — account is not provisioned.
    /// Will NOT recover via retry; user action required.
    BillingConfigMissing,
    /// HTTP 400: `insufficient_budget` — account has run out of credits.
    InsufficientBudget,
    /// HTTP 429: `rate_limited` — too many requests; back off.
    RateLimited,
}

impl BillingErrorCode {
    /// Parse from the backend's `code` string field.
    pub fn from_code(code: &str) -> Option<Self> {
        match code {
            "billing_config_missing" => Some(Self::BillingConfigMissing),
            "insufficient_budget" => Some(Self::InsufficientBudget),
            "rate_limited" => Some(Self::RateLimited),
            _ => None,
        }
    }

    /// Canonical string representation matching the backend's `code` field.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::BillingConfigMissing => "billing_config_missing",
            Self::InsufficientBudget => "insufficient_budget",
            Self::RateLimited => "rate_limited",
        }
    }
}

impl std::fmt::Display for BillingErrorCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Typed error variants for backend HTTP API calls made by
/// [`crate::api::BackendOAuthClient`].
#[derive(Debug)]
pub enum BackendApiError {
    /// HTTP 402 or 400 with a billing-related code. The account is not
    /// provisioned or has run out of credits. Do NOT retry — requires user
    /// action (re-auth or dashboard visit).
    Billing(BillingErrorCode, String),

    /// HTTP 5xx — transient backend fault, safe to retry with bounded backoff.
    Server {
        status: u16,
        code: Option<String>,
        message: String,
    },

    /// HTTP 4xx (excluding 402 billing errors). Includes 429 with an optional
    /// `retry_after_secs` parsed from the `Retry-After` response header.
    Client {
        status: u16,
        code: Option<String>,
        message: String,
        /// Seconds to wait before retrying, parsed from `Retry-After` header.
        /// Clamped to ≤ 60 s so a hostile backend can't park the agent.
        retry_after_secs: Option<u32>,
    },

    /// Network / transport error (connection refused, timeout, TLS, …).
    Transport(reqwest::Error),
}

impl std::fmt::Display for BackendApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Billing(code, msg) => write!(f, "billing error ({code}): {msg}"),
            Self::Server {
                status,
                code,
                message,
            } => {
                if let Some(c) = code {
                    write!(f, "server error {status} ({c}): {message}")
                } else {
                    write!(f, "server error {status}: {message}")
                }
            }
            Self::Client {
                status,
                code,
                message,
                retry_after_secs,
            } => {
                if let Some(c) = code {
                    if let Some(ra) = retry_after_secs {
                        write!(
                            f,
                            "client error {status} ({c}) retry_after={ra}s: {message}"
                        )
                    } else {
                        write!(f, "client error {status} ({c}): {message}")
                    }
                } else if let Some(ra) = retry_after_secs {
                    write!(f, "client error {status} retry_after={ra}s: {message}")
                } else {
                    write!(f, "client error {status}: {message}")
                }
            }
            Self::Transport(e) => write!(f, "transport error: {e}"),
        }
    }
}

impl std::error::Error for BackendApiError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Transport(e) => Some(e),
            _ => None,
        }
    }
}

/// Parse a non-2xx HTTP response into a [`BackendApiError`].
///
/// Inspects the status code and attempts to decode the JSON body for the
/// structured envelope `{ success:false, code, error }`. Falls back to the
/// raw body text if JSON parsing fails.
///
/// # 429 Retry-After
///
/// For 429 responses the `Retry-After` header (integer seconds) is parsed and
/// clamped to `[0, 60]` so a buggy backend cannot park the caller indefinitely.
pub fn parse_backend_error(
    status: u16,
    response_body: &str,
    headers: &HeaderMap,
) -> BackendApiError {
    // Try to decode the structured envelope.
    let (parsed_code, parsed_message) = extract_code_and_message(response_body);

    match status {
        // 402 = Payment Required — billing errors.
        402 => {
            let billing_code = parsed_code
                .as_deref()
                .and_then(BillingErrorCode::from_code)
                .unwrap_or(BillingErrorCode::BillingConfigMissing);
            let message =
                parsed_message.unwrap_or_else(|| "billing configuration unavailable".to_string());
            BackendApiError::Billing(billing_code, message)
        }

        // 429 = Too Many Requests — parse Retry-After.
        429 => {
            let retry_after_secs = parse_retry_after(headers);
            BackendApiError::Client {
                status,
                code: parsed_code,
                message: parsed_message.unwrap_or_else(|| "rate limited".to_string()),
                retry_after_secs,
            }
        }

        // 4xx (including 400 with a possible billing code). 400 with a
        // billing code maps to Billing (e.g. insufficient_budget); other 4xx
        // fall through to Client.
        400..=499 => {
            if status == 400 {
                if let Some(code_str) = parsed_code.as_deref() {
                    if let Some(billing_code) = BillingErrorCode::from_code(code_str) {
                        let message = parsed_message.unwrap_or_else(|| "billing error".to_string());
                        return BackendApiError::Billing(billing_code, message);
                    }
                }
            }
            BackendApiError::Client {
                status,
                code: parsed_code,
                message: parsed_message.unwrap_or_else(|| response_body.to_string()),
                retry_after_secs: None,
            }
        }

        // 5xx = server error, transient, safe to retry.
        500..=599 => BackendApiError::Server {
            status,
            code: parsed_code,
            message: parsed_message.unwrap_or_else(|| response_body.to_string()),
        },

        // Unexpected (1xx, 3xx never expected from authed_json).
        _ => BackendApiError::Server {
            status,
            code: parsed_code,
            message: parsed_message.unwrap_or_else(|| response_body.to_string()),
        },
    }
}

/// Extract `code` and `error`/`message` from a JSON body of the form
/// `{ success:false, code:"...", error:"..." }`.
///
/// Returns `(Option<code>, Option<message>)`. Both may be `None` if the body
/// is not JSON or doesn't match the envelope shape.
fn extract_code_and_message(body: &str) -> (Option<String>, Option<String>) {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(body) else {
        return (None, None);
    };
    let Some(obj) = v.as_object() else {
        return (None, None);
    };

    let code = obj
        .get("code")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    let message = obj
        .get("error")
        .or_else(|| obj.get("message"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    (code, message)
}

/// Parse and clamp the `Retry-After` header value (integer seconds). Returns
/// `None` if the header is absent or unparseable. Clamps to ≤ 60 s so a
/// hostile backend cannot park the caller indefinitely.
fn parse_retry_after(headers: &HeaderMap) -> Option<u32> {
    let value = headers
        .get("retry-after")
        .or_else(|| headers.get("Retry-After"))
        .and_then(|v| v.to_str().ok())?;
    let secs: u32 = value.trim().parse().ok()?;
    Some(secs.min(60))
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::HeaderMap;

    fn empty_headers() -> HeaderMap {
        HeaderMap::new()
    }

    fn headers_with_retry_after(secs: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert("retry-after", secs.parse().unwrap());
        h
    }

    // ── BillingErrorCode ────────────────────────────────────────────────────

    #[test]
    fn billing_code_from_billing_config_missing() {
        let code = BillingErrorCode::from_code("billing_config_missing");
        assert_eq!(code, Some(BillingErrorCode::BillingConfigMissing));
    }

    #[test]
    fn billing_code_from_rate_limited() {
        let code = BillingErrorCode::from_code("rate_limited");
        assert_eq!(code, Some(BillingErrorCode::RateLimited));
    }

    #[test]
    fn billing_code_from_unknown_returns_none() {
        assert_eq!(BillingErrorCode::from_code("unknown_code"), None);
        assert_eq!(BillingErrorCode::from_code(""), None);
    }

    // ── parse_backend_error: 402 billing_config_missing ────────────────────

    #[test]
    fn parse_402_billing_config_missing() {
        let body = r#"{"success":false,"code":"billing_config_missing","error":"Billing configuration is unavailable for this account"}"#;
        let err = parse_backend_error(402, body, &empty_headers());
        match err {
            BackendApiError::Billing(BillingErrorCode::BillingConfigMissing, msg) => {
                assert!(
                    msg.contains("Billing configuration"),
                    "expected billing message, got: {msg}"
                );
            }
            other => panic!("expected Billing(BillingConfigMissing, _), got {other}"),
        }
    }

    #[test]
    fn parse_402_no_code_defaults_to_billing_config_missing() {
        let body = r#"{"success":false,"error":"payment required"}"#;
        let err = parse_backend_error(402, body, &empty_headers());
        match err {
            BackendApiError::Billing(BillingErrorCode::BillingConfigMissing, _) => {}
            other => panic!("expected Billing(BillingConfigMissing, _), got {other}"),
        }
    }

    // ── parse_backend_error: 500 internal_error ─────────────────────────────

    #[test]
    fn parse_500_internal_error() {
        let body = r#"{"success":false,"code":"internal_error","error":"Internal server error"}"#;
        let err = parse_backend_error(500, body, &empty_headers());
        match err {
            BackendApiError::Server {
                status,
                code,
                message,
            } => {
                assert_eq!(status, 500);
                assert_eq!(code.as_deref(), Some("internal_error"));
                assert!(message.contains("Internal server error"), "got: {message}");
            }
            other => panic!("expected Server, got {other}"),
        }
    }

    #[test]
    fn parse_500_plain_text_body() {
        let err = parse_backend_error(500, "Internal Server Error", &empty_headers());
        match err {
            BackendApiError::Server {
                status: 500,
                code: None,
                ..
            } => {}
            other => panic!("expected Server 500 with no code, got {other}"),
        }
    }

    // ── parse_backend_error: 429 rate-limit ─────────────────────────────────

    #[test]
    fn parse_429_with_retry_after() {
        let body = r#"{"success":false,"code":"rate_limited","error":"Too many requests"}"#;
        let headers = headers_with_retry_after("30");
        let err = parse_backend_error(429, body, &headers);
        match err {
            BackendApiError::Client {
                status: 429,
                code,
                retry_after_secs,
                ..
            } => {
                assert_eq!(code.as_deref(), Some("rate_limited"));
                assert_eq!(retry_after_secs, Some(30));
            }
            other => panic!("expected Client 429, got {other}"),
        }
    }

    #[test]
    fn parse_retry_after_clamped_to_60() {
        let body = r#"{"success":false,"error":"slow down"}"#;
        let headers = headers_with_retry_after("120");
        let err = parse_backend_error(429, body, &headers);
        match err {
            BackendApiError::Client {
                retry_after_secs: Some(secs),
                ..
            } => {
                assert!(
                    secs <= 60,
                    "retry_after_secs must be clamped to ≤ 60, got {secs}"
                );
            }
            other => panic!("expected Client with retry_after, got {other}"),
        }
    }

    #[test]
    fn parse_429_no_retry_after_header() {
        let body = r#"{"success":false,"error":"rate limited"}"#;
        let err = parse_backend_error(429, body, &empty_headers());
        match err {
            BackendApiError::Client {
                status: 429,
                retry_after_secs: None,
                ..
            } => {}
            other => panic!("expected Client 429 with no retry_after, got {other}"),
        }
    }

    // ── parse_backend_error: 400 with billing code ──────────────────────────

    #[test]
    fn parse_400_insufficient_budget_maps_to_billing() {
        let body =
            r#"{"success":false,"code":"insufficient_budget","error":"Insufficient budget"}"#;
        let err = parse_backend_error(400, body, &empty_headers());
        match err {
            BackendApiError::Billing(BillingErrorCode::InsufficientBudget, _) => {}
            other => panic!("expected Billing(InsufficientBudget), got {other}"),
        }
    }

    #[test]
    fn parse_400_non_billing_code_maps_to_client() {
        let body = r#"{"success":false,"code":"validation_error","error":"Bad request"}"#;
        let err = parse_backend_error(400, body, &empty_headers());
        match err {
            BackendApiError::Client {
                status: 400, code, ..
            } => {
                assert_eq!(code.as_deref(), Some("validation_error"));
            }
            other => panic!("expected Client 400, got {other}"),
        }
    }
}
