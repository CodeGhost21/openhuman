//! Tests for Meta OAuth handoff helpers (#1952).

use super::{
    is_authorize_rate_limited, is_clearable_oauth_status, is_inflight_oauth_status,
    is_meta_oauth_toolkit, meta_oauth_rate_limit_message, wrap_authorize_rate_limit_error,
};

#[test]
fn meta_oauth_toolkit_detection() {
    assert!(is_meta_oauth_toolkit("instagram"));
    assert!(is_meta_oauth_toolkit("Facebook"));
    assert!(!is_meta_oauth_toolkit("gmail"));
}

#[test]
fn inflight_and_clearable_statuses() {
    assert!(is_inflight_oauth_status("pending"));
    assert!(is_inflight_oauth_status("INITIATED"));
    assert!(!is_inflight_oauth_status("ACTIVE"));

    assert!(is_clearable_oauth_status("FAILED"));
    assert!(is_clearable_oauth_status("EXPIRED"));
    assert!(!is_clearable_oauth_status("ACTIVE"));
}

#[test]
fn authorize_rate_limit_shape_detection() {
    assert!(is_authorize_rate_limited(
        "Backend returned 429 Too Many Requests"
    ));
    assert!(is_authorize_rate_limited("rate_limit exceeded"));
    assert!(!is_authorize_rate_limited("401 Unauthorized"));
}

#[test]
fn wrap_authorize_rate_limit_error_replaces_meta_toolkit_message() {
    let err = anyhow::anyhow!("Backend returned 429 Too Many Requests");
    let wrapped = wrap_authorize_rate_limit_error("instagram", err);
    let msg = format!("{wrapped:#}");
    assert!(msg.contains("Business or Creator"));
    assert!(msg.contains("429"));
}

#[test]
fn wrap_authorize_rate_limit_error_passthrough_for_non_meta() {
    let err = anyhow::anyhow!("Backend returned 429 Too Many Requests");
    let wrapped = wrap_authorize_rate_limit_error("gmail", err);
    assert!(format!("{wrapped:#}").contains("Backend returned 429"));
}

#[test]
fn meta_oauth_rate_limit_message_mentions_business_account() {
    let msg = meta_oauth_rate_limit_message("instagram");
    assert!(msg.to_ascii_lowercase().contains("business"));
}
