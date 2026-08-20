//! Post-receive Git hook handler and repository update workflow.

use std::fs;
use std::io::{self, BufRead};
use std::path::Path;

use crate::error::{Result, SendforgeError};
use crate::meta::generate_repo_metadata;
use crate::prerender::{render_index_html, render_log_html, render_markdown};
use crate::repo::refs::{atomic_write_file, update_server_info};
use crate::repo::{find_readme_in_tree, load_commit_history, load_commit_tree};

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

    // 2. Generate repository metadata
    let meta = generate_repo_metadata(repo_path, None)?;

    // 3. Resolve default branch tree and README content for pre-rendering
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

    // 4. Pre-render static HTML fallback files
    let index_html = render_index_html(&meta, &tree_entries, rendered_readme.as_deref());
    let log_html = render_log_html(&meta, &commits);
    let meta_json = serde_json::to_string_pretty(&meta)?;

    // 5. Determine target output directory
    let static_dir = match output_dir {
        Some(dir) => dir.to_path_buf(),
        None => repo_path.join("static"),
    };
    fs::create_dir_all(&static_dir)?;

    // 6. Write static assets atomically
    atomic_write_file(&static_dir.join("meta.json"), meta_json.as_bytes())?;
    atomic_write_file(&static_dir.join("index.html"), index_html.as_bytes())?;
    atomic_write_file(&static_dir.join("log.html"), log_html.as_bytes())?;

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
