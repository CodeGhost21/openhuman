use serde_json::Value;

/// Formats a JSON-RPC request ID into a human-readable string.
///
/// Handles different JSON types (String, Number, Null) to ensure consistent
/// output in log messages.
pub fn format_request_id(id: &Value) -> String {
    match id {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Null => "null".to_string(),
        other => other.to_string(),
    }
}

/// Redacts sensitive keys from a JSON parameters object before logging.
///
/// This is used to prevent accidental leakage of API keys, tokens, and passwords
/// in debug logs.
pub fn redact_params_for_log(params: &Value) -> Value {
    redact_value(params)
}

/// Produces a short summary of a JSON value, useful for high-level logging.
///
/// Instead of printing a potentially massive object/array, it returns a
/// string like `object(keys=foo,bar)` or `array(len=10)`.
pub fn summarize_rpc_result(result: &Value) -> String {
    match result {
        Value::Object(map) => {
            let mut keys = map.keys().cloned().collect::<Vec<_>>();
            keys.sort();
            format!("object(keys={})", keys.join(","))
        }
        Value::Array(items) => format!("array(len={})", items.len()),
        Value::String(s) => format!("string(len={})", s.len()),
        Value::Bool(b) => format!("bool({b})"),
        Value::Number(n) => format!("number({n})"),
        Value::Null => "null".to_string(),
    }
}

/// Redacts sensitive keys from a JSON result object before trace logging.
pub fn redact_result_for_trace(result: &Value) -> Value {
    redact_value(result)
}

/// Recursively redacts sensitive information from a JSON value.
///
/// It traverses objects and arrays, replacing values of keys that match
/// [`is_sensitive_key`] with `[REDACTED]`.
fn redact_value(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (k, v) in map {
                if is_sensitive_key(k) {
                    out.insert(k.clone(), Value::String("[REDACTED]".to_string()));
                } else {
                    out.insert(k.clone(), redact_value(v));
                }
            }
            Value::Object(out)
        }
        Value::Array(items) => Value::Array(items.iter().map(redact_value).collect()),
        other => other.clone(),
    }
}

/// Returns true if a key name is considered sensitive (e.g., "api_key", "password").
fn is_sensitive_key(key: &str) -> bool {
    matches!(
        key,
        "api_key"
            | "apikey"
            | "token"
            | "access_token"
            | "refresh_token"
            | "authorization"
            | "password"
            | "secret"
            | "client_secret"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ── format_request_id ────────────────────────────────────────────

    #[test]
    fn format_request_id_string() {
        assert_eq!(format_request_id(&json!("req-1")), "req-1");
    }

    #[test]
    fn format_request_id_number() {
        assert_eq!(format_request_id(&json!(42)), "42");
    }

    #[test]
    fn format_request_id_null() {
        assert_eq!(format_request_id(&Value::Null), "null");
    }

    #[test]
    fn format_request_id_other() {
        let id = format_request_id(&json!(true));
        assert_eq!(id, "true");
    }

    // ── summarize_rpc_result ─────────────────────────────────────────

    #[test]
    fn summarize_object() {
        let v = json!({"b": 1, "a": 2});
        let s = summarize_rpc_result(&v);
        assert_eq!(s, "object(keys=a,b)");
    }

    #[test]
    fn summarize_array() {
        let v = json!([1, 2, 3]);
        assert_eq!(summarize_rpc_result(&v), "array(len=3)");
    }

    #[test]
    fn summarize_string() {
        let v = json!("hello");
        assert_eq!(summarize_rpc_result(&v), "string(len=5)");
    }

    #[test]
    fn summarize_bool() {
        assert_eq!(summarize_rpc_result(&json!(true)), "bool(true)");
    }

    #[test]
    fn summarize_number() {
        assert_eq!(summarize_rpc_result(&json!(42)), "number(42)");
    }

    #[test]
    fn summarize_null() {
        assert_eq!(summarize_rpc_result(&Value::Null), "null");
    }

    // ── redact_params_for_log / redact_result_for_trace ──────────────

    #[test]
    fn redact_sensitive_keys() {
        let params = json!({
            "api_key": "sk-secret-123",
            "model": "gpt-4",
            "token": "bearer-tok",
            "safe_field": "visible"
        });
        let redacted = redact_params_for_log(&params);
        assert_eq!(redacted["api_key"], "[REDACTED]");
        assert_eq!(redacted["token"], "[REDACTED]");
        assert_eq!(redacted["model"], "gpt-4");
        assert_eq!(redacted["safe_field"], "visible");
    }

    #[test]
    fn redact_nested_objects() {
        let params = json!({
            "config": {
                "password": "s3cr3t",
                "name": "test"
            }
        });
        let redacted = redact_params_for_log(&params);
        assert_eq!(redacted["config"]["password"], "[REDACTED]");
        assert_eq!(redacted["config"]["name"], "test");
    }

    #[test]
    fn redact_arrays() {
        let params = json!([{"api_key": "secret"}, {"name": "ok"}]);
        let redacted = redact_params_for_log(&params);
        assert_eq!(redacted[0]["api_key"], "[REDACTED]");
        assert_eq!(redacted[1]["name"], "ok");
    }

    #[test]
    fn redact_non_object_passthrough() {
        assert_eq!(redact_params_for_log(&json!("hello")), json!("hello"));
        assert_eq!(redact_params_for_log(&json!(42)), json!(42));
        assert_eq!(redact_params_for_log(&Value::Null), Value::Null);
    }

    #[test]
    fn redact_result_same_as_params() {
        let v = json!({"secret": "x", "ok": "y"});
        let r = redact_result_for_trace(&v);
        assert_eq!(r["secret"], "[REDACTED]");
        assert_eq!(r["ok"], "y");
    }

    // ── is_sensitive_key ─────────────────────────────────────────────

    #[test]
    fn sensitive_keys() {
        for key in [
            "api_key",
            "apikey",
            "token",
            "access_token",
            "refresh_token",
            "authorization",
            "password",
            "secret",
            "client_secret",
        ] {
            assert!(is_sensitive_key(key), "'{key}' should be sensitive");
        }
    }

    #[test]
    fn non_sensitive_keys() {
        for key in ["model", "name", "id", "method", "params", "result"] {
            assert!(!is_sensitive_key(key), "'{key}' should NOT be sensitive");
        }
    }
}
