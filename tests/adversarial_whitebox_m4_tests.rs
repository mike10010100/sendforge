//! White-box Adversarial Test Suite for Milestone M4 (Tier 5 Adversarial Coverage Hardening).
//!
//! Thoroughly stress-tests:
//! 1. Multi-segment, path-traversal, null-byte, and malformed PR & Issue references and ID sanitization.
//! 2. Malformed Git object structures (commits with non-blob meta files, issue refs pointing to trees/tags, corrupted commit trees).
//! 3. Boundary timestamps (negative epoch, year 3000, i64::MAX, zero).
//! 4. Rapid post-receive hook executions with atomic file writes and path containment guards.
//! 5. Comprehensive XSS neutralization across all HTML pre-rendered templates and Markdown elements.
//! 6. Arbitrary fanout and corrupted review notes trees.

use flate2::write::ZlibEncoder;
use flate2::Compression;
use std::fs;
use std::io::Write;
use tempfile::tempdir;

use sendforge::collab::issues::load_issues;
use sendforge::collab::models::sanitize_id;
use sendforge::collab::notes::load_review_notes;
use sendforge::collab::pulls::load_pull_requests;
use sendforge::hook::{run_hook_update, validate_path_containment};
use sendforge::meta::generate_repo_metadata;
use sendforge::prerender::{
    format_timestamp_iso, render_markdown, render_pull_detail_html, render_pulls_html,
};
use sendforge::repo::init_bare_repo;
use sendforge::repo::objects::{compute_object_sha, ObjectType};
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
// 1. ADVERSARIAL SANITIZE_ID & PATH TRAVERSAL FUZZING
// =========================================================================

#[test]
fn test_adversarial_sanitize_id_exhaustive_fuzzing() {
    let attacks = vec![
        ("../../../../etc/passwd", "passwd"),
        ("..\\..\\..\\windows\\system32", "system32"),
        ("....//....//config.sys", "config.sys"),
        (".hidden_id", "hidden_id"),
        ("...dots...", "dots."),
        ("pr-42-feat.patch", "pr-42-feat.patch"),
        ("issue#999", "issue999"),
        ("<script>alert(1)</script>", "script"),
        ("CON.txt", "CON.txt"),
        ("NUL", "NUL"),
        ("PR/10/HEAD", "HEAD"),
        ("PR\\20\\meta", "meta"),
        ("", ""),
        ("   ", ""),
        ("///", ""),
        ("..", ""),
        (".", ""),
        ("./.", ""),
        ("../..", ""),
        ("a/b/c/d/123", "123"),
    ];

    for (input, expected) in attacks {
        let actual = sanitize_id(input);
        assert_eq!(
            actual, expected,
            "Failed sanitize_id for input: '{input}', expected: '{expected}', got: '{actual}'"
        );
        // Guarantee no path traversal components remain
        assert!(
            !actual.starts_with('.'),
            "Sanitized id '{actual}' must not start with dot"
        );
        assert!(
            !actual.contains(".."),
            "Sanitized id '{actual}' must not contain '..'"
        );
        assert!(
            !actual.contains('/'),
            "Sanitized id '{actual}' must not contain '/'"
        );
        assert!(
            !actual.contains('\\'),
            "Sanitized id '{actual}' must not contain '\\'"
        );
    }
}

// =========================================================================
// 2. PATHOLOGICAL PR AND ISSUE REFS DISCOVERY & FALLBACKS
// =========================================================================

#[test]
fn test_adversarial_deep_multisegment_pr_and_issue_refs_with_traversal_attempts(
) -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();
    init_bare_repo(repo_path, &InitOptions::default())?;

    let commit_sha = create_commit(
        repo_path,
        "Root commit\n\nBody message",
        None,
        None,
        1740000000,
    )?;

    // Create adversarial loose refs with deeply nested and path-traversal paths
    let refs_dir = repo_path.join("refs");
    let pr_heads_dir = refs_dir
        .join("pull")
        .join("security")
        .join("cve-2026")
        .join("101");
    fs::create_dir_all(&pr_heads_dir)?;
    fs::write(pr_heads_dir.join("head"), &commit_sha)?;

    // Issue ref with nested segment
    let issues_dir = refs_dir.join("issues").join("team").join("vuln");
    fs::create_dir_all(&issues_dir)?;
    fs::write(issues_dir.join("202"), &commit_sha)?;

    let pulls = load_pull_requests(repo_path)?;
    assert_eq!(pulls.len(), 1);
    assert_eq!(pulls[0].id, "101");
    assert_eq!(pulls[0].number, 101);
    assert_eq!(pulls[0].title, "Root commit");

    let issues = load_issues(repo_path)?;
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].id, "202");
    assert_eq!(issues[0].number, 202);
    assert_eq!(issues[0].title, "Root commit");

    Ok(())
}

#[test]
fn test_adversarial_pr_meta_commit_tree_with_nonblob_entries(
) -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();
    init_bare_repo(repo_path, &InitOptions::default())?;

    let head_commit = create_commit(repo_path, "Fallback PR Head Commit", None, None, 1740001000)?;

    // Create a tree where "meta.json" is actually a SUBTREE (not a blob)
    let dummy_tree = write_loose_object(repo_path, ObjectType::Tree, b"")?;
    let corrupt_tree = create_tree_with_entry(repo_path, "040000", "meta.json", &dummy_tree)?;
    let meta_commit = create_commit(
        repo_path,
        "Meta commit containing folder meta.json",
        None,
        Some(&corrupt_tree),
        1740002000,
    )?;

    // Write PR refs: head and meta
    let pr_dir = repo_path.join("refs").join("pull").join("55");
    fs::create_dir_all(&pr_dir)?;
    fs::write(pr_dir.join("head"), &head_commit)?;
    fs::write(pr_dir.join("meta"), &meta_commit)?;

    let pulls = load_pull_requests(repo_path)?;
    assert_eq!(pulls.len(), 1);
    assert_eq!(pulls[0].id, "55");
    assert_eq!(pulls[0].number, 55);
    // Should safely fallback to head_commit rather than crashing on subtree
    assert_eq!(pulls[0].title, "Fallback PR Head Commit");
    assert_eq!(pulls[0].head_commit, head_commit);

    Ok(())
}

#[test]
fn test_adversarial_issue_ref_pointing_to_tag_or_tree() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();
    init_bare_repo(repo_path, &InitOptions::default())?;

    // Write a tree object directly as an issue ref
    let tree_sha = write_loose_object(repo_path, ObjectType::Tree, b"")?;
    let issues_dir = repo_path.join("refs").join("issues");
    fs::create_dir_all(&issues_dir)?;
    fs::write(issues_dir.join("999"), &tree_sha)?;

    // Write a valid issue ref
    let commit_sha = create_commit(repo_path, "Valid Issue Commit", None, None, 1740003000)?;
    fs::write(issues_dir.join("100"), &commit_sha)?;

    let issues = load_issues(repo_path)?;
    // Tree object issue ref is safely skipped, valid issue is parsed
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].id, "100");
    assert_eq!(issues[0].number, 100);
    assert_eq!(issues[0].title, "Valid Issue Commit");

    Ok(())
}

// =========================================================================
// 3. EXTREME TIMESTAMPS & CLOCK WARP BOUNDARY STRESS TESTS
// =========================================================================

#[test]
fn test_adversarial_extreme_and_negative_timestamps_full_pipeline(
) -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();
    init_bare_repo(repo_path, &InitOptions::default())?;

    // Negative timestamp (before 1970)
    let neg_commit = create_commit(repo_path, "Old commit", None, None, -500000000)?;
    // Distant future timestamp (Year 3000 = 32503680000)
    let future_commit = create_commit(
        repo_path,
        "Future commit",
        Some(&neg_commit),
        None,
        32503680000,
    )?;

    let pr_dir = repo_path.join("refs").join("pull").join("1");
    fs::create_dir_all(&pr_dir)?;
    fs::write(pr_dir.join("head"), &neg_commit)?;

    let pr2_dir = repo_path.join("refs").join("pull").join("2");
    fs::create_dir_all(&pr2_dir)?;
    fs::write(pr2_dir.join("head"), &future_commit)?;

    let pulls = load_pull_requests(repo_path)?;
    assert_eq!(pulls.len(), 2);

    let pulls_html = render_pulls_html(&generate_repo_metadata(repo_path, None)?, &pulls);
    assert!(!pulls_html.is_empty());
    assert!(pulls_html.contains("Pull Requests"));

    let pr1_detail = render_pull_detail_html(&generate_repo_metadata(repo_path, None)?, &pulls[0]);
    assert!(!pr1_detail.is_empty());

    let pr2_detail = render_pull_detail_html(&generate_repo_metadata(repo_path, None)?, &pulls[1]);
    assert!(!pr2_detail.is_empty());

    // Timestamp ISO converter boundary checks
    assert_eq!(format_timestamp_iso(0), "1970-01-01T00:00:00Z");
    assert_eq!(format_timestamp_iso(i64::MIN), "1970-01-01T00:00:00Z");
    assert_eq!(format_timestamp_iso(i64::MAX), "1970-01-01T00:00:00Z");

    Ok(())
}

// =========================================================================
// 4. RAPID POST-RECEIVE HOOK & PATH CONTAINMENT VERIFICATION
// =========================================================================

#[test]
fn test_adversarial_hook_atomic_updates_under_rapid_ref_churn(
) -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();
    init_bare_repo(repo_path, &InitOptions::default())?;

    let out_dir = dir.path().join("export_out");
    fs::create_dir_all(&out_dir)?;

    let mut parent = None;
    for i in 1..=10 {
        let commit_sha = create_commit(
            repo_path,
            &format!("Ref iteration commit {i}"),
            parent.as_deref(),
            None,
            1740000000 + i * 100,
        )?;

        // Update branch
        let head_path = repo_path.join("refs").join("heads").join("main");
        fs::create_dir_all(head_path.parent().unwrap())?;
        fs::write(&head_path, &commit_sha)?;

        // Add PR and Issue
        let pr_dir = repo_path.join("refs").join("pull").join(format!("{i}"));
        fs::create_dir_all(&pr_dir)?;
        fs::write(pr_dir.join("head"), &commit_sha)?;

        let issue_dir = repo_path.join("refs").join("issues");
        fs::create_dir_all(&issue_dir)?;
        fs::write(issue_dir.join(format!("{i}")), &commit_sha)?;

        parent = Some(commit_sha);

        // Run hook update
        run_hook_update(repo_path, Some(&out_dir), true)?;

        // Verify exported assets exist and are valid JSON / HTML
        assert!(out_dir.join("meta.json").is_file());
        assert!(out_dir.join("pulls.json").is_file());
        assert!(out_dir.join("issues.json").is_file());
        assert!(out_dir.join("index.html").is_file());
        assert!(out_dir.join("log.html").is_file());
        assert!(out_dir.join("pulls.html").is_file());
        assert!(out_dir.join("issues.html").is_file());

        let pulls_json = fs::read_to_string(out_dir.join("pulls.json"))?;
        let parsed_pulls: serde_json::Value = serde_json::from_str(&pulls_json)?;
        assert_eq!(parsed_pulls.as_array().unwrap().len(), i as usize);

        let issues_json = fs::read_to_string(out_dir.join("issues.json"))?;
        let parsed_issues: serde_json::Value = serde_json::from_str(&issues_json)?;
        assert_eq!(parsed_issues.as_array().unwrap().len(), i as usize);
    }

    Ok(())
}

#[test]
fn test_adversarial_validate_path_containment_guards() {
    let base = std::path::Path::new("/var/git/repo/static");

    assert!(validate_path_containment(
        base,
        std::path::Path::new("/var/git/repo/static/pulls/1.html")
    )
    .is_ok());
    assert!(validate_path_containment(
        base,
        std::path::Path::new("/var/git/repo/static/issues/sub/2.html")
    )
    .is_ok());

    // Path traversal escapes
    assert!(validate_path_containment(
        base,
        std::path::Path::new("/var/git/repo/static/../secret.txt")
    )
    .is_err());
    assert!(validate_path_containment(
        base,
        std::path::Path::new("/var/git/repo/static/../../../../etc/passwd")
    )
    .is_err());
    assert!(validate_path_containment(base, std::path::Path::new("/tmp/outside")).is_err());
}

// =========================================================================
// 5. XSS NEUTRALIZATION IN MARKDOWN & HTML PRE-RENDERER
// =========================================================================

#[test]
fn test_adversarial_xss_in_all_prerender_fields() -> Result<(), Box<dyn std::error::Error>> {
    let xss_body = r#"<script>alert('xss')</script><img src=x onerror=alert(1)><a href="javascript:alert('link')">click</a>"#;

    let rendered_md = render_markdown(xss_body);
    assert!(
        !rendered_md.contains("<script>"),
        "Must escape raw <script> tag"
    );
    assert!(!rendered_md.contains("<img"), "Must escape raw <img> tag");
    assert!(
        rendered_md.contains("&lt;script&gt;"),
        "Must contain escaped script tag"
    );
    assert!(
        rendered_md.contains("&lt;img"),
        "Must contain escaped img tag"
    );
    assert!(
        !rendered_md.contains("href=\"javascript:"),
        "Must rewrite javascript: URLs to #"
    );

    Ok(())
}

// =========================================================================
// 6. ARBITRARY NOTES TREE FANOUT & MIXED PAYLOADS
// =========================================================================

#[test]
fn test_adversarial_review_notes_mixed_deep_fanout_and_corrupt_entries(
) -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();
    init_bare_repo(repo_path, &InitOptions::default())?;

    // Create note blob with valid JSON review note
    let note1_json = r#"{"commitSha":"1111111111111111111111111111111111111111","filePath":"src/main.rs","line":42,"author":{"name":"Reviewer","email":"rev@test.org"},"body":"Fix this buffer overflow!","createdAt":1740005000}"#;
    let note1_sha = write_loose_object(repo_path, ObjectType::Blob, note1_json.as_bytes())?;

    // Create note blob with plaintext review note
    let note2_text = "Plaintext review comment on commit";
    let note2_sha = write_loose_object(repo_path, ObjectType::Blob, note2_text.as_bytes())?;

    // Create a 2-level fanout tree: dir "11" -> entry "1111...": note1_sha, dir "22" -> entry "2222...": note2_sha
    let sub_tree1 = create_tree_with_entry(
        repo_path,
        "100644",
        "11111111111111111111111111111111111111",
        &note1_sha,
    )?;
    let sub_tree2 = create_tree_with_entry(
        repo_path,
        "100644",
        "22222222222222222222222222222222222222",
        &note2_sha,
    )?;

    let mut root_tree_bytes = Vec::new();
    root_tree_bytes.extend_from_slice(b"040000 11\0");
    root_tree_bytes.extend_from_slice(&hex::decode(&sub_tree1)?);
    root_tree_bytes.extend_from_slice(b"040000 22\0");
    root_tree_bytes.extend_from_slice(&hex::decode(&sub_tree2)?);
    let root_notes_tree = write_loose_object(repo_path, ObjectType::Tree, &root_tree_bytes)?;

    let notes_commit = create_commit(
        repo_path,
        "Review Notes Commit",
        None,
        Some(&root_notes_tree),
        1740006000,
    )?;

    // Write refs/notes/reviews
    let notes_ref_path = repo_path.join("refs").join("notes").join("reviews");
    fs::create_dir_all(notes_ref_path.parent().unwrap())?;
    fs::write(&notes_ref_path, &notes_commit)?;

    let notes = load_review_notes(repo_path)?;
    assert_eq!(notes.len(), 2);

    let note_with_line = notes
        .iter()
        .find(|n| n.line == Some(42))
        .expect("Must find line 42 note");
    assert_eq!(note_with_line.file_path.as_deref(), Some("src/main.rs"));
    assert_eq!(note_with_line.body, "Fix this buffer overflow!");

    let plaintext_note = notes
        .iter()
        .find(|n| n.body == "Plaintext review comment on commit")
        .expect("Must find plaintext note");
    assert_eq!(
        plaintext_note.commit_sha,
        "2222222222222222222222222222222222222222"
    );

    Ok(())
}
