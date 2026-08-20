//! Review Notes discovery and parsing subsystem (`refs/notes/reviews`).

use std::collections::BTreeMap;
use std::path::Path;

use crate::collab::models::{Author, ReviewNote};
use crate::error::Result;
use crate::repo::load_commit_tree;
use crate::repo::objects::{parse_commit, read_loose_object, ObjectType};
use crate::repo::refs::{discover_all_refs, RefEntry};

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
enum NotePayload {
    Single(ReviewNote),
    Multiple(Vec<ReviewNote>),
}

fn parse_note_payload(text: &str, target_commit_sha: &str, notes: &mut Vec<ReviewNote>) {
    if let Ok(payload) = serde_json::from_str::<NotePayload>(text) {
        match payload {
            NotePayload::Single(mut note) => {
                if note.commit_sha.is_empty() {
                    note.commit_sha = target_commit_sha.to_string();
                }
                notes.push(note);
            }
            NotePayload::Multiple(list) => {
                for mut note in list {
                    if note.commit_sha.is_empty() {
                        note.commit_sha = target_commit_sha.to_string();
                    }
                    notes.push(note);
                }
            }
        }
    } else {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            notes.push(ReviewNote {
                commit_sha: target_commit_sha.to_string(),
                file_path: None,
                line: None,
                author: Author::default(),
                body: trimmed.to_string(),
                created_at: 0,
            });
        }
    }
}

/// Recursively collects review notes from a Git notes tree object.
fn collect_notes_from_tree(
    repo_path: &Path,
    tree_sha: &str,
    sha_prefix: &str,
    notes: &mut Vec<ReviewNote>,
) -> Result<()> {
    if tree_sha.is_empty() {
        return Ok(());
    }

    let entries = load_commit_tree(repo_path, tree_sha)?;
    for entry in entries {
        let full_name = format!("{sha_prefix}{}", entry.name);
        if entry.is_dir {
            collect_notes_from_tree(repo_path, &entry.sha, &full_name, notes)?;
        } else if let Ok(raw) = read_loose_object(repo_path, &entry.sha) {
            let text = String::from_utf8_lossy(&raw.data);
            parse_note_payload(&text, &full_name, notes);
        }
    }

    Ok(())
}

/// Discovers and parses all Review Notes from `refs/notes/reviews` and `refs/notes/*`.
///
/// # Errors
/// Returns `SendforgeError` if Git notes traversal fails.
pub fn scan_review_notes(
    repo_path: &Path,
    all_refs: &BTreeMap<String, RefEntry>,
) -> Result<Vec<ReviewNote>> {
    let mut notes = Vec::new();

    for (ref_name, entry) in all_refs {
        if ref_name == "refs/notes/reviews" || ref_name.starts_with("refs/notes/") {
            if let Ok(raw) = read_loose_object(repo_path, &entry.sha) {
                match raw.object_type {
                    ObjectType::Commit => {
                        if let Ok(commit) = parse_commit(&entry.sha, &raw.data) {
                            collect_notes_from_tree(repo_path, &commit.tree, "", &mut notes)?;
                        }
                    }
                    ObjectType::Tree => {
                        collect_notes_from_tree(repo_path, &entry.sha, "", &mut notes)?;
                    }
                    ObjectType::Blob => {
                        let text = String::from_utf8_lossy(&raw.data);
                        parse_note_payload(&text, "", &mut notes);
                    }
                    ObjectType::Tag => {}
                }
            }
        }
    }

    Ok(notes)
}

/// Convenience function that discovers all refs and loads all Review Notes in a repository.
///
/// # Errors
/// Returns `SendforgeError` if repository references cannot be discovered.
pub fn load_review_notes(repo_path: &Path) -> Result<Vec<ReviewNote>> {
    let all_refs = discover_all_refs(repo_path)?;
    scan_review_notes(repo_path, &all_refs)
}
