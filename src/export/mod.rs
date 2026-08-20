//! Standalone static site exporter for Sendforge repositories.

use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{Result, SendforgeError};
use crate::hook::run_hook_update;
use crate::repo::refs::atomic_write_file;

/// Options for configuring the static site export.
#[derive(Debug, Clone, Default)]
pub struct ExportOptions {
    /// Path to compiled frontend SPA distribution assets to merge into export.
    pub frontend_dist: Option<PathBuf>,
    /// Base URL prefix for static links.
    pub base_url: Option<String>,
    /// Exclude Git objects directory from the exported folder.
    pub no_objects: bool,
}

/// Recursively copies a directory tree to a destination directory.
fn copy_dir_all(src: &Path, dst: &Path) -> Result<()> {
    if !src.is_dir() {
        return Ok(());
    }

    fs::create_dir_all(dst)?;

    for entry_res in fs::read_dir(src)? {
        let entry = entry_res?;
        let file_type = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if file_type.is_dir() {
            copy_dir_all(&src_path, &dst_path)?;
        } else if file_type.is_file() {
            let _ = fs::remove_file(&dst_path);
            fs::copy(&src_path, &dst_path)?;
        }
    }

    Ok(())
}

/// Exports a self-contained static site directory ready for S3, Cloudflare Pages, Caddy, or Nginx.
///
/// # Errors
/// Returns `SendforgeError` if repository files cannot be read or output cannot be written.
pub fn export_static_site(
    repo_path: &Path,
    output_dir: &Path,
    options: &ExportOptions,
) -> Result<()> {
    // 1. Ensure repository metadata and pre-rendered pages are up-to-date
    run_hook_update(repo_path, None, true)?;

    fs::create_dir_all(output_dir)?;

    // 2. Copy static entrypoint files (index.html, log.html, meta.json)
    let static_src = repo_path.join("static");
    if static_src.is_dir() {
        copy_dir_all(&static_src, output_dir)?;
    }

    // 3. Copy Git Dumb HTTP essential files (HEAD, config, info/refs)
    let head_src = repo_path.join("HEAD");
    if head_src.is_file() {
        let dst_head = output_dir.join("HEAD");
        let _ = fs::remove_file(&dst_head);
        fs::copy(&head_src, dst_head)?;
    }

    let config_src = repo_path.join("config");
    if config_src.is_file() {
        let dst_config = output_dir.join("config");
        let _ = fs::remove_file(&dst_config);
        fs::copy(&config_src, dst_config)?;
    }

    let info_refs_src = repo_path.join("info").join("refs");
    if info_refs_src.is_file() {
        let dst_info = output_dir.join("info");
        fs::create_dir_all(&dst_info)?;
        let dst_refs = dst_info.join("refs");
        let _ = fs::remove_file(&dst_refs);
        fs::copy(&info_refs_src, dst_refs)?;
    }

    // 4. Copy Git objects unless excluded
    if !options.no_objects {
        // Automatically unpack any packfiles into loose objects if present
        let pack_dir = repo_path.join("objects").join("pack");
        if pack_dir.is_dir() {
            if let Ok(entries) = fs::read_dir(&pack_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().and_then(|s| s.to_str()) == Some("pack") {
                        if let Ok(pack_data) = fs::read(&path) {
                            if let Ok(mut child) = std::process::Command::new("git")
                                .arg("--git-dir")
                                .arg(repo_path)
                                .arg("unpack-objects")
                                .arg("-q")
                                .stdin(std::process::Stdio::piped())
                                .spawn()
                            {
                                if let Some(mut stdin) = child.stdin.take() {
                                    use std::io::Write;
                                    let _ = stdin.write_all(&pack_data);
                                }
                                let _ = child.wait();
                            }
                        }
                    }
                }
            }
        }

        let objects_src = repo_path.join("objects");
        if objects_src.is_dir() {
            let objects_dst = output_dir.join("objects");
            copy_dir_all(&objects_src, &objects_dst)?;
        }
    }

    // 5. Merge compiled frontend SPA distribution if specified
    if let Some(ref dist_path) = options.frontend_dist {
        if dist_path.is_dir() {
            copy_dir_all(dist_path, output_dir)?;
        } else {
            return Err(SendforgeError::InvalidArgument(format!(
                "Frontend dist directory does not exist: {}",
                dist_path.display()
            )));
        }
    }

    // 6. Generate Cloudflare Pages / Netlify _headers file
    let headers_content = r"/*
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, HEAD, OPTIONS
  Access-Control-Allow-Headers: Range, Content-Type, Authorization, If-Modified-Since, If-None-Match
  Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges, ETag

/objects/*
  Content-Type: application/x-git-loose-object
  Cache-Control: public, max-age=31536000, immutable

/objects/pack/*.pack
  Content-Type: application/x-git-packed-objects
  Cache-Control: public, max-age=31536000, immutable

/objects/pack/*.idx
  Content-Type: application/x-git-packed-objects-toc
  Cache-Control: public, max-age=31536000, immutable

/info/refs
  Content-Type: text/plain; charset=utf-8
  Cache-Control: no-cache

/HEAD
  Content-Type: text/plain; charset=utf-8
  Cache-Control: no-cache
";

    atomic_write_file(&output_dir.join("_headers"), headers_content.as_bytes())?;

    Ok(())
}
