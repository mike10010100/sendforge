//! Issue discovery and parsing subsystem.

use std::collections::BTreeMap;
use std::path::Path;

use chrono::Utc;

use crate::collab::models::{sanitize_id, Author, Issue, IssueStatus};
use crate::error::{Result, SendforgeError};
use crate::repo::load_commit_tree;
use crate::repo::objects::{parse_commit, read_loose_object, ObjectType};
use crate::repo::refs::{discover_all_refs, RefEntry};

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

fn issue_from_commit(repo_path: &Path, id_str: &str, number: usize, sha: &str) -> Result<Issue> {
    let raw = read_loose_object(repo_path, sha)?;
    if raw.object_type != ObjectType::Commit {
        return Err(SendforgeError::InvalidObject(format!(
            "Issue ref {sha} is not a commit object"
        )));
    }

    let commit = parse_commit(sha, &raw.data)?;
    let title = if commit.summary.is_empty() {
        format!("Issue #{number}")
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

    Ok(Issue {
        id: final_id,
        number,
        title,
        description,
        author: Author {
            name: commit.author.name,
            email: commit.author.email,
        },
        status: IssueStatus::Open,
        created_at,
        updated_at,
        labels: Vec::new(),
        comments: Vec::new(),
    })
}

/// Discovers and parses all Issues from `refs/issues/*`.
///
/// # Errors
/// Returns `SendforgeError` if Git object reading fails critically.
pub fn scan_issues(repo_path: &Path, all_refs: &BTreeMap<String, RefEntry>) -> Result<Vec<Issue>> {
    let mut issues = Vec::new();

    for (fallback_index, (ref_name, entry)) in (1..).zip(all_refs) {
        if let Some(raw_id_str) = ref_name.strip_prefix("refs/issues/") {
            let id = sanitize_id(raw_id_str);
            if id.is_empty() {
                continue;
            }
            let number = parse_id_number(&id, fallback_index);

            let mut issue_opt = None;

            if let Ok(raw) = read_loose_object(repo_path, &entry.sha) {
                match raw.object_type {
                    ObjectType::Blob => {
                        let text = String::from_utf8_lossy(&raw.data);
                        if let Ok(mut parsed) = serde_json::from_str::<Issue>(&text) {
                            let sanitized_parsed_id = sanitize_id(&parsed.id);
                            if sanitized_parsed_id.is_empty() {
                                parsed.id.clone_from(&id);
                            } else {
                                parsed.id = sanitized_parsed_id;
                            }
                            if parsed.number == 0 {
                                parsed.number = number;
                            }
                            issue_opt = Some(parsed);
                        }
                    }
                    ObjectType::Commit => {
                        if let Ok(commit) = parse_commit(&entry.sha, &raw.data) {
                            if let Ok(tree_entries) = load_commit_tree(repo_path, &commit.tree) {
                                for target in &["meta.json", "issue.json"] {
                                    if let Some(t_entry) = tree_entries
                                        .iter()
                                        .find(|e| !e.is_dir && e.name.eq_ignore_ascii_case(target))
                                    {
                                        if let Ok(blob_raw) =
                                            read_loose_object(repo_path, &t_entry.sha)
                                        {
                                            let text = String::from_utf8_lossy(&blob_raw.data);
                                            if let Ok(mut parsed) =
                                                serde_json::from_str::<Issue>(&text)
                                            {
                                                let sanitized_parsed_id = sanitize_id(&parsed.id);
                                                if sanitized_parsed_id.is_empty() {
                                                    parsed.id.clone_from(&id);
                                                } else {
                                                    parsed.id = sanitized_parsed_id;
                                                }
                                                if parsed.number == 0 {
                                                    parsed.number = number;
                                                }
                                                issue_opt = Some(parsed);
                                                break;
                                            }
                                        }
                                    }
                                }
                            }

                            if issue_opt.is_none() {
                                if let Ok(mut parsed) =
                                    serde_json::from_str::<Issue>(&commit.message)
                                {
                                    let sanitized_parsed_id = sanitize_id(&parsed.id);
                                    if sanitized_parsed_id.is_empty() {
                                        parsed.id.clone_from(&id);
                                    } else {
                                        parsed.id = sanitized_parsed_id;
                                    }
                                    if parsed.number == 0 {
                                        parsed.number = number;
                                    }
                                    issue_opt = Some(parsed);
                                }
                            }
                        }

                        if issue_opt.is_none() {
                            if let Ok(issue) = issue_from_commit(repo_path, &id, number, &entry.sha)
                            {
                                issue_opt = Some(issue);
                            }
                        }
                    }
                    _ => {}
                }
            }

            if let Some(mut issue) = issue_opt {
                if issue.id.is_empty() {
                    issue.id = format!("{number}");
                }
                issues.push(issue);
            }
        }
    }

    issues.sort_by_key(|i| i.number);
    Ok(issues)
}

/// Convenience function that discovers all refs and loads all Issues in a repository.
///
/// # Errors
/// Returns `SendforgeError` if repository references cannot be discovered.
pub fn load_issues(repo_path: &Path) -> Result<Vec<Issue>> {
    let all_refs = discover_all_refs(repo_path)?;
    scan_issues(repo_path, &all_refs)
}
