use super::flow::parse_callback_input;
use super::{
    complete_openai_oauth, disconnect_openai_oauth, openai_oauth_status, start_openai_oauth,
};
use crate::openhuman::config::Config;
use crate::openhuman::credentials::profiles::{AuthProfile, AuthProfilesStore, TokenSet};
use crate::openhuman::inference::openai_oauth::lookup_openai_bearer_token;
use crate::openhuman::inference::openai_oauth::store::{
    OPENAI_OAUTH_PROFILE_NAME, OPENAI_PROVIDER_KEY,
};
use chrono::{Duration, Utc};
use tempfile::tempdir;

fn test_config(tmp: &tempfile::TempDir) -> Config {
    let mut config = Config::default();
    config.config_path = tmp.path().join("config.toml");
    config
}

#[test]
fn start_openai_oauth_returns_authorize_url() {
    let tmp = tempdir().unwrap();
    let config = test_config(&tmp);

    let start = start_openai_oauth(&config).unwrap();
    assert!(start.auth_url.contains("auth.openai.com"));
    assert!(start.auth_url.contains("code_challenge="));
    assert_eq!(start.redirect_uri, "http://127.0.0.1:1455/auth/callback");
    assert!(!start.state.is_empty());
    assert!(!openai_oauth_status(&config).unwrap().connected);
}

#[test]
fn parse_callback_input_accepts_full_redirect_url() {
    let url = "http://127.0.0.1:1455/auth/callback?code=abc&state=xyz";
    let (code, state) = parse_callback_input(url).unwrap();
    assert_eq!(code, "abc");
    assert_eq!(state, "xyz");
}

#[test]
fn parse_callback_input_rejects_missing_code() {
    let err = parse_callback_input("http://127.0.0.1:1455/auth/callback?state=xyz").unwrap_err();
    assert!(err.contains("code"));
}

#[test]
fn complete_openai_oauth_rejects_state_mismatch() {
    let tmp = tempdir().unwrap();
    let config = test_config(&tmp);
    let start = start_openai_oauth(&config).unwrap();
    let callback = format!(
        "http://127.0.0.1:1455/auth/callback?code=fake&state=not-{}",
        start.state
    );
    let rt = tokio::runtime::Runtime::new().unwrap();
    let err = rt
        .block_on(complete_openai_oauth(&config, &callback))
        .unwrap_err();
    assert!(err.contains("state mismatch"));
}

#[test]
fn lookup_openai_bearer_token_prefers_api_key_over_oauth() {
    let tmp = tempdir().unwrap();
    let config = test_config(&tmp);
    let store = AuthProfilesStore::new(tmp.path(), false);

    let oauth_profile = AuthProfile::new_oauth(
        OPENAI_PROVIDER_KEY,
        OPENAI_OAUTH_PROFILE_NAME,
        TokenSet {
            access_token: "oauth-access".into(),
            refresh_token: Some("refresh".into()),
            id_token: None,
            expires_at: Some(Utc::now() + Duration::hours(1)),
            token_type: Some("Bearer".into()),
            scope: None,
        },
    );
    store.upsert_profile(oauth_profile, true).unwrap();

    let api_profile =
        AuthProfile::new_token("provider:openai", "default", "sk-api-key".to_string());
    store.upsert_profile(api_profile, true).unwrap();

    let token = lookup_openai_bearer_token(&config).unwrap();
    assert_eq!(token.as_deref(), Some("sk-api-key"));
}

#[test]
fn disconnect_openai_oauth_clears_profile() {
    let tmp = tempdir().unwrap();
    let config = test_config(&tmp);
    let store = AuthProfilesStore::new(tmp.path(), false);
    let profile = AuthProfile::new_oauth(
        OPENAI_PROVIDER_KEY,
        OPENAI_OAUTH_PROFILE_NAME,
        TokenSet {
            access_token: "oauth-access".into(),
            refresh_token: None,
            id_token: None,
            expires_at: None,
            token_type: Some("Bearer".into()),
            scope: None,
        },
    );
    store.upsert_profile(profile, true).unwrap();
    assert!(openai_oauth_status(&config).unwrap().connected);

    disconnect_openai_oauth(&config).unwrap();
    assert!(!openai_oauth_status(&config).unwrap().connected);
}
