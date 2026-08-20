//! Integration tests for Git reference discovery and dumb HTTP info/refs generation.

use std::fs;
use tempfile::tempdir;

use sendforge::repo::refs::{discover_all_refs, read_head, update_server_info, HeadPointer};

#[test]
fn test_read_head_symbolic_and_detached() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();

    // 1. Symbolic HEAD
    fs::write(repo_path.join("HEAD"), b"ref: refs/heads/develop\n")?;
    let head1 = read_head(repo_path)?;
    assert_eq!(
        head1,
        HeadPointer::Symbolic {
            target_ref: "refs/heads/develop".into(),
            branch_name: "develop".into(),
        }
    );

    // 2. Detached HEAD
    let sha = "1234567890abcdef1234567890abcdef12345678";
    fs::write(repo_path.join("HEAD"), format!("{sha}\n"))?;
    let head2 = read_head(repo_path)?;
    assert_eq!(head2, HeadPointer::Detached(sha.into()));

    Ok(())
}

#[test]
fn test_loose_and_packed_refs_precedence() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();

    let packed_sha = "1111111111111111111111111111111111111111";
    let loose_sha = "2222222222222222222222222222222222222222";

    // Write packed-refs
    let packed_content = format!(
        "# pack-refs with: peeled fully-peeled sorted\n{packed_sha} refs/heads/main\n3333333333333333333333333333333333333333 refs/heads/feature\n"
    );
    fs::write(repo_path.join("packed-refs"), packed_content)?;

    // Write loose ref for refs/heads/main
    let heads_dir = repo_path.join("refs/heads");
    fs::create_dir_all(&heads_dir)?;
    fs::write(heads_dir.join("main"), format!("{loose_sha}\n"))?;

    let refs = discover_all_refs(repo_path)?;

    // Loose ref must override packed ref for 'refs/heads/main'
    let main_ref = refs.get("refs/heads/main").expect("refs/heads/main must exist");
    assert_eq!(main_ref.sha, loose_sha);

    // Packed ref for 'refs/heads/feature' must be preserved
    let feat_ref = refs.get("refs/heads/feature").expect("refs/heads/feature must exist");
    assert_eq!(feat_ref.sha, "3333333333333333333333333333333333333333");

    Ok(())
}

#[test]
fn test_update_server_info_generation() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();

    // 1. Setup refs
    let heads_dir = repo_path.join("refs/heads");
    let tags_dir = repo_path.join("refs/tags");
    fs::create_dir_all(&heads_dir)?;
    fs::create_dir_all(&tags_dir)?;

    fs::write(heads_dir.join("main"), b"4444444444444444444444444444444444444444\n")?;
    fs::write(tags_dir.join("v1.0.0"), b"5555555555555555555555555555555555555555\n")?;

    // 2. Setup packs
    let pack_dir = repo_path.join("objects/pack");
    fs::create_dir_all(&pack_dir)?;
    fs::write(pack_dir.join("pack-abc.pack"), b"fake pack data")?;
    fs::write(pack_dir.join("pack-abc.idx"), b"fake idx data")?;

    update_server_info(repo_path)?;

    let info_refs = fs::read_to_string(repo_path.join("info/refs"))?;
    assert!(info_refs.contains("4444444444444444444444444444444444444444\trefs/heads/main"));
    assert!(info_refs.contains("5555555555555555555555555555555555555555\trefs/tags/v1.0.0"));

    let packs_info = fs::read_to_string(repo_path.join("objects/info/packs"))?;
    assert!(packs_info.contains("P pack-abc.pack"));

    Ok(())
}

#[test]
fn test_info_refs_peeled_annotated_tags() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();

    let tag_sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    let peeled_commit_sha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    let packed_content = format!(
        "# pack-refs with: peeled fully-peeled sorted\n{tag_sha} refs/tags/v2.0.0\n^{peeled_commit_sha}\n"
    );
    fs::write(repo_path.join("packed-refs"), packed_content)?;

    update_server_info(repo_path)?;

    let info_refs = fs::read_to_string(repo_path.join("info/refs"))?;
    let expected_tag_line = format!("{tag_sha}\trefs/tags/v2.0.0\n");
    let expected_peeled_line = format!("{peeled_commit_sha}\trefs/tags/v2.0.0^{{}}\n");

    assert!(info_refs.contains(&expected_tag_line));
    assert!(info_refs.contains(&expected_peeled_line));
    // Verify that NO line begins with ^ in info/refs (the Dumb HTTP spec requires peeled tags to start with SHA)
    for line in info_refs.lines() {
        assert!(!line.starts_with('^'), "info/refs must not have lines starting with ^: {line}");
    }

    Ok(())
}

