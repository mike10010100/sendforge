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

#[test]
fn test_multi_repo_export_flat_layout() -> Result<(), Box<dyn std::error::Error>> {
    use sendforge::export::multi::{export_multi_repository, ForgeIndex};

    let dir = tempdir()?;
    let repos_dir = dir.path().join("repos");
    let export_dir = dir.path().join("exported_forge");

    fs::create_dir_all(&repos_dir)?;

    let repo1_path = repos_dir.join("alpha.git");
    let repo2_path = repos_dir.join("beta.git");

    init_bare_repo(
        &repo1_path,
        &InitOptions {
            name: Some("Alpha Project".into()),
            description: Some("The primary alpha codebase".into()),
            default_branch: Some("main".into()),
            owner: Some("core-team".into()),
            clone_url: Some("https://forge.local/alpha.git".into()),
            force: false,
        },
    )?;

    init_bare_repo(
        &repo2_path,
        &InitOptions {
            name: Some("Beta Utility".into()),
            description: Some("Utility library beta".into()),
            default_branch: Some("master".into()),
            owner: None,
            clone_url: None,
            force: false,
        },
    )?;

    let options = ExportOptions {
        frontend_dist: None,
        base_url: Some("/".into()),
        no_objects: false,
    };

    let index: ForgeIndex = export_multi_repository(&repos_dir, &export_dir, &options)?;

    assert_eq!(index.version, 1);
    assert_eq!(index.title, "Sendforge Hub");
    assert_eq!(index.repos.len(), 2);

    // Verify repos.json exists and parses
    let json_file = export_dir.join("repos.json");
    assert!(json_file.is_file());
    let raw_json = fs::read_to_string(&json_file)?;
    let parsed_index: ForgeIndex = serde_json::from_str(&raw_json)?;
    assert_eq!(parsed_index.repos.len(), 2);

    // Verify sub-repository static outputs
    assert!(export_dir.join("alpha/index.html").is_file());
    assert!(export_dir.join("alpha/meta.json").is_file());
    assert!(export_dir.join("alpha/HEAD").is_file());
    assert!(export_dir.join("beta/index.html").is_file());
    assert!(export_dir.join("beta/meta.json").is_file());

    // Verify root dashboard index.html
    let root_index_file = export_dir.join("index.html");
    assert!(root_index_file.is_file());
    let root_html = fs::read_to_string(&root_index_file)?;
    assert!(root_html.contains("Sendforge Hub"));
    assert!(root_html.contains("Alpha Project"));
    assert!(root_html.contains("Beta Utility"));
    assert!(root_html.contains("alpha/"));
    assert!(root_html.contains("beta/"));
    assert!(root_html.contains("2 Repositories"));

    // Verify root _headers
    assert!(export_dir.join("_headers").is_file());

    Ok(())
}

#[test]
fn test_multi_repo_export_nested_owner_layout() -> Result<(), Box<dyn std::error::Error>> {
    use sendforge::export::multi::{export_multi_repository, ForgeIndex};

    let dir = tempdir()?;
    let repos_dir = dir.path().join("org_repos");
    let export_dir = dir.path().join("exported_org_forge");

    let alice_backend = repos_dir.join("alice").join("backend.git");
    let alice_frontend = repos_dir.join("alice").join("frontend.git");
    let bob_infra = repos_dir.join("bob").join("infra.git");

    init_bare_repo(
        &alice_backend,
        &InitOptions {
            name: Some("Alice Backend".into()),
            description: Some("Server backend services".into()),
            default_branch: Some("main".into()),
            owner: None, // Will be inferred as alice from directory path
            clone_url: None,
            force: false,
        },
    )?;

    init_bare_repo(
        &alice_frontend,
        &InitOptions {
            name: Some("Alice Frontend".into()),
            description: Some("Client web frontend".into()),
            default_branch: Some("main".into()),
            owner: None,
            clone_url: None,
            force: false,
        },
    )?;

    init_bare_repo(
        &bob_infra,
        &InitOptions {
            name: Some("Bob Infra".into()),
            description: Some("Cloud infrastructure and terraform".into()),
            default_branch: Some("trunk".into()),
            owner: None, // Will be inferred as bob
            clone_url: None,
            force: false,
        },
    )?;

    let options = ExportOptions {
        frontend_dist: None,
        base_url: None,
        no_objects: true,
    };

    let index: ForgeIndex = export_multi_repository(&repos_dir, &export_dir, &options)?;

    assert_eq!(index.repos.len(), 3);

    // Verify IDs and owners
    let alice_repos: Vec<_> = index
        .repos
        .iter()
        .filter(|r| r.owner.as_deref() == Some("alice"))
        .collect();
    assert_eq!(alice_repos.len(), 2);

    let bob_repos: Vec<_> = index
        .repos
        .iter()
        .filter(|r| r.owner.as_deref() == Some("bob"))
        .collect();
    assert_eq!(bob_repos.len(), 1);

    // Verify paths with trailing slash
    assert!(index.repos.iter().any(|r| r.path == "alice/backend/"));
    assert!(index.repos.iter().any(|r| r.path == "alice/frontend/"));
    assert!(index.repos.iter().any(|r| r.path == "bob/infra/"));

    // Verify sub-repository static output files
    assert!(export_dir.join("alice/backend/index.html").is_file());
    assert!(export_dir.join("alice/frontend/index.html").is_file());
    assert!(export_dir.join("bob/infra/index.html").is_file());

    // Verify root dashboard HTML contains owner sections
    let root_html = fs::read_to_string(export_dir.join("index.html"))?;
    assert!(root_html.contains("👤 alice"));
    assert!(root_html.contains("👤 bob"));
    assert!(root_html.contains("alice/backend/"));
    assert!(root_html.contains("bob/infra/"));

    Ok(())
}

#[test]
fn test_multi_repo_export_with_frontend_dist_and_schema_validation(
) -> Result<(), Box<dyn std::error::Error>> {
    use sendforge::export::multi::{export_multi_repository, ForgeIndex};

    let dir = tempdir()?;
    let repos_dir = dir.path().join("repos_dist");
    let export_dir = dir.path().join("exported_forge_dist");
    let frontend_dist = dir.path().join("frontend_assets");

    fs::create_dir_all(&frontend_dist)?;
    fs::write(frontend_dist.join("app.js"), b"// SPA bundle")?;
    fs::write(frontend_dist.join("style.css"), b"/* CSS bundle */")?;

    let repo_path = repos_dir.join("demo.git");
    init_bare_repo(&repo_path, &InitOptions::default())?;

    let options = ExportOptions {
        frontend_dist: Some(frontend_dist),
        base_url: Some("/hub/".into()),
        no_objects: false,
    };

    let index: ForgeIndex = export_multi_repository(&repos_dir, &export_dir, &options)?;

    // Verify frontend assets merged into root output
    assert!(export_dir.join("app.js").is_file());
    assert!(export_dir.join("style.css").is_file());
    assert!(export_dir.join("index.html").is_file());
    assert!(export_dir.join("repos.json").is_file());

    // Validate JSON schema shape exactly
    let raw_json = fs::read_to_string(export_dir.join("repos.json"))?;
    let json_val: serde_json::Value = serde_json::from_str(&raw_json)?;

    assert_eq!(json_val["version"], 1);
    assert_eq!(json_val["title"], "Sendforge Hub");
    assert!(json_val["generated_at"].is_string());
    assert!(json_val["repos"].is_array());

    let repo_obj = &json_val["repos"][0];
    assert!(repo_obj["id"].is_string());
    assert!(repo_obj["name"].is_string());
    assert!(repo_obj["default_branch"].is_string());
    assert!(repo_obj["stats"].is_object());
    assert!(repo_obj["stats"]["commits"].is_number());
    assert!(repo_obj["stats"]["branches"].is_number());
    assert!(repo_obj["stats"]["tags"].is_number());
    assert!(repo_obj["stats"]["issues"].is_number());
    assert!(repo_obj["stats"]["pulls"].is_number());
    assert!(repo_obj["path"].is_string());
    assert!(repo_obj["path"].as_str().unwrap().ends_with('/'));

    assert_eq!(index.repos.len(), 1);

    Ok(())
}

#[test]
fn test_cli_export_argument_parsing() -> Result<(), Box<dyn std::error::Error>> {
    let bin_path = env!("CARGO_BIN_EXE_sendforge");
    let dir = tempdir()?;
    let repos_dir = dir.path().join("repos");
    fs::create_dir_all(&repos_dir)?;
    let repo1 = repos_dir.join("repo1.git");
    init_bare_repo(&repo1, &InitOptions::default())?;

    // 1. Single repo export: sendforge export <repo> <out>
    let single_out = dir.path().join("single_out");
    let status = std::process::Command::new(bin_path)
        .args([
            "export",
            repo1.to_str().unwrap(),
            single_out.to_str().unwrap(),
        ])
        .status()?;
    assert!(
        status.success(),
        "sendforge export <repo> <out> must succeed"
    );
    assert!(single_out.join("index.html").is_file());

    // 2. Multi-repo export: sendforge export --all <repos_dir> <out_all>
    let multi_out = dir.path().join("multi_out");
    let status = std::process::Command::new(bin_path)
        .args([
            "export",
            "--all",
            repos_dir.to_str().unwrap(),
            multi_out.to_str().unwrap(),
        ])
        .status()?;
    assert!(
        status.success(),
        "sendforge export --all <repos_dir> <out_all> must succeed"
    );
    assert!(multi_out.join("index.html").is_file());
    assert!(multi_out.join("repos.json").is_file());

    // 3. Error when missing destination
    let status = std::process::Command::new(bin_path)
        .args(["export", "--all", repos_dir.to_str().unwrap()])
        .status()?;
    assert!(!status.success(), "export without destination should fail");

    Ok(())
}
