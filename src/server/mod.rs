//! High-performance local static HTTP server with RFC 7233 Range and CORS support.

pub mod mime;
pub mod range;

use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use crate::error::{Result, SendforgeError};
use crate::server::mime::determine_mime_type;
use crate::server::range::{parse_range_header, resolve_byte_range};

/// Options for configuring the Sendforge local static HTTP server.
#[derive(Debug, Clone)]
pub struct ServerOptions {
    /// Host address to bind (e.g. "127.0.0.1" or "0.0.0.0").
    pub host: String,
    /// TCP port to bind (default 8080).
    pub port: u16,
    /// Enable permissive CORS headers.
    pub cors: bool,
    /// Single Page Application fallback: route missing paths to index.html.
    pub spa: bool,
}

impl Default for ServerOptions {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 8080,
            cors: true,
            spa: false,
        }
    }
}

/// Decodes percent-encoded URL characters (%20, %2e, etc.).
#[must_use]
pub fn percent_decode(input: &str) -> String {
    let mut bytes = Vec::with_capacity(input.len());
    let mut chars = input.bytes();

    while let Some(b) = chars.next() {
        if b == b'%' {
            let h1 = chars.next();
            let h2 = chars.next();
            if let (Some(c1), Some(c2)) = (h1, h2) {
                let hex_str = [c1, c2];
                if let Ok(s) = std::str::from_utf8(&hex_str) {
                    if let Ok(decoded_byte) = u8::from_str_radix(s, 16) {
                        bytes.push(decoded_byte);
                        continue;
                    }
                }
            }
            bytes.push(b'%');
        } else {
            bytes.push(b);
        }
    }

    String::from_utf8_lossy(&bytes).into_owned()
}

/// Sanitizes a request path ensuring it does not escape `root_dir`.
///
/// # Errors
/// Returns `SendforgeError::PathTraversal` if directory traversal is detected.
pub fn sanitize_path(root_dir: &Path, raw_path: &str) -> Result<PathBuf> {
    let decoded = percent_decode(raw_path);
    let trimmed = decoded
        .split('?')
        .next()
        .unwrap_or("")
        .trim_start_matches('/');

    let mut resolved = root_dir.to_path_buf();
    for segment in trimmed.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            return Err(SendforgeError::PathTraversal(format!(
                "Directory traversal detected: {raw_path}"
            )));
        }
        resolved.push(segment);
    }

    Ok(resolved)
}

/// Formats standard CORS headers if CORS is enabled.
fn get_cors_headers(cors_enabled: bool) -> &'static str {
    if cors_enabled {
        "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: Range, Content-Type, Authorization, If-Modified-Since, If-None-Match\r\nAccess-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges, ETag\r\n"
    } else {
        ""
    }
}

struct ParsedHttpRequest {
    method: String,
    uri: String,
    range_header: Option<String>,
    if_none_match: Option<String>,
}

fn parse_request(reader: &mut BufReader<&TcpStream>) -> Option<ParsedHttpRequest> {
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() || request_line.is_empty() {
        return None;
    }

    let mut parts = request_line.split_ascii_whitespace();
    let method = parts.next()?.to_string();
    let uri = parts.next().unwrap_or("/").to_string();

    let mut range_header = None;
    let mut if_none_match = None;

    let mut line = String::new();
    while reader.read_line(&mut line).is_ok() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            break;
        }
        if let Some((name, val)) = trimmed.split_once(':') {
            let name_lower = name.trim().to_ascii_lowercase();
            if name_lower == "range" {
                range_header = Some(val.trim().to_string());
            } else if name_lower == "if-none-match" {
                if_none_match = Some(val.trim().to_string());
            }
        }
        line.clear();
    }

    Some(ParsedHttpRequest {
        method,
        uri,
        range_header,
        if_none_match,
    })
}

fn send_range_content(
    stream: &mut TcpStream,
    mut file: File,
    start: u64,
    length: u64,
    headers: &str,
    is_get: bool,
) {
    if stream.write_all(headers.as_bytes()).is_err() {
        return;
    }

    if is_get && file.seek(SeekFrom::Start(start)).is_ok() {
        let mut take_reader = file.take(length);
        let mut buffer = [0u8; 16384];
        while let Ok(n) = take_reader.read(&mut buffer) {
            if n == 0 || stream.write_all(&buffer[..n]).is_err() {
                break;
            }
        }
    }
}

fn send_full_content(stream: &mut TcpStream, mut file: File, headers: &str, is_get: bool) {
    if stream.write_all(headers.as_bytes()).is_err() {
        return;
    }

    if is_get {
        let mut buffer = [0u8; 16384];
        while let Ok(n) = file.read(&mut buffer) {
            if n == 0 || stream.write_all(&buffer[..n]).is_err() {
                break;
            }
        }
    }
}

fn resolve_candidate_file(root_dir: &Path, uri: &str, spa: bool) -> Result<Option<PathBuf>> {
    let target_path = sanitize_path(root_dir, uri)?;
    let decoded = percent_decode(uri);
    let trimmed_path = decoded
        .split('?')
        .next()
        .unwrap_or("")
        .trim_start_matches('/');

    // Candidate 1: Direct path in root_dir
    let mut candidate = target_path;
    if candidate.is_dir() {
        candidate = candidate.join("index.html");
    }

    // Candidate 2: Check static/ subdirectory in root_dir (for bare repo serve)
    if !candidate.is_file() {
        if let Ok(static_path) = sanitize_path(&root_dir.join("static"), trimmed_path) {
            let mut static_candidate = static_path;
            if static_candidate.is_dir() {
                static_candidate = static_candidate.join("index.html");
            }
            if static_candidate.is_file() {
                candidate = static_candidate;
            }
        }
    }

    // Candidate 3: Strip repo directory prefix (e.g. /my-repo.git/info/refs -> info/refs)
    if !candidate.is_file() {
        if let Some(dir_name) = root_dir.file_name().and_then(|n| n.to_str()) {
            let base_name = dir_name.strip_suffix(".git").unwrap_or(dir_name);
            let stripped = trimmed_path
                .strip_prefix(dir_name)
                .or_else(|| trimmed_path.strip_prefix(base_name))
                .map(|s| s.trim_start_matches('/'));

            if let Some(subpath) = stripped {
                if let Ok(sub_path) = sanitize_path(root_dir, subpath) {
                    let mut sub_candidate = sub_path;
                    if sub_candidate.is_dir() {
                        sub_candidate = sub_candidate.join("index.html");
                    }
                    if sub_candidate.is_file() {
                        candidate = sub_candidate;
                    } else if let Ok(sub_static_path) =
                        sanitize_path(&root_dir.join("static"), subpath)
                    {
                        let mut sub_static_candidate = sub_static_path;
                        if sub_static_candidate.is_dir() {
                            sub_static_candidate = sub_static_candidate.join("index.html");
                        }
                        if sub_static_candidate.is_file() {
                            candidate = sub_static_candidate;
                        }
                    }
                }
            }
        }
    }

    // Candidate 4: SPA Fallback if enabled
    if !candidate.is_file() && spa {
        let spa_root = root_dir.join("index.html");
        let spa_static = root_dir.join("static").join("index.html");
        if spa_root.is_file() {
            candidate = spa_root;
        } else if spa_static.is_file() {
            candidate = spa_static;
        }
    }

    if candidate.is_file() {
        Ok(Some(candidate))
    } else {
        Ok(None)
    }
}

/// Handles a single incoming HTTP connection.
fn handle_connection(mut stream: TcpStream, root_dir: &Path, options: &ServerOptions) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));

    let mut reader = BufReader::new(&stream);
    let Some(req) = parse_request(&mut reader) else {
        return;
    };

    let cors = get_cors_headers(options.cors);

    if req.method == "OPTIONS" {
        let resp = format!(
            "HTTP/1.1 204 No Content\r\n{cors}Content-Length: 0\r\nConnection: close\r\n\r\n"
        );
        let _ = stream.write_all(resp.as_bytes());
        return;
    }

    if req.method != "GET" && req.method != "HEAD" {
        let resp = format!(
            "HTTP/1.1 405 Method Not Allowed\r\n{cors}Content-Length: 0\r\nConnection: close\r\n\r\n"
        );
        let _ = stream.write_all(resp.as_bytes());
        return;
    }

    let final_file_path = match resolve_candidate_file(root_dir, &req.uri, options.spa) {
        Ok(Some(file_path)) => file_path,
        Err(SendforgeError::PathTraversal(_)) => {
            let resp = format!(
                "HTTP/1.1 403 Forbidden\r\n{cors}Content-Length: 13\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n403 Forbidden"
            );
            let _ = stream.write_all(resp.as_bytes());
            return;
        }
        Ok(None) | Err(_) => {
            send_404(&mut stream, cors);
            return;
        }
    };

    let Ok(file) = File::open(&final_file_path) else {
        send_404(&mut stream, cors);
        return;
    };

    let Ok(metadata) = file.metadata() else {
        send_404(&mut stream, cors);
        return;
    };

    let file_len = metadata.len();
    let mime_type = determine_mime_type(&req.uri, &final_file_path);
    let etag = format!("\"{file_len:x}\"");

    if let Some(client_etag) = req.if_none_match {
        if client_etag == etag || client_etag == "*" {
            let resp = format!(
                "HTTP/1.1 304 Not Modified\r\n{cors}ETag: {etag}\r\nConnection: close\r\n\r\n"
            );
            let _ = stream.write_all(resp.as_bytes());
            return;
        }
    }

    let is_get = req.method == "GET";

    if let Some(range_val) = req.range_header {
        if let Some(parsed_range) = parse_range_header(&range_val) {
            if let Some((start, end, length)) = resolve_byte_range(parsed_range, file_len) {
                let headers = format!(
                    "HTTP/1.1 206 Partial Content\r\n{cors}Content-Type: {mime_type}\r\nContent-Range: bytes {start}-{end}/{file_len}\r\nContent-Length: {length}\r\nAccept-Ranges: bytes\r\nETag: {etag}\r\nConnection: close\r\n\r\n"
                );
                send_range_content(&mut stream, file, start, length, &headers, is_get);
                return;
            }

            let headers = format!(
                "HTTP/1.1 416 Range Not Satisfiable\r\n{cors}Content-Range: bytes */{file_len}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            let _ = stream.write_all(headers.as_bytes());
            return;
        }
    }

    let headers = format!(
        "HTTP/1.1 200 OK\r\n{cors}Content-Type: {mime_type}\r\nContent-Length: {file_len}\r\nAccept-Ranges: bytes\r\nETag: {etag}\r\nConnection: close\r\n\r\n"
    );
    send_full_content(&mut stream, file, &headers, is_get);
}

fn send_404(stream: &mut TcpStream, cors: &str) {
    let resp = format!(
        "HTTP/1.1 404 Not Found\r\n{cors}Content-Length: 13\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n404 Not Found"
    );
    let _ = stream.write_all(resp.as_bytes());
}

/// Runs the Sendforge local static HTTP server until terminated.
///
/// # Errors
/// Returns `SendforgeError::Io` if TCP binding fails.
pub fn run_server(serve_dir: &Path, options: &ServerOptions) -> Result<()> {
    let addr = format!("{}:{}", options.host, options.port);
    let listener = TcpListener::bind(&addr)?;
    let root_path = Arc::new(
        serve_dir
            .canonicalize()
            .unwrap_or_else(|_| serve_dir.to_path_buf()),
    );
    let opts = Arc::new(options.clone());

    eprintln!(
        "[sendforge serve] Serving static files from: {}",
        root_path.display()
    );
    eprintln!("[sendforge serve] Listening on http://{addr}");
    eprintln!(
        "[sendforge serve] CORS: {}, SPA Fallback: {}",
        options.cors, options.spa
    );

    for stream_res in listener.incoming() {
        match stream_res {
            Ok(stream) => {
                let root_clone = Arc::clone(&root_path);
                let opts_clone = Arc::clone(&opts);
                std::thread::spawn(move || {
                    handle_connection(stream, &root_clone, &opts_clone);
                });
            }
            Err(e) => {
                eprintln!("[sendforge serve] Connection accept error: {e}");
            }
        }
    }

    Ok(())
}
