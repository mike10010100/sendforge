//! Integration tests for post-receive hook handler and metadata generation.

use flate2::write::ZlibEncoder;
use flate2::Compression;
use std::fs;
use std::io::Cursor;
use std::io::Write;
use tempfile::tempdir;

use sendforge::hook::{parse_ref_updates, run_hook_update};
use sendforge::meta::SendforgeRepoMeta;
use sendforge::repo::objects::{compute_object_sha, ObjectType};
use sendforge::repo::{init_bare_repo, InitOptions};

/// Helper to write a zlib-compressed loose object into `<repo>/objects/xx/xxx`.
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

#[test]
fn test_parse_ref_updates_stdin() -> Result<(), Box<dyn std::error::Error>> {
    let input = "0000000000000000000000000000000000000000 1111111111111111111111111111111111111111 refs/heads/main\n2222222222222222222222222222222222222222 3333333333333333333333333333333333333333 refs/heads/feature\n";
    let cursor = Cursor::new(input);
    let updates = parse_ref_updates(cursor)?;

    assert_eq!(updates.len(), 2);
    assert_eq!(updates[0].ref_name, "refs/heads/main");
    assert_eq!(
        updates[0].old_rev,
        "0000000000000000000000000000000000000000"
    );
    assert_eq!(
        updates[0].new_rev,
        "1111111111111111111111111111111111111111"
    );

    assert_eq!(updates[1].ref_name, "refs/heads/feature");
    assert_eq!(
        updates[1].old_rev,
        "2222222222222222222222222222222222222222"
    );
    assert_eq!(
        updates[1].new_rev,
        "3333333333333333333333333333333333333333"
    );

    Ok(())
}

#[test]
fn test_hook_pipeline_with_commit_and_readme() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path().join("my-project.git");

    let init_opts = InitOptions {
        name: Some("my-project".into()),
        description: Some("Awesome static project".into()),
        default_branch: Some("main".into()),
        clone_url: Some("http://localhost:8080/my-project.git".into()),
        ..Default::default()
    };
    init_bare_repo(&repo_path, &init_opts)?;

    // 1. Create README blob
    let readme_content = b"# Sendforge Awesome\n\n- Feature A\n- Feature B\n";
    let readme_sha = write_loose_object(&repo_path, ObjectType::Blob, readme_content)?;

    // 2. Create Tree object referencing README.md
    let mut tree_bytes = Vec::new();
    tree_bytes.extend_from_slice(b"100644 README.md\0");
    let readme_sha_bytes = hex::decode(&readme_sha)?;
    tree_bytes.extend_from_slice(&readme_sha_bytes);
    let tree_sha = write_loose_object(&repo_path, ObjectType::Tree, &tree_bytes)?;

    // 3. Create Commit object referencing Tree
    let commit_text = format!(
        "tree {tree_sha}\nauthor Dev <dev@sendforge.org> 1787171400 +0000\ncommitter Dev <dev@sendforge.org> 1787171400 +0000\n\nInitial commit with README\n"
    );
    let commit_sha = write_loose_object(&repo_path, ObjectType::Commit, commit_text.as_bytes())?;

    // 4. Update ref refs/heads/main
    fs::write(repo_path.join("refs/heads/main"), format!("{commit_sha}\n"))?;

    // 5. Run hook update
    run_hook_update(&repo_path, None, true)?;

    // 6. Assert static assets
    let meta_json_path = repo_path.join("static/meta.json");
    let index_html_path = repo_path.join("static/index.html");
    let log_html_path = repo_path.join("static/log.html");

    assert!(meta_json_path.is_file());
    assert!(index_html_path.is_file());
    assert!(log_html_path.is_file());

    // Validate meta.json
    let meta_str = fs::read_to_string(meta_json_path)?;
    let meta: SendforgeRepoMeta = serde_json::from_str(&meta_str)?;

    assert_eq!(meta.name, "my-project");
    assert_eq!(meta.default_branch, "main");
    assert!(meta.has_readme);
    assert_eq!(meta.readme_filename.as_deref(), Some("README.md"));
    assert_eq!(meta.stats.commit_count, 1);
    assert_eq!(meta.stats.file_count, 1);
    assert_eq!(meta.branches.len(), 1);
    assert_eq!(meta.branches[0].target, commit_sha);

    // Validate index.html
    let index_html = fs::read_to_string(index_html_path)?;
    assert!(index_html.contains("my-project"));
    assert!(index_html.contains("Awesome static project"));
    assert!(index_html.contains("git clone http://localhost:8080/my-project.git"));
    assert!(index_html.contains("Initial commit with README"));
    assert!(index_html.contains("README.md"));
    assert!(index_html.contains("Sendforge Awesome"));

    // Validate log.html
    let log_html = fs::read_to_string(log_html_path)?;
    assert!(log_html.contains("Initial commit with README"));
    assert!(log_html.contains("dev@sendforge.org"));
    assert!(log_html.contains(&commit_sha[..7]));

    Ok(())
}

#[test]
fn test_hook_pipeline_empty_repo() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path().join("empty.git");

    init_bare_repo(&repo_path, &InitOptions::default())?;
    run_hook_update(&repo_path, None, true)?;

    let meta_str = fs::read_to_string(repo_path.join("static/meta.json"))?;
    let meta: SendforgeRepoMeta = serde_json::from_str(&meta_str)?;

    assert_eq!(meta.stats.commit_count, 0);
    assert_eq!(meta.stats.file_count, 0);
    assert!(!meta.has_readme);

    let index_html = fs::read_to_string(repo_path.join("static/index.html"))?;
    assert!(index_html.contains("No files in default branch or repository is empty."));

    Ok(())
}

#[test]
fn test_hook_pipeline_emits_collaboration_assets() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path().join("collab_hook.git");

    let init_opts = InitOptions {
        name: Some("collab-hook-test".into()),
        default_branch: Some("main".into()),
        ..Default::default()
    };
    init_bare_repo(&repo_path, &init_opts)?;

    // 1. Commit on main
    let tree_sha = write_loose_object(&repo_path, ObjectType::Tree, b"")?;
    let commit_text = format!(
        "tree {tree_sha}\nauthor Alice <alice@example.com> 1740000000 +0000\ncommitter Alice <alice@example.com> 1740000000 +0000\n\nInitial main commit\n"
    );
    let commit_main = write_loose_object(&repo_path, ObjectType::Commit, commit_text.as_bytes())?;
    fs::write(
        repo_path.join("refs/heads/main"),
        format!("{commit_main}\n"),
    )?;

    // 2. Add PR ref and Issue ref
    let pr_tree_sha = write_loose_object(&repo_path, ObjectType::Tree, b"")?;
    let pr_commit_text = format!(
        "tree {pr_tree_sha}\nparent {commit_main}\nauthor Alice <alice@example.com> 1740000000 +0000\ncommitter Alice <alice@example.com> 1740000000 +0000\n\nPR head commit\n"
    );
    let pr_commit = write_loose_object(&repo_path, ObjectType::Commit, pr_commit_text.as_bytes())?;
    let pr_dir = repo_path.join("refs/pull/1");
    fs::create_dir_all(&pr_dir)?;
    fs::write(pr_dir.join("head"), format!("{pr_commit}\n"))?;

    let issue_dir = repo_path.join("refs/issues");
    fs::create_dir_all(&issue_dir)?;
    let issue_tree_sha = write_loose_object(&repo_path, ObjectType::Tree, b"")?;
    let issue_commit_text = format!(
        "tree {issue_tree_sha}\nauthor Alice <alice@example.com> 1740000000 +0000\ncommitter Alice <alice@example.com> 1740000000 +0000\n\nBug in parser\n"
    );
    let issue_commit =
        write_loose_object(&repo_path, ObjectType::Commit, issue_commit_text.as_bytes())?;
    fs::write(issue_dir.join("1"), format!("{issue_commit}\n"))?;

    // 3. Execute hook update
    run_hook_update(&repo_path, None, true)?;

    // 4. Verify generated static files
    let static_dir = repo_path.join("static");
    assert!(static_dir.join("meta.json").is_file());
    assert!(static_dir.join("pulls.json").is_file());
    assert!(static_dir.join("issues.json").is_file());
    assert!(static_dir.join("pulls.html").is_file());
    assert!(static_dir.join("issues.html").is_file());
    assert!(static_dir.join("pulls/1.html").is_file());
    assert!(static_dir.join("issues/1.html").is_file());

    // 5. Verify stats inside meta.json
    let meta_str = fs::read_to_string(static_dir.join("meta.json"))?;
    let meta: SendforgeRepoMeta = serde_json::from_str(&meta_str)?;
    assert_eq!(meta.stats.pull_count, 1);
    assert_eq!(meta.stats.issue_count, 1);

    Ok(())
}
