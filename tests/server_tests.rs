//! Unit and integration tests for server range requests, MIME types, and path security.

use std::path::Path;

use sendforge::server::mime::determine_mime_type;
use sendforge::server::range::{parse_range_header, resolve_byte_range, ByteRange};
use sendforge::server::{percent_decode, sanitize_path};

#[test]
fn test_range_header_parsing() {
    assert_eq!(
        parse_range_header("bytes=0-1023"),
        Some(ByteRange::FromTo(0, 1023))
    );
    assert_eq!(
        parse_range_header("bytes=5000-"),
        Some(ByteRange::From(5000))
    );
    assert_eq!(
        parse_range_header("bytes=-500"),
        Some(ByteRange::Suffix(500))
    );
    assert_eq!(parse_range_header("bytes=500-100"), None);
    assert_eq!(parse_range_header("invalid"), None);
}

#[test]
fn test_byte_range_resolution() {
    let total = 10_000;

    // 1. FromTo
    let (s, e, len) = resolve_byte_range(ByteRange::FromTo(0, 1023), total).unwrap();
    assert_eq!((s, e, len), (0, 1023, 1024));

    // 2. FromTo clamped to total_size - 1
    let (s, e, len) = resolve_byte_range(ByteRange::FromTo(9000, 15000), total).unwrap();
    assert_eq!((s, e, len), (9000, 9999, 1000));

    // 3. Single byte 0-0
    let (s, e, len) = resolve_byte_range(ByteRange::FromTo(0, 0), total).unwrap();
    assert_eq!((s, e, len), (0, 0, 1));

    // 4. Open-ended From
    let (s, e, len) = resolve_byte_range(ByteRange::From(5000), total).unwrap();
    assert_eq!((s, e, len), (5000, 9999, 5000));

    // 5. Suffix
    let (s, e, len) = resolve_byte_range(ByteRange::Suffix(500), total).unwrap();
    assert_eq!((s, e, len), (9500, 9999, 500));

    // 6. Unsatisfiable: start >= total
    assert_eq!(resolve_byte_range(ByteRange::From(10_000), total), None);
    assert_eq!(
        resolve_byte_range(ByteRange::FromTo(10_000, 11_000), total),
        None
    );

    // 7. Empty file (0 bytes)
    assert_eq!(resolve_byte_range(ByteRange::FromTo(0, 0), 0), None);
}

#[test]
fn test_mime_type_dispatch() {
    assert_eq!(
        determine_mime_type("/repo.git/info/refs", Path::new("info/refs")),
        "text/plain; charset=utf-8"
    );
    assert_eq!(
        determine_mime_type("/repo.git/HEAD", Path::new("HEAD")),
        "text/plain; charset=utf-8"
    );
    assert_eq!(
        determine_mime_type(
            "/repo.git/objects/info/packs",
            Path::new("objects/info/packs")
        ),
        "text/plain; charset=utf-8"
    );
    assert_eq!(
        determine_mime_type(
            "/objects/12/34567890123456789012345678901234567890",
            Path::new("34567890123456789012345678901234567890")
        ),
        "application/x-git-loose-object"
    );
    assert_eq!(
        determine_mime_type("/objects/pack/pack-123.pack", Path::new("pack-123.pack")),
        "application/x-git-packed-objects"
    );
    assert_eq!(
        determine_mime_type("/objects/pack/pack-123.idx", Path::new("pack-123.idx")),
        "application/x-git-packed-objects-toc"
    );
    assert_eq!(
        determine_mime_type("/index.html", Path::new("index.html")),
        "text/html; charset=utf-8"
    );
    assert_eq!(
        determine_mime_type("/style.css", Path::new("style.css")),
        "text/css; charset=utf-8"
    );
    assert_eq!(
        determine_mime_type("/app.js", Path::new("app.js")),
        "application/javascript; charset=utf-8"
    );
    assert_eq!(
        determine_mime_type("/meta.json", Path::new("meta.json")),
        "application/json; charset=utf-8"
    );
    assert_eq!(
        determine_mime_type("/engine.wasm", Path::new("engine.wasm")),
        "application/wasm"
    );
}

#[test]
fn test_percent_decoding_and_path_traversal() {
    assert_eq!(percent_decode("hello%20world"), "hello world");
    assert_eq!(percent_decode("%2e%2e%2f"), "../");

    let root = Path::new("/srv/git");

    let safe = sanitize_path(root, "/my-repo.git/info/refs").unwrap();
    assert_eq!(safe, root.join("my-repo.git/info/refs"));

    let traversal = sanitize_path(root, "/../etc/passwd");
    assert!(traversal.is_err());

    let encoded_traversal = sanitize_path(root, "/%2e%2e/etc/passwd");
    assert!(encoded_traversal.is_err());
}
