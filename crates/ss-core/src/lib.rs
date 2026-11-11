//! Silver Skies domain core — pure, dependency-light, fully unit-testable.
//!
//! Nothing in here does I/O. Networking lives in `ss-net`, persistence in
//! `ss-store`, audio in `ss-audio`, map rendering in `ss-map`, and the egui
//! application in the `silverskies` binary.

pub mod alerts;
pub mod command;
pub mod geo;
pub mod same;
pub mod theme;
pub mod types;
pub mod weather;

pub use types::*;
