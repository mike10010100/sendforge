//! Pull Request discovery and parsing subsystem.

use std::collections::BTreeMap;
use std::path::Path;

use chrono::Utc;

use crate::collab::models::{sanitize_id, Author, PullRequest, PullRequestStatus};
use crate::error::{Result, SendforgeError};
use crate::repo::load_commit_tree;
use crate::repo::objects::{parse_commit, read_loose_object, ObjectType};
use crate::repo::refs::{discover_all_refs, read_head, HeadPointer, RefEntry};

/// Extracts numeric identifier from a string (e.g. "1" -> 1, "pr-42" -> 42).
fn parse_id_number(id_str: &str, fallback_index: usize) -> usize {
    if let Ok(n) = id_str.parse::<usize>() {
        return n;
    }
    let digits: String = id_str.chars().filter(char::is_ascii_digit).collect();
    if let Ok(n) = digits.parse::<usize>() {
        if n > 0 {
            return n;
        }
    }
    fallback_index
}

/// Attempts to parse PR JSON metadata from a loose Git object.
fn try_parse_pr_meta_object(repo_path: &Path, meta_sha: &str) -> Option<PullRequest> {
    let raw = read_loose_object(repo_path, meta_sha).ok()?;
    match raw.object_type {
        ObjectType::Blob => {
            let text = String::from_utf8_lossy(&raw.data);
            serde_json::from_str::<PullRequest>(&text).ok()
        }
        ObjectType::Commit => {
            let commit = parse_commit(meta_sha, &raw.data).ok()?;
            if let Ok(entries) = load_commit_tree(repo_path, &commit.tree) {
                for target in &["meta.json", "pr.json", "pull.json"] {
                    if let Some(entry) = entries
                        .iter()
                        .find(|e| !e.is_dir && e.name.eq_ignore_ascii_case(target))
                    {
                        if let Ok(blob_raw) = read_loose_object(repo_path, &entry.sha) {
                            let text = String::from_utf8_lossy(&blob_raw.data);
                            if let Ok(pr) = serde_json::from_str::<PullRequest>(&text) {
                                return Some(pr);
                            }
                        }
                    }
                }
            }
            serde_json::from_str::<PullRequest>(&commit.message).ok()
        }
        _ => None,
    }
}

/// Builds a fallback `PullRequest` from the head commit object.
fn pr_from_head_commit(
    repo_path: &Path,
    id_str: &str,
    number: usize,
    head_sha: &str,
    default_branch: &str,
) -> Result<PullRequest> {
    let raw = read_loose_object(repo_path, head_sha)?;
    if raw.object_type != ObjectType::Commit {
        return Err(SendforgeError::InvalidObject(format!(
            "PR head {head_sha} is not a commit object"
        )));
    }

    let commit = parse_commit(head_sha, &raw.data)?;
    let title = if commit.summary.is_empty() {
        format!("Pull Request #{number}")
    } else {
        commit.summary.clone()
    };

    let description = if commit.message == commit.summary {
        String::new()
    } else {
        commit
            .message
            .strip_prefix(&commit.summary)
            .unwrap_or(&commit.message)
            .trim()
            .to_string()
    };

    let created_at = if commit.author.timestamp > 0 {
        commit.author.timestamp
    } else {
        Utc::now().timestamp()
    };

    let updated_at = if commit.committer.timestamp > 0 {
        commit.committer.timestamp
    } else {
        created_at
    };

    let safe_id = sanitize_id(id_str);
    let final_id = if safe_id.is_empty() {
        format!("{number}")
    } else {
        safe_id
    };

    Ok(PullRequest {
        id: final_id.clone(),
        number,
        title,
        description,
        author: Author {
            name: commit.author.name,
            email: commit.author.email,
        },
        target_branch: default_branch.to_string(),
        source_branch: format!("pull/{final_id}"),
        head_commit: head_sha.to_string(),
        status: PullRequestStatus::Open,
        created_at,
        updated_at,
        labels: Vec::new(),
        comments: Vec::new(),
    })
}

/// Discovers and parses all Pull Requests from repository references.
///
/// # Errors
/// Returns `SendforgeError` if Git object reading fails critically.
pub fn scan_pull_requests(
    repo_path: &Path,
    all_refs: &BTreeMap<String, RefEntry>,
    default_branch: &str,
) -> Result<Vec<PullRequest>> {
    let mut pr_map: BTreeMap<String, (Option<String>, Option<String>)> = BTreeMap::new();

    for (ref_name, entry) in all_refs {
        if let Some(rest) = ref_name.strip_prefix("refs/pull/") {
            let (raw_id, is_head, is_meta) = if let Some(stripped) = rest.strip_suffix("/head") {
                (stripped, true, false)
            } else if let Some(stripped) = rest.strip_suffix("/meta") {
                (stripped, false, true)
            } else {
                (rest, false, false)
            };

            let id = sanitize_id(raw_id);
            if !id.is_empty() {
                let pr_entry = pr_map.entry(id).or_insert((None, None));
                if is_head {
                    pr_entry.0 = Some(entry.sha.clone());
                } else if is_meta {
                    pr_entry.1 = Some(entry.sha.clone());
                } else if pr_entry.0.is_none() {
                    pr_entry.0 = Some(entry.sha.clone());
                }
            }
        }
    }

    let mut pulls = Vec::new();

    for (fallback_index, (id, (head_sha_opt, meta_sha_opt))) in (1..).zip(pr_map) {
        let number = parse_id_number(&id, fallback_index);

        let mut pr_opt = None;

        // 1. Try parsing JSON from meta_sha
        if let Some(ref meta_sha) = meta_sha_opt {
            if let Some(mut parsed) = try_parse_pr_meta_object(repo_path, meta_sha) {
                let sanitized_parsed_id = sanitize_id(&parsed.id);
                if sanitized_parsed_id.is_empty() {
                    parsed.id.clone_from(&id);
                } else {
                    parsed.id = sanitized_parsed_id;
                }
                if parsed.number == 0 {
                    parsed.number = number;
                }
                if let Some(ref head_sha) = head_sha_opt {
                    if parsed.head_commit.is_empty() {
                        parsed.head_commit.clone_from(head_sha);
                    }
                }
                pr_opt = Some(parsed);
            }
        }

        // 2. Fallback to head_sha commit object
        if pr_opt.is_none() {
            if let Some(ref head_sha) = head_sha_opt {
                if let Ok(pr) =
                    pr_from_head_commit(repo_path, &id, number, head_sha, default_branch)
                {
                    pr_opt = Some(pr);
                }
            }
        }

        if let Some(mut pr) = pr_opt {
            if pr.id.is_empty() {
                pr.id = format!("{number}");
            }
            pulls.push(pr);
        }
    }

    pulls.sort_by_key(|p| p.number);
    Ok(pulls)
}

/// Convenience function that discovers all refs and loads all Pull Requests in a repository.
///
/// # Errors
/// Returns `SendforgeError` if repository references cannot be discovered.
pub fn load_pull_requests(repo_path: &Path) -> Result<Vec<PullRequest>> {
    let all_refs = discover_all_refs(repo_path)?;
    let default_branch = match read_head(repo_path) {
        Ok(HeadPointer::Symbolic { branch_name, .. }) => branch_name,
        _ => "main".to_string(),
    };
    scan_pull_requests(repo_path, &all_refs, &default_branch)
}
