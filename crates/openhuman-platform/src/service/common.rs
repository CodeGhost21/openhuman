//! Shared helpers for platform service install/lifecycle (all OS targets).
//!
//! Each helper serves only the managers compiled for the current OS, so the
//! ones another OS needs are allowed to be unused here.
#![cfg_attr(
    not(any(target_os = "macos", target_os = "linux", windows)),
    allow(dead_code)
)]

use anyhow::Result;
use std::path::Path;
use std::process::{Command, Stdio};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// The command line a Linux unit or Windows wrapper runs: the quoted
/// executable followed by its arguments.
#[cfg_attr(not(any(target_os = "linux", windows)), allow(dead_code))]
pub(crate) fn command_line(exe: &Path, args: &[String]) -> String {
    let exe_quoted = format!("\"{}\"", exe.display());
    if args.is_empty() {
        exe_quoted
    } else {
        format!("{} {}", exe_quoted, args.join(" "))
    }
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn xml_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Suppress conhost allocation for Windows command spawns. Without this,
/// every `schtasks /Query` polled by service status checks flashes a
/// console — visible to users (#1475 follow-up to #731 + #1338).
#[cfg(windows)]
fn no_window(cmd: &mut Command) {
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
}

#[cfg(not(windows))]
fn no_window(_cmd: &mut Command) {}

pub(crate) fn run_checked(cmd: &mut Command) -> Result<()> {
    no_window(cmd);
    let status = cmd.status()?;
    if !status.success() {
        anyhow::bail!("command failed with status {status}");
    }
    Ok(())
}

pub(crate) fn run_capture(cmd: &mut Command) -> Result<String> {
    no_window(cmd);
    let output = cmd.output()?;
    if !output.status.success() {
        anyhow::bail!("command failed with status {}", output.status);
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn run_best_effort(cmd: &mut Command) {
    no_window(cmd);
    match cmd.stdout(Stdio::null()).stderr(Stdio::null()).status() {
        Ok(status) => {
            if !status.success() {
                log::debug!("[service] best-effort command failed with status {status}");
            }
        }
        Err(err) => {
            log::debug!("[service] best-effort command failed to execute: {err}");
        }
    }
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn run_check_silent(cmd: &mut Command) -> bool {
    no_window(cmd);
    cmd.stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(test)]
#[path = "common_tests.rs"]
mod tests;
