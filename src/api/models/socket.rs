use serde::{Deserialize, Serialize};

/// Socket connection status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
pub enum ConnectionStatus {
    #[default]
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
    Error,
}

/// Socket connection state emitted to frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocketState {
    pub status: ConnectionStatus,
    pub socket_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl Default for SocketState {
    fn default() -> Self {
        Self {
            status: ConnectionStatus::Disconnected,
            socket_id: None,
            error: None,
        }
    }
}

/// Generic socket message wrapper
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocketMessage {
    pub event: String,
    pub data: serde_json::Value,
}

/// MCP request structure (JSON-RPC 2.0)
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpRequest {
    pub jsonrpc: String,
    pub id: serde_json::Value,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

/// MCP response structure (JSON-RPC 2.0)
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpResponse {
    pub jsonrpc: String,
    pub id: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<McpError>,
}

/// MCP error structure
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn connection_status_default_is_disconnected() {
        assert_eq!(ConnectionStatus::default(), ConnectionStatus::Disconnected);
    }

    #[test]
    fn connection_status_serde_roundtrip() {
        for status in [
            ConnectionStatus::Disconnected,
            ConnectionStatus::Connecting,
            ConnectionStatus::Connected,
            ConnectionStatus::Reconnecting,
            ConnectionStatus::Error,
        ] {
            let json = serde_json::to_string(&status).unwrap();
            let back: ConnectionStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(back, status);
        }
    }

    #[test]
    fn connection_status_serializes_lowercase() {
        assert_eq!(
            serde_json::to_string(&ConnectionStatus::Connected).unwrap(),
            "\"connected\""
        );
        assert_eq!(
            serde_json::to_string(&ConnectionStatus::Reconnecting).unwrap(),
            "\"reconnecting\""
        );
    }

    #[test]
    fn socket_state_default() {
        let state = SocketState::default();
        assert_eq!(state.status, ConnectionStatus::Disconnected);
        assert!(state.socket_id.is_none());
        assert!(state.error.is_none());
    }

    #[test]
    fn socket_state_serde_roundtrip() {
        let state = SocketState {
            status: ConnectionStatus::Connected,
            socket_id: Some("abc-123".into()),
            error: None,
        };
        let json = serde_json::to_string(&state).unwrap();
        let back: SocketState = serde_json::from_str(&json).unwrap();
        assert_eq!(back.status, ConnectionStatus::Connected);
        assert_eq!(back.socket_id.as_deref(), Some("abc-123"));
    }

    #[test]
    fn socket_state_skips_none_error_in_json() {
        let state = SocketState::default();
        let json = serde_json::to_string(&state).unwrap();
        assert!(!json.contains("error"));
    }

    #[test]
    fn socket_message_serde() {
        let msg = SocketMessage {
            event: "test".into(),
            data: json!({"key": "val"}),
        };
        let json = serde_json::to_string(&msg).unwrap();
        let back: SocketMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(back.event, "test");
        assert_eq!(back.data["key"], "val");
    }

    #[test]
    fn mcp_request_serde() {
        let req = McpRequest {
            jsonrpc: "2.0".into(),
            id: json!(1),
            method: "test_method".into(),
            params: Some(json!({"a": 1})),
        };
        let json = serde_json::to_string(&req).unwrap();
        let back: McpRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(back.method, "test_method");
    }

    #[test]
    fn mcp_request_without_params() {
        let req = McpRequest {
            jsonrpc: "2.0".into(),
            id: json!("req-1"),
            method: "ping".into(),
            params: None,
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(!json.contains("params"));
    }

    #[test]
    fn mcp_response_success() {
        let resp = McpResponse {
            jsonrpc: "2.0".into(),
            id: json!(1),
            result: Some(json!({"ok": true})),
            error: None,
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("result"));
        assert!(!json.contains("error"));
    }

    #[test]
    fn mcp_response_error() {
        let resp = McpResponse {
            jsonrpc: "2.0".into(),
            id: json!(1),
            result: None,
            error: Some(McpError {
                code: -32601,
                message: "Method not found".into(),
                data: None,
            }),
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("-32601"));
        assert!(!json.contains("result"));
    }

    #[test]
    fn mcp_error_with_data() {
        let err = McpError {
            code: -32600,
            message: "Invalid Request".into(),
            data: Some(json!({"detail": "missing method"})),
        };
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("detail"));
    }
}
