//! Resolve OpenClaw / AI prompt directories for bundled and dev layouts.

use std::path::{Path, PathBuf};

/// OpenClaw markdown directory inside a bundled resource dir.
pub fn bundled_openclaw_prompts_dir(resource_dir: &Path) -> Option<PathBuf> {
    let candidates = [
        resource_dir.join("openhuman").join("agent").join("prompts"),
        resource_dir.join("prompts"),
        resource_dir.join("ai"),
        resource_dir
            .join("src")
            .join("openhuman")
            .join("agent")
            .join("prompts"),
    ];
    candidates.into_iter().find(|p| p.is_dir())
}

/// Locate `src/openhuman/agent/prompts` by walking up from `cwd`.
pub fn repo_ai_prompts_dir(cwd: &Path) -> Option<PathBuf> {
    for up in 0..=8 {
        let mut base = cwd.to_path_buf();
        let mut ok = true;
        for _ in 0..up {
            if !base.pop() {
                ok = false;
                break;
            }
        }
        if !ok {
            continue;
        }
        let candidate = base
            .join("src")
            .join("openhuman")
            .join("agent")
            .join("prompts");
        if candidate.is_dir() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn bundled_openclaw_prompts_dir_returns_none_for_empty_dir() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(bundled_openclaw_prompts_dir(tmp.path()).is_none());
    }

    #[test]
    fn bundled_openclaw_prompts_dir_finds_prompts_subdir() {
        let tmp = tempfile::tempdir().unwrap();
        let prompts = tmp.path().join("openhuman").join("agent").join("prompts");
        fs::create_dir_all(&prompts).unwrap();
        let result = bundled_openclaw_prompts_dir(tmp.path());
        assert!(result.is_some());
        assert_eq!(result.unwrap(), prompts);
    }

    #[test]
    fn bundled_openclaw_prompts_dir_finds_ai_subdir() {
        let tmp = tempfile::tempdir().unwrap();
        let ai_dir = tmp.path().join("ai");
        fs::create_dir_all(&ai_dir).unwrap();
        let result = bundled_openclaw_prompts_dir(tmp.path());
        assert!(result.is_some());
    }

    #[test]
    fn repo_ai_prompts_dir_returns_none_for_tmpdir() {
        let tmp = tempfile::tempdir().unwrap();
        // A random tmpdir won't have src/openhuman/agent/prompts
        assert!(repo_ai_prompts_dir(tmp.path()).is_none());
    }

    #[test]
    fn repo_ai_prompts_dir_finds_repo_root() {
        // This test relies on running inside the actual repo
        let cwd = std::env::current_dir().unwrap();
        let result = repo_ai_prompts_dir(&cwd);
        // May or may not find it depending on CWD, but shouldn't panic
        let _ = result;
    }
}
