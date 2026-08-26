//! Static zero-JS HTML pre-rendering for the root Forge Dashboard.

use std::collections::BTreeMap;
use std::fmt::Write as _;

use crate::export::multi::{ForgeIndex, ForgeRepoCard};
use crate::prerender::escape_html;

fn format_stat_pill(label: &str, count: usize, icon: &str) -> String {
    format!(r#"<span class="stat-pill" title="{count} {label}">{icon} {count} {label}</span>"#)
}

fn render_repo_card_html(card: &ForgeRepoCard) -> String {
    let name_esc = escape_html(&card.name);
    let path_esc = escape_html(&card.path);
    let default_branch_esc = escape_html(&card.default_branch);

    let desc_html = card.description.as_deref().map_or_else(
        || r#"<p class="repo-card-desc empty"><em>No description provided</em></p>"#.to_string(),
        |desc| format!(r#"<p class="repo-card-desc">{}</p>"#, escape_html(desc)),
    );

    let owner_tag = card.owner.as_deref().map_or_else(String::new, |o| {
        format!(r#"<span class="owner-pill">👤 {}</span>"#, escape_html(o))
    });

    let latest_commit_html = card.latest_commit.as_ref().map_or_else(String::new, |c| {
        let summary_esc = escape_html(&c.summary);
        let author_esc = escape_html(&c.author);
        let short_oid = if c.oid.len() >= 7 {
            &c.oid[..7]
        } else {
            &c.oid
        };
        let short_oid_esc = escape_html(short_oid);

        format!(
            r#"        <div class="repo-card-commit">
          <div class="commit-msg"><strong>{summary_esc}</strong></div>
          <div class="commit-meta">
            <span>by {author_esc}</span>
            <code class="commit-sha">{short_oid_esc}</code>
          </div>
        </div>"#
        )
    });

    let commit_pill = format_stat_pill("commits", card.stats.commits, "📜");
    let branch_pill = format_stat_pill("branches", card.stats.branches, "🌿");
    let tag_pill = format_stat_pill("tags", card.stats.tags, "🏷️");
    let issue_pill = format_stat_pill("issues", card.stats.issues, "🎯");
    let pull_pill = format_stat_pill("pulls", card.stats.pulls, "🔀");

    format!(
        r#"      <article class="repo-card">
        <header class="repo-card-header">
          <div class="repo-card-title-row">
            <h3><a href="{path_esc}" class="repo-title-link">📦 {name_esc}</a></h3>
            <span class="badge default-branch-badge">{default_branch_esc}</span>
          </div>
          {owner_tag}
        </header>

        {desc_html}

{latest_commit_html}

        <footer class="repo-card-stats">
          {commit_pill}
          {branch_pill}
          {tag_pill}
          {issue_pill}
          {pull_pill}
        </footer>
      </article>"#
    )
}

fn group_repos_by_owner(repos: &[ForgeRepoCard]) -> BTreeMap<String, Vec<&ForgeRepoCard>> {
    let mut owner_groups: BTreeMap<String, Vec<&ForgeRepoCard>> = BTreeMap::new();
    for repo in repos {
        let owner_key = repo
            .owner
            .as_deref()
            .unwrap_or("Independent / Standalone")
            .to_string();
        owner_groups.entry(owner_key).or_default().push(repo);
    }
    owner_groups
}

fn build_owner_filter_pills(
    owner_groups: &BTreeMap<String, Vec<&ForgeRepoCard>>,
    repo_count: usize,
) -> String {
    let mut filter_pills = String::new();
    let _ = write!(
        filter_pills,
        r#"<span class="filter-pill active">All ({repo_count})</span>"#
    );
    for (owner_name, repos) in owner_groups {
        let owner_esc = escape_html(owner_name);
        let count = repos.len();
        let _ = write!(
            filter_pills,
            r#"<span class="filter-pill">{owner_esc} ({count})</span>"#
        );
    }
    filter_pills
}

fn build_owner_groups_html(owner_groups: &BTreeMap<String, Vec<&ForgeRepoCard>>) -> String {
    let mut groups_html = String::new();
    for (owner_name, repos) in owner_groups {
        let owner_esc = escape_html(owner_name);
        let count = repos.len();

        let mut cards_html = String::new();
        for repo in repos {
            let _ = writeln!(cards_html, "{}", render_repo_card_html(repo));
        }

        let _ = write!(
            groups_html,
            r#"    <section class="owner-group-section">
      <div class="owner-group-header">
        <h2>👤 {owner_esc}</h2>
        <span class="badge count-badge">{count} repos</span>
      </div>
      <div class="repo-grid">
{cards_html}      </div>
    </section>
"#
        );
    }
    groups_html
}

/// Pre-renders the zero-JS `index.html` root dashboard landing page for a multi-repository forge.
#[must_use]
pub fn render_dashboard_html(index: &ForgeIndex) -> String {
    let title_esc = escape_html(&index.title);
    let repo_count = index.repos.len();
    let total_commits: usize = index.repos.iter().map(|r| r.stats.commits).sum();

    let owner_groups = group_repos_by_owner(&index.repos);
    let owner_count = owner_groups.len();
    let filter_pills = build_owner_filter_pills(&owner_groups, repo_count);
    let groups_html = build_owner_groups_html(&owner_groups);
    let generated_at_esc = escape_html(&index.generated_at);

    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title_esc} - Static Git Forge Portfolio</title>
  <meta name="description" content="Multi-repository portfolio and high-performance static Git forge hub.">
  <meta property="og:type" content="website">
  <meta property="og:title" content="{title_esc} — Static Git Forge">
  <meta property="og:description" content="Explore {repo_count} Git repositories with zero server dependencies.">
  <meta property="og:image" content="/og-card.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{title_esc} — Static Git Forge">
  <meta name="twitter:description" content="Explore {repo_count} Git repositories with zero server dependencies.">
  <meta name="twitter:image" content="/og-card.png">
  <link rel="stylesheet" href="style.css">
  <script type="module" src="app.js"></script>
</head>
<body>
  <div id="app" class="app-container dashboard-app">
    <!-- Forge Hub Static Header -->
    <header class="forge-header dashboard-header">
      <div class="header-top">
        <div class="repo-brand">
          <span class="repo-icon">🏛️</span>
          <h1><a href="./">{title_esc}</a></h1>
        </div>
        <div class="forge-stats-summary">
          <span class="badge">📦 {repo_count} Repositories</span>
          <span class="badge">👥 {owner_count} Owners</span>
          <span class="badge">📜 {total_commits} Total Commits</span>
        </div>
      </div>
      <p class="repo-desc">High-Performance Static Git Forge Portfolio Hub</p>
    </header>

    <main class="main-content dashboard-main">
      <!-- Search & Filter Controls -->
      <section class="dashboard-controls">
        <div class="search-box-container">
          <input
            type="search"
            class="search-input dashboard-search-input"
            placeholder="Search repositories by name, owner, or description..."
            aria-label="Search repositories"
            disabled
          >
        </div>
        <div class="owner-filter-bar">
          {filter_pills}
        </div>
      </section>

      <!-- Repository Grid Sections -->
      <div class="dashboard-groups">
{groups_html}      </div>
    </main>

    <!-- Static Footer -->
    <footer class="forge-footer">
      <span>Powered by <strong>Sendforge</strong> (Static-First Git Forge)</span>
      <span>Generated on <time datetime="{generated_at_esc}">{generated_at_esc}</time></span>
    </footer>
  </div>
</body>
</html>"#
    )
}
