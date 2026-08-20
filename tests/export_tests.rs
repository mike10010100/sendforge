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
