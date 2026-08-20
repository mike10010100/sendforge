//! Collaboration data models for Pull Requests, Issues, Review Notes, and Comments.

use serde::{Deserialize, Serialize};

/// Status of a Pull Request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PullRequestStatus {
    #[default]
    Open,
    Merged,
    Closed,
}

/// Status of an Issue.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IssueStatus {
    #[default]
    Open,
    Closed,
}

/// Author or contributor representation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Author {
    pub name: String,
    pub email: String,
}

impl Default for Author {
    fn default() -> Self {
        Self {
            name: "Anonymous".to_string(),
            email: "anonymous@sendforge.local".to_string(),
        }
    }
}

/// A discussion comment on an Issue or Pull Request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Comment {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub author: Author,
    #[serde(default)]
    pub body: String,
    #[serde(default, alias = "createdAt")]
    pub created_at: i64,
}

fn default_target_branch() -> String {
    "main".to_string()
}

/// A structured Pull Request entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PullRequest {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub number: usize,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: Author,
    #[serde(default = "default_target_branch", alias = "targetBranch")]
    pub target_branch: String,
    #[serde(default, alias = "sourceBranch")]
    pub source_branch: String,
    #[serde(default, alias = "headCommit")]
    pub head_commit: String,
    #[serde(default)]
    pub status: PullRequestStatus,
    #[serde(default, alias = "createdAt")]
    pub created_at: i64,
    #[serde(default, alias = "updatedAt")]
    pub updated_at: i64,
    #[serde(default)]
    pub labels: Vec<String>,
    #[serde(default)]
    pub comments: Vec<Comment>,
}

/// A structured Issue entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Issue {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub number: usize,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: Author,
    #[serde(default)]
    pub status: IssueStatus,
    #[serde(default, alias = "createdAt")]
    pub created_at: i64,
    #[serde(default, alias = "updatedAt")]
    pub updated_at: i64,
    #[serde(default)]
    pub labels: Vec<String>,
    #[serde(default)]
    pub comments: Vec<Comment>,
}

/// A code review note attached to a commit, file, or diff line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReviewNote {
    #[serde(default, alias = "commitSha")]
    pub commit_sha: String,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "filePath")]
    pub file_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
    #[serde(default)]
    pub author: Author,
    #[serde(default)]
    pub body: String,
    #[serde(default, alias = "createdAt")]
    pub created_at: i64,
}

/// Sanitizes a collaboration identifier (PR or Issue ID) to prevent path traversal
/// and ensure safe filenames across platforms.
#[must_use]
pub fn sanitize_id(raw: &str) -> String {
    let trimmed = raw.trim();
    // Normalize backslashes to forward slashes
    let normalized = trimmed.replace('\\', "/");
    // Extract the last non-empty path segment (stripping out any "." or "..")
    let last_segment = normalized
        .split('/')
        .rfind(|s| !s.is_empty() && *s != "." && *s != "..")
        .unwrap_or("");

    // Retain only safe characters: alphanumeric, '-', '_', '.'
    let sanitized: String = last_segment
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_' || *c == '.')
        .collect();

    // Strip leading dots to prevent hidden files or "." / ".."
    let no_leading_dots = sanitized.trim_start_matches('.');
    // Remove any embedded ".."
    no_leading_dots.replace("..", "")
}
