//! The entry point for the OpenHuman core application.
//!
//! This file is responsible for:
//! - Loading environment configuration.
//! - Dispatching command-line arguments to the core logic in `openhuman_core`.

/// Main application entry point.
///
/// Loads environment configuration, then delegates execution to the core
/// library based on CLI arguments.
fn main() {
    let _ = dotenvy::dotenv();

    // Collect command-line arguments, skipping the binary name.
    let args: Vec<String> = std::env::args().skip(1).collect();

    // Delegate to the core library to handle the command.
    if let Err(err) = openhuman_core::run_core_from_args(&args) {
        eprintln!("{err}");
        std::process::exit(1);
    }
}
