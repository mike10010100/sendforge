//! Zero-JS HTML pre-rendering engine and `CommonMark` markdown renderer.

use pulldown_cmark::{html, CowStr, Event, Options, Parser, Tag};
use std::fmt::Write as _;

use crate::collab::models::{Comment, Issue, IssueStatus, PullRequest, PullRequestStatus};
use crate::meta::SendforgeRepoMeta;
use crate::repo::objects::{CommitObject, TreeEntry};

/// Active navigation tab indicator for pre-rendered pages.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NavTab {
    Code,
    Commits,
    Issues,
    Pulls,
}

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

/// Formats a Unix epoch timestamp safely into an ISO 8601 UTC string.
#[must_use]
pub fn format_timestamp_iso(timestamp: i64) -> String {
    chrono::DateTime::from_timestamp(timestamp, 0).map_or_else(
        || "1970-01-01T00:00:00Z".to_string(),
        |dt| dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
    )
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
        Event::InlineHtml(text) => {
            Event::InlineHtml(CowStr::Boxed(escape_html(&text).into_boxed_str()))
        }
        Event::Start(Tag::Link {
            link_type,
            dest_url,
            title,
            id,
        }) => {
            let lower = dest_url.trim_start().to_ascii_lowercase();
            let safe_url = if lower.starts_with("javascript:")
                || lower.starts_with("vbscript:")
                || lower.starts_with("data:text/html")
            {
                CowStr::Borrowed("#")
            } else {
                dest_url
            };
            Event::Start(Tag::Link {
                link_type,
                dest_url: safe_url,
                title,
                id,
            })
        }
        Event::Start(Tag::Image {
            link_type,
            dest_url,
            title,
            id,
        }) => {
            let lower = dest_url.trim_start().to_ascii_lowercase();
            let safe_url = if lower.starts_with("javascript:")
                || lower.starts_with("vbscript:")
                || lower.starts_with("data:text/html")
            {
                CowStr::Borrowed("#")
            } else {
                dest_url
            };
            Event::Start(Tag::Image {
                link_type,
                dest_url: safe_url,
                title,
                id,
            })
        }
        other => other,
    });

    let mut html_output = String::new();
    html::push_html(&mut html_output, sanitized_events);
    html_output
}

/// Renders the 4-tab repository navigation bar with active state and count badges.
#[must_use]
pub fn render_nav_bar(active_tab: NavTab, meta: &SendforgeRepoMeta, depth: usize) -> String {
    let prefix = if depth == 0 { "" } else { "../" };
    let code_cls = if active_tab == NavTab::Code {
        " class=\"active\""
    } else {
        ""
    };
    let commits_cls = if active_tab == NavTab::Commits {
        " class=\"active\""
    } else {
        ""
    };
    let issues_cls = if active_tab == NavTab::Issues {
        " class=\"active\""
    } else {
        ""
    };
    let pulls_cls = if active_tab == NavTab::Pulls {
        " class=\"active\""
    } else {
        ""
    };

    let commit_count = meta.stats.commit_count;
    let open_issue_count = meta.stats.open_issue_count;
    let open_pull_count = meta.stats.open_pull_count;

    format!(
        r#"    <!-- Navigation Tabs -->
    <nav class="repo-nav">
      <a href="{prefix}./"{code_cls}>📁 Code</a>
      <a href="{prefix}log.html"{commits_cls}>📜 Commits ({commit_count})</a>
      <a href="{prefix}issues.html"{issues_cls}>🎯 Issues ({open_issue_count})</a>
      <a href="{prefix}pulls.html"{pulls_cls}>🔀 Pull Requests ({open_pull_count})</a>
    </nav>"#
    )
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
        format!(r#"<div class="clone-box"><code>git clone {clone_url_esc}</code></div>"#)
    };

    let latest_commit_html = build_latest_commit_section(meta);
    let tree_table_body = build_tree_table_rows(tree_entries);
    let readme_section = build_readme_section(meta, rendered_readme_html);
    let nav_html = render_nav_bar(NavTab::Code, meta, 0);

    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{repo_name_esc} - Sendforge</title>
  <meta name="description" content="{desc_esc}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://www.sendforge.dev/">
  <meta property="og:site_name" content="Sendforge">
  <meta property="og:title" content="{repo_name_esc} — The Static-First Git Forge">
  <meta property="og:description" content="{desc_esc}">
  <meta property="og:image" content="https://www.sendforge.dev/og-card.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{repo_name_esc} — The Static-First Git Forge">
  <meta name="twitter:description" content="{desc_esc}">
  <meta name="twitter:image" content="https://www.sendforge.dev/og-card.png">
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

{nav_html}

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
"#
    )
}

/// Pre-renders the zero-JS `log.html` commit history page fallback.
#[must_use]
pub fn render_log_html(meta: &SendforgeRepoMeta, commits: &[CommitObject]) -> String {
    let repo_name_esc = escape_html(&meta.name);
    let updated_at_esc = escape_html(&meta.updated_at);
    let nav_html = render_nav_bar(NavTab::Commits, meta, 0);

    let commit_items = if commits.is_empty() {
        r#"        <li class="commit-item empty-commits"><p>No commits recorded yet.</p></li>"#
            .to_string()
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
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://www.sendforge.dev/log.html">
  <meta property="og:site_name" content="Sendforge">
  <meta property="og:title" content="Commit History — {repo_name_esc}">
  <meta property="og:image" content="https://www.sendforge.dev/og-card.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Commit History — {repo_name_esc}">
  <meta name="twitter:image" content="https://www.sendforge.dev/og-card.png">
  <link rel="stylesheet" href="/style.css">
  <script type="module" src="/app.js"></script>
</head>
<body>
  <div id="app">
    <header class="forge-header">
      <h1><a href="./">{repo_name_esc}</a> / Commits</h1>
    </header>
{nav_html}
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
"#
    )
}

fn build_labels_badge_list(labels: &[String]) -> String {
    let mut labels_html = String::new();
    for label in labels {
        let label_esc = escape_html(label);
        let _ = write!(
            labels_html,
            r#"<span class="badge badge-label">{label_esc}</span> "#
        );
    }
    labels_html
}

fn build_pr_list_items(pulls: &[PullRequest]) -> String {
    if pulls.is_empty() {
        return r#"        <li class="collab-item empty-collab empty-pulls"><p>No pull requests found.</p></li>"#.to_string();
    }

    let mut out = String::new();
    for pull in pulls {
        let id_esc = escape_html(&pull.id);
        let title_esc = escape_html(&pull.title);
        let author_name_esc = escape_html(&pull.author.name);
        let target_branch_esc = escape_html(&pull.target_branch);
        let source_branch_esc = escape_html(&pull.source_branch);
        let created_at_iso = format_timestamp_iso(pull.created_at);

        let (status_badge, status_class) = match pull.status {
            PullRequestStatus::Open => ("🟢 Open", "badge-open"),
            PullRequestStatus::Merged => ("🟣 Merged", "badge-merged"),
            PullRequestStatus::Closed => ("🔴 Closed", "badge-closed"),
        };

        let labels_html = build_labels_badge_list(&pull.labels);
        let comment_badge = if pull.comments.is_empty() {
            String::new()
        } else {
            format!(
                r#"<span class="comment-count">💬 {}</span>"#,
                pull.comments.len()
            )
        };

        let _ = writeln!(
            out,
            r#"        <li class="collab-item pr-item">
          <div class="collab-item-header">
            <span class="badge badge-status {status_class}">{status_badge}</span>
            <a href="pulls/{id_esc}.html" class="collab-title">#{number} {title_esc}</a>
            {labels_html}
          </div>
          <div class="collab-item-meta">
            <span>#{number} opened on <time datetime="{created_at_iso}">{created_at_iso}</time> by <strong>{author_name_esc}</strong></span>
            <span class="branch-flow"><code>{target_branch_esc}</code> ← <code>{source_branch_esc}</code></span>
            {comment_badge}
          </div>
        </li>"#,
            number = pull.number
        );
    }
    out
}

/// Pre-renders the zero-JS `pulls.html` pull request list page fallback.
#[must_use]
pub fn render_pulls_html(meta: &SendforgeRepoMeta, pulls: &[PullRequest]) -> String {
    let repo_name_esc = escape_html(&meta.name);
    let desc_esc = meta
        .description
        .as_deref()
        .map_or_else(String::new, escape_html);
    let default_branch_esc = escape_html(&meta.default_branch);
    let updated_at_esc = escape_html(&meta.updated_at);
    let nav_html = render_nav_bar(NavTab::Pulls, meta, 0);

    let open_count = pulls
        .iter()
        .filter(|p| p.status == PullRequestStatus::Open)
        .count();
    let merged_count = pulls
        .iter()
        .filter(|p| p.status == PullRequestStatus::Merged)
        .count();
    let closed_count = pulls
        .iter()
        .filter(|p| p.status == PullRequestStatus::Closed)
        .count();

    let items_html = build_pr_list_items(pulls);

    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pull Requests - {repo_name_esc} - Sendforge</title>
  <meta name="description" content="{desc_esc}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://www.sendforge.dev/pulls.html">
  <meta property="og:site_name" content="Sendforge">
  <meta property="og:title" content="Pull Requests — {repo_name_esc}">
  <meta property="og:description" content="{desc_esc}">
  <meta property="og:image" content="https://www.sendforge.dev/og-card.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Pull Requests — {repo_name_esc}">
  <meta name="twitter:description" content="{desc_esc}">
  <meta name="twitter:image" content="https://www.sendforge.dev/og-card.png">
  <link rel="stylesheet" href="/style.css">
  <script type="module" src="/app.js"></script>
</head>
<body>
  <div id="app">
    <header class="forge-header">
      <div class="repo-title">
        <h1><a href="./">{repo_name_esc}</a> / Pull Requests</h1>
        <span class="badge">{default_branch_esc}</span>
      </div>
      <p class="repo-desc">{desc_esc}</p>
    </header>

{nav_html}

    <main class="collab-container">
      <div class="collab-filter-bar">
        <span class="filter-pill active">🟢 {open_count} Open</span>
        <span class="filter-pill">🟣 {merged_count} Merged</span>
        <span class="filter-pill">🔴 {closed_count} Closed</span>
      </div>
      <ul class="collab-list pr-list">
{items_html}      </ul>
    </main>

    <footer class="forge-footer">
      <span>Powered by <strong>Sendforge</strong> (Static-First Git Forge)</span>
      <span>Last updated: {updated_at_esc}</span>
    </footer>
  </div>
</body>
</html>
"#
    )
}

fn build_issue_list_items(issues: &[Issue]) -> String {
    if issues.is_empty() {
        return r#"        <li class="collab-item empty-collab empty-issues"><p>No issues found.</p></li>"#
            .to_string();
    }

    let mut out = String::new();
    for issue in issues {
        let id_esc = escape_html(&issue.id);
        let title_esc = escape_html(&issue.title);
        let author_name_esc = escape_html(&issue.author.name);
        let created_at_iso = format_timestamp_iso(issue.created_at);

        let (status_badge, status_class) = match issue.status {
            IssueStatus::Open => ("🟢 Open", "badge-open"),
            IssueStatus::Closed => ("🔴 Closed", "badge-closed"),
        };

        let labels_html = build_labels_badge_list(&issue.labels);
        let comment_badge = if issue.comments.is_empty() {
            String::new()
        } else {
            format!(
                r#"<span class="comment-count">💬 {}</span>"#,
                issue.comments.len()
            )
        };

        let _ = writeln!(
            out,
            r#"        <li class="collab-item issue-item">
          <div class="collab-item-header">
            <span class="badge badge-status {status_class}">{status_badge}</span>
            <a href="issues/{id_esc}.html" class="collab-title">#{number} {title_esc}</a>
            {labels_html}
          </div>
          <div class="collab-item-meta">
            <span>#{number} opened on <time datetime="{created_at_iso}">{created_at_iso}</time> by <strong>{author_name_esc}</strong></span>
            {comment_badge}
          </div>
        </li>"#,
            number = issue.number
        );
    }
    out
}

/// Pre-renders the zero-JS `issues.html` issue list page fallback.
#[must_use]
pub fn render_issues_html(meta: &SendforgeRepoMeta, issues: &[Issue]) -> String {
    let repo_name_esc = escape_html(&meta.name);
    let desc_esc = meta
        .description
        .as_deref()
        .map_or_else(String::new, escape_html);
    let default_branch_esc = escape_html(&meta.default_branch);
    let updated_at_esc = escape_html(&meta.updated_at);
    let nav_html = render_nav_bar(NavTab::Issues, meta, 0);

    let open_count = issues
        .iter()
        .filter(|i| i.status == IssueStatus::Open)
        .count();
    let closed_count = issues
        .iter()
        .filter(|i| i.status == IssueStatus::Closed)
        .count();

    let items_html = build_issue_list_items(issues);

    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Issues - {repo_name_esc} - Sendforge</title>
  <meta name="description" content="{desc_esc}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://www.sendforge.dev/issues.html">
  <meta property="og:site_name" content="Sendforge">
  <meta property="og:title" content="Issues — {repo_name_esc}">
  <meta property="og:description" content="{desc_esc}">
  <meta property="og:image" content="https://www.sendforge.dev/og-card.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Issues — {repo_name_esc}">
  <meta name="twitter:description" content="{desc_esc}">
  <meta name="twitter:image" content="https://www.sendforge.dev/og-card.png">
  <link rel="stylesheet" href="/style.css">
  <script type="module" src="/app.js"></script>
</head>
<body>
  <div id="app">
    <header class="forge-header">
      <div class="repo-title">
        <h1><a href="./">{repo_name_esc}</a> / Issues</h1>
        <span class="badge">{default_branch_esc}</span>
      </div>
      <p class="repo-desc">{desc_esc}</p>
    </header>

{nav_html}

    <main class="collab-container">
      <div class="collab-filter-bar">
        <span class="filter-pill active">🟢 {open_count} Open</span>
        <span class="filter-pill">🔴 {closed_count} Closed</span>
      </div>
      <ul class="collab-list issue-list">
{items_html}      </ul>
    </main>

    <footer class="forge-footer">
      <span>Powered by <strong>Sendforge</strong> (Static-First Git Forge)</span>
      <span>Last updated: {updated_at_esc}</span>
    </footer>
  </div>
</body>
</html>
"#
    )
}

fn build_comments_html(comments: &[Comment], empty_msg: &str) -> String {
    if comments.is_empty() {
        return format!(r#"<p class="no-comments">{empty_msg}</p>"#);
    }

    let mut comments_html = String::new();
    for comment in comments {
        let c_author_esc = escape_html(&comment.author.name);
        let c_date_iso = format_timestamp_iso(comment.created_at);
        let c_body_html = render_markdown(&comment.body);

        let _ = writeln!(
            comments_html,
            r#"        <div class="collab-comment-card">
          <div class="comment-header">
            <strong>{c_author_esc}</strong> commented on <time datetime="{c_date_iso}">{c_date_iso}</time>
          </div>
          <div class="comment-body markdown-body">
            {c_body_html}
          </div>
        </div>"#
        );
    }
    comments_html
}

/// Pre-renders individual zero-JS `pulls/<id>.html` PR detail fallback.
#[must_use]
pub fn render_pull_detail_html(meta: &SendforgeRepoMeta, pull: &PullRequest) -> String {
    let repo_name_esc = escape_html(&meta.name);
    let title_esc = escape_html(&pull.title);
    let author_name_esc = escape_html(&pull.author.name);
    let target_branch_esc = escape_html(&pull.target_branch);
    let source_branch_esc = escape_html(&pull.source_branch);
    let head_commit_esc = escape_html(&pull.head_commit);
    let updated_at_esc = escape_html(&meta.updated_at);
    let created_at_iso = format_timestamp_iso(pull.created_at);
    let nav_html = render_nav_bar(NavTab::Pulls, meta, 1);

    let (status_badge, status_class) = match pull.status {
        PullRequestStatus::Open => ("🟢 Open", "badge-open"),
        PullRequestStatus::Merged => ("🟣 Merged", "badge-merged"),
        PullRequestStatus::Closed => ("🔴 Closed", "badge-closed"),
    };

    let labels_html = build_labels_badge_list(&pull.labels);
    let rendered_desc = if pull.description.trim().is_empty() {
        "<p class=\"empty-desc\"><em>No description provided.</em></p>".to_string()
    } else {
        render_markdown(&pull.description)
    };

    let comments_html =
        build_comments_html(&pull.comments, "No comments on this pull request yet.");

    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>#{number} {title_esc} - Pull Requests - {repo_name_esc} - Sendforge</title>
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Sendforge">
  <meta property="og:title" content="PR #{number}: {title_esc} — {repo_name_esc}">
  <meta property="og:image" content="https://www.sendforge.dev/og-card.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="PR #{number}: {title_esc} — {repo_name_esc}">
  <meta name="twitter:image" content="https://www.sendforge.dev/og-card.png">
  <link rel="stylesheet" href="../style.css">
  <script type="module" src="../app.js"></script>
</head>
<body>
  <div id="app">
    <header class="forge-header">
      <div class="repo-title">
        <h1><a href="../">{repo_name_esc}</a> / <a href="../pulls.html">Pull Requests</a> / #{number}</h1>
      </div>
    </header>

{nav_html}

    <main class="collab-detail-container">
      <div class="collab-detail-header">
        <h2 class="collab-detail-title">{title_esc} <span class="collab-id-badge">#{number}</span></h2>
        <div class="collab-detail-meta">
          <span class="badge badge-status {status_class}">{status_badge}</span>
          <span><strong>{author_name_esc}</strong> wants to merge into <code>{target_branch_esc}</code> from <code>{source_branch_esc}</code></span>
          <span class="head-sha">Commit: <code>{head_commit_esc}</code></span>
          {labels_html}
        </div>
      </div>

      <article class="collab-description-card">
        <div class="card-header">
          <strong>{author_name_esc}</strong> opened this pull request on <time datetime="{created_at_iso}">{created_at_iso}</time>
        </div>
        <div class="card-body markdown-body">
          {rendered_desc}
        </div>
      </article>

      <section class="collab-timeline">
        <h3>Discussion ({comments_count})</h3>
{comments_html}      </section>
    </main>

    <footer class="forge-footer">
      <span>Powered by <strong>Sendforge</strong> (Static-First Git Forge)</span>
      <span>Last updated: {updated_at_esc}</span>
    </footer>
  </div>
</body>
</html>
"#,
        number = pull.number,
        comments_count = pull.comments.len()
    )
}

/// Pre-renders individual zero-JS `issues/<id>.html` Issue detail fallback.
#[must_use]
pub fn render_issue_detail_html(meta: &SendforgeRepoMeta, issue: &Issue) -> String {
    let repo_name_esc = escape_html(&meta.name);
    let title_esc = escape_html(&issue.title);
    let author_name_esc = escape_html(&issue.author.name);
    let updated_at_esc = escape_html(&meta.updated_at);
    let created_at_iso = format_timestamp_iso(issue.created_at);
    let nav_html = render_nav_bar(NavTab::Issues, meta, 1);

    let (status_badge, status_class) = match issue.status {
        IssueStatus::Open => ("🟢 Open", "badge-open"),
        IssueStatus::Closed => ("🔴 Closed", "badge-closed"),
    };

    let labels_html = build_labels_badge_list(&issue.labels);
    let rendered_desc = if issue.description.trim().is_empty() {
        "<p class=\"empty-desc\"><em>No description provided.</em></p>".to_string()
    } else {
        render_markdown(&issue.description)
    };

    let comments_html = build_comments_html(&issue.comments, "No comments on this issue yet.");

    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>#{number} {title_esc} - Issues - {repo_name_esc} - Sendforge</title>
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Sendforge">
  <meta property="og:title" content="Issue #{number}: {title_esc} — {repo_name_esc}">
  <meta property="og:image" content="https://www.sendforge.dev/og-card.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Issue #{number}: {title_esc} — {repo_name_esc}">
  <meta name="twitter:image" content="https://www.sendforge.dev/og-card.png">
  <link rel="stylesheet" href="../style.css">
  <script type="module" src="../app.js"></script>
</head>
<body>
  <div id="app">
    <header class="forge-header">
      <div class="repo-title">
        <h1><a href="../">{repo_name_esc}</a> / <a href="../issues.html">Issues</a> / #{number}</h1>
      </div>
    </header>

{nav_html}

    <main class="collab-detail-container">
      <div class="collab-detail-header">
        <h2 class="collab-detail-title">{title_esc} <span class="collab-id-badge">#{number}</span></h2>
        <div class="collab-detail-meta">
          <span class="badge badge-status {status_class}">{status_badge}</span>
          <span>Opened on <time datetime="{created_at_iso}">{created_at_iso}</time> by <strong>{author_name_esc}</strong></span>
          {labels_html}
        </div>
      </div>

      <article class="collab-description-card">
        <div class="card-header">
          <strong>{author_name_esc}</strong> opened this issue on <time datetime="{created_at_iso}">{created_at_iso}</time>
        </div>
        <div class="card-body markdown-body">
          {rendered_desc}
        </div>
      </article>

      <section class="collab-timeline">
        <h3>Discussion ({comments_count})</h3>
{comments_html}      </section>
    </main>

    <footer class="forge-footer">
      <span>Powered by <strong>Sendforge</strong> (Static-First Git Forge)</span>
      <span>Last updated: {updated_at_esc}</span>
    </footer>
  </div>
</body>
</html>
"#,
        number = issue.number,
        comments_count = issue.comments.len()
    )
}
