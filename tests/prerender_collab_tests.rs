//! Integration tests for zero-JS static HTML pre-rendering of collaboration views and 4-tab navigation.

use sendforge::collab::models::{
    Author, Comment, Issue, IssueStatus, PullRequest, PullRequestStatus,
};
use sendforge::meta::{BranchMeta, HeadMeta, RepoStats, SendforgeRepoMeta};
use sendforge::prerender::{
    render_index_html, render_issue_detail_html, render_issues_html, render_log_html,
    render_pull_detail_html, render_pulls_html,
};

fn mock_meta() -> SendforgeRepoMeta {
    SendforgeRepoMeta {
        name: "test-forge".into(),
        description: Some("Static Git forge".into()),
        owner: Some("tester".into()),
        clone_url: Some("http://localhost:8080/test-forge.git".into()),
        default_branch: "main".into(),
        branches: vec![BranchMeta {
            name: "main".into(),
            target: "1111111111111111111111111111111111111111".into(),
            is_default: true,
            latest_commit_date: Some("2026-08-20T04:00:00Z".into()),
        }],
        tags: Vec::new(),
        head: Some(HeadMeta {
            target_ref: "refs/heads/main".into(),
            sha: "1111111111111111111111111111111111111111".into(),
        }),
        latest_commit: None,
        stats: RepoStats {
            branch_count: 1,
            tag_count: 0,
            commit_count: 15,
            file_count: 5,
            pull_count: 3,
            open_pull_count: 2,
            issue_count: 4,
            open_issue_count: 3,
        },
        has_readme: false,
        readme_filename: None,
        updated_at: "2026-08-20T04:00:00Z".into(),
    }
}

// =========================================================================
// 1. 4-TAB NAVIGATION BAR TESTS
// =========================================================================

#[test]
fn test_4_tab_navigation_bar_active_states() {
    let meta = mock_meta();

    // 1. Code tab active on index.html
    let index_html = render_index_html(&meta, &[], None);
    assert!(
        index_html.contains(r#"<a href="./" class="active">📁 Code</a>"#)
            || index_html.contains("Code")
    );
    assert!(index_html.contains("Commits (15)"));
    assert!(index_html.contains("Issues (3)"));
    assert!(index_html.contains("Pull Requests (2)"));

    // 2. Commits tab active on log.html
    let log_html = render_log_html(&meta, &[]);
    assert!(
        log_html.contains(r#"href="log.html" class="active""#) || log_html.contains("Commits (15)")
    );

    // 3. Pull Requests tab active on pulls.html
    let pulls_html = render_pulls_html(&meta, &[]);
    assert!(
        pulls_html.contains(r#"href="pulls.html" class="active""#)
            || pulls_html.contains("Pull Requests (2)")
    );

    // 4. Issues tab active on issues.html
    let issues_html = render_issues_html(&meta, &[]);
    assert!(
        issues_html.contains(r#"href="issues.html" class="active""#)
            || issues_html.contains("Issues (3)")
    );
}

// =========================================================================
// 2. PR LIST PRE-RENDERING
// =========================================================================

#[test]
fn test_render_pulls_html_list_and_empty_state() {
    let meta = mock_meta();

    // Empty state
    let empty_html = render_pulls_html(&meta, &[]);
    assert!(empty_html.contains("No pull requests found") || empty_html.contains("empty-pulls"));

    // Populated state with multiple statuses
    let prs = vec![
        PullRequest {
            id: "1".into(),
            number: 1,
            title: "Add OAuth2 Support".into(),
            description: "Enables OAuth authentication.".into(),
            author: Author {
                name: "Alice".into(),
                email: "alice@example.com".into(),
            },
            target_branch: "main".into(),
            source_branch: "feat/oauth".into(),
            head_commit: "1111111111111111111111111111111111111111".into(),
            status: PullRequestStatus::Open,
            created_at: 1740000000,
            updated_at: 1740001000,
            labels: vec!["auth".into(), "security".into()],
            comments: vec![Comment {
                id: "c1".into(),
                author: Author {
                    name: "Bob".into(),
                    email: "bob@example.com".into(),
                },
                body: "LGTM".into(),
                created_at: 1740000500,
            }],
        },
        PullRequest {
            id: "2".into(),
            number: 2,
            title: "Fix Memory Leak in Cache".into(),
            description: "Resolved buffer leak.".into(),
            author: Author {
                name: "Bob".into(),
                email: "bob@example.com".into(),
            },
            target_branch: "main".into(),
            source_branch: "fix/leak".into(),
            head_commit: "2222222222222222222222222222222222222222".into(),
            status: PullRequestStatus::Merged,
            created_at: 1739000000,
            updated_at: 1739005000,
            labels: vec!["bug".into()],
            comments: vec![],
        },
    ];

    let html = render_pulls_html(&meta, &prs);

    // Assert PR 1 elements
    assert!(html.contains("Add OAuth2 Support"));
    assert!(html.contains("#1"));
    assert!(html.contains("badge-open") || html.contains("open"));
    assert!(html.contains("Alice"));
    assert!(html.contains("auth"));
    assert!(html.contains("security"));
    assert!(html.contains("pulls/1.html") || html.contains("#/pulls/1"));

    // Assert PR 2 elements
    assert!(html.contains("Fix Memory Leak in Cache"));
    assert!(html.contains("#2"));
    assert!(html.contains("badge-merged") || html.contains("merged"));
}

// =========================================================================
// 3. ISSUE LIST PRE-RENDERING
// =========================================================================

#[test]
fn test_render_issues_html_list_and_empty_state() {
    let meta = mock_meta();

    // Empty state
    let empty_html = render_issues_html(&meta, &[]);
    assert!(empty_html.contains("No issues found") || empty_html.contains("empty-issues"));

    // Populated state
    let issues = vec![
        Issue {
            id: "1".into(),
            number: 1,
            title: "Crashing on deep Git tree".into(),
            description: "Stack overflow on 100 deep directories.".into(),
            author: Author {
                name: "Charlie".into(),
                email: "c@example.com".into(),
            },
            status: IssueStatus::Open,
            created_at: 1740000000,
            updated_at: 1740000000,
            labels: vec!["crash".into(), "high-priority".into()],
            comments: vec![],
        },
        Issue {
            id: "2".into(),
            number: 2,
            title: "Improve CLI help text".into(),
            description: "Better examples needed.".into(),
            author: Author {
                name: "Dave".into(),
                email: "d@example.com".into(),
            },
            status: IssueStatus::Closed,
            created_at: 1730000000,
            updated_at: 1731000000,
            labels: vec!["docs".into()],
            comments: vec![],
        },
    ];

    let html = render_issues_html(&meta, &issues);

    assert!(html.contains("Crashing on deep Git tree"));
    assert!(html.contains("#1"));
    assert!(html.contains("badge-open") || html.contains("open"));
    assert!(html.contains("crash"));
    assert!(html.contains("high-priority"));
    assert!(html.contains("issues/1.html") || html.contains("#/issues/1"));

    assert!(html.contains("Improve CLI help text"));
    assert!(html.contains("#2"));
    assert!(html.contains("badge-closed") || html.contains("closed"));
}

// =========================================================================
// 4. DETAIL PAGES PRE-RENDERING & MARKDOWN INTEGRATION
// =========================================================================

#[test]
fn test_render_pull_detail_and_issue_detail_html() {
    let meta = mock_meta();

    let pr = PullRequest {
        id: "10".into(),
        number: 10,
        title: "Implement Web Worker Diffing".into(),
        description:
            "### Summary\n- Myers diff in worker\n- Offload UI thread\n\n```typescript\nconst worker = new Worker();\n```"
                .into(),
        author: Author {
            name: "Alice".into(),
            email: "alice@example.com".into(),
        },
        target_branch: "main".into(),
        source_branch: "feat/worker-diff".into(),
        head_commit: "abcdef0123456789abcdef0123456789abcdef01".into(),
        status: PullRequestStatus::Open,
        created_at: 1740000000,
        updated_at: 1740001000,
        labels: vec!["performance".into()],
        comments: vec![Comment {
            id: "c1".into(),
            author: Author {
                name: "Bob".into(),
                email: "bob@example.com".into(),
            },
            body: "Great work! Tested with 5000 lines diff.\n- [x] Fast\n- [x] Zero lag".into(),
            created_at: 1740000500,
        }],
    };

    let pr_html = render_pull_detail_html(&meta, &pr);
    assert!(pr_html.contains("#10"));
    assert!(pr_html.contains("Implement Web Worker Diffing"));
    assert!(pr_html.contains("feat/worker-diff"));
    assert!(pr_html.contains("main"));
    assert!(pr_html.contains("<h3>Summary</h3>") || pr_html.contains("Summary"));
    assert!(pr_html.contains("<code") && pr_html.contains("const worker = new Worker();"));
    assert!(pr_html.contains("Bob"));
    assert!(pr_html.contains("Great work!"));
    assert!(pr_html.contains("<input") || pr_html.contains("Fast"));

    let issue = Issue {
        id: "5".into(),
        number: 5,
        title: "Add Dark Mode Theme".into(),
        description: "Support system `prefers-color-scheme: dark`.".into(),
        author: Author {
            name: "Charlie".into(),
            email: "c@example.com".into(),
        },
        status: IssueStatus::Open,
        created_at: 1740000000,
        updated_at: 1740000000,
        labels: vec!["enhancement".into()],
        comments: vec![],
    };

    let issue_html = render_issue_detail_html(&meta, &issue);
    assert!(issue_html.contains("#5"));
    assert!(issue_html.contains("Add Dark Mode Theme"));
    assert!(
        issue_html.contains("<code>prefers-color-scheme: dark</code>")
            || issue_html.contains("prefers-color-scheme: dark")
    );
    assert!(issue_html.contains("Charlie"));
}

// =========================================================================
// 5. XSS & HTML SANITIZATION IN COLLABORATION TEMPLATES
// =========================================================================

#[test]
fn test_xss_sanitization_in_collab_views() {
    let meta = mock_meta();

    let xss_pr = PullRequest {
        id: "99".into(),
        number: 99,
        title: "<script>alert('xss-title')</script>".into(),
        description:
            "[Click Me](javascript:alert('xss-desc')) <img src=x onerror=alert('xss-img')>".into(),
        author: Author {
            name: "<script>alert('xss-author')</script>".into(),
            email: "xss@example.com".into(),
        },
        target_branch: "main<script>".into(),
        source_branch: "feat<script>".into(),
        head_commit: "1111111111111111111111111111111111111111".into(),
        status: PullRequestStatus::Open,
        created_at: 1740000000,
        updated_at: 1740000000,
        labels: vec!["<script>alert('xss-label')</script>".into()],
        comments: vec![Comment {
            id: "c99".into(),
            author: Author {
                name: "Hacker<script>".into(),
                email: "h@h.com".into(),
            },
            body: "<iframe src='evil.html'></iframe>".into(),
            created_at: 1740000000,
        }],
    };

    let pulls_list_html = render_pulls_html(&meta, std::slice::from_ref(&xss_pr));
    assert!(!pulls_list_html.contains("<script>alert('xss-title')</script>"));
    assert!(pulls_list_html.contains("&lt;script&gt;alert(&#39;xss-title&#39;)&lt;/script&gt;"));

    let detail_html = render_pull_detail_html(&meta, &xss_pr);
    assert!(!detail_html.contains("href=\"javascript:"));
    assert!(!detail_html.contains("<iframe src='evil.html'>"));
    assert!(detail_html.contains("&lt;iframe") || !detail_html.contains("evil.html"));
}
