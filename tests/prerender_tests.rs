//! Integration tests for zero-JS HTML template pre-rendering and markdown engine.

use sendforge::meta::{BranchMeta, HeadMeta, RepoStats, SendforgeRepoMeta};
use sendforge::prerender::{escape_html, render_index_html, render_log_html, render_markdown};
use sendforge::repo::objects::{CommitObject, CommitSignature, TreeEntry};

#[test]
fn test_html_escaping() {
    assert_eq!(
        escape_html("<script>alert('xss' & \"foo\")</script>"),
        "&lt;script&gt;alert(&#39;xss&#39; &amp; &quot;foo&quot;)&lt;/script&gt;"
    );
}

#[test]
fn test_markdown_tables_and_code() {
    let md = r#"# Title

| Feature | Status |
|---|---|
| Range | Supported |

```rust
fn main() { println!("hi"); }
```

- [x] Done task
- [ ] Todo task
~~strikethrough~~
"#;

    let html = render_markdown(md);

    assert!(html.contains("<h1>Title</h1>"));
    assert!(html.contains("<table>"));
    assert!(html.contains("<th>Feature</th>"));
    assert!(html.contains("<td>Supported</td>"));
    assert!(html.contains("<code"));
    assert!(html.contains("println!"));
    assert!(html.contains("<del>strikethrough</del>"));
    assert!(html.contains("<input"));
}

#[test]
fn test_render_index_and_log_html() {
    let meta = SendforgeRepoMeta {
        name: "test-forge".into(),
        description: Some("Static Git forge".into()),
        owner: Some("tester".into()),
        clone_url: Some("http://localhost:8080/test-forge.git".into()),
        default_branch: "main".into(),
        branches: vec![BranchMeta {
            name: "main".into(),
            target: "1111111111111111111111111111111111111111".into(),
            is_default: true,
            latest_commit_date: Some("2026-08-19T20:30:00Z".into()),
        }],
        tags: Vec::new(),
        head: Some(HeadMeta {
            target_ref: "refs/heads/main".into(),
            sha: "1111111111111111111111111111111111111111".into(),
        }),
        latest_commit: Some(CommitObject {
            id: "1111111111111111111111111111111111111111".into(),
            short_id: "1111111".into(),
            tree: "2222222222222222222222222222222222222222".into(),
            parents: Vec::new(),
            author: CommitSignature {
                name: "Author".into(),
                email: "a@a.com".into(),
                timestamp: 1_787_171_400,
                date: "2026-08-19T20:30:00Z".into(),
            },
            committer: CommitSignature {
                name: "Author".into(),
                email: "a@a.com".into(),
                timestamp: 1_787_171_400,
                date: "2026-08-19T20:30:00Z".into(),
            },
            message: "Initial commit".into(),
            summary: "Initial commit".into(),
        }),
        stats: RepoStats {
            branch_count: 1,
            tag_count: 0,
            commit_count: 1,
            file_count: 2,
            pull_count: 0,
            open_pull_count: 0,
            issue_count: 0,
            open_issue_count: 0,
        },
        has_readme: true,
        readme_filename: Some("README.md".into()),
        updated_at: "2026-08-19T20:30:05Z".into(),
    };

    let entries = vec![
        TreeEntry {
            mode: "040000".into(),
            name: "src".into(),
            sha: "3333333333333333333333333333333333333333".into(),
            short_sha: "3333333".into(),
            is_dir: true,
            is_executable: false,
            is_symlink: false,
            is_submodule: false,
        },
        TreeEntry {
            mode: "100644".into(),
            name: "README.md".into(),
            sha: "4444444444444444444444444444444444444444".into(),
            short_sha: "4444444".into(),
            is_dir: false,
            is_executable: false,
            is_symlink: false,
            is_submodule: false,
        },
    ];

    let rendered_readme = "<p>Rendered readme content</p>";
    let index_html = render_index_html(&meta, &entries, Some(rendered_readme));

    assert!(index_html.contains("test-forge"));
    assert!(index_html.contains("Static Git forge"));
    assert!(index_html.contains("📁 src/"));
    assert!(index_html.contains("📄 README.md"));
    assert!(index_html.contains("Rendered readme content"));

    let commits = vec![meta.latest_commit.clone().unwrap()];
    let log_html = render_log_html(&meta, &commits);

    assert!(log_html.contains("<a href=\"./\">test-forge</a> / Commits"));
    assert!(log_html.contains("Initial commit"));
    assert!(log_html.contains("Author &lt;a@a.com&gt;"));
    assert!(log_html.contains("1111111"));
}
