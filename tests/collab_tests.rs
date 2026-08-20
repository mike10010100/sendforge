//! Integration tests for Git collaboration ref discovery, metadata parsing, and JSON serialization.

use std::fs;
use tempfile::tempdir;

use sendforge::collab::issues::load_issues;
use sendforge::collab::models::{Author, Comment, IssueStatus, PullRequest, PullRequestStatus};
use sendforge::collab::notes::load_review_notes;
use sendforge::collab::pulls::load_pull_requests;
use sendforge::meta::{generate_repo_metadata, SendforgeRepoMeta};
use sendforge::repo::init_bare_repo;
use sendforge::repo::objects::{compute_object_sha, ObjectType};
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
    use flate2::write::ZlibEncoder;
    use flate2::Compression;
    use std::io::Write;

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
) -> Result<String, Box<dyn std::error::Error>> {
    let tree_sha = write_loose_object(repo_path, ObjectType::Tree, b"")?;
    let parent_line = parent.map_or_else(String::new, |p| format!("parent {p}\n"));
    let commit_text = format!(
        "tree {tree_sha}\n{parent_line}author Alice <alice@example.com> 1740000000 +0000\ncommitter Alice <alice@example.com> 1740000000 +0000\n\n{message}"
    );
    write_loose_object(repo_path, ObjectType::Commit, commit_text.as_bytes())
}

// =========================================================================
// 1. REF DISCOVERY
// =========================================================================

#[test]
fn test_discover_collaboration_refs_loose_and_packed() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();
    init_bare_repo(repo_path, &InitOptions::default())?;

    let commit_main = create_commit(repo_path, "Initial commit", None)?;
    let commit_pr1 = create_commit(repo_path, "Feature PR 1", Some(&commit_main))?;
    let commit_issue1 = create_commit(repo_path, "Issue 1 report", None)?;
    let notes_blob = write_loose_object(repo_path, ObjectType::Blob, b"Review notes content")?;

    // 1. Setup Loose Refs
    let pr_dir = repo_path.join("refs/pull/1");
    fs::create_dir_all(&pr_dir)?;
    fs::write(pr_dir.join("head"), format!("{commit_pr1}\n"))?;

    let issues_dir = repo_path.join("refs/issues");
    fs::create_dir_all(&issues_dir)?;
    fs::write(issues_dir.join("1"), format!("{commit_issue1}\n"))?;

    let notes_dir = repo_path.join("refs/notes");
    fs::create_dir_all(&notes_dir)?;
    fs::write(notes_dir.join("reviews"), format!("{notes_blob}\n"))?;

    // 2. Setup Packed Refs for PR 2 and Issue 2
    let commit_pr2 = create_commit(repo_path, "Feature PR 2", Some(&commit_main))?;
    let packed_content = format!(
        "# pack-refs with: peeled fully-peeled sorted\n{commit_main} refs/heads/main\n{commit_pr2} refs/pull/2/head\n{commit_issue1} refs/issues/2\n"
    );
    fs::write(repo_path.join("packed-refs"), packed_content)?;

    let all_refs = discover_all_refs(repo_path)?;

    // Assert discovery
    assert!(
        all_refs.contains_key("refs/pull/1/head"),
        "Missing refs/pull/1/head"
    );
    assert!(
        all_refs.contains_key("refs/pull/2/head"),
        "Missing packed refs/pull/2/head"
    );
    assert!(
        all_refs.contains_key("refs/issues/1"),
        "Missing refs/issues/1"
    );
    assert!(
        all_refs.contains_key("refs/issues/2"),
        "Missing packed refs/issues/2"
    );
    assert!(
        all_refs.contains_key("refs/notes/reviews"),
        "Missing refs/notes/reviews"
    );

    // Verify standard branches are preserved
    assert_eq!(
        all_refs.get("refs/heads/main").map(|r| &r.sha),
        Some(&commit_main)
    );

    Ok(())
}

// =========================================================================
// 2. PULL REQUEST JSON METADATA PARSING & COMMIT FALLBACK
// =========================================================================

#[test]
fn test_parse_pull_request_with_explicit_json_meta() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();
    init_bare_repo(repo_path, &InitOptions::default())?;

    let head_sha = create_commit(repo_path, "Add feature X\n\nDetailed commit message.", None)?;

    // Create JSON metadata blob
    let json_meta = r#"{
        "title": "Add feature X via PR",
        "description": "PR markdown description",
        "author": { "name": "Alice", "email": "alice@example.com" },
        "target_branch": "main",
        "source_branch": "feature/x",
        "status": "open",
        "created_at": 1740000000,
        "updated_at": 1740001000,
        "labels": ["feature", "ui"],
        "comments": [
            {
                "id": "c1",
                "author": { "name": "Bob", "email": "bob@example.com" },
                "body": "Looks great to me!",
                "created_at": 1740000500
            }
        ]
    }"#;

    let meta_blob_sha = write_loose_object(repo_path, ObjectType::Blob, json_meta.as_bytes())?;

    let pr_dir = repo_path.join("refs/pull/1");
    fs::create_dir_all(&pr_dir)?;
    fs::write(pr_dir.join("head"), format!("{head_sha}\n"))?;
    fs::write(pr_dir.join("meta"), format!("{meta_blob_sha}\n"))?;

    let pulls = load_pull_requests(repo_path)?;
    assert_eq!(pulls.len(), 1);

    let pr = &pulls[0];
    assert_eq!(pr.id, "1");
    assert_eq!(pr.number, 1);
    assert_eq!(pr.title, "Add feature X via PR");
    assert_eq!(pr.description, "PR markdown description");
    assert_eq!(pr.author.name, "Alice");
    assert_eq!(pr.author.email, "alice@example.com");
    assert_eq!(pr.target_branch, "main");
    assert_eq!(pr.source_branch, "feature/x");
    assert_eq!(pr.head_commit, head_sha);
    assert_eq!(pr.status, PullRequestStatus::Open);
    assert_eq!(pr.created_at, 1740000000);
    assert_eq!(pr.updated_at, 1740001000);
    assert_eq!(pr.labels, vec!["feature", "ui"]);
    assert_eq!(pr.comments.len(), 1);
    assert_eq!(pr.comments[0].id, "c1");
    assert_eq!(pr.comments[0].author.name, "Bob");
    assert_eq!(pr.comments[0].body, "Looks great to me!");

    Ok(())
}

#[test]
fn test_parse_pull_request_commit_fallback_when_meta_absent(
) -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();
    init_bare_repo(repo_path, &InitOptions::default())?;

    let commit_message =
        "feat(auth): implement oauth2 login\n\nSupports GitHub and Google providers.\nResolves #42.";
    let head_sha = create_commit(repo_path, commit_message, None)?;

    // Only create refs/pull/42/head (NO refs/pull/42/meta)
    let pr_dir = repo_path.join("refs/pull/42");
    fs::create_dir_all(&pr_dir)?;
    fs::write(pr_dir.join("head"), format!("{head_sha}\n"))?;

    let pulls = load_pull_requests(repo_path)?;
    assert_eq!(pulls.len(), 1);

    let pr = &pulls[0];
    assert_eq!(pr.id, "42");
    assert_eq!(pr.number, 42);
    assert_eq!(pr.title, "feat(auth): implement oauth2 login");
    assert!(pr
        .description
        .contains("Supports GitHub and Google providers."));
    assert_eq!(pr.author.name, "Alice");
    assert_eq!(pr.author.email, "alice@example.com");
    assert_eq!(pr.target_branch, "main");
    assert_eq!(pr.source_branch, "pull/42");
    assert_eq!(pr.head_commit, head_sha);
    assert_eq!(pr.status, PullRequestStatus::Open);
    assert_eq!(pr.created_at, 1740000000);
    assert_eq!(pr.labels, Vec::<String>::new());
    assert_eq!(pr.comments.len(), 0);

    Ok(())
}

// =========================================================================
// 3. ISSUE PARSING (JSON & COMMIT FALLBACK)
// =========================================================================

#[test]
fn test_parse_issue_json_and_commit_fallback() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();
    init_bare_repo(repo_path, &InitOptions::default())?;

    // Issue 1: Explicit JSON blob
    let issue_json = r#"{
        "title": "Bug in diff rendering",
        "description": "Lines wrapping unexpectedly on mobile.",
        "author": { "name": "Charlie", "email": "charlie@example.com" },
        "status": "open",
        "created_at": 1740000000,
        "updated_at": 1740000000,
        "labels": ["bug", "ui"],
        "comments": []
    }"#;
    let issue_blob_sha = write_loose_object(repo_path, ObjectType::Blob, issue_json.as_bytes())?;

    // Issue 2: Commit object fallback
    let commit_issue_sha = create_commit(
        repo_path,
        "Dark mode contrast issue\n\nText unreadable in sidebar.",
        None,
    )?;

    let issues_dir = repo_path.join("refs/issues");
    fs::create_dir_all(&issues_dir)?;
    fs::write(issues_dir.join("1"), format!("{issue_blob_sha}\n"))?;
    fs::write(issues_dir.join("2"), format!("{commit_issue_sha}\n"))?;

    let issues = load_issues(repo_path)?;
    assert_eq!(issues.len(), 2);

    let issue1 = issues
        .iter()
        .find(|i| i.id == "1")
        .expect("Issue 1 not found");
    assert_eq!(issue1.title, "Bug in diff rendering");
    assert_eq!(issue1.author.name, "Charlie");
    assert_eq!(issue1.status, IssueStatus::Open);
    assert_eq!(issue1.labels, vec!["bug", "ui"]);

    let issue2 = issues
        .iter()
        .find(|i| i.id == "2")
        .expect("Issue 2 not found");
    assert_eq!(issue2.title, "Dark mode contrast issue");
    assert!(issue2.description.contains("Text unreadable in sidebar."));
    assert_eq!(issue2.author.name, "Alice");
    assert_eq!(issue2.status, IssueStatus::Open);

    Ok(())
}

// =========================================================================
// 4. REVIEW NOTES PARSING
// =========================================================================

#[test]
fn test_parse_review_notes() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();
    init_bare_repo(repo_path, &InitOptions::default())?;

    let target_commit_sha = create_commit(repo_path, "Refactor core loop", None)?;

    let notes_payload = format!(
        r#"[
        {{
            "commit_sha": "{target_commit_sha}",
            "file_path": "src/engine/diff.rs",
            "line": 42,
            "author": {{ "name": "Reviewer Dave", "email": "dave@example.com" }},
            "body": "Consider using binary search here for performance.",
            "created_at": 1740002000
        }}
    ]"#
    );

    let notes_blob_sha = write_loose_object(repo_path, ObjectType::Blob, notes_payload.as_bytes())?;

    let notes_dir = repo_path.join("refs/notes");
    fs::create_dir_all(&notes_dir)?;
    fs::write(notes_dir.join("reviews"), format!("{notes_blob_sha}\n"))?;

    let notes = load_review_notes(repo_path)?;
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].commit_sha, target_commit_sha);
    assert_eq!(notes[0].file_path.as_deref(), Some("src/engine/diff.rs"));
    assert_eq!(notes[0].line, Some(42));
    assert_eq!(notes[0].author.name, "Reviewer Dave");
    assert_eq!(
        notes[0].body,
        "Consider using binary search here for performance."
    );

    Ok(())
}

// =========================================================================
// 5. JSON SCHEMA SERIALIZATION & ROUNDTRIP
// =========================================================================

#[test]
fn test_pulls_and_issues_json_schema_roundtrip() -> Result<(), Box<dyn std::error::Error>> {
    let prs = vec![PullRequest {
        id: "1".into(),
        number: 1,
        title: "Add feature X".into(),
        description: "Markdown body...".into(),
        author: Author {
            name: "Alice".into(),
            email: "alice@example.com".into(),
        },
        target_branch: "main".into(),
        source_branch: "feature/x".into(),
        head_commit: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2".into(),
        status: PullRequestStatus::Open,
        created_at: 1740000000,
        updated_at: 1740000000,
        labels: vec!["feature".into(), "ui".into()],
        comments: vec![Comment {
            id: "c1".into(),
            author: Author {
                name: "Bob".into(),
                email: "bob@example.com".into(),
            },
            body: "Looks great!".into(),
            created_at: 1740001000,
        }],
    }];

    let json_str = serde_json::to_string_pretty(&prs)?;
    assert!(json_str.contains(r#""id": "1""#));
    assert!(json_str.contains(r#""number": 1"#));
    assert!(json_str.contains(r#""target_branch": "main""#));
    assert!(json_str.contains(r#""source_branch": "feature/x""#));
    assert!(json_str.contains(r#""status": "open""#));

    let deserialized: Vec<PullRequest> = serde_json::from_str(&json_str)?;
    assert_eq!(prs, deserialized);

    Ok(())
}

// =========================================================================
// 6. METADATA STATS COUNT EXTENSION
// =========================================================================

#[test]
fn test_metadata_repo_stats_collaboration_counts() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();
    init_bare_repo(repo_path, &InitOptions::default())?;

    let commit_main = create_commit(repo_path, "Main commit", None)?;
    fs::write(
        repo_path.join("refs/heads/main"),
        format!("{commit_main}\n"),
    )?;

    // Create 2 PRs (1 open, 1 closed)
    let pr1_commit = create_commit(repo_path, "PR 1 commit", Some(&commit_main))?;
    let pr_dir1 = repo_path.join("refs/pull/1");
    fs::create_dir_all(&pr_dir1)?;
    fs::write(pr_dir1.join("head"), format!("{pr1_commit}\n"))?;

    let pr2_meta = r#"{"title":"PR 2","status":"closed","author":{"name":"A","email":"a@a.com"},"target_branch":"main","source_branch":"feat","created_at":0,"updated_at":0,"labels":[],"comments":[]}"#;
    let pr2_blob = write_loose_object(repo_path, ObjectType::Blob, pr2_meta.as_bytes())?;
    let pr_dir2 = repo_path.join("refs/pull/2");
    fs::create_dir_all(&pr_dir2)?;
    fs::write(pr_dir2.join("head"), format!("{pr1_commit}\n"))?;
    fs::write(pr_dir2.join("meta"), format!("{pr2_blob}\n"))?;

    // Create 3 Issues (2 open, 1 closed)
    let issue_dir = repo_path.join("refs/issues");
    fs::create_dir_all(&issue_dir)?;
    let issue1_blob = write_loose_object(repo_path, ObjectType::Blob, b"{\"title\":\"I1\",\"status\":\"open\",\"author\":{\"name\":\"A\",\"email\":\"a@a.com\"},\"created_at\":0,\"updated_at\":0,\"labels\":[],\"comments\":[]}")?;
    let issue2_blob = write_loose_object(repo_path, ObjectType::Blob, b"{\"title\":\"I2\",\"status\":\"open\",\"author\":{\"name\":\"A\",\"email\":\"a@a.com\"},\"created_at\":0,\"updated_at\":0,\"labels\":[],\"comments\":[]}")?;
    let issue3_blob = write_loose_object(repo_path, ObjectType::Blob, b"{\"title\":\"I3\",\"status\":\"closed\",\"author\":{\"name\":\"A\",\"email\":\"a@a.com\"},\"created_at\":0,\"updated_at\":0,\"labels\":[],\"comments\":[]}")?;
    fs::write(issue_dir.join("1"), format!("{issue1_blob}\n"))?;
    fs::write(issue_dir.join("2"), format!("{issue2_blob}\n"))?;
    fs::write(issue_dir.join("3"), format!("{issue3_blob}\n"))?;

    let meta = generate_repo_metadata(repo_path, None)?;
    assert_eq!(meta.stats.pull_count, 2);
    assert_eq!(meta.stats.open_pull_count, 1);
    assert_eq!(meta.stats.issue_count, 3);
    assert_eq!(meta.stats.open_issue_count, 2);

    Ok(())
}

// =========================================================================
// 7. BACKWARDS COMPATIBILITY
// =========================================================================

#[test]
fn test_backwards_compatible_meta_json_deserialization() -> Result<(), Box<dyn std::error::Error>> {
    // Old meta.json without pull_count, open_pull_count, issue_count, open_issue_count
    let legacy_json = r#"{
        "name": "legacy-repo",
        "description": "Legacy repo description",
        "default_branch": "main",
        "branches": [],
        "tags": [],
        "stats": {
            "branch_count": 1,
            "tag_count": 0,
            "commit_count": 5,
            "file_count": 10
        },
        "has_readme": false,
        "updated_at": "2026-08-19T20:30:05Z"
    }"#;

    let meta: SendforgeRepoMeta = serde_json::from_str(legacy_json)?;
    assert_eq!(meta.stats.branch_count, 1);
    assert_eq!(meta.stats.pull_count, 0, "Default serde value must be 0");
    assert_eq!(meta.stats.open_pull_count, 0);
    assert_eq!(meta.stats.issue_count, 0);
    assert_eq!(meta.stats.open_issue_count, 0);

    Ok(())
}
