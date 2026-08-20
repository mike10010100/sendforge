//! Git reference discovery, parsing, and Dumb HTTP info/refs generation.

use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;

use crate::error::{Result, SendforgeError};
use crate::repo::objects::peel_tag;

/// A resolved Git reference entry.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct RefEntry {
    /// Full reference name (e.g. "refs/heads/main" or "refs/tags/v1.0.0").
    pub name: String,
    /// 40-character hex SHA-1 of the reference target.
    pub sha: String,
    /// True if this reference is a branch (`refs/heads/*`).
    pub is_branch: bool,
    /// True if this reference is a tag (`refs/tags/*`).
    pub is_tag: bool,
    /// Peeled target commit SHA if this reference is an annotated tag.
    pub peeled_sha: Option<String>,
}

impl RefEntry {
    /// Creates a new `RefEntry` by inspecting prefix patterns.
    #[must_use]
    pub fn new(name: String, sha: String) -> Self {
        let is_branch = name.starts_with("refs/heads/");
        let is_tag = name.starts_with("refs/tags/");
        Self {
            name,
            sha,
            is_branch,
            is_tag,
            peeled_sha: None,
        }
    }

    /// Returns true if this ref is a Pull Request head commit ref (`refs/pull/<id>/head`).
    #[must_use]
    pub fn is_pull_head(&self) -> bool {
        self.name.starts_with("refs/pull/") && self.name.ends_with("/head")
    }

    /// Returns true if this ref is a Pull Request metadata ref (`refs/pull/<id>/meta`).
    #[must_use]
    pub fn is_pull_meta(&self) -> bool {
        self.name.starts_with("refs/pull/") && self.name.ends_with("/meta")
    }

    /// Returns true if this ref is an Issue ref (`refs/issues/<id>`).
    #[must_use]
    pub fn is_issue(&self) -> bool {
        self.name.starts_with("refs/issues/")
    }

    /// Returns true if this ref is a Review Notes ref (`refs/notes/reviews` or `refs/notes/*`).
    #[must_use]
    pub fn is_review_note(&self) -> bool {
        self.name == "refs/notes/reviews" || self.name.starts_with("refs/notes/")
    }
}

/// Resolved `HEAD` pointer representation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HeadPointer {
    /// Symbolic reference (e.g. `ref: refs/heads/main`).
    Symbolic {
        /// The referenced ref path (e.g. "refs/heads/main").
        target_ref: String,
        /// The branch name extracted from `target_ref` (e.g. "main").
        branch_name: String,
    },
    /// Detached HEAD directly pointing to an object SHA.
    Detached(String),
}

/// Reads the repository's `HEAD` file.
///
/// # Errors
/// Returns `SendforgeError::RepoNotFound` or `SendforgeError::InvalidRef` on missing or unparseable HEAD.
pub fn read_head(repo_path: &Path) -> Result<HeadPointer> {
    let head_path = repo_path.join("HEAD");
    if !head_path.is_file() {
        return Err(SendforgeError::RepoNotFound(repo_path.to_path_buf()));
    }

    let content = fs::read_to_string(&head_path)?;
    let trimmed = content.trim();

    if let Some(target) = trimmed.strip_prefix("ref:") {
        let target_ref = target.trim().to_string();
        let branch_name = target_ref
            .strip_prefix("refs/heads/")
            .unwrap_or(&target_ref)
            .to_string();

        Ok(HeadPointer::Symbolic {
            target_ref,
            branch_name,
        })
    } else if trimmed.len() == 40 && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(HeadPointer::Detached(trimmed.to_string()))
    } else {
        Err(SendforgeError::InvalidRef(format!(
            "Unrecognized HEAD format: {trimmed}"
        )))
    }
}

/// Resolves the commit SHA pointed to by `HEAD`.
///
/// # Errors
/// Returns `SendforgeError` if HEAD or the referenced branch cannot be resolved.
pub fn resolve_head_commit(repo_path: &Path) -> Result<Option<String>> {
    let head = read_head(repo_path)?;
    match head {
        HeadPointer::Detached(sha) => Ok(Some(sha)),
        HeadPointer::Symbolic { target_ref, .. } => {
            let refs = discover_all_refs(repo_path)?;
            Ok(refs.get(&target_ref).map(|r| r.sha.clone()))
        }
    }
}

/// Recursively discovers all loose references under `<repo>/refs`.
fn collect_loose_refs_recursive(
    dir_path: &Path,
    prefix: &str,
    refs_map: &mut BTreeMap<String, RefEntry>,
) -> Result<()> {
    if !dir_path.is_dir() {
        return Ok(());
    }

    for entry_res in fs::read_dir(dir_path)? {
        let entry = entry_res?;
        let path = entry.path();
        let file_name = entry.file_name();
        let name_str = file_name.to_string_lossy();

        if name_str.starts_with('.') {
            continue;
        }

        if path.is_dir() {
            let sub_prefix = format!("{prefix}{name_str}/");
            collect_loose_refs_recursive(&path, &sub_prefix, refs_map)?;
        } else if path.is_file() {
            let ref_name = format!("{prefix}{name_str}");
            let content = fs::read_to_string(&path)?;
            let sha = content.trim().to_string();
            if sha.len() == 40 && sha.chars().all(|c| c.is_ascii_hexdigit()) {
                refs_map.insert(ref_name.clone(), RefEntry::new(ref_name, sha));
            }
        }
    }

    Ok(())
}

/// Reads references from `<repo>/packed-refs` if it exists.
fn read_packed_refs(repo_path: &Path) -> Result<BTreeMap<String, RefEntry>> {
    let mut packed_map = BTreeMap::new();
    let packed_path = repo_path.join("packed-refs");
    if !packed_path.is_file() {
        return Ok(packed_map);
    }

    let file = File::open(&packed_path)?;
    let reader = BufReader::new(file);
    let mut last_ref_name: Option<String> = None;

    for line_res in reader.lines() {
        let line = line_res?;
        let trimmed = line.trim();

        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        if let Some(peeled_sha) = trimmed.strip_prefix('^') {
            // Peeling line for the immediately preceding tag
            if let Some(ref name) = last_ref_name {
                if let Some(entry) = packed_map.get_mut(name) {
                    entry.peeled_sha = Some(peeled_sha.trim().to_string());
                }
            }
            continue;
        }

        let mut parts = trimmed.split_ascii_whitespace();
        if let (Some(sha), Some(name)) = (parts.next(), parts.next()) {
            if sha.len() == 40 && sha.chars().all(|c| c.is_ascii_hexdigit()) {
                let entry = RefEntry::new(name.to_string(), sha.to_string());
                last_ref_name = Some(name.to_string());
                packed_map.insert(name.to_string(), entry);
            }
        }
    }

    Ok(packed_map)
}

/// Discovers all references (loose and packed) in the bare Git repository.
///
/// Loose references take precedence over packed references.
///
/// # Errors
/// Returns `SendforgeError::Io` on filesystem reading errors.
pub fn discover_all_refs(repo_path: &Path) -> Result<BTreeMap<String, RefEntry>> {
    // 1. Read packed-refs first as base
    let mut refs_map = read_packed_refs(repo_path)?;

    // 2. Discover all loose references recursively under <repo>/refs
    let refs_dir = repo_path.join("refs");
    collect_loose_refs_recursive(&refs_dir, "refs/", &mut refs_map)?;

    // 3. Resolve peeled tags for any tag entries lacking a peeled_sha
    for entry in refs_map.values_mut() {
        if entry.is_tag && entry.peeled_sha.is_none() {
            if let Ok(peeled) = peel_tag(repo_path, &entry.sha) {
                if peeled != entry.sha {
                    entry.peeled_sha = Some(peeled);
                }
            }
        }
    }

    Ok(refs_map)
}

/// Atomically writes content to a file via a temporary `.tmp` file and rename.
///
/// # Errors
/// Returns `SendforgeError::Io` on file creation, writing, or renaming failure.
pub fn atomic_write_file(path: &Path, content: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let file_name = path.file_name().map_or_else(
        || "temp.tmp".to_string(),
        |f| format!("{}.tmp", f.to_string_lossy()),
    );
    let tmp_path = path.with_file_name(file_name);

    {
        let mut file = File::create(&tmp_path)?;
        file.write_all(content)?;
        file.sync_all()?;
    }

    fs::rename(&tmp_path, path)?;
    Ok(())
}

/// Updates dumb HTTP server-info (`info/refs` and `objects/info/packs`).
///
/// # Errors
/// Returns `SendforgeError` if references cannot be read or files cannot be written.
pub fn update_server_info(repo_path: &Path) -> Result<()> {
    // 1. Update info/refs
    let refs_map = discover_all_refs(repo_path)?;
    let mut info_refs_lines = Vec::new();

    for entry in refs_map.values() {
        info_refs_lines.push(format!("{}\t{}\n", entry.sha, entry.name));
        if let Some(ref peeled) = entry.peeled_sha {
            info_refs_lines.push(format!("{}\t{}^{{}}\n", peeled, entry.name));
        }
    }

    let info_refs_content = info_refs_lines.concat();
    let info_refs_path = repo_path.join("info").join("refs");
    atomic_write_file(&info_refs_path, info_refs_content.as_bytes())?;

    // 2. Update objects/info/packs
    let packs_dir = repo_path.join("objects").join("pack");
    let mut pack_lines = Vec::new();

    if packs_dir.is_dir() {
        let mut pack_files = Vec::new();
        for entry_res in fs::read_dir(&packs_dir)? {
            let entry = entry_res?;
            let path = entry.path();
            if path
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("pack"))
            {
                let file_name = entry.file_name().to_string_lossy().into_owned();
                pack_files.push(file_name);
            }
        }
        pack_files.sort();
        for pack in pack_files {
            pack_lines.push(format!("P {pack}\n"));
        }
    }

    let packs_content = pack_lines.concat();
    let packs_info_path = repo_path.join("objects").join("info").join("packs");
    atomic_write_file(&packs_info_path, packs_content.as_bytes())?;

    Ok(())
}
