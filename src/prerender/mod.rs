//! Zero-JS HTML pre-rendering engine and `CommonMark` markdown renderer.

use std::fmt::Write as _;
use pulldown_cmark::{html, CowStr, Event, Options, Parser, Tag};

use crate::meta::SendforgeRepoMeta;
use crate::repo::objects::{CommitObject, TreeEntry};

/// Safely escapes special HTML characters in text.
#[must_use]
pub fn escape_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

/// Renders a `CommonMark` Markdown document into sanitized HTML.
#[must_use]
pub fn render_markdown(markdown_text: &str) -> String {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_FOOTNOTES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    options.insert(Options::ENABLE_HEADING_ATTRIBUTES);

    let parser = Parser::new_ext(markdown_text, options);
    let sanitized_events = parser.map(|event| match event {
        Event::Html(text) => Event::Html(CowStr::Boxed(escape_html(&text).into_boxed_str())),
        Event::InlineHtml(text) => Event::InlineHtml(CowStr::Boxed(escape_html(&text).into_boxed_str())),
        Event::Start(Tag::Link { link_type, dest_url, title, id }) => {
            let lower = dest_url.trim_start().to_ascii_lowercase();
            let safe_url = if lower.starts_with("javascript:")
                || lower.starts_with("vbscript:")
                || lower.starts_with("data:text/html")
            {
                CowStr::Borrowed("#")
            } else {
                dest_url
            };
            Event::Start(Tag::Link { link_type, dest_url: safe_url, title, id })
        }
        Event::Start(Tag::Image { link_type, dest_url, title, id }) => {
            let lower = dest_url.trim_start().to_ascii_lowercase();
            let safe_url = if lower.starts_with("javascript:")
                || lower.starts_with("vbscript:")
                || lower.starts_with("data:text/html")
            {
                CowStr::Borrowed("#")
            } else {
                dest_url
            };
            Event::Start(Tag::Image { link_type, dest_url: safe_url, title, id })
        }
        other => other,
    });

    let mut html_output = String::new();
    html::push_html(&mut html_output, sanitized_events);
    html_output
}

fn build_latest_commit_section(meta: &SendforgeRepoMeta) -> String {
    if let Some(ref commit) = meta.latest_commit {
        let summary_esc = escape_html(&commit.summary);
        let author_name_esc = escape_html(&commit.author.name);
        let author_date_esc = escape_html(&commit.author.date);
        let short_id_esc = escape_html(&commit.short_id);

        format!(
            r#"<section class="latest-commit-bar">
      <div class="commit-summary">
        <strong>{summary_esc}</strong>
      </div>
      <div class="commit-meta">
        <span>{author_name_esc} committed on {author_date_esc}</span>
        <span class="commit-hash"><code>{short_id_esc}</code></span>
      </div>
    </section>"#
        )
    } else {
        String::new()
    }
}

fn build_tree_table_rows(tree_entries: &[TreeEntry]) -> String {
    if tree_entries.is_empty() {
        return r#"<tr><td colspan="3" class="empty-tree-msg">No files in default branch or repository is empty.</td></tr>"#.to_string();
    }

    let mut rows = String::new();
    for entry in tree_entries {
        let name_esc = escape_html(&entry.name);
        let type_str = if entry.is_dir { "tree" } else { "blob" };
        let icon = if entry.is_dir { "📁" } else { "📄" };
        let slash = if entry.is_dir { "/" } else { "" };
        let hash_href = if entry.is_dir {
            format!("#/tree/{name_esc}")
        } else {
            format!("#/blob/{name_esc}")
        };
        let short_sha_esc = escape_html(&entry.short_sha);

        let _ = writeln!(
            rows,
            r#"          <tr>
            <td class="entry-type">{type_str}</td>
            <td class="entry-name">
              <a href="{hash_href}">{icon} {name_esc}{slash}</a>
            </td>
            <td class="entry-id"><code>{short_sha_esc}</code></td>
          </tr>"#
        );
    }
    rows
}

fn build_readme_section(meta: &SendforgeRepoMeta, rendered_readme_html: Option<&str>) -> String {
    if let (true, Some(readme_html)) = (meta.has_readme, rendered_readme_html) {
        let readme_filename_esc = meta
            .readme_filename
            .as_deref()
            .map_or_else(|| "README.md".to_string(), escape_html);

        format!(
            r#"    <!-- Pre-rendered README section -->
    <article class="readme-container">
      <div class="readme-header">
        <span>📖 {readme_filename_esc}</span>
      </div>
      <div class="readme-content markdown-body">
        {readme_html}
      </div>
    </article>"#
        )
    } else {
        String::new()
    }
}

/// Pre-renders the zero-JS `index.html` landing page fallback.
#[must_use]
pub fn render_index_html(
    meta: &SendforgeRepoMeta,
    tree_entries: &[TreeEntry],
    rendered_readme_html: Option<&str>,
) -> String {
    let repo_name_esc = escape_html(&meta.name);
    let desc_esc = meta
        .description
        .as_deref()
        .map_or_else(String::new, escape_html);
    let default_branch_esc = escape_html(&meta.default_branch);
    let clone_url = meta.clone_url.as_deref().unwrap_or("");
    let clone_url_esc = escape_html(clone_url);
    let updated_at_esc = escape_html(&meta.updated_at);

    let clone_box_html = if clone_url.is_empty() {
        String::new()
    } else {
        format!(
            r#"<div class="clone-box"><code>git clone {clone_url_esc}</code></div>"#
        )
    };

    let latest_commit_html = build_latest_commit_section(meta);
    let tree_table_body = build_tree_table_rows(tree_entries);
    let readme_section = build_readme_section(meta, rendered_readme_html);

    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{repo_name_esc} - Sendforge</title>
  <meta name="description" content="{desc_esc}">
  <link rel="stylesheet" href="/style.css">
  <script type="module" src="/app.js"></script>
</head>
<body>
  <div id="app">
    <!-- Static Header -->
    <header class="forge-header">
      <div class="repo-title">
        <h1><a href="./">{repo_name_esc}</a></h1>
        <span class="badge">{default_branch_esc}</span>
      </div>
      <p class="repo-desc">{desc_esc}</p>
      {clone_box_html}
    </header>

    <!-- Navigation Tabs -->
    <nav class="repo-nav">
      <a href="./" class="active">Code</a>
      <a href="log.html">Commits ({})</a>
      <a href="meta.json">Raw Metadata</a>
    </nav>

    {latest_commit_html}

    <!-- File Tree Table -->
    <main class="tree-container">
      <table class="tree-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Name</th>
            <th>Object ID</th>
          </tr>
        </thead>
        <tbody>
{tree_table_body}        </tbody>
      </table>
    </main>

{readme_section}

    <!-- Footer -->
    <footer class="forge-footer">
      <span>Powered by <strong>Sendforge</strong> (Static-First Git Forge)</span>
      <span>Last updated: {updated_at_esc}</span>
    </footer>
  </div>
</body>
</html>
"#,
        meta.stats.commit_count
    )
}

/// Pre-renders the zero-JS `log.html` commit history page fallback.
#[must_use]
pub fn render_log_html(meta: &SendforgeRepoMeta, commits: &[CommitObject]) -> String {
    let repo_name_esc = escape_html(&meta.name);
    let updated_at_esc = escape_html(&meta.updated_at);

    let commit_items = if commits.is_empty() {
        r#"        <li class="commit-item empty-commits"><p>No commits recorded yet.</p></li>"#.to_string()
    } else {
        let mut list_html = String::new();
        for commit in commits {
            let summary_esc = escape_html(&commit.summary);
            let author_name_esc = escape_html(&commit.author.name);
            let author_email_esc = escape_html(&commit.author.email);
            let author_date_esc = escape_html(&commit.author.date);
            let short_id_esc = escape_html(&commit.short_id);

            let _ = writeln!(
                list_html,
                r#"        <li class="commit-item">
          <div class="commit-message">{summary_esc}</div>
          <div class="commit-details">
            <span>{author_name_esc} &lt;{author_email_esc}&gt;</span>
            <time datetime="{author_date_esc}">{author_date_esc}</time>
            <span class="commit-sha"><code>{short_id_esc}</code></span>
          </div>
        </li>"#
            );
        }
        list_html
    };

    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Commit History - {repo_name_esc} - Sendforge</title>
  <link rel="stylesheet" href="/style.css">
  <script type="module" src="/app.js"></script>
</head>
<body>
  <div id="app">
    <header class="forge-header">
      <h1><a href="./">{repo_name_esc}</a> / Commits</h1>
    </header>
    <nav class="repo-nav">
      <a href="./">Code</a>
      <a href="log.html" class="active">Commits ({})</a>
      <a href="meta.json">Raw Metadata</a>
    </nav>
    <main class="commit-log">
      <ul class="commit-list">
{commit_items}      </ul>
    </main>
    <footer class="forge-footer">
      <span>Powered by <strong>Sendforge</strong> (Static-First Git Forge)</span>
      <span>Last updated: {updated_at_esc}</span>
    </footer>
  </div>
</body>
</html>
"#,
        meta.stats.commit_count
    )
}
