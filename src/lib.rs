//! Sendforge: High-performance, static-first Git forge.
//!
//! Provides bare Git repository initialization, post-receive hook handlers,
//! dumb HTTP server-info generation, repository metadata serialization (`meta.json`),
//! zero-JS static HTML pre-rendering, static exporting, and a local static HTTP server.

#![forbid(unsafe_code)]
#![deny(
    clippy::all,
    clippy::pedantic,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::todo,
    clippy::unimplemented
)]

pub mod collab;
pub mod error;
pub mod export;
pub mod hook;
pub mod meta;
pub mod prerender;
pub mod repo;
pub mod server;

pub use error::{Result, SendforgeError};
