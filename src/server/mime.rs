//! MIME Content-Type resolution for static files and Git dumb HTTP endpoints.

use std::path::Path;

/// Determines the MIME Content-Type for a requested URI path or file.
#[must_use]
pub fn determine_mime_type(path_str: &str, file_path: &Path) -> &'static str {
    let clean_path = path_str.trim_start_matches('/');

    // 1. Check Git dumb HTTP protocol endpoints
    if clean_path.ends_with("/info/refs") || clean_path == "info/refs" {
        return "text/plain; charset=utf-8";
    }
    if clean_path.ends_with("/HEAD") || clean_path == "HEAD" {
        return "text/plain; charset=utf-8";
    }
    if clean_path.ends_with("/objects/info/packs") || clean_path == "objects/info/packs" {
        return "text/plain; charset=utf-8";
    }
    if Path::new(clean_path)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pack"))
    {
        return "application/x-git-packed-objects";
    }
    if Path::new(clean_path)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("idx"))
    {
        return "application/x-git-packed-objects-toc";
    }

    // Check Git loose objects (/objects/xx/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx)
    if is_git_loose_object_path(clean_path) {
        return "application/x-git-loose-object";
    }

    // 2. Check by file extension
    let extension = file_path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_lowercase();

    match extension.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "wasm" => "application/wasm",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "txt" | "md" => "text/plain; charset=utf-8",
        "xml" => "application/xml",
        _ => "application/octet-stream",
    }
}

/// Checks if a request path matches a Git loose object pattern `objects/xx/xxx...`
fn is_git_loose_object_path(path: &str) -> bool {
    let segments: Vec<&str> = path.split('/').collect();
    if segments.len() < 2 {
        return false;
    }

    let last = segments[segments.len() - 1];
    let second_last = segments[segments.len() - 2];

    if second_last.len() == 2
        && second_last.chars().all(|c| c.is_ascii_hexdigit())
        && last.len() == 38
        && last.chars().all(|c| c.is_ascii_hexdigit())
    {
        if segments.len() >= 3 && segments[segments.len() - 3] == "objects" {
            return true;
        }
        if segments.len() == 2 {
            return true;
        }
    }

    false
}
