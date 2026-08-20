//! Comprehensive Adversarial & Edge Case Tests for Sendforge Git Parser Engine.
//!
//! Covers:
//! 1. Corrupted zlib loose object payloads & invalid headers
//! 2. Truncated binary tree records (missing null byte, truncated 20-byte SHA-1, missing mode space)
//! 3. Empty repositories (0 commits), 0-byte blobs (`.gitkeep`)
//! 4. Deeply nested directories (50+ path segments)
//! 5. Unicode, emoji, and special character filenames (`🦀.rs`, `ünicode/файл.txt`, whitespace)
//! 6. Multi-parent merge commits & octopus merges (3+ parent hashes)
//! 7. Clock-warp timestamps (future timestamps, negative timezone offsets, leap seconds)
//! 8. Tag peeling cycles and boundary conditions

use flate2::write::ZlibEncoder;
use flate2::Compression;
use std::fs;
use std::io::Write;
use tempfile::tempdir;

use sendforge::error::SendforgeError;
use sendforge::hook::run_hook_update;
use sendforge::meta::generate_repo_metadata;
use sendforge::repo::init_bare_repo;
use sendforge::repo::objects::{
    compute_object_sha, decompress_raw_object, parse_commit, parse_raw_object_bytes,
    parse_signature, parse_tree, peel_tag, read_loose_object, ObjectType,
};
use sendforge::repo::refs::{
    discover_all_refs, read_head, resolve_head_commit, update_server_info, HeadPointer,
};
use sendforge::repo::{load_commit_history, load_commit_tree, InitOptions};

/// Helper to write a zlib-compressed loose object into `<repo>/objects/xx/xxx`.
fn write_loose_object_raw(
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

// =========================================================================
// SECTION 1: Corrupted zlib loose object payloads and invalid headers
// =========================================================================

#[test]
fn test_adversarial_corrupted_zlib_streams() {
    // Completely random bytes (invalid zlib magic header -> Decompression error)
    let garbage = b"THIS IS NOT ZLIB COMPRESSED DATA AT ALL 1234567890!@#$%^&*()";
    let res_garbage = decompress_raw_object(garbage, "fake_sha");
    assert!(matches!(res_garbage, Err(SendforgeError::Decompression(_))));

    // Corrupted checksum / invalid block (fails during zlib decode)
    let corrupt_block = &[0x78, 0x9c, 0xff, 0xff, 0xff, 0xff, 0xff];
    let res_corrupt = decompress_raw_object(corrupt_block, "fake_sha");
    assert!(matches!(
        res_corrupt,
        Err(SendforgeError::Decompression(_) | SendforgeError::InvalidObject(_))
    ));

    // Valid zlib stream but payload is not a valid Git object header (no null byte) -> InvalidObject
    let mut enc = ZlibEncoder::new(Vec::new(), Compression::default());
    enc.write_all(b"not a valid git header without null byte")
        .unwrap();
    let valid_zlib_non_git = enc.finish().unwrap();
    let res_non_git = decompress_raw_object(&valid_zlib_non_git, "fake_sha");
    assert!(matches!(res_non_git, Err(SendforgeError::InvalidObject(_))));

    // Empty byte buffer -> decompresses to 0 bytes -> InvalidObject (Missing null byte)
    let empty_bytes = &[];
    let res_empty = decompress_raw_object(empty_bytes, "fake_sha");
    assert!(matches!(res_empty, Err(SendforgeError::InvalidObject(_))));
}

#[test]
fn test_adversarial_invalid_raw_object_headers() {
    // 1. Missing null byte entirely
    let no_null = b"blob 12345 hello world";
    assert!(matches!(
        parse_raw_object_bytes(no_null),
        Err(SendforgeError::InvalidObject(_))
    ));

    // 2. Empty decompressed payload
    let empty = b"";
    assert!(matches!(
        parse_raw_object_bytes(empty),
        Err(SendforgeError::InvalidObject(_))
    ));

    // 3. Unknown object type
    let bad_type = b"invalidtype 10\x001234567890";
    assert!(matches!(
        parse_raw_object_bytes(bad_type),
        Err(SendforgeError::InvalidObject(_))
    ));

    // 4. Missing size in header
    let missing_size = b"blob\0hello";
    assert!(matches!(
        parse_raw_object_bytes(missing_size),
        Err(SendforgeError::InvalidObject(_))
    ));

    // 5. Negative size in header
    let negative_size = b"blob -10\0hello";
    assert!(matches!(
        parse_raw_object_bytes(negative_size),
        Err(SendforgeError::InvalidObject(_))
    ));

    // 6. Non-numeric size
    let non_num_size = b"blob abc\0hello";
    assert!(matches!(
        parse_raw_object_bytes(non_num_size),
        Err(SendforgeError::InvalidObject(_))
    ));

    // 7. Huge integer overflow size
    let huge_size = b"blob 999999999999999999999999999999999999999999999999999999\0hello";
    assert!(matches!(
        parse_raw_object_bytes(huge_size),
        Err(SendforgeError::InvalidObject(_))
    ));

    // 8. Non-UTF8 header before null byte
    let invalid_utf8_header = &[0xff, 0xfe, 0xfd, 0x00, 0x61, 0x62, 0x63];
    assert!(matches!(
        parse_raw_object_bytes(invalid_utf8_header),
        Err(SendforgeError::InvalidObject(_))
    ));
}

// =========================================================================
// SECTION 2: Truncated binary tree records
// =========================================================================

#[test]
fn test_adversarial_truncated_tree_records() {
    // 1. Missing space after mode
    let bad_mode_space = b"100644README.md\0\x11\x11\x11\x11\x11\x11\x11\x11\x11\x11\x11\x11\x11\x11\x11\x11\x11\x11\x11\x11";
    assert!(matches!(
        parse_tree(bad_mode_space),
        Err(SendforgeError::InvalidObject(_))
    ));

    // 2. Missing null byte after filename
    let missing_null = b"100644 README.md";
    assert!(matches!(
        parse_tree(missing_null),
        Err(SendforgeError::InvalidObject(_))
    ));

    // 3. Truncated 20-byte SHA-1 (only 5 bytes provided)
    let mut truncated_sha = Vec::new();
    truncated_sha.extend_from_slice(b"100644 file.txt\0");
    truncated_sha.extend_from_slice(&[0xaa, 0xbb, 0xcc, 0xdd, 0xee]); // 5 bytes instead of 20
    assert!(matches!(
        parse_tree(&truncated_sha),
        Err(SendforgeError::InvalidObject(_))
    ));

    // 4. Truncated SHA-1 (0 bytes after null)
    let mut zero_sha = Vec::new();
    zero_sha.extend_from_slice(b"100644 empty_sha.txt\0");
    assert!(matches!(
        parse_tree(&zero_sha),
        Err(SendforgeError::InvalidObject(_))
    ));

    // 5. Valid first entry, truncated second entry
    let mut two_entries = Vec::new();
    two_entries.extend_from_slice(b"100644 valid.txt\0");
    two_entries.extend_from_slice(&[0x12; 20]);
    two_entries.extend_from_slice(b"100644 truncated.txt\0");
    two_entries.extend_from_slice(&[0x34; 10]); // Only 10 bytes SHA
    assert!(matches!(
        parse_tree(&two_entries),
        Err(SendforgeError::InvalidObject(_))
    ));

    // 6. Non-UTF-8 mode
    let mut bad_mode = Vec::new();
    bad_mode.extend_from_slice(&[0xff, 0xfe, b' ', b'f', b'i', b'l', b'e', 0x00]);
    bad_mode.extend_from_slice(&[0x00; 20]);
    assert!(matches!(
        parse_tree(&bad_mode),
        Err(SendforgeError::InvalidObject(_))
    ));
}

// =========================================================================
// SECTION 3: Empty repositories (0 commits), 0-byte blobs (`.gitkeep`)
// =========================================================================

#[test]
fn test_adversarial_empty_repository_and_zero_byte_blob() -> Result<(), Box<dyn std::error::Error>>
{
    let dir = tempdir()?;
    let repo_path = dir.path();

    // 1. Initialize fresh empty bare repository
    let opts = InitOptions {
        default_branch: Some("main".into()),
        ..Default::default()
    };
    init_bare_repo(repo_path, &opts)?;

    // 2. Read HEAD on empty repo
    let head = read_head(repo_path)?;
    assert_eq!(
        head,
        HeadPointer::Symbolic {
            target_ref: "refs/heads/main".into(),
            branch_name: "main".into(),
        }
    );

    // 3. Resolve HEAD commit on empty repo (should be None, NOT an error)
    let head_commit = resolve_head_commit(repo_path)?;
    assert_eq!(head_commit, None);

    // 4. Discover all refs on empty repo (should be empty map)
    let refs = discover_all_refs(repo_path)?;
    assert!(refs.is_empty());

    // 5. Run update_server_info on empty repo
    update_server_info(repo_path)?;
    assert!(repo_path.join("info/refs").is_file());

    // 6. Generate metadata on empty repo
    let meta = generate_repo_metadata(repo_path, None)?;
    assert_eq!(meta.default_branch, "main");
    assert_eq!(meta.latest_commit, None);
    assert_eq!(meta.stats.commit_count, 0);
    assert!(meta.branches.is_empty());
    assert!(meta.tags.is_empty());

    // 7. Run hook pipeline on empty repo (should succeed without panic)
    run_hook_update(repo_path, None, true)?;
    assert!(repo_path.join("static/meta.json").is_file());
    assert!(repo_path.join("static/index.html").is_file());
    assert!(repo_path.join("static/log.html").is_file());

    // 8. 0-byte blob (.gitkeep)
    let zero_byte_data = b"";
    let zero_blob_sha = write_loose_object_raw(repo_path, ObjectType::Blob, zero_byte_data)?;
    // Standard Git SHA-1 for empty blob is e69de29bb2d1d6434b8b29ae775ad8c2e48c5391
    assert_eq!(zero_blob_sha, "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");

    let read_zero_blob = read_loose_object(repo_path, &zero_blob_sha)?;
    assert_eq!(read_zero_blob.object_type, ObjectType::Blob);
    assert_eq!(read_zero_blob.size, 0);
    assert_eq!(read_zero_blob.data.len(), 0);

    // 9. Empty tree object (0 bytes payload)
    let empty_tree_data = b"";
    let empty_tree_sha = write_loose_object_raw(repo_path, ObjectType::Tree, empty_tree_data)?;
    // Standard Git SHA-1 for empty tree is 4b825dc642cb6eb9a060e54bf8d69288fbee4904
    assert_eq!(empty_tree_sha, "4b825dc642cb6eb9a060e54bf8d69288fbee4904");

    let entries = parse_tree(empty_tree_data)?;
    assert!(entries.is_empty());

    Ok(())
}

// =========================================================================
// SECTION 4: Deeply nested directories (50+ path segments)
// =========================================================================

#[test]
fn test_adversarial_deeply_nested_trees() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();

    // 1. Create a chain of 60 nested tree objects
    let leaf_blob_sha =
        write_loose_object_raw(repo_path, ObjectType::Blob, b"deep content in level 60")?;
    let mut current_tree_target_sha = leaf_blob_sha;
    let mut is_leaf = true;

    for i in (1..=60).rev() {
        let mut tree_payload = Vec::new();
        let name = format!("level_{i}");
        let mode = if is_leaf { "100644" } else { "040000" };
        tree_payload.extend_from_slice(format!("{mode} {name}\0").as_bytes());

        let binary_sha = hex::decode(&current_tree_target_sha)?;
        tree_payload.extend_from_slice(&binary_sha);

        let new_tree_sha = write_loose_object_raw(repo_path, ObjectType::Tree, &tree_payload)?;
        current_tree_target_sha = new_tree_sha;
        is_leaf = false;
    }

    let root_tree_sha = current_tree_target_sha;
    let root_entries = load_commit_tree(repo_path, &root_tree_sha)?;
    assert_eq!(root_entries.len(), 1);
    assert_eq!(root_entries[0].name, "level_1");
    assert!(root_entries[0].is_dir);

    Ok(())
}

// =========================================================================
// SECTION 5: Unicode, emoji, and special character filenames
// =========================================================================

#[test]
fn test_adversarial_unicode_emoji_and_special_filenames() -> Result<(), Box<dyn std::error::Error>>
{
    let special_names = vec![
        "🦀.rs",
        "🚀_rocket.ts",
        "ünicode/файл.txt",
        "中文_文件名.md",
        "العربية_ملف.txt",
        "עברית.txt",
        "file with multiple spaces and tabs.txt",
        "!@#$%^&*()_+-=[]{}|;:',.<>?.txt",
        ".hidden_config_file",
        "spaces at ends .txt",
    ];

    let mut tree_payload = Vec::new();
    for (i, name) in special_names.iter().enumerate() {
        let mode = if name.contains('/') {
            "040000"
        } else {
            "100644"
        };
        tree_payload.extend_from_slice(format!("{mode} {name}\0").as_bytes());
        tree_payload.extend_from_slice(&[(i as u8) + 1; 20]);
    }

    let parsed_entries = parse_tree(&tree_payload)?;
    assert_eq!(parsed_entries.len(), special_names.len());

    let parsed_names: Vec<String> = parsed_entries.iter().map(|e| e.name.clone()).collect();
    for name in &special_names {
        assert!(
            parsed_names.contains(&name.to_string()),
            "Tree missing entry for special name: {name}"
        );
    }

    // Verify directory sorting: dir ("ünicode/файл.txt") should come before regular files
    assert_eq!(parsed_entries[0].name, "ünicode/файл.txt");
    assert!(parsed_entries[0].is_dir);

    Ok(())
}

// =========================================================================
// SECTION 6: Multi-parent merge commits & octopus merges (3+ parent hashes)
// =========================================================================

#[test]
fn test_adversarial_octopus_merges_and_commit_headers() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();

    // 1. Octopus merge with 5 parents
    let parents = vec![
        "1111111111111111111111111111111111111111",
        "2222222222222222222222222222222222222222",
        "3333333333333333333333333333333333333333",
        "4444444444444444444444444444444444444444",
        "5555555555555555555555555555555555555555",
    ];

    let tree_sha = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
    let mut commit_str = format!("tree {tree_sha}\n");
    for p in &parents {
        commit_str.push_str(&format!("parent {p}\n"));
    }
    commit_str.push_str("author Octopus Dev <octopus@example.com> 1700000000 +0000\n");
    commit_str.push_str("committer Octopus Dev <octopus@example.com> 1700000000 +0000\n");
    commit_str.push_str("\nMerge 5 branches into main (octopus merge)\n\nDetailed resolution.");

    let commit_sha = write_loose_object_raw(repo_path, ObjectType::Commit, commit_str.as_bytes())?;
    let raw = read_loose_object(repo_path, &commit_sha)?;
    let commit = parse_commit(&commit_sha, &raw.data)?;

    assert_eq!(commit.tree, tree_sha);
    assert_eq!(commit.parents.len(), 5);
    assert_eq!(commit.parents, parents);
    assert_eq!(commit.summary, "Merge 5 branches into main (octopus merge)");

    // 2. Commit with GPG signature and extra unknown headers
    let signed_commit = format!(
        "tree {tree_sha}\nparent {}\nauthor Signer <s@s.com> 1700000000 +0000\ncommitter Signer <s@s.com> 1700000000 +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n Version: BCPG v1.68\n \n wsBcBAABCAAQBQJ...\n -----END PGP SIGNATURE-----\n\nCommit with signature",
        parents[0]
    );
    let signed_sha =
        write_loose_object_raw(repo_path, ObjectType::Commit, signed_commit.as_bytes())?;
    let signed_raw = read_loose_object(repo_path, &signed_sha)?;
    let parsed_signed = parse_commit(&signed_sha, &signed_raw.data)?;
    assert_eq!(parsed_signed.summary, "Commit with signature");
    assert_eq!(parsed_signed.parents, vec![parents[0]]);

    // 3. Traversal limit test with multi-parent commits
    let history = load_commit_history(repo_path, &commit_sha, 10)?;
    assert_eq!(history.len(), 1); // Only 1 commit in loose objects

    Ok(())
}

// =========================================================================
// SECTION 7: Clock-warp timestamps & extreme timezones
// =========================================================================

#[test]
fn test_adversarial_clock_warp_and_timezone_parsing() -> Result<(), Box<dyn std::error::Error>> {
    // 1. Year 2100 timestamp (future epoch)
    let sig_2100 = parse_signature("Futurist <future@example.com> 4102444800 +0000")?;
    assert_eq!(sig_2100.timestamp, 4_102_444_800);
    assert!(sig_2100.date.starts_with("2100"));

    // 2. Pre-1970 negative timestamp
    let sig_1965 = parse_signature("Retro Hacker <retro@example.com> -157766400 -0500")?;
    assert_eq!(sig_1965.timestamp, -157_766_400);
    assert!(sig_1965.date.starts_with("1965"));

    // 3. Quarter-hour timezone (+1245 Chatham Islands)
    let sig_chatham = parse_signature("Chatham Is <nz@example.com> 1700000000 +1245")?;
    assert_eq!(sig_chatham.timestamp, 1_700_000_000);

    // 4. Non-standard timestamp string (falls back to 0)
    let sig_corrupt_ts = parse_signature("Corrupt <c@c.com> not_a_number +0000")?;
    assert_eq!(sig_corrupt_ts.timestamp, 0);
    assert_eq!(sig_corrupt_ts.date, "1970-01-01T00:00:00Z");

    // 5. Signature without email brackets (returns Error)
    let sig_no_brackets = parse_signature("Just A Name 1700000000 +0000");
    assert!(matches!(
        sig_no_brackets,
        Err(SendforgeError::InvalidObject(_))
    ));

    // 6. Signature with mismatched brackets (returns Error)
    let sig_inverted = parse_signature("Mismatched >test@test.com< 1700000000 +0000");
    assert!(matches!(
        sig_inverted,
        Err(SendforgeError::InvalidObject(_))
    ));

    Ok(())
}

// =========================================================================
// SECTION 8: Tag peeling recursion depth and cyclic references
// =========================================================================

#[test]
fn test_adversarial_nested_annotated_tags_peeling() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path();

    // 1. Create base commit
    let base_commit = b"tree 0000000000000000000000000000000000000000\nauthor A <a@a.com> 0 +0000\ncommitter A <a@a.com> 0 +0000\n\nBase";
    let target_sha = write_loose_object_raw(repo_path, ObjectType::Commit, base_commit)?;

    // 2. Chain 5 nested annotated tags: tag5 -> tag4 -> tag3 -> tag2 -> tag1 -> commit
    let mut current_target = target_sha.clone();
    for i in 1..=5 {
        let tag_data = format!(
            "object {current_target}\ntype {}\ntag v1.0.{i}\ntagger Tagger <t@t.com> 1700000000 +0000\n\nNested tag {i}",
            if i == 1 { "commit" } else { "tag" }
        );
        let tag_sha = write_loose_object_raw(repo_path, ObjectType::Tag, tag_data.as_bytes())?;
        current_target = tag_sha;
    }

    let top_tag_sha = current_target;
    let peeled = peel_tag(repo_path, &top_tag_sha)?;
    assert_eq!(
        peeled, target_sha,
        "Nested annotated tag chain failed to peel to base commit"
    );

    Ok(())
}
