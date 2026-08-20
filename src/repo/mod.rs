//! Bare Git repository initialization, inspection, and traversal.

pub mod objects;
pub mod refs;

use std::collections::HashSet;
use std::fs;
use std::path::Path;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use crate::error::{Result, SendforgeError};
use crate::repo::objects::{
    parse_commit, parse_tree, read_loose_object, CommitObject, ObjectType, TreeEntry,
};
use crate::repo::refs::{atomic_write_file, update_server_info};

/// Options for initializing a new bare Git repository.
#[derive(Debug, Clone, Default)]
pub struct InitOptions {
    /// Human-friendly display name of the repository.
    pub name: Option<String>,
    /// Brief description of the repository.
    pub description: Option<String>,
    /// Default branch name (defaults to "main").
    pub default_branch: Option<String>,
    /// Repository owner or organization handle.
    pub owner: Option<String>,
    /// Public clone URL displayed in the web UI.
    pub clone_url: Option<String>,
    /// Reinitialize / overwrite existing files if directory already exists.
    pub force: bool,
}

/// Checks if a given directory appears to be a bare Git repository.
#[must_use]
pub fn is_bare_repo(path: &Path) -> bool {
    path.join("HEAD").is_file()
        && path.join("objects").is_dir()
        && path.join("refs").is_dir()
}

/// Derives a clean repository name from its path.
#[must_use]
pub fn derive_repo_name(path: &Path) -> String {
    path.file_name().map_or_else(
        || "repository".to_string(),
        |name| {
            let s = name.to_string_lossy();
            s.strip_suffix(".git").unwrap_or(&s).to_string()
        },
    )
}

/// Initializes a bare Git repository configured for Sendforge.
///
/// # Errors
/// Returns `SendforgeError::RepoAlreadyExists` if the path exists with content and `force` is false,
/// or `SendforgeError::Io` on filesystem write failures.
pub fn init_bare_repo(path: &Path, options: &InitOptions) -> Result<()> {
    if path.exists() && !options.force && !is_bare_repo(path) {
        if let Ok(mut entries) = fs::read_dir(path) {
            if entries.next().is_some() {
                return Err(SendforgeError::RepoAlreadyExists(path.to_path_buf()));
            }
        }
    }

    // 1. Create directory hierarchy
    fs::create_dir_all(path.join("info"))?;
    fs::create_dir_all(path.join("objects").join("info"))?;
    fs::create_dir_all(path.join("objects").join("pack"))?;
    fs::create_dir_all(path.join("refs").join("heads"))?;
    fs::create_dir_all(path.join("refs").join("tags"))?;
    fs::create_dir_all(path.join("hooks"))?;
    fs::create_dir_all(path.join("static"))?;

    let default_branch = options
        .default_branch
        .as_deref()
        .unwrap_or("main")
        .trim();
    let default_branch = if default_branch.is_empty() {
        "main"
    } else {
        default_branch
    };

    // 2. Write HEAD
    let head_content = format!("ref: refs/heads/{default_branch}\n");
    atomic_write_file(&path.join("HEAD"), head_content.as_bytes())?;

    // 3. Write Git config with Sendforge metadata section
    let mut config_content = "[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = true\n[http]\n\treceivepack = true\n\tuploadpack = true\n[receive]\n\tunpackLimit = 10000\n[transfer]\n\tunpackLimit = 10000\n".to_string();

    let mut sendforge_section = Vec::new();
    if let Some(ref n) = options.name {
        if !n.is_empty() {
            sendforge_section.push(format!("\tname = {n}\n"));
        }
    }
    if let Some(ref o) = options.owner {
        if !o.is_empty() {
            sendforge_section.push(format!("\towner = {o}\n"));
        }
    }
    if let Some(ref u) = options.clone_url {
        if !u.is_empty() {
            sendforge_section.push(format!("\tcloneurl = {u}\n"));
        }
    }
    if !sendforge_section.is_empty() {
        config_content.push_str("[sendforge]\n");
        for line in sendforge_section {
            config_content.push_str(&line);
        }
    }
    atomic_write_file(&path.join("config"), config_content.as_bytes())?;

    // 4. Write description
    let description = options.description.as_deref().unwrap_or("");
    atomic_write_file(&path.join("description"), format!("{description}\n").as_bytes())?;

    // 5. Write info/exclude
    let exclude_content = "# git ls-files --others --exclude-from=.git/info/exclude\n";
    atomic_write_file(&path.join("info").join("exclude"), exclude_content.as_bytes())?;

    // 6. Write post-receive hook script
    let hook_path = path.join("hooks").join("post-receive");
    let exe_path_str = std::env::current_exe()
        .ok()
        .and_then(|p| p.to_str().map(ToString::to_string))
        .unwrap_or_default();

    let hook_content = format!(
        r#"#!/bin/sh
if command -v sendforge >/dev/null 2>&1; then
    exec sendforge hook
fi
if [ -n "$SENDFORGE_BIN" ] && [ -x "$SENDFORGE_BIN" ]; then
    exec "$SENDFORGE_BIN" hook
fi
if [ -n "{exe_path_str}" ] && [ -x "{exe_path_str}" ]; then
    exec "{exe_path_str}" hook
fi
if [ -x "./target/debug/sendforge" ]; then
    exec "./target/debug/sendforge" hook
fi
if [ -x "./target/release/sendforge" ]; then
    exec "./target/release/sendforge" hook
fi
exec sendforge hook
"#
    );
    atomic_write_file(&hook_path, hook_content.as_bytes())?;

    #[cfg(unix)]
    {
        let permissions = fs::Permissions::from_mode(0o755);
        fs::set_permissions(&hook_path, permissions)?;
    }

    // 7. Initialize dumb HTTP server info
    update_server_info(path)?;

    Ok(())
}

/// Traverses commit history from a starting commit SHA up to `limit` commits.
///
/// Follows parent pointers (first-parent or linear traversal).
///
/// # Errors
/// Returns `SendforgeError` if any commit object is unreadable or malformed.
pub fn load_commit_history(
    repo_path: &Path,
    start_sha: &str,
    limit: usize,
) -> Result<Vec<CommitObject>> {
    let mut commits = Vec::new();
    let mut visited = HashSet::new();
    let mut current_sha = start_sha.to_string();

    while commits.len() < limit {
        if current_sha.is_empty()
            || current_sha == "0000000000000000000000000000000000000000"
            || visited.contains(&current_sha)
        {
            break;
        }

        visited.insert(current_sha.clone());

        let Ok(raw) = read_loose_object(repo_path, &current_sha) else {
            break; // Reached end of accessible loose objects
        };

        if raw.object_type != ObjectType::Commit {
            break;
        }

        let commit = parse_commit(&current_sha, &raw.data)?;
        let first_parent = commit.parents.first().cloned();
        commits.push(commit);

        match first_parent {
            Some(parent_sha) => current_sha = parent_sha,
            None => break,
        }
    }

    Ok(commits)
}

/// Resolves the root `TreeEntry` list for a commit.
///
/// # Errors
/// Returns `SendforgeError` if tree object is unreadable or malformed.
pub fn load_commit_tree(repo_path: &Path, tree_sha: &str) -> Result<Vec<TreeEntry>> {
    if tree_sha.is_empty() {
        return Ok(Vec::new());
    }

    let raw = read_loose_object(repo_path, tree_sha)?;
    if raw.object_type != ObjectType::Tree {
        return Err(SendforgeError::InvalidObject(format!(
            "Expected tree object for {tree_sha}, found {}",
            raw.object_type
        )));
    }

    parse_tree(&raw.data)
}

/// Identifies and extracts the README file content from root tree entries.
///
/// Looks for (case-insensitively): `README.md`, `README.markdown`, `README.txt`, `README`.
///
/// # Errors
/// Returns `SendforgeError` if reading blob fails.
pub fn find_readme_in_tree(
    repo_path: &Path,
    tree_entries: &[TreeEntry],
) -> Result<Option<(String, String)>> {
    let priority = [
        "readme.md",
        "readme.markdown",
        "readme.mdown",
        "readme.txt",
        "readme",
    ];

    for candidate in &priority {
        if let Some(entry) = tree_entries
            .iter()
            .find(|e| !e.is_dir && e.name.to_lowercase() == *candidate)
        {
            let raw_blob = read_loose_object(repo_path, &entry.sha)?;
            let text = String::from_utf8_lossy(&raw_blob.data).into_owned();
            return Ok(Some((entry.name.clone(), text)));
        }
    }

    Ok(None)
}
