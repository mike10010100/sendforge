//! Error types for the Sendforge crate.

use std::path::PathBuf;

/// The primary error type for Sendforge operations.
#[derive(Debug, thiserror::Error)]
pub enum SendforgeError {
    /// An I/O error occurred.
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    /// A Git-related operational error occurred.
    #[error("Git error: {0}")]
    Git(String),

    /// Zlib decompression failed.
    #[error("Zlib decompression error: {0}")]
    Decompression(String),

    /// An invalid Git reference format was encountered.
    #[error("Invalid reference format: {0}")]
    InvalidRef(String),

    /// A repository was not found at the specified path.
    #[error("Repository not found at path: {0}")]
    RepoNotFound(PathBuf),

    /// A repository already exists at the specified path.
    #[error("Repository already exists at path: {0}")]
    RepoAlreadyExists(PathBuf),

    /// A requested Git object was not found.
    #[error("Object not found: {0}")]
    ObjectNotFound(String),

    /// A Git object has invalid header or corrupted content.
    #[error("Invalid object: {0}")]
    InvalidObject(String),

    /// An error occurred in the HTTP server.
    #[error("HTTP server error: {0}")]
    ServerError(String),

    /// JSON serialization or deserialization failed.
    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),

    /// Directory traversal or path escape attempt detected.
    #[error("Path traversal forbidden: {0}")]
    PathTraversal(String),

    /// Invalid argument or configuration provided.
    #[error("Invalid argument: {0}")]
    InvalidArgument(String),
}

/// A specialized Result type for Sendforge operations.
pub type Result<T> = std::result::Result<T, SendforgeError>;
