//! Integration tests for bare repository initialization.

use std::fs;
use tempfile::tempdir;

use sendforge::error::SendforgeError;
use sendforge::repo::{init_bare_repo, is_bare_repo, InitOptions};

#[test]
fn test_init_bare_repo_default_layout() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path().join("test_repo.git");

    let options = InitOptions {
        name: Some("test_repo".into()),
        description: Some("A test bare repository".into()),
        default_branch: Some("main".into()),
        owner: Some("alice".into()),
        clone_url: Some("http://localhost:8080/test_repo.git".into()),
        force: false,
    };

    init_bare_repo(&repo_path, &options)?;

    assert!(is_bare_repo(&repo_path));
    assert!(repo_path.join("HEAD").is_file());
    assert!(repo_path.join("config").is_file());
    assert!(repo_path.join("description").is_file());
    assert!(repo_path.join("info/refs").is_file());
    assert!(repo_path.join("objects/info/packs").is_file());
    assert!(repo_path.join("hooks/post-receive").is_file());
    assert!(repo_path.join("static").is_dir());

    let head_content = fs::read_to_string(repo_path.join("HEAD"))?;
    assert_eq!(head_content.trim(), "ref: refs/heads/main");

    let desc_content = fs::read_to_string(repo_path.join("description"))?;
    assert_eq!(desc_content.trim(), "A test bare repository");

    let config_content = fs::read_to_string(repo_path.join("config"))?;
    assert!(config_content.contains("bare = true"));
    assert!(config_content.contains("receivepack = true"));

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let hook_meta = fs::metadata(repo_path.join("hooks/post-receive"))?;
        let mode = hook_meta.permissions().mode();
        assert_eq!(mode & 0o111, 0o111, "Hook script should be executable");
    }

    Ok(())
}

#[test]
fn test_init_custom_default_branch() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path().join("trunk_repo.git");

    let options = InitOptions {
        default_branch: Some("trunk".into()),
        ..Default::default()
    };

    init_bare_repo(&repo_path, &options)?;

    let head_content = fs::read_to_string(repo_path.join("HEAD"))?;
    assert_eq!(head_content.trim(), "ref: refs/heads/trunk");

    Ok(())
}

#[test]
fn test_init_existing_directory_without_force_fails() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path().join("occupied.git");

    fs::create_dir_all(&repo_path)?;
    fs::write(repo_path.join("existing_file.txt"), b"data")?;

    let options = InitOptions {
        force: false,
        ..Default::default()
    };

    let result = init_bare_repo(&repo_path, &options);
    assert!(matches!(result, Err(SendforgeError::RepoAlreadyExists(_))));

    Ok(())
}

#[test]
fn test_init_existing_directory_with_force_succeeds() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path().join("reinit.git");

    fs::create_dir_all(&repo_path)?;
    fs::write(repo_path.join("dummy.txt"), b"old")?;

    let options = InitOptions {
        force: true,
        ..Default::default()
    };

    init_bare_repo(&repo_path, &options)?;
    assert!(is_bare_repo(&repo_path));

    Ok(())
}
