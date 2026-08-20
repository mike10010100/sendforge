//! Adversarial Verification Suite for Milestone M1 (Collaboration Subsystem).
//!
//! Tests:
//! 1. Corrupted or invalid JSON in `refs/pull/<id>/meta` and `refs/issues/<id>` (fallback resilience).
//! 2. Extreme timestamps (negative seconds, i64::MAX, year 9999, i64::MIN, clock-warp).
//! 3. Repositories with 0 refs, only packed refs, and deep ref fanouts.
//! 4. Non-standard notes trees (Git 2/38 fanout, 2/2/36 fanout, empty/whitespace notes, mixed payloads).

use flate2::write::ZlibEncoder;
use flate2::Compression;
use std::fs;
use std::io::Write;
use tempfile::tempdir;

use sendforge::collab::issues::load_issues;
use sendforge::collab::models::{
    Author, Comment, Issue, IssueStatus, PullRequest, PullRequestStatus,
};
use sendforge::collab::notes::load_review_notes;
use sendforge::collab::pulls::load_pull_requests;
use sendforge::export::{export_static_site, ExportOptions};
use sendforge::hook::run_hook_update;
use sendforge::meta::generate_repo_metadata;
use sendforge::prerender::{
    format_timestamp_iso, render_issue_detail_html, render_issues_html, render_pull_detail_html,
    render_pulls_html,
};
use sendforge::repo::init_bare_repo;
use sendforge::repo::objects::{compute_object_sha, parse_signature, ObjectType};
use sendforge::repo::refs::discover_all_refs;
use sendforge::repo::InitOptions;

// =========================================================================
// TEST HELPERS
// =========================================================================

fn write_loose_object(
    repo_path: &std::path::Path,
    obj_type: ObjectType,
    content: &[u8],
) -> Result<String, Box<dyn std::error::Error>> {
    let sha = compute_object_sha(obj_type, content);
    let obj_dir = repo_path.join("objects").join(&sha[..2]);
    fs::create_dir_all(&obj_dir)?;

    let mut uncompressed = Vec::new();
    let header = format!("{obj_type} {}\0", content.len());
    uncompressed.extend_from_slice(header.as_bytes());
    uncompressed.extend_from_slice(content);

    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(&uncompressed)?;
    let compressed = encoder.finish()?;

    let obj_file = obj_dir.join(&sha[2..]);
    fs::write(obj_file, compressed)?;
    Ok(sha)
}

fn create_commit(
    repo_path: &std::path::Path,
    message: &str,
    parent: Option<&str>,
    tree_sha_opt: Option<&str>,
    timestamp: i64,
) -> Result<String, Box<dyn std::error::Error>> {
    let tree_sha = match tree_sha_opt {
        Some(sha) => sha.to_string(),
        None => write_loose_object(repo_path, ObjectType::Tree, b"")?,
    };

    let parent_line = parent.map_or_else(String::new, |p| format!("parent {p}\n"));
    let commit_text = format!(
        "tree {tree_sha}\n{parent_line}author Alice <alice@example.com> {timestamp} +0000\ncommitter Alice <alice@example.com> {timestamp} +0000\n\n{message}"
    );
    write_loose_object(repo_path, ObjectType::Commit, commit_text.as_bytes())
}

fn create_tree_with_entry(
    repo_path: &std::path::Path,
    entry_mode: &str,
    entry_name: &str,
    entry_sha: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let sha_bytes = hex::decode(entry_sha)?;
    let mut tree_bytes = Vec::new();
    tree_bytes.extend_from_slice(format!("{entry_mode} {entry_name}\0").as_bytes());
    tree_bytes.extend_from_slice(&sha_bytes);
    write_loose_object(repo_path, ObjectType::Tree, &tree_bytes)
}

// =========================================================================
// 1. CORRUPTED OR INVALID JSON FALLBACK STRESS TESTS
// =========================================================================

#[test]
fn test_adversarial_pr_corrupted_json_meta_falls_back_to_head_commit(
) -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();
    init_bare_repo(repo_path, &InitOptions::default())?;

    let main_commit = create_commit(repo_path, "Initial main commit", None, None, 1740000000)?;
    let pr_head_commit = create_commit(
        repo_path,
        "Feature X title\n\nThis is the detailed commit body description for PR 101.",
        Some(&main_commit),
        None,
        1740001000,
    )?;

    // Set up refs/heads/main
    let heads_dir = repo_path.join("refs/heads");
    fs::create_dir_all(&heads_dir)?;
    fs::write(heads_dir.join("main"), format!("{main_commit}\n"))?;

    // Set up refs/pull/101/head
    let pr_dir = repo_path.join("refs/pull/101");
    fs::create_dir_all(&pr_dir)?;
    fs::write(pr_dir.join("head"), format!("{pr_head_commit}\n"))?;

    // Scenario A: refs/pull/101/meta points to truncated JSON blob
    let truncated_json = b"{\"title\": \"Truncated PR Metadata";
    let meta_blob_truncated = write_loose_object(repo_path, ObjectType::Blob, truncated_json)?;
    fs::write(pr_dir.join("meta"), format!("{meta_blob_truncated}\n"))?;

    let pulls = load_pull_requests(repo_path)?;
    assert_eq!(pulls.len(), 1, "Expected 1 PR discovered");
    assert_eq!(pulls[0].id, "101");
    assert_eq!(pulls[0].number, 101);
    assert_eq!(pulls[0].title, "Feature X title");
    assert_eq!(
        pulls[0].description,
        "This is the detailed commit body description for PR 101."
    );
    assert_eq!(pulls[0].head_commit, pr_head_commit);
    assert_eq!(pulls[0].author.name, "Alice");
    assert_eq!(pulls[0].status, PullRequestStatus::Open);

    // Scenario B: refs/pull/101/meta points to invalid JSON syntax
    let syntax_err_json = b"{\"title\": \"Bad Syntax\", \"status\": invalid_unquoted_value, }";
    let meta_blob_syntax = write_loose_object(repo_path, ObjectType::Blob, syntax_err_json)?;
    fs::write(pr_dir.join("meta"), format!("{meta_blob_syntax}\n"))?;

    let pulls_b = load_pull_requests(repo_path)?;
    assert_eq!(pulls_b.len(), 1);
    assert_eq!(pulls_b[0].title, "Feature X title");

    // Scenario C: refs/pull/101/meta points to binary junk
    let binary_junk = &[0x00, 0xff, 0xfe, 0xca, 0xfe, 0xba, 0xbe, 0x12, 0x34];
    let meta_blob_binary = write_loose_object(repo_path, ObjectType::Blob, binary_junk)?;
    fs::write(pr_dir.join("meta"), format!("{meta_blob_binary}\n"))?;

    let pulls_c = load_pull_requests(repo_path)?;
    assert_eq!(pulls_c.len(), 1);
    assert_eq!(pulls_c[0].title, "Feature X title");

    // Scenario D: refs/pull/101/meta points to a non-existent object SHA
    fs::write(
        pr_dir.join("meta"),
        "0000000000000000000000000000000000000000\n",
    )?;
    let pulls_d = load_pull_requests(repo_path)?;
    assert_eq!(pulls_d.len(), 1);
    assert_eq!(pulls_d[0].title, "Feature X title");

    Ok(())
}

#[test]
fn test_adversarial_pr_corrupted_json_in_commit_tree_or_message(
) -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();
    init_bare_repo(repo_path, &InitOptions::default())?;

    let pr_head_commit = create_commit(
        repo_path,
        "Fallback PR Commit\n\nCommit body fallback",
        None,
        None,
        1740001000,
    )?;

    let pr_dir = repo_path.join("refs/pull/42");
    fs::create_dir_all(&pr_dir)?;
    fs::write(pr_dir.join("head"), format!("{pr_head_commit}\n"))?;

    // Create a meta commit with a meta.json in its tree that contains invalid JSON
    let bad_meta_blob = write_loose_object(repo_path, ObjectType::Blob, b"BAD JSON NOT PARSEABLE")?;
    let tree_sha = create_tree_with_entry(repo_path, "100644", "meta.json", &bad_meta_blob)?;
    let meta_commit = create_commit(
        repo_path,
        "Also malformed commit message { not json",
        None,
        Some(&tree_sha),
        1740001000,
    )?;

    fs::write(pr_dir.join("meta"), format!("{meta_commit}\n"))?;

    let pulls = load_pull_requests(repo_path)?;
    assert_eq!(pulls.len(), 1);
    assert_eq!(pulls[0].id, "42");
    assert_eq!(pulls[0].number, 42);
    assert_eq!(pulls[0].title, "Fallback PR Commit");
    assert_eq!(pulls[0].description, "Commit body fallback");

    Ok(())
}

#[test]
fn test_adversarial_issue_corrupted_json_in_blob_or_commit(
) -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();
    init_bare_repo(repo_path, &InitOptions::default())?;

    let issues_dir = repo_path.join("refs/issues");
    fs::create_dir_all(&issues_dir)?;

    // 1. Issue 1: points to a blob with invalid JSON -> skipped gracefully
    let bad_blob = write_loose_object(repo_path, ObjectType::Blob, b"INVALID ISSUE JSON")?;
    fs::write(issues_dir.join("1"), format!("{bad_blob}\n"))?;

    // 2. Issue 2: points to a commit with corrupted meta.json in tree -> falls back to commit fields!
    let bad_json_blob = write_loose_object(repo_path, ObjectType::Blob, b"{ invalid json }")?;
    let tree_sha = create_tree_with_entry(repo_path, "100644", "issue.json", &bad_json_blob)?;
    let commit_issue2 = create_commit(
        repo_path,
        "Bug in parser engine\n\nSteps to reproduce: push invalid ref.",
        None,
        Some(&tree_sha),
        1740002000,
    )?;
    fs::write(issues_dir.join("2"), format!("{commit_issue2}\n"))?;

    // 3. Issue 3: points to a valid JSON blob
    let valid_issue_json = r#"{
        "title": "Clean Issue 3",
        "description": "Works perfectly",
        "author": { "name": "Charlie", "email": "charlie@example.com" },
        "status": "closed",
        "labels": ["enhancement"]
    }"#;
    let valid_blob = write_loose_object(repo_path, ObjectType::Blob, valid_issue_json.as_bytes())?;
    fs::write(issues_dir.join("3"), format!("{valid_blob}\n"))?;

    let issues = load_issues(repo_path)?;
    assert_eq!(issues.len(), 2, "Expected 2 issues (issue 2 and issue 3)");

    assert_eq!(issues[0].id, "2");
    assert_eq!(issues[0].number, 2);
    assert_eq!(issues[0].title, "Bug in parser engine");
    assert_eq!(
        issues[0].description,
        "Steps to reproduce: push invalid ref."
    );
    assert_eq!(issues[0].status, IssueStatus::Open);

    assert_eq!(issues[1].id, "3");
    assert_eq!(issues[1].number, 3);
    assert_eq!(issues[1].title, "Clean Issue 3");
    assert_eq!(issues[1].status, IssueStatus::Closed);
    assert_eq!(issues[1].labels, vec!["enhancement".to_string()]);

    Ok(())
}

// =========================================================================
// 2. EXTREME TIMESTAMPS & CLOCK-WARP BOUNDARIES
// =========================================================================

#[test]
fn test_adversarial_iso_timestamp_formatting_boundaries() {
    // i64::MIN (out of chrono range -> fallback)
    assert_eq!(format_timestamp_iso(i64::MIN), "1970-01-01T00:00:00Z");

    // Negative timestamp (before 1970)
    assert_eq!(format_timestamp_iso(-1), "1969-12-31T23:59:59Z");
    assert_eq!(format_timestamp_iso(-62135596800), "0001-01-01T00:00:00Z");

    // Unix epoch 0
    assert_eq!(format_timestamp_iso(0), "1970-01-01T00:00:00Z");

    // Standard timestamp
    assert_eq!(format_timestamp_iso(1740000000), "2025-02-19T21:20:00Z");

    // Far future: year 9999
    assert_eq!(format_timestamp_iso(253402300799), "9999-12-31T23:59:59Z");

    // i64::MAX (out of chrono range -> fallback)
    assert_eq!(format_timestamp_iso(i64::MAX), "1970-01-01T00:00:00Z");
}

#[test]
fn test_adversarial_pr_issue_and_comments_extreme_timestamps(
) -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();
    init_bare_repo(repo_path, &InitOptions::default())?;

    let meta = generate_repo_metadata(repo_path, None)?;

    // PR with extreme timestamps
    let extreme_pr = PullRequest {
        id: "extreme-1".to_string(),
        number: 1,
        title: "PR with extreme time".to_string(),
        description: "Testing time boundaries".to_string(),
        author: Author {
            name: "Time Traveler".to_string(),
            email: "tt@example.com".to_string(),
        },
        target_branch: "main".to_string(),
        source_branch: "future".to_string(),
        head_commit: "0123456789012345678901234567890123456789".to_string(),
        status: PullRequestStatus::Open,
        created_at: i64::MIN,
        updated_at: i64::MAX,
        labels: vec!["time-warp".to_string()],
        comments: vec![
            Comment {
                id: "c1".to_string(),
                author: Author {
                    name: "Past".to_string(),
                    email: "past@example.com".to_string(),
                },
                body: "Before epoch comment".to_string(),
                created_at: -100_000_000,
            },
            Comment {
                id: "c2".to_string(),
                author: Author {
                    name: "Future".to_string(),
                    email: "future@example.com".to_string(),
                },
                body: "Year 9999 comment".to_string(),
                created_at: 253402300799,
            },
        ],
    };

    let pr_list_html = render_pulls_html(&meta, std::slice::from_ref(&extreme_pr));
    assert!(pr_list_html.contains("PR with extreme time"));
    assert!(pr_list_html.contains("1970-01-01T00:00:00Z"));

    let pr_detail_html = render_pull_detail_html(&meta, &extreme_pr);
    assert!(pr_detail_html.contains("Before epoch comment"));
    assert!(pr_detail_html.contains("Year 9999 comment"));
    assert!(pr_detail_html.contains("9999-12-31T23:59:59Z"));

    // Issue with extreme timestamps
    let extreme_issue = Issue {
        id: "extreme-issue-1".to_string(),
        number: 1,
        title: "Issue with extreme time".to_string(),
        description: "Testing issue time boundaries".to_string(),
        author: Author::default(),
        status: IssueStatus::Closed,
        created_at: i64::MAX,
        updated_at: -500,
        labels: vec![],
        comments: vec![],
    };

    let issues_list_html = render_issues_html(&meta, std::slice::from_ref(&extreme_issue));
    assert!(issues_list_html.contains("Issue with extreme time"));

    let issue_detail_html = render_issue_detail_html(&meta, &extreme_issue);
    assert!(issue_detail_html.contains("Issue with extreme time"));
    assert!(issue_detail_html.contains("1970-01-01T00:00:00Z"));

    Ok(())
}

#[test]
fn test_adversarial_commit_signature_timestamp_parsing() {
    let sig_min = parse_signature("User <user@example.com> -9223372036854775808 +0000").unwrap();
    assert_eq!(sig_min.timestamp, i64::MIN);
    assert_eq!(sig_min.date, "1970-01-01T00:00:00Z");

    let sig_max = parse_signature("User <user@example.com> 9223372036854775807 +0000").unwrap();
    assert_eq!(sig_max.timestamp, i64::MAX);
    assert_eq!(sig_max.date, "1970-01-01T00:00:00Z");

    let sig_overflow =
        parse_signature("User <user@example.com> 999999999999999999999999999999 +0000").unwrap();
    assert_eq!(sig_overflow.timestamp, 0);
    assert_eq!(sig_overflow.date, "1970-01-01T00:00:00Z");
}

// =========================================================================
// 3. ZERO REFS, ONLY PACKED REFS, DEEP FANOUT REFS
// =========================================================================

#[test]
fn test_adversarial_empty_repo_zero_refs_pipeline() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();
    init_bare_repo(repo_path, &InitOptions::default())?;

    // Completely empty repository (0 branches, 0 tags, 0 PRs, 0 issues, 0 notes)
    let all_refs = discover_all_refs(repo_path)?;
    assert!(all_refs.is_empty(), "Empty repo should have 0 refs");

    let pulls = load_pull_requests(repo_path)?;
    assert!(pulls.is_empty());

    let issues = load_issues(repo_path)?;
    assert!(issues.is_empty());

    let notes = load_review_notes(repo_path)?;
    assert!(notes.is_empty());

    let meta = generate_repo_metadata(repo_path, None)?;
    assert_eq!(meta.stats.branch_count, 0);
    assert_eq!(meta.stats.tag_count, 0);
    assert_eq!(meta.stats.commit_count, 0);
    assert_eq!(meta.stats.pull_count, 0);
    assert_eq!(meta.stats.issue_count, 0);

    // Run hook update
    run_hook_update(repo_path, None, true)?;

    let static_dir = repo_path.join("static");
    assert!(static_dir.join("pulls.json").is_file());
    assert!(static_dir.join("issues.json").is_file());
    assert!(static_dir.join("meta.json").is_file());
    assert!(static_dir.join("pulls.html").is_file());
    assert!(static_dir.join("issues.html").is_file());

    let pulls_content = fs::read_to_string(static_dir.join("pulls.json"))?;
    assert_eq!(pulls_content.trim(), "[]");

    let issues_content = fs::read_to_string(static_dir.join("issues.json"))?;
    assert_eq!(issues_content.trim(), "[]");

    // Run export
    let export_dir = dir.path().join("export_out");
    export_static_site(repo_path, &export_dir, &ExportOptions::default())?;
    assert!(export_dir.join("pulls.json").is_file());
    assert!(export_dir.join("issues.json").is_file());
    assert!(export_dir.join("pulls.html").is_file());
    assert!(export_dir.join("issues.html").is_file());

    Ok(())
}

#[test]
fn test_adversarial_only_packed_refs_collaboration_discovery(
) -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();
    init_bare_repo(repo_path, &InitOptions::default())?;

    let main_commit = create_commit(repo_path, "Main commit", None, None, 1740000000)?;
    let pr_commit = create_commit(
        repo_path,
        "Packed PR Commit",
        Some(&main_commit),
        None,
        1740001000,
    )?;
    let issue_commit = create_commit(repo_path, "Packed Issue Commit", None, None, 1740002000)?;
    let note_blob = write_loose_object(
        repo_path,
        ObjectType::Blob,
        b"{\"body\":\"Packed note review\",\"line\":42}",
    )?;

    // Remove loose refs directory completely to simulate freshly packed repo
    let refs_dir = repo_path.join("refs");
    let _ = fs::remove_dir_all(&refs_dir);

    // Create packed-refs file with branches, tags, PRs, issues, notes
    let packed_content = format!(
        "# pack-refs with: peeled fully-peeled sorted\n\
         {main_commit} refs/heads/main\n\
         {main_commit} refs/tags/v1.0\n\
         ^{main_commit}\n\
         {pr_commit} refs/pull/77/head\n\
         {issue_commit} refs/issues/88\n\
         {note_blob} refs/notes/reviews\n"
    );
    fs::write(repo_path.join("packed-refs"), packed_content)?;

    let all_refs = discover_all_refs(repo_path)?;
    assert_eq!(all_refs.len(), 5);

    let pulls = load_pull_requests(repo_path)?;
    assert_eq!(pulls.len(), 1);
    assert_eq!(pulls[0].id, "77");
    assert_eq!(pulls[0].number, 77);
    assert_eq!(pulls[0].title, "Packed PR Commit");

    let issues = load_issues(repo_path)?;
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].id, "88");
    assert_eq!(issues[0].number, 88);
    assert_eq!(issues[0].title, "Packed Issue Commit");

    let notes = load_review_notes(repo_path)?;
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].body, "Packed note review");
    assert_eq!(notes[0].line, Some(42));

    let meta = generate_repo_metadata(repo_path, None)?;
    assert_eq!(meta.stats.pull_count, 1);
    assert_eq!(meta.stats.open_pull_count, 1);
    assert_eq!(meta.stats.issue_count, 1);
    assert_eq!(meta.stats.open_issue_count, 1);
    assert_eq!(meta.stats.branch_count, 1);
    assert_eq!(meta.stats.tag_count, 1);

    Ok(())
}

#[test]
fn test_adversarial_deep_ref_fanout_and_numeric_id_parsing(
) -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();
    init_bare_repo(repo_path, &InitOptions::default())?;

    let base_commit = create_commit(repo_path, "Base commit", None, None, 1740000000)?;

    // Create 30 deeply nested branch refs: refs/heads/team/sub/area/feature/n
    for i in 1..=30 {
        let branch_dir = repo_path.join(format!("refs/heads/team/sub/area/feature/group{i}"));
        fs::create_dir_all(&branch_dir)?;
        fs::write(branch_dir.join("work"), format!("{base_commit}\n"))?;
    }

    // Create PR refs with alphanumeric & numeric IDs:
    // refs/pull/pr-9999/head
    let pr1_dir = repo_path.join("refs/pull/pr-9999");
    fs::create_dir_all(&pr1_dir)?;
    let pr1_commit = create_commit(
        repo_path,
        "PR 9999 Title\n\nAlphanumeric PR ID",
        Some(&base_commit),
        None,
        1740001000,
    )?;
    fs::write(pr1_dir.join("head"), format!("{pr1_commit}\n"))?;

    // refs/pull/alpha_only_id/head
    let pr2_dir = repo_path.join("refs/pull/alpha_only_id");
    fs::create_dir_all(&pr2_dir)?;
    let pr2_commit = create_commit(
        repo_path,
        "Alpha ID PR Title",
        Some(&base_commit),
        None,
        1740002000,
    )?;
    fs::write(pr2_dir.join("head"), format!("{pr2_commit}\n"))?;

    // Create deep Issue refs:
    // refs/issues/org/project/issue-12345
    let issue_dir = repo_path.join("refs/issues/org/project");
    fs::create_dir_all(&issue_dir)?;
    let issue_commit = create_commit(repo_path, "Deep Issue 12345", None, None, 1740003000)?;
    fs::write(issue_dir.join("issue-12345"), format!("{issue_commit}\n"))?;

    let all_refs = discover_all_refs(repo_path)?;
    assert_eq!(
        all_refs.len(),
        33,
        "Expected 30 branches + 2 PRs + 1 Issue = 33 refs"
    );

    let pulls = load_pull_requests(repo_path)?;
    assert_eq!(pulls.len(), 2);
    // Verified numeric ID extraction for pr-9999
    let p_9999 = pulls.iter().find(|p| p.number == 9999);
    assert!(p_9999.is_some(), "Expected PR #9999 to be parsed");
    assert_eq!(p_9999.unwrap().title, "PR 9999 Title");

    let issues = load_issues(repo_path)?;
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].number, 12345);
    assert_eq!(issues[0].title, "Deep Issue 12345");

    Ok(())
}

#[test]
fn test_adversarial_multi_segment_pr_id_support() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();
    init_bare_repo(repo_path, &InitOptions::default())?;

    let base_commit = create_commit(repo_path, "Base commit", None, None, 1740000000)?;

    // Multi-segment PR ref: refs/pull/team/subteam/1/head
    let pr_nested_dir = repo_path.join("refs/pull/team/subteam/1");
    fs::create_dir_all(&pr_nested_dir)?;
    let pr_commit = create_commit(
        repo_path,
        "Nested PR Ref",
        Some(&base_commit),
        None,
        1740001000,
    )?;
    fs::write(pr_nested_dir.join("head"), format!("{pr_commit}\n"))?;

    // Ref is discovered in discover_all_refs
    let all_refs = discover_all_refs(repo_path)?;
    assert!(all_refs.contains_key("refs/pull/team/subteam/1/head"));

    // scan_pull_requests strips suffix "/head" and extracts sanitized ID "1"
    let pulls = load_pull_requests(repo_path)?;
    assert_eq!(
        pulls.len(),
        1,
        "Multi-segment PR ref paths (refs/pull/team/subteam/1/head) must be correctly discovered and parsed"
    );
    assert_eq!(pulls[0].id, "1");
    assert_eq!(pulls[0].number, 1);
    assert_eq!(pulls[0].title, "Nested PR Ref");

    Ok(())
}

// =========================================================================
// 4. NON-STANDARD NOTES TREES & EMPTY NOTES
// =========================================================================

#[test]
fn test_adversarial_empty_and_whitespace_notes() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();
    init_bare_repo(repo_path, &InitOptions::default())?;

    // Empty note blob (0 bytes)
    let empty_blob = write_loose_object(repo_path, ObjectType::Blob, b"")?;

    // Whitespace note blob
    let ws_blob = write_loose_object(repo_path, ObjectType::Blob, b"   \n\t  \r\n   ")?;

    let mut tree_bytes = Vec::new();
    for (name, sha) in &[
        ("0123456789012345678901234567890123456789", &empty_blob),
        ("1123456789012345678901234567890123456789", &ws_blob),
    ] {
        let sha_bytes = hex::decode(sha)?;
        tree_bytes.extend_from_slice(format!("100644 {name}\0").as_bytes());
        tree_bytes.extend_from_slice(&sha_bytes);
    }
    let tree_sha = write_loose_object(repo_path, ObjectType::Tree, &tree_bytes)?;

    // Combine into commit
    let notes_commit = create_commit(repo_path, "Notes commit", None, Some(&tree_sha), 1740000000)?;

    let notes_dir = repo_path.join("refs/notes");
    fs::create_dir_all(&notes_dir)?;
    fs::write(notes_dir.join("reviews"), format!("{notes_commit}\n"))?;

    let notes = load_review_notes(repo_path)?;
    assert!(
        notes.is_empty(),
        "Empty/whitespace notes must not emit phantom review notes"
    );

    Ok(())
}

#[test]
fn test_adversarial_notes_git_standard_fanout_trees() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();
    init_bare_repo(repo_path, &InitOptions::default())?;

    // Note payload: single review note
    let note1_payload = r#"{
        "file_path": "src/main.rs",
        "line": 42,
        "author": { "name": "Reviewer", "email": "rev@example.com" },
        "body": "Check this boundary condition."
    }"#;
    let note1_blob = write_loose_object(repo_path, ObjectType::Blob, note1_payload.as_bytes())?;

    // Standard Git 2/38 fanout:
    // target commit SHA: 2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c
    // Directory entry: "2b" (tree), inside: "3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c" (blob)
    let subtree_sha = create_tree_with_entry(
        repo_path,
        "100644",
        "3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c",
        &note1_blob,
    )?;
    let root_tree_sha = create_tree_with_entry(repo_path, "040000", "2b", &subtree_sha)?;

    let notes_commit = create_commit(
        repo_path,
        "Notes fanout commit",
        None,
        Some(&root_tree_sha),
        1740000000,
    )?;

    let notes_dir = repo_path.join("refs/notes");
    fs::create_dir_all(&notes_dir)?;
    fs::write(notes_dir.join("reviews"), format!("{notes_commit}\n"))?;

    let notes = load_review_notes(repo_path)?;
    assert_eq!(notes.len(), 1);
    assert_eq!(
        notes[0].commit_sha, "2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c",
        "Reconstructed commit SHA from 2/38 fanout mismatch"
    );
    assert_eq!(notes[0].file_path, Some("src/main.rs".to_string()));
    assert_eq!(notes[0].line, Some(42));
    assert_eq!(notes[0].body, "Check this boundary condition.");

    Ok(())
}

#[test]
fn test_adversarial_notes_corrupted_and_mixed_payloads() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();
    init_bare_repo(repo_path, &InitOptions::default())?;

    // 1. Array of ReviewNotes
    let array_payload = r#"[
        { "body": "Comment A", "line": 10 },
        { "body": "Comment B", "line": 20 }
    ]"#;
    let array_blob = write_loose_object(repo_path, ObjectType::Blob, array_payload.as_bytes())?;

    // 2. Malformed JSON (falls back to plaintext note)
    let malformed_json = b"{\"body\": \"Unclosed string";
    let malformed_blob = write_loose_object(repo_path, ObjectType::Blob, malformed_json)?;

    // 3. Plaintext note
    let plain_blob = write_loose_object(repo_path, ObjectType::Blob, b"Plain text LGTM!")?;

    let mut tree_bytes = Vec::new();
    for (name, sha) in &[
        ("1111111111111111111111111111111111111111", &array_blob),
        ("2222222222222222222222222222222222222222", &malformed_blob),
        ("3333333333333333333333333333333333333333", &plain_blob),
    ] {
        let sha_bytes = hex::decode(sha)?;
        tree_bytes.extend_from_slice(format!("100644 {name}\0").as_bytes());
        tree_bytes.extend_from_slice(&sha_bytes);
    }
    let tree_sha = write_loose_object(repo_path, ObjectType::Tree, &tree_bytes)?;

    let notes_commit = create_commit(
        repo_path,
        "Mixed notes commit",
        None,
        Some(&tree_sha),
        1740000000,
    )?;

    let notes_dir = repo_path.join("refs/notes");
    fs::create_dir_all(&notes_dir)?;
    fs::write(notes_dir.join("reviews"), format!("{notes_commit}\n"))?;

    let notes = load_review_notes(repo_path)?;
    assert_eq!(
        notes.len(),
        4,
        "Expected 2 from array + 1 malformed (plaintext) + 1 plaintext = 4 notes"
    );

    // Verify array notes
    assert_eq!(notes[0].body, "Comment A");
    assert_eq!(
        notes[0].commit_sha,
        "1111111111111111111111111111111111111111"
    );
    assert_eq!(notes[1].body, "Comment B");

    // Verify malformed fallback to plaintext
    assert_eq!(notes[2].body, "{\"body\": \"Unclosed string");
    assert_eq!(
        notes[2].commit_sha,
        "2222222222222222222222222222222222222222"
    );

    // Verify plaintext note
    assert_eq!(notes[3].body, "Plain text LGTM!");
    assert_eq!(
        notes[3].commit_sha,
        "3333333333333333333333333333333333333333"
    );

    Ok(())
}
