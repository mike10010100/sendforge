//! `meta.json` repository index metadata serialization and schema generator.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use chrono::Utc;

use crate::error::Result;
use crate::repo::objects::{
    parse_commit, parse_tag, read_loose_object, CommitObject, CommitSignature, ObjectType,
};
use crate::repo::refs::{discover_all_refs, read_head, HeadPointer, RefEntry};
use crate::repo::{
    derive_repo_name, find_readme_in_tree, load_commit_history, load_commit_tree, InitOptions,
};

/// Branch entry in repository metadata.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct BranchMeta {
    /// Branch name without `refs/heads/` prefix.
    pub name: String,
    /// 40-character hex SHA-1 of the branch tip commit.
    pub target: String,
    /// True if this is the default branch.
    pub is_default: bool,
    /// ISO 8601 UTC date of the latest commit on this branch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latest_commit_date: Option<String>,
}

/// Tag entry in repository metadata.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct TagMeta {
    /// Tag name without `refs/tags/` prefix.
    pub name: String,
    /// 40-character hex SHA-1 of the tag object or direct commit.
    pub target: String,
    /// True if this is an annotated tag object.
    pub is_annotated: bool,
    /// Peeled target commit SHA.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub peeled: Option<String>,
    /// Alias for peeled target commit SHA.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub peeled_target: Option<String>,
    /// Tagger signature if annotated.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tagger: Option<CommitSignature>,
    /// Annotation message if present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// HEAD pointer metadata.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct HeadMeta {
    /// Target reference (e.g. "refs/heads/main").
    #[serde(rename = "ref")]
    pub target_ref: String,
    /// Target commit SHA.
    pub sha: String,
}

/// Repository statistics.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct RepoStats {
    /// Total number of branches.
    pub branch_count: usize,
    /// Total number of tags.
    pub tag_count: usize,
    /// Number of commits accessible from default branch.
    pub commit_count: usize,
    /// Number of files in the default branch root tree.
    pub file_count: usize,
}

/// Full Sendforge repository metadata structure (`meta.json`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct SendforgeRepoMeta {
    /// Repository display name.
    pub name: String,
    /// Repository description.
    pub description: Option<String>,
    /// Repository owner handle.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    /// Public clone URL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clone_url: Option<String>,
    /// Default branch name (e.g. "main").
    pub default_branch: String,
    /// List of branches in the repository.
    pub branches: Vec<BranchMeta>,
    /// List of tags in the repository.
    pub tags: Vec<TagMeta>,
    /// HEAD reference information.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub head: Option<HeadMeta>,
    /// Latest commit on default branch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latest_commit: Option<CommitObject>,
    /// Repository statistics.
    pub stats: RepoStats,
    /// True if a README file is present in the default branch.
    pub has_readme: bool,
    /// Filename of the README if present (e.g. "README.md").
    pub readme_filename: Option<String>,
    /// Timestamp of last metadata update (ISO 8601 UTC).
    pub updated_at: String,
}

#[derive(Default)]
struct ParsedRepoConfig {
    name: Option<String>,
    owner: Option<String>,
    clone_url: Option<String>,
}

fn read_repo_config(repo_path: &Path) -> ParsedRepoConfig {
    let mut parsed = ParsedRepoConfig::default();
    let config_path = repo_path.join("config");
    let Ok(content) = fs::read_to_string(config_path) else {
        return parsed;
    };

    let mut in_sendforge = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            in_sendforge = trimmed.eq_ignore_ascii_case("[sendforge]");
            continue;
        }
        if in_sendforge {
            if let Some((k, v)) = trimmed.split_once('=') {
                let key = k.trim().to_lowercase();
                let val = v.trim().to_string();
                if !val.is_empty() {
                    match key.as_str() {
                        "name" => parsed.name = Some(val),
                        "owner" => parsed.owner = Some(val),
                        "cloneurl" | "clone_url" => parsed.clone_url = Some(val),
                        _ => {}
                    }
                }
            }
        }
    }

    parsed
}

fn collect_branches(repo_path: &Path, all_refs: &BTreeMap<String, RefEntry>, default_branch: &str) -> Vec<BranchMeta> {
    let mut branches = Vec::new();
    for (ref_name, entry) in all_refs {
        if let Some(branch_name) = ref_name.strip_prefix("refs/heads/") {
            let is_default = branch_name == default_branch;
            let mut latest_commit_date = None;

            if let Ok(raw) = read_loose_object(repo_path, &entry.sha) {
                if raw.object_type == ObjectType::Commit {
                    if let Ok(commit) = parse_commit(&entry.sha, &raw.data) {
                        latest_commit_date = Some(commit.author.date);
                    }
                }
            }

            branches.push(BranchMeta {
                name: branch_name.to_string(),
                target: entry.sha.clone(),
                is_default,
                latest_commit_date,
            });
        }
    }
    branches
}

fn collect_tags(repo_path: &Path, all_refs: &BTreeMap<String, RefEntry>) -> Vec<TagMeta> {
    let mut tags = Vec::new();
    for (ref_name, entry) in all_refs {
        if let Some(tag_name) = ref_name.strip_prefix("refs/tags/") {
            let mut is_annotated = false;
            let mut tagger = None;
            let mut message = None;

            if let Ok(raw) = read_loose_object(repo_path, &entry.sha) {
                if raw.object_type == ObjectType::Tag {
                    is_annotated = true;
                    if let Ok(parsed_tag) = parse_tag(&raw.data) {
                        tagger = parsed_tag.tagger;
                        message = parsed_tag.message;
                    }
                }
            }

            let peeled = entry.peeled_sha.clone();
            tags.push(TagMeta {
                name: tag_name.to_string(),
                target: entry.sha.clone(),
                is_annotated,
                peeled: peeled.clone(),
                peeled_target: peeled,
                tagger,
                message,
            });
        }
    }
    tags
}

struct DefaultBranchDetails {
    latest_commit: Option<CommitObject>,
    file_count: usize,
    commit_count: usize,
    has_readme: bool,
    readme_filename: Option<String>,
}

fn resolve_default_branch_details(
    repo_path: &Path,
    commit_sha: Option<&str>,
) -> DefaultBranchDetails {
    let mut details = DefaultBranchDetails {
        latest_commit: None,
        file_count: 0,
        commit_count: 0,
        has_readme: false,
        readme_filename: None,
    };

    let Some(sha) = commit_sha else {
        return details;
    };

    if let Ok(raw) = read_loose_object(repo_path, sha) {
        if raw.object_type == ObjectType::Commit {
            if let Ok(commit) = parse_commit(sha, &raw.data) {
                if let Ok(tree_entries) = load_commit_tree(repo_path, &commit.tree) {
                    details.file_count = tree_entries.iter().filter(|e| !e.is_dir).count();
                    if let Ok(Some((readme_name, _))) = find_readme_in_tree(repo_path, &tree_entries) {
                        details.has_readme = true;
                        details.readme_filename = Some(readme_name);
                    }
                }

                if let Ok(history) = load_commit_history(repo_path, sha, 10_000) {
                    details.commit_count = history.len();
                }

                details.latest_commit = Some(commit);
            }
        }
    }

    details
}

/// Generates a `SendforgeRepoMeta` structure by inspecting a bare Git repository.
///
/// # Errors
/// Returns `SendforgeError` if repository files cannot be read.
pub fn generate_repo_metadata(
    repo_path: &Path,
    options: Option<&InitOptions>,
) -> Result<SendforgeRepoMeta> {
    let repo_config = read_repo_config(repo_path);

    let repo_name = options
        .and_then(|o| o.name.clone())
        .or(repo_config.name)
        .unwrap_or_else(|| derive_repo_name(repo_path));

    let repo_desc = options
        .and_then(|o| o.description.clone())
        .or_else(|| {
            let desc_path = repo_path.join("description");
            fs::read_to_string(desc_path).ok().map(|s| s.trim().to_string())
        })
        .filter(|s| !s.is_empty());

    let owner = options
        .and_then(|o| o.owner.clone())
        .or(repo_config.owner)
        .filter(|s| !s.is_empty());

    let clone_url = options
        .and_then(|o| o.clone_url.clone())
        .or(repo_config.clone_url)
        .filter(|s| !s.is_empty());

    let all_refs = discover_all_refs(repo_path)?;
    let head_info = read_head(repo_path).ok();
    let default_branch = match head_info {
        Some(HeadPointer::Symbolic { ref branch_name, .. }) => branch_name.clone(),
        _ => options
            .and_then(|o| o.default_branch.clone())
            .unwrap_or_else(|| "main".to_string()),
    };

    let branches = collect_branches(repo_path, &all_refs, &default_branch);
    let tags = collect_tags(repo_path, &all_refs);

    let default_ref_name = format!("refs/heads/{default_branch}");
    let default_commit_sha = all_refs.get(&default_ref_name).map(|r| r.sha.clone());
    let details = resolve_default_branch_details(repo_path, default_commit_sha.as_deref());

    let head_meta = default_commit_sha.map(|sha| HeadMeta {
        target_ref: default_ref_name,
        sha,
    });

    let stats = RepoStats {
        branch_count: branches.len(),
        tag_count: tags.len(),
        commit_count: details.commit_count,
        file_count: details.file_count,
    };

    let updated_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

    Ok(SendforgeRepoMeta {
        name: repo_name,
        description: repo_desc,
        owner,
        clone_url,
        default_branch,
        branches,
        tags,
        head: head_meta,
        latest_commit: details.latest_commit,
        stats,
        has_readme: details.has_readme,
        readme_filename: details.readme_filename,
        updated_at,
    })
}
