//! Artifact-producing agent tools: `generate_document` (`.docx`) and
//! `generate_presentation` (`.pptx`).
//!
//! Both build their output through [`super::production::Production`] and the
//! [`super::FileRoots`] files folder, so they live with the artifact domain
//! rather than in the generic `tools/` registry. The whole directory is behind
//! the `documents` feature (see `artifacts/mod.rs`); `tools::ops` registers the
//! tools and `artifacts::ops` re-dispatches a presentation for Retry.

mod document;
mod document_engine;
mod document_types;
mod presentation;
mod presentation_engine;
mod presentation_images;
mod presentation_types;

pub use document::DocumentTool;
pub use presentation::PresentationTool;
