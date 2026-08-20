//! RFC 7233 HTTP Range header parsing and byte-range resolution.

/// Parsed Range representation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ByteRange {
    /// Explicit start and end offsets (`bytes=0-1023`).
    FromTo(u64, u64),
    /// Open-ended range starting at an offset (`bytes=5000-`).
    From(u64),
    /// Suffix range for the last N bytes (`bytes=-500`).
    Suffix(u64),
}

/// Parses a standard `Range` HTTP header string (e.g. `bytes=0-1023`).
#[must_use]
pub fn parse_range_header(header_val: &str) -> Option<ByteRange> {
    let trimmed = header_val.trim();
    let spec = trimmed.strip_prefix("bytes=")?;

    // If multiple comma-separated ranges, take the first range
    let first_range = spec.split(',').next()?.trim();

    if let Some(suffix_str) = first_range.strip_prefix('-') {
        let suffix_len = suffix_str.parse::<u64>().ok()?;
        if suffix_len == 0 {
            return None;
        }
        return Some(ByteRange::Suffix(suffix_len));
    }

    let mut parts = first_range.split('-');
    let start_str = parts.next()?.trim();
    let end_str = parts.next()?.trim();

    let start = start_str.parse::<u64>().ok()?;

    if end_str.is_empty() {
        Some(ByteRange::From(start))
    } else {
        let end = end_str.parse::<u64>().ok()?;
        if start > end {
            return None;
        }
        Some(ByteRange::FromTo(start, end))
    }
}

/// Resolves a `ByteRange` against a total file size.
///
/// Returns `Some((start_byte, end_byte_inclusive, length))` or `None` if the range is unsatisfiable.
#[must_use]
pub fn resolve_byte_range(range: ByteRange, total_size: u64) -> Option<(u64, u64, u64)> {
    if total_size == 0 {
        return None;
    }

    match range {
        ByteRange::FromTo(start, end) => {
            if start >= total_size || start > end {
                return None;
            }
            let clamped_end = end.min(total_size.saturating_sub(1));
            let length = clamped_end.saturating_sub(start).saturating_add(1);
            Some((start, clamped_end, length))
        }
        ByteRange::From(start) => {
            if start >= total_size {
                return None;
            }
            let end = total_size.saturating_sub(1);
            let length = end.saturating_sub(start).saturating_add(1);
            Some((start, end, length))
        }
        ByteRange::Suffix(suffix_len) => {
            if suffix_len == 0 {
                return None;
            }
            let length = suffix_len.min(total_size);
            let start = total_size.saturating_sub(length);
            let end = total_size.saturating_sub(1);
            Some((start, end, length))
        }
    }
}
