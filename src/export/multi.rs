//! Multi-repository discovery, portfolio indexer, and static exporter.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::error::{Result, SendforgeError};
use crate::export::{copy_dir_all, export_static_site, ExportOptions};
use crate::meta::generate_repo_metadata;
use crate::prerender::render_dashboard_html;
use crate::repo::is_bare_repo;
use crate::repo::refs::atomic_write_file;

/// Summary of the latest commit for repository card display.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ForgeCommitSummary {
    /// 40-character hex SHA-1 object ID of the commit.
    pub oid: String,
    /// First line summary of the commit message.
    pub summary: String,
    /// Commit author name.
    pub author: String,
    /// Unix epoch timestamp in seconds.
    pub timestamp: i64,
}

/// Aggregated repository statistics for portfolio display.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ForgeRepoStats {
    /// Number of accessible commits on the default branch.
    pub commits: usize,
    /// Number of branches in the repository.
    pub branches: usize,
    /// Number of tags in the repository.
    pub tags: usize,
    /// Total number of issues.
    pub issues: usize,
    /// Total number of pull requests.
    pub pulls: usize,
}

/// Metadata card for a single repository within the multi-repository portfolio.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ForgeRepoCard {
    /// Unique identifier for the repository (e.g. "owner/repo-name" or "repo-name").
    pub id: String,
    /// Clean display name of the repository.
    pub name: String,
    /// Repository owner handle or organization, if available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    /// Brief description of the repository.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Default branch name (e.g. "main").
    pub default_branch: String,
    /// Latest commit on default branch, if any commits exist.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latest_commit: Option<ForgeCommitSummary>,
    /// Repository statistics.
    pub stats: ForgeRepoStats,
    /// Relative URL path to the repository directory (e.g. "owner/repo-name/").
    pub path: String,
}

/// Multi-repository portfolio index structure (`repos.json`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ForgeIndex {
    /// Schema version number.
    pub version: u32,
    /// Portfolio or forge title.
    pub title: String,
    /// Timestamp of portfolio index generation (ISO 8601 UTC).
    pub generated_at: String,
    /// List of indexed repositories.
    pub repos: Vec<ForgeRepoCard>,
}

/// Information about a discovered bare Git repository on disk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveredRepo {
    /// Full filesystem path to the bare Git repository.
    pub full_path: PathBuf,
    /// Relative path from the root discovery directory.
    pub relative_path: String,
    /// Repository display name.
    pub name: String,
    /// Derived or inferred owner from path hierarchy, if any.
    pub owner: Option<String>,
}

/// Recursively scans a directory for bare Git repositories.
///
/// Supports both flat directory structures (`repos/repo1.git`, `repos/repo2.git`)
/// and owner-nested directory structures (`repos/alice/repo1.git`, `repos/bob/repo2.git`).
///
/// # Errors
/// Returns `SendforgeError::Io` if filesystem reads fail.
pub fn discover_repositories(repos_dir: &Path) -> Result<Vec<DiscoveredRepo>> {
    if !repos_dir.exists() {
        return Err(SendforgeError::RepoNotFound(repos_dir.to_path_buf()));
    }

    // If the given root itself is a bare repository:
    if is_bare_repo(repos_dir) {
        let name = crate::repo::derive_repo_name(repos_dir);
        return Ok(vec![DiscoveredRepo {
            full_path: repos_dir.to_path_buf(),
            relative_path: name.clone(),
            name,
            owner: None,
        }]);
    }

    let mut discovered = Vec::new();
    scan_dir_recursive(repos_dir, repos_dir, &mut discovered)?;

    discovered.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(discovered)
}

fn is_skip_dir(name: &str) -> bool {
    name.starts_with('.')
        || matches!(
            name,
            "objects" | "refs" | "hooks" | "info" | "static" | "target" | "node_modules" | ".git"
        )
}

fn scan_dir_recursive(
    root: &Path,
    current: &Path,
    discovered: &mut Vec<DiscoveredRepo>,
) -> Result<()> {
    let entries = fs::read_dir(current)?;

    for entry_res in entries {
        let entry = entry_res?;
        let path = entry.path();
        let file_type = entry.file_type()?;

        if !file_type.is_dir() {
            continue;
        }

        let file_name = entry.file_name();
        let name_str = file_name.to_string_lossy();

        if is_skip_dir(&name_str) {
            continue;
        }

        if is_bare_repo(&path) {
            let rel_path = path
                .strip_prefix(root)
                .map_err(|e| SendforgeError::InvalidArgument(e.to_string()))?;

            let mut components: Vec<String> = rel_path
                .components()
                .map(|c| c.as_os_str().to_string_lossy().to_string())
                .collect();

            if let Some(last) = components.last_mut() {
                if let Some(stripped) = last.strip_suffix(".git") {
                    *last = stripped.to_string();
                }
            }

            let normalized_rel_path = components.join("/");
            let repo_name = components
                .last()
                .cloned()
                .unwrap_or_else(|| "repository".to_string());

            let owner = if components.len() > 1 {
                Some(components[..components.len() - 1].join("/"))
            } else {
                None
            };

            discovered.push(DiscoveredRepo {
                full_path: path,
                relative_path: normalized_rel_path,
                name: repo_name,
                owner,
            });
        } else {
            // Recurse into subdirectory
            scan_dir_recursive(root, &path, discovered)?;
        }
    }

    Ok(())
}

/// Builds a `ForgeRepoCard` from repository metadata and discovery details.
#[must_use]
pub fn build_repo_card(
    discovered: &DiscoveredRepo,
    meta: &crate::meta::SendforgeRepoMeta,
) -> ForgeRepoCard {
    let name = if meta.name.is_empty() {
        discovered.name.clone()
    } else {
        meta.name.clone()
    };

    let owner = meta
        .owner
        .clone()
        .or_else(|| discovered.owner.clone())
        .filter(|o| !o.is_empty());

    let id = owner.as_ref().map_or_else(
        || discovered.relative_path.clone(),
        |o| format!("{o}/{name}"),
    );

    let latest_commit = meta.latest_commit.as_ref().map(|c| ForgeCommitSummary {
        oid: c.id.clone(),
        summary: c.summary.clone(),
        author: c.author.name.clone(),
        timestamp: c.author.timestamp,
    });

    let stats = ForgeRepoStats {
        commits: meta.stats.commit_count,
        branches: meta.stats.branch_count,
        tags: meta.stats.tag_count,
        issues: meta.stats.issue_count,
        pulls: meta.stats.pull_count,
    };

    let path = if discovered.relative_path.ends_with('/') {
        discovered.relative_path.clone()
    } else {
        format!("{}/", discovered.relative_path)
    };

    ForgeRepoCard {
        id,
        name,
        owner,
        description: meta.description.clone(),
        default_branch: meta.default_branch.clone(),
        latest_commit,
        stats,
        path,
    }
}

/// Discovers, updates, and exports all repositories in a directory into a multi-repository portfolio site.
///
/// Generates:
/// - `<output_dir>/repos.json` (portfolio index)
/// - `<output_dir>/index.html` (static pre-rendered root forge dashboard)
/// - `<output_dir>/_headers` (Cloudflare Pages / Netlify CORS and caching headers)
/// - `<output_dir>/<relative_path>/*` (exported sub-repository static sites)
///
/// # Errors
/// Returns `SendforgeError` if repository discovery, export, or filesystem writing fails.
pub fn export_multi_repository(
    repos_dir: &Path,
    output_dir: &Path,
    options: &ExportOptions,
) -> Result<ForgeIndex> {
    let discovered_repos = discover_repositories(repos_dir)?;
    if discovered_repos.is_empty() {
        return Err(SendforgeError::RepoNotFound(repos_dir.to_path_buf()));
    }

    fs::create_dir_all(output_dir)?;

    let mut repo_cards = Vec::with_capacity(discovered_repos.len());

    for discovered in &discovered_repos {
        let sub_output = output_dir.join(&discovered.relative_path);
        fs::create_dir_all(&sub_output)?;

        // Export individual repository static site
        export_static_site(&discovered.full_path, &sub_output, options)?;

        // Generate metadata for portfolio index card
        let meta = generate_repo_metadata(&discovered.full_path, None)?;
        let card = build_repo_card(discovered, &meta);
        repo_cards.push(card);
    }

    // Sort cards deterministically by ID
    repo_cards.sort_by(|a, b| a.id.cmp(&b.id));

    let generated_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let forge_index = ForgeIndex {
        version: 1,
        title: "Sendforge Hub".to_string(),
        generated_at,
        repos: repo_cards,
    };

    // Write repos.json
    let json_bytes = serde_json::to_vec_pretty(&forge_index)?;
    atomic_write_file(&output_dir.join("repos.json"), &json_bytes)?;

    // If frontend SPA dist is provided, merge it into the root output directory
    if let Some(ref dist_path) = options.frontend_dist {
        if dist_path.is_dir() {
            copy_dir_all(dist_path, output_dir)?;
        } else {
            return Err(SendforgeError::InvalidArgument(format!(
                "Frontend dist directory does not exist: {}",
                dist_path.display()
            )));
        }
    }

    // Render and write zero-JS static root Forge Dashboard HTML fallback
    let dashboard_html = render_dashboard_html(&forge_index);
    atomic_write_file(&output_dir.join("index.html"), dashboard_html.as_bytes())?;

    // Write root _headers file
    let headers_content = r"/*
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, HEAD, OPTIONS
  Access-Control-Allow-Headers: Range, Content-Type, Authorization, If-Modified-Since, If-None-Match
  Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges, ETag

/repos.json
  Content-Type: application/json; charset=utf-8
  Cache-Control: no-cache

/index.html
  Content-Type: text/html; charset=utf-8
  Cache-Control: no-cache
";
    atomic_write_file(&output_dir.join("_headers"), headers_content.as_bytes())?;

    Ok(forge_index)
}
