use crate::openhuman::config::Config;
use std::path::PathBuf;

/// Shared daemon state file path used by health/doctor reporting.
pub fn state_file_path(config: &Config) -> PathBuf {
    config
        .config_path
        .parent()
        .map_or_else(|| PathBuf::from("."), PathBuf::from)
        .join("daemon_state.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_file_path_uses_config_parent() {
        let config = Config {
            config_path: PathBuf::from("/home/user/.openhuman/config.toml"),
            ..Config::default()
        };
        let path = state_file_path(&config);
        assert_eq!(
            path,
            PathBuf::from("/home/user/.openhuman/daemon_state.json")
        );
    }

    #[test]
    fn state_file_path_relative_config() {
        let config = Config {
            config_path: PathBuf::from("config.toml"),
            ..Config::default()
        };
        let path = state_file_path(&config);
        // "config.toml".parent() = "" which joins to "daemon_state.json"
        assert!(path.to_str().unwrap().contains("daemon_state.json"));
    }
}
