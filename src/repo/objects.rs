//! Git loose object reading, parsing, and decompression.

use std::fmt;
use std::io::Read;
use std::path::Path;

use chrono::DateTime;
use flate2::read::ZlibDecoder;
use sha1::{Digest, Sha1};

use crate::error::{Result, SendforgeError};

/// Supported Git object types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ObjectType {
    /// Commit object.
    Commit,
    /// Tree (directory listing) object.
    Tree,
    /// Blob (file content) object.
    Blob,
    /// Annotated tag object.
    Tag,
}

impl fmt::Display for ObjectType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Commit => write!(f, "commit"),
            Self::Tree => write!(f, "tree"),
            Self::Blob => write!(f, "blob"),
            Self::Tag => write!(f, "tag"),
        }
    }
}

impl std::str::FromStr for ObjectType {
    type Err = SendforgeError;

    fn from_str(s: &str) -> Result<Self> {
        match s {
            "commit" => Ok(Self::Commit),
            "tree" => Ok(Self::Tree),
            "blob" => Ok(Self::Blob),
            "tag" => Ok(Self::Tag),
            _ => Err(SendforgeError::InvalidObject(format!(
                "Unknown object type: {s}"
            ))),
        }
    }
}

/// Raw decompressed Git object.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawObject {
    /// The Git object type.
    pub object_type: ObjectType,
    /// The size in bytes as declared in the header.
    pub size: usize,
    /// The raw payload data of the object.
    pub data: Vec<u8>,
}

/// An entry within a Git Tree object.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[allow(clippy::struct_excessive_bools)]
pub struct TreeEntry {
    /// File mode as octal string (e.g. "100644", "040000", "100755", "120000").
    pub mode: String,
    /// Entry filename or directory name.
    pub name: String,
    /// 40-hex character SHA-1 object ID.
    pub sha: String,
    /// 7-hex character short SHA-1 prefix.
    pub short_sha: String,
    /// True if the entry represents a directory tree.
    pub is_dir: bool,
    /// True if the entry is an executable file (`100755`).
    pub is_executable: bool,
    /// True if the entry is a symbolic link (`120000`).
    pub is_symlink: bool,
    /// True if the entry is a submodule / gitlink (`160000`).
    pub is_submodule: bool,
}

/// Git author or committer signature information.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct CommitSignature {
    /// Name of the contributor.
    pub name: String,
    /// Email of the contributor.
    pub email: String,
    /// Raw Unix epoch timestamp in seconds.
    pub timestamp: i64,
    /// Formatted ISO 8601 UTC timestamp (e.g. "2026-08-19T20:30:00Z").
    pub date: String,
}

/// A parsed Git commit object.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct CommitObject {
    /// 40-hex character commit hash.
    pub id: String,
    /// 7-hex character short commit hash.
    pub short_id: String,
    /// 40-hex character root tree hash.
    pub tree: String,
    /// List of 40-hex character parent commit hashes.
    pub parents: Vec<String>,
    /// Author signature.
    pub author: CommitSignature,
    /// Committer signature.
    pub committer: CommitSignature,
    /// Full commit message.
    pub message: String,
    /// First line summary of the commit message.
    pub summary: String,
}

/// A parsed Git annotated tag object.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct TagObject {
    /// 40-hex character target object hash.
    pub target: String,
    /// Object type pointed to (usually "commit").
    pub target_type: String,
    /// Name of the tag.
    pub name: String,
    /// Tagger signature if present.
    pub tagger: Option<CommitSignature>,
    /// Tag annotation message if present.
    pub message: Option<String>,
}

/// Reads and decompresses a loose Git object from the repository.
///
/// # Errors
/// Returns `SendforgeError::ObjectNotFound` if the loose object file does not exist,
/// `SendforgeError::Decompression` if zlib inflation fails, or
/// `SendforgeError::InvalidObject` if the header is malformed.
pub fn read_loose_object(repo_path: &Path, sha: &str) -> Result<RawObject> {
    if sha.len() != 40 {
        return Err(SendforgeError::InvalidRef(format!(
            "Object SHA must be 40 hex characters: {sha}"
        )));
    }

    let obj_path = repo_path
        .join("objects")
        .join(&sha[..2])
        .join(&sha[2..]);

    if !obj_path.is_file() {
        return Err(SendforgeError::ObjectNotFound(sha.to_string()));
    }

    let compressed = std::fs::read(&obj_path)?;
    decompress_raw_object(&compressed, sha)
}

/// Decompresses raw zlib bytes into a `RawObject`.
///
/// # Errors
/// Returns `SendforgeError::Decompression` or `SendforgeError::InvalidObject` on corrupt payloads.
pub fn decompress_raw_object(compressed_bytes: &[u8], sha_for_context: &str) -> Result<RawObject> {
    let mut decoder = ZlibDecoder::new(compressed_bytes);
    let mut decompressed = Vec::new();
    decoder.read_to_end(&mut decompressed).map_err(|e| {
        SendforgeError::Decompression(format!(
            "Failed to decompress object {sha_for_context}: {e}"
        ))
    })?;

    parse_raw_object_bytes(&decompressed)
}

/// Parses uncompressed Git object bytes `<type> <size>\0<data>` into a `RawObject`.
///
/// # Errors
/// Returns `SendforgeError::InvalidObject` if header delimiter or fields are missing.
pub fn parse_raw_object_bytes(decompressed: &[u8]) -> Result<RawObject> {
    let null_pos = decompressed
        .iter()
        .position(|&b| b == 0)
        .ok_or_else(|| SendforgeError::InvalidObject("Missing null byte in object header".into()))?;

    let header_str = std::str::from_utf8(&decompressed[..null_pos])
        .map_err(|e| SendforgeError::InvalidObject(format!("Invalid object header UTF-8: {e}")))?;

    let mut parts = header_str.split_ascii_whitespace();
    let type_str = parts
        .next()
        .ok_or_else(|| SendforgeError::InvalidObject("Empty object header".into()))?;
    let size_str = parts
        .next()
        .ok_or_else(|| SendforgeError::InvalidObject("Missing size in object header".into()))?;

    let object_type = type_str.parse::<ObjectType>()?;
    let size = size_str
        .parse::<usize>()
        .map_err(|e| SendforgeError::InvalidObject(format!("Invalid object size number: {e}")))?;

    let data = decompressed[null_pos + 1..].to_vec();

    Ok(RawObject {
        object_type,
        size,
        data,
    })
}

/// Computes the 40-character hex SHA-1 ID of a Git object.
#[must_use]
pub fn compute_object_sha(obj_type: ObjectType, data: &[u8]) -> String {
    let mut hasher = Sha1::new();
    let header = format!("{obj_type} {}\0", data.len());
    hasher.update(header.as_bytes());
    hasher.update(data);
    let hash = hasher.finalize();
    hex::encode(hash)
}

/// Parses a Git signature line (`Name <email> 1787171400 +0000`).
///
/// # Errors
/// Returns `SendforgeError::InvalidObject` if signature syntax is completely broken.
pub fn parse_signature(line: &str) -> Result<CommitSignature> {
    let open_bracket = line.find('<').ok_or_else(|| {
        SendforgeError::InvalidObject(format!("Signature missing '<': {line}"))
    })?;
    let close_bracket = line.find('>').ok_or_else(|| {
        SendforgeError::InvalidObject(format!("Signature missing '>': {line}"))
    })?;

    if close_bracket < open_bracket {
        return Err(SendforgeError::InvalidObject(format!(
            "Mismatched signature brackets: {line}"
        )));
    }

    let name = line[..open_bracket].trim().to_string();
    let email = line[open_bracket + 1..close_bracket].trim().to_string();
    let after_email = line[close_bracket + 1..].trim();

    let mut time_parts = after_email.split_ascii_whitespace();
    let timestamp_str = time_parts.next().unwrap_or("0");
    let timestamp = timestamp_str.parse::<i64>().unwrap_or(0);

    // Format safely into ISO 8601 UTC
    let date = DateTime::from_timestamp(timestamp, 0).map_or_else(
        || "1970-01-01T00:00:00Z".to_string(),
        |dt| dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
    );

    Ok(CommitSignature {
        name,
        email,
        timestamp,
        date,
    })
}

/// Parses raw commit object bytes into a `CommitObject`.
///
/// # Errors
/// Returns `SendforgeError::InvalidObject` if commit headers are missing or malformed.
pub fn parse_commit(sha: &str, data: &[u8]) -> Result<CommitObject> {
    let text = String::from_utf8_lossy(data);
    let mut tree = String::new();
    let mut parents = Vec::new();
    let mut author: Option<CommitSignature> = None;
    let mut committer: Option<CommitSignature> = None;

    let mut lines = text.lines();
    let mut in_gpgsig = false;

    for line in &mut lines {
        if in_gpgsig {
            if line.contains("END PGP SIGNATURE")
                || line.contains("END PGP MESSAGE")
                || line.contains("END SSH SIGNATURE")
                || line.contains("END SIGNATURE")
            {
                in_gpgsig = false;
                continue;
            }
            if line.starts_with(' ') || line.starts_with('\t') || line.is_empty() {
                continue;
            }
            in_gpgsig = false;
        }

        if line.is_empty() {
            // Empty line separates commit headers from message
            break;
        }

        if let Some(tree_sha) = line.strip_prefix("tree ") {
            tree = tree_sha.trim().to_string();
        } else if let Some(parent_sha) = line.strip_prefix("parent ") {
            parents.push(parent_sha.trim().to_string());
        } else if let Some(author_line) = line.strip_prefix("author ") {
            author = Some(parse_signature(author_line)?);
        } else if let Some(committer_line) = line.strip_prefix("committer ") {
            committer = Some(parse_signature(committer_line)?);
        } else if line.starts_with("gpgsig ")
            || line.starts_with("gpgsig-sha256 ")
            || line.starts_with("mergetag ")
        {
            in_gpgsig = true;
        }
    }

    let default_sig = CommitSignature {
        name: "Unknown".into(),
        email: "unknown@example.com".into(),
        timestamp: 0,
        date: "1970-01-01T00:00:00Z".into(),
    };

    let author_final = author.unwrap_or_else(|| default_sig.clone());
    let committer_final = committer.unwrap_or(default_sig);

    // Remaining text is the commit message
    let mut message_lines = Vec::new();
    for line in lines {
        message_lines.push(line);
    }
    let message = message_lines.join("\n");
    let summary = message_lines
        .first()
        .map_or_else(String::new, |s| (*s).trim().to_string());

    let short_id = if sha.len() >= 7 {
        sha[..7].to_string()
    } else {
        sha.to_string()
    };

    Ok(CommitObject {
        id: sha.to_string(),
        short_id,
        tree,
        parents,
        author: author_final,
        committer: committer_final,
        message,
        summary,
    })
}

/// Parses raw tree object bytes into a sorted list of `TreeEntry`.
///
/// # Errors
/// Returns `SendforgeError::InvalidObject` if binary tree records are malformed.
pub fn parse_tree(data: &[u8]) -> Result<Vec<TreeEntry>> {
    let mut entries = Vec::new();
    let mut offset = 0;

    while offset < data.len() {
        let space_pos = data[offset..]
            .iter()
            .position(|&b| b == b' ')
            .map(|p| offset + p)
            .ok_or_else(|| {
                SendforgeError::InvalidObject("Missing space in tree entry".into())
            })?;

        let mode_bytes = &data[offset..space_pos];
        let mode = std::str::from_utf8(mode_bytes).map_err(|e| {
            SendforgeError::InvalidObject(format!("Invalid tree mode UTF-8: {e}"))
        })?;

        let null_pos = data[space_pos + 1..]
            .iter()
            .position(|&b| b == 0)
            .map(|p| space_pos + 1 + p)
            .ok_or_else(|| {
                SendforgeError::InvalidObject("Missing null delimiter in tree entry".into())
            })?;

        let name_bytes = &data[space_pos + 1..null_pos];
        let name = String::from_utf8_lossy(name_bytes).into_owned();

        let sha_start = null_pos + 1;
        let sha_end = sha_start + 20;
        if sha_end > data.len() {
            return Err(SendforgeError::InvalidObject(
                "Truncated tree entry SHA-1".into(),
            ));
        }

        let sha = hex::encode(&data[sha_start..sha_end]);
        let is_dir = mode.starts_with('4') || mode.starts_with("04");
        let is_executable = mode == "100755";
        let is_symlink = mode == "120000";
        let is_submodule = mode == "160000";
        let short_sha = sha[..7].to_string();

        entries.push(TreeEntry {
            mode: mode.to_string(),
            name,
            sha,
            short_sha,
            is_dir,
            is_executable,
            is_symlink,
            is_submodule,
        });

        offset = sha_end;
    }

    // Sort entries: directories first, then alphabetical by name
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });

    Ok(entries)
}

/// Parses raw tag object bytes into a `TagObject`.
///
/// # Errors
/// Returns `SendforgeError::InvalidObject` if tag headers are malformed.
pub fn parse_tag(data: &[u8]) -> Result<TagObject> {
    let text = String::from_utf8_lossy(data);
    let mut target = String::new();
    let mut target_type = "commit".to_string();
    let mut name = String::new();
    let mut tagger: Option<CommitSignature> = None;

    let mut lines = text.lines();
    for line in &mut lines {
        if line.is_empty() {
            break;
        }

        if let Some(target_sha) = line.strip_prefix("object ") {
            target = target_sha.trim().to_string();
        } else if let Some(type_str) = line.strip_prefix("type ") {
            target_type = type_str.trim().to_string();
        } else if let Some(tag_name) = line.strip_prefix("tag ") {
            name = tag_name.trim().to_string();
        } else if let Some(tagger_line) = line.strip_prefix("tagger ") {
            tagger = Some(parse_signature(tagger_line)?);
        }
    }

    let mut message_lines = Vec::new();
    for line in lines {
        message_lines.push(line);
    }
    let message = if message_lines.is_empty() {
        None
    } else {
        Some(message_lines.join("\n"))
    };

    Ok(TagObject {
        target,
        target_type,
        name,
        tagger,
        message,
    })
}

/// Peels a tag SHA to find the ultimate commit/blob target object.
///
/// If `target_sha` points to an annotated tag object, reads it and resolves the inner object.
/// Recursively unwraps nested tags up to 10 levels.
///
/// # Errors
/// Returns `SendforgeError` if an object cannot be read.
pub fn peel_tag(repo_path: &Path, target_sha: &str) -> Result<String> {
    let mut current_sha = target_sha.to_string();

    for _ in 0..10 {
        match read_loose_object(repo_path, &current_sha) {
            Ok(raw) => {
                if raw.object_type == ObjectType::Tag {
                    let parsed_tag = parse_tag(&raw.data)?;
                    current_sha = parsed_tag.target;
                } else {
                    return Ok(current_sha);
                }
            }
            Err(_) => {
                // If not found loose, it might be in a packfile or already peeled
                return Ok(current_sha);
            }
        }
    }

    Ok(current_sha)
}
