//! Post-receive Git hook handler and repository update workflow.

use std::fs;
use std::io::{self, BufRead};
use std::path::{Path, PathBuf};

use crate::collab::models::sanitize_id;
use crate::error::{Result, SendforgeError};
use crate::meta::generate_repo_metadata;
use crate::prerender::{render_index_html, render_log_html, render_markdown};
use crate::repo::refs::{atomic_write_file, update_server_info};
use crate::repo::{find_readme_in_tree, load_commit_history, load_commit_tree};

/// Validates that `target_path` is strictly contained within `base_dir` and does not escape via `..`.
///
/// # Errors
/// Returns `SendforgeError::PathTraversal` if `target_path` escapes `base_dir`.
pub fn validate_path_containment(base_dir: &Path, target_path: &Path) -> Result<()> {
    let mut normalized = PathBuf::new();
    for comp in target_path.components() {
        match comp {
            std::path::Component::Prefix(p) => normalized.push(p.as_os_str()),
            std::path::Component::RootDir => normalized.push("/"),
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                if !normalized.pop() {
                    return Err(SendforgeError::PathTraversal(format!(
                        "Target path {} escapes base directory {}",
                        target_path.display(),
                        base_dir.display()
                    )));
                }
            }
            std::path::Component::Normal(c) => normalized.push(c),
        }
    }

    let mut normalized_base = PathBuf::new();
    for comp in base_dir.components() {
        match comp {
            std::path::Component::Prefix(p) => normalized_base.push(p.as_os_str()),
            std::path::Component::RootDir => normalized_base.push("/"),
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized_base.pop();
            }
            std::path::Component::Normal(c) => normalized_base.push(c),
        }
    }

    if !normalized.starts_with(&normalized_base) {
        return Err(SendforgeError::PathTraversal(format!(
            "Target path {} is outside base directory {}",
            target_path.display(),
            base_dir.display()
        )));
    }

    Ok(())
}

/// A single Git reference update delivered via stdin in `post-receive`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RefUpdate {
    /// 40-character hex SHA-1 before the update (or 40 zeros if created).
    pub old_rev: String,
    /// 40-character hex SHA-1 after the update (or 40 zeros if deleted).
    pub new_rev: String,
    /// Full reference name (e.g. "refs/heads/main").
    pub ref_name: String,
}

/// Parses stdin lines into a list of `RefUpdate` records.
///
/// # Errors
/// Returns `SendforgeError::InvalidRef` if any line is malformed.
pub fn parse_ref_updates<R: BufRead>(reader: R) -> Result<Vec<RefUpdate>> {
    let mut updates = Vec::new();

    for line_res in reader.lines() {
        let line = line_res?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let mut parts = trimmed.split_ascii_whitespace();
        let old_rev = parts.next().ok_or_else(|| {
            SendforgeError::InvalidRef(format!("Missing old_rev in line: {trimmed}"))
        })?;
        let new_rev = parts.next().ok_or_else(|| {
            SendforgeError::InvalidRef(format!("Missing new_rev in line: {trimmed}"))
        })?;
        let ref_name = parts.next().ok_or_else(|| {
            SendforgeError::InvalidRef(format!("Missing ref_name in line: {trimmed}"))
        })?;

        if old_rev.len() != 40 || new_rev.len() != 40 {
            return Err(SendforgeError::InvalidRef(format!(
                "Invalid revision length in line: {trimmed}"
            )));
        }

        updates.push(RefUpdate {
            old_rev: old_rev.to_string(),
            new_rev: new_rev.to_string(),
            ref_name: ref_name.to_string(),
        });
    }

    Ok(updates)
}

/// Executes the full Sendforge post-receive hook / update pipeline for a repository.
///
/// Updates `info/refs`, `objects/info/packs`, `static/meta.json`, `static/index.html`, and `static/log.html`.
///
/// # Errors
/// Returns `SendforgeError` if any update step fails.
pub fn run_hook_update(repo_path: &Path, output_dir: Option<&Path>, quiet: bool) -> Result<()> {
    if !quiet {
        eprintln!("[sendforge] Updating dumb HTTP refs and static fallbacks...");
    }

    // 1. Update Dumb HTTP server-info (info/refs & objects/info/packs)
    update_server_info(repo_path)?;

    // 2. Discover collaboration objects
    let pulls = crate::collab::pulls::load_pull_requests(repo_path)?;
    let issues = crate::collab::issues::load_issues(repo_path)?;

    // 3. Generate repository metadata
    let meta = generate_repo_metadata(repo_path, None)?;

    // 4. Resolve default branch tree and README content for pre-rendering
    let mut tree_entries = Vec::new();
    let mut rendered_readme = None;
    let mut commits = Vec::new();

    if let Some(ref commit) = meta.latest_commit {
        if let Ok(entries) = load_commit_tree(repo_path, &commit.tree) {
            tree_entries = entries;
            if let Ok(Some((_, raw_md))) = find_readme_in_tree(repo_path, &tree_entries) {
                rendered_readme = Some(render_markdown(&raw_md));
            }
        }

        if let Ok(history) = load_commit_history(repo_path, &commit.id, 50) {
            commits = history;
        }
    }

    // 5. Pre-render static HTML fallback files
    let index_html = render_index_html(&meta, &tree_entries, rendered_readme.as_deref());
    let log_html = render_log_html(&meta, &commits);
    let pulls_html = crate::prerender::render_pulls_html(&meta, &pulls);
    let issues_html = crate::prerender::render_issues_html(&meta, &issues);

    let meta_json = serde_json::to_string_pretty(&meta)?;
    let pulls_json = serde_json::to_string_pretty(&pulls)?;
    let issues_json = serde_json::to_string_pretty(&issues)?;

    // 6. Determine target output directory
    let static_dir = match output_dir {
        Some(dir) => dir.to_path_buf(),
        None => repo_path.join("static"),
    };
    fs::create_dir_all(&static_dir)?;

    let static_pulls_dir = static_dir.join("pulls");
    fs::create_dir_all(&static_pulls_dir)?;

    let static_issues_dir = static_dir.join("issues");
    fs::create_dir_all(&static_issues_dir)?;

    // 7. Write static assets atomically
    atomic_write_file(&static_dir.join("meta.json"), meta_json.as_bytes())?;
    atomic_write_file(&static_dir.join("pulls.json"), pulls_json.as_bytes())?;
    atomic_write_file(&static_dir.join("issues.json"), issues_json.as_bytes())?;
    atomic_write_file(&static_dir.join("index.html"), index_html.as_bytes())?;
    atomic_write_file(&static_dir.join("log.html"), log_html.as_bytes())?;
    atomic_write_file(&static_dir.join("pulls.html"), pulls_html.as_bytes())?;
    atomic_write_file(&static_dir.join("issues.html"), issues_html.as_bytes())?;

    // 8. Write individual PR detail pages
    for pull in &pulls {
        let safe_id = sanitize_id(&pull.id);
        let id_to_use = if safe_id.is_empty() {
            format!("{}", pull.number)
        } else {
            safe_id
        };
        let target_path = static_pulls_dir.join(format!("{id_to_use}.html"));
        validate_path_containment(&static_pulls_dir, &target_path)?;
        let detail_html = crate::prerender::render_pull_detail_html(&meta, pull);
        atomic_write_file(&target_path, detail_html.as_bytes())?;
    }

    // 9. Write individual Issue detail pages
    for issue in &issues {
        let safe_id = sanitize_id(&issue.id);
        let id_to_use = if safe_id.is_empty() {
            format!("{}", issue.number)
        } else {
            safe_id
        };
        let target_path = static_issues_dir.join(format!("{id_to_use}.html"));
        validate_path_containment(&static_issues_dir, &target_path)?;
        let detail_html = crate::prerender::render_issue_detail_html(&meta, issue);
        atomic_write_file(&target_path, detail_html.as_bytes())?;
    }

    if !quiet {
        eprintln!(
            "[sendforge] Successfully generated static assets in {}",
            static_dir.display()
        );
    }

    Ok(())
}

/// Reads ref updates from stdin and runs the post-receive hook.
///
/// # Errors
/// Returns `SendforgeError` if hook execution encounters an error.
pub fn handle_post_receive_stdin(
    repo_path: &Path,
    output_dir: Option<&Path>,
    quiet: bool,
) -> Result<()> {
    let stdin = io::stdin();
    let handle = stdin.lock();

    // Read and parse all incoming ref updates
    let updates = parse_ref_updates(handle)?;

    if !quiet && !updates.is_empty() {
        eprintln!("[sendforge] Received {} ref update(s):", updates.len());
        for u in &updates {
            eprintln!(
                "  {} -> {} ({})",
                &u.old_rev[..7],
                &u.new_rev[..7],
                u.ref_name
            );
        }
    }

    // Run the complete update workflow
    run_hook_update(repo_path, output_dir, quiet)
}
