//! Integration tests for the static site exporter.

use std::fs;
use tempfile::tempdir;

use sendforge::export::{export_static_site, ExportOptions};
use sendforge::repo::{init_bare_repo, InitOptions};

#[test]
fn test_export_standalone_static_bundle() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path().join("source.git");
    let export_dir = dir.path().join("exported_site");
    let frontend_dist = dir.path().join("frontend_dist");

    // 1. Initialize repo
    init_bare_repo(&repo_path, &InitOptions::default())?;

    // 2. Create simulated frontend SPA build files
    fs::create_dir_all(&frontend_dist)?;
    fs::write(frontend_dist.join("app.js"), b"console.log('sendforge');")?;
    fs::write(frontend_dist.join("style.css"), b"body { margin: 0; }")?;

    let options = ExportOptions {
        frontend_dist: Some(frontend_dist),
        base_url: Some("/".into()),
        no_objects: false,
    };

    export_static_site(&repo_path, &export_dir, &options)?;

    // 3. Verify exported artifacts
    assert!(export_dir.join("index.html").is_file());
    assert!(export_dir.join("log.html").is_file());
    assert!(export_dir.join("meta.json").is_file());
    assert!(export_dir.join("HEAD").is_file());
    assert!(export_dir.join("config").is_file());
    assert!(export_dir.join("info/refs").is_file());
    assert!(export_dir.join("objects").is_dir());
    assert!(export_dir.join("app.js").is_file());
    assert!(export_dir.join("style.css").is_file());
    assert!(export_dir.join("_headers").is_file());

    let headers_content = fs::read_to_string(export_dir.join("_headers"))?;
    assert!(headers_content.contains("Access-Control-Allow-Origin: *"));
    assert!(headers_content.contains("application/x-git-loose-object"));

    Ok(())
}

#[test]
fn test_export_no_objects_flag() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path().join("source_no_obj.git");
    let export_dir = dir.path().join("exported_no_obj");

    init_bare_repo(&repo_path, &InitOptions::default())?;

    let options = ExportOptions {
        frontend_dist: None,
        base_url: None,
        no_objects: true,
    };

    export_static_site(&repo_path, &export_dir, &options)?;

    assert!(export_dir.join("index.html").is_file());
    assert!(export_dir.join("meta.json").is_file());
    assert!(!export_dir.join("objects").exists());

    Ok(())
}

#[test]
fn test_export_static_site_includes_all_collab_assets() -> Result<(), Box<dyn std::error::Error>> {
    use flate2::write::ZlibEncoder;
    use flate2::Compression;
    use sendforge::repo::objects::{compute_object_sha, ObjectType};
    use std::io::Write;

    let dir = tempdir()?;
    let repo_path = dir.path().join("export_src.git");
    let export_dir = dir.path().join("exported_site");

    init_bare_repo(&repo_path, &InitOptions::default())?;

    // Create helper to write loose object
    let write_obj =
        |obj_type: ObjectType, content: &[u8]| -> Result<String, Box<dyn std::error::Error>> {
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
        };

    let tree_sha = write_obj(ObjectType::Tree, b"")?;
    let commit_text = format!(
        "tree {tree_sha}\nauthor Alice <alice@example.com> 1740000000 +0000\ncommitter Alice <alice@example.com> 1740000000 +0000\n\nPR Commit\n"
    );
    let pr_commit = write_obj(ObjectType::Commit, commit_text.as_bytes())?;

    let pr_dir = repo_path.join("refs/pull/1");
    fs::create_dir_all(&pr_dir)?;
    fs::write(pr_dir.join("head"), format!("{pr_commit}\n"))?;

    let options = ExportOptions {
        frontend_dist: None,
        base_url: Some("/".into()),
        no_objects: false,
    };

    export_static_site(&repo_path, &export_dir, &options)?;

    // Assert exported collab files
    assert!(export_dir.join("pulls.json").is_file());
    assert!(export_dir.join("issues.json").is_file());
    assert!(export_dir.join("pulls.html").is_file());
    assert!(export_dir.join("issues.html").is_file());
    assert!(export_dir.join("pulls/1.html").is_file());

    Ok(())
}
