//! Integration tests for Git loose object compression, decompression, and parsing.

use flate2::write::ZlibEncoder;
use flate2::Compression;
use std::fs;
use std::io::Write;
use tempfile::tempdir;

use sendforge::error::SendforgeError;
use sendforge::repo::objects::{
    compute_object_sha, parse_commit, parse_signature, parse_tag, parse_tree, peel_tag,
    read_loose_object, ObjectType,
};

/// Helper to write a zlib-compressed loose object into `<repo>/objects/xx/xxx`.
fn write_loose_object_file(
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
fn test_loose_blob_write_and_read() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();

    let data = b"# Hello Sendforge\n\nThis is a test readme.";
    let sha = write_loose_object_file(repo_path, ObjectType::Blob, data)?;

    let read_obj = read_loose_object(repo_path, &sha)?;
    assert_eq!(read_obj.object_type, ObjectType::Blob);
    assert_eq!(read_obj.size, data.len());
    assert_eq!(&read_obj.data, data);

    Ok(())
}

#[test]
fn test_commit_parsing() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();

    let tree_sha = "0123456789abcdef0123456789abcdef01234567";
    let parent_sha = "fedcba9876543210fedcba9876543210fedcba98";
    let commit_text = format!(
        "tree {tree_sha}\nparent {parent_sha}\nauthor Alice <alice@example.com> 1787171400 +0000\ncommitter Bob <bob@example.com> 1787171400 +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n Version: GnuPG\n -----END PGP SIGNATURE-----\n\nfeat: implement git engine\n\nDetailed commit message body."
    );

    let sha = write_loose_object_file(repo_path, ObjectType::Commit, commit_text.as_bytes())?;
    let raw = read_loose_object(repo_path, &sha)?;
    let commit = parse_commit(&sha, &raw.data)?;

    assert_eq!(commit.id, sha);
    assert_eq!(commit.short_id, &sha[..7]);
    assert_eq!(commit.tree, tree_sha);
    assert_eq!(commit.parents, vec![parent_sha]);
    assert_eq!(commit.author.name, "Alice");
    assert_eq!(commit.author.email, "alice@example.com");
    assert_eq!(commit.author.timestamp, 1_787_171_400);
    assert_eq!(commit.committer.name, "Bob");
    assert_eq!(commit.summary, "feat: implement git engine");
    assert!(commit.message.contains("Detailed commit message body."));

    Ok(())
}

#[test]
fn test_tree_parsing_and_sorting() -> Result<(), Box<dyn std::error::Error>> {
    let mut tree_bytes = Vec::new();

    // 1. Blob: README.md
    tree_bytes.extend_from_slice(b"100644 README.md\0");
    tree_bytes.extend_from_slice(&[0x11; 20]);

    // 2. Directory tree: src
    tree_bytes.extend_from_slice(b"040000 src\0");
    tree_bytes.extend_from_slice(&[0x22; 20]);

    // 3. Executable: build.sh
    tree_bytes.extend_from_slice(b"100755 build.sh\0");
    tree_bytes.extend_from_slice(&[0x33; 20]);

    let entries = parse_tree(&tree_bytes)?;
    assert_eq!(entries.len(), 3);

    // Directories first
    assert_eq!(entries[0].name, "src");
    assert!(entries[0].is_dir);
    assert_eq!(entries[0].mode, "040000");

    // Files next (alphabetical)
    assert_eq!(entries[1].name, "README.md");
    assert!(!entries[1].is_dir);
    assert!(!entries[1].is_executable);

    assert_eq!(entries[2].name, "build.sh");
    assert!(!entries[2].is_dir);
    assert!(entries[2].is_executable);

    Ok(())
}

#[test]
fn test_annotated_tag_parsing_and_peeling() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();

    let commit_data = b"tree 0000000000000000000000000000000000000000\nauthor A <a@a.com> 0 +0000\ncommitter A <a@a.com> 0 +0000\n\nInitial";
    let commit_sha = write_loose_object_file(repo_path, ObjectType::Commit, commit_data)?;

    let tag_data = format!(
        "object {commit_sha}\ntype commit\ntag v1.0.0\ntagger Release Mgr <mgr@example.com> 1787172000 +0000\n\nRelease version 1.0.0"
    );
    let tag_sha = write_loose_object_file(repo_path, ObjectType::Tag, tag_data.as_bytes())?;

    let raw_tag = read_loose_object(repo_path, &tag_sha)?;
    let parsed = parse_tag(&raw_tag.data)?;

    assert_eq!(parsed.name, "v1.0.0");
    assert_eq!(parsed.target, commit_sha);
    assert_eq!(parsed.target_type, "commit");
    assert_eq!(
        parsed.tagger.as_ref().map(|t| t.name.as_str()),
        Some("Release Mgr")
    );
    assert_eq!(parsed.message.as_deref(), Some("Release version 1.0.0"));

    // Test peeling
    let peeled = peel_tag(repo_path, &tag_sha)?;
    assert_eq!(peeled, commit_sha);

    Ok(())
}

#[test]
fn test_corrupted_loose_objects_return_typed_errors() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();

    let sha_corrupt_zlib = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    let dir_a = repo_path.join("objects/aa");
    fs::create_dir_all(&dir_a)?;
    fs::write(
        dir_a.join(&sha_corrupt_zlib[2..]),
        b"not valid zlib compressed data",
    )?;

    let res = read_loose_object(repo_path, sha_corrupt_zlib);
    assert!(matches!(res, Err(SendforgeError::Decompression(_))));

    let sha_missing = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    let res_missing = read_loose_object(repo_path, sha_missing);
    assert!(matches!(
        res_missing,
        Err(SendforgeError::ObjectNotFound(_))
    ));

    Ok(())
}

#[test]
fn test_signature_parsing_clock_warp_safety() -> Result<(), Box<dyn std::error::Error>> {
    // 1. Normal modern timestamp
    let sig1 = parse_signature("John Doe <john@example.com> 1787171400 +0000")?;
    assert_eq!(sig1.name, "John Doe");
    assert_eq!(sig1.email, "john@example.com");
    assert_eq!(sig1.timestamp, 1_787_171_400);

    // 2. Pre-1970 negative timestamp
    let sig2 = parse_signature("Old Timer <old@example.com> -31536000 +0000")?;
    assert_eq!(sig2.timestamp, -31_536_000);
    assert!(sig2.date.starts_with("1969"));

    // 3. Zero timestamp
    let sig3 = parse_signature("Epoch <epoch@example.com> 0 +0000")?;
    assert_eq!(sig3.timestamp, 0);
    assert_eq!(sig3.date, "1970-01-01T00:00:00Z");

    Ok(())
}
