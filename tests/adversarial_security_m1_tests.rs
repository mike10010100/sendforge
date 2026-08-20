//! Adversarial security, HTML sanitization, and path traversal test suite for Milestone M1.

use flate2::write::ZlibEncoder;
use flate2::Compression;
use std::fs;
use std::io::Write;
use tempfile::tempdir;

use sendforge::collab::models::{
    Author, Comment, Issue, IssueStatus, PullRequest, PullRequestStatus,
};
use sendforge::export::{export_static_site, ExportOptions};
use sendforge::hook::run_hook_update;
use sendforge::meta::{BranchMeta, HeadMeta, RepoStats, SendforgeRepoMeta};
use sendforge::prerender::{
    render_issue_detail_html, render_issues_html, render_markdown, render_nav_bar,
    render_pull_detail_html, render_pulls_html, NavTab,
};
use sendforge::repo::init_bare_repo;
use sendforge::repo::objects::{compute_object_sha, ObjectType};
use sendforge::repo::refs::discover_all_refs;
use sendforge::repo::InitOptions;

fn helper_write_loose_object(
    repo_path: &std::path::Path,
    obj_type: ObjectType,
    content: &[u8],
) -> Result<String, Box<dyn std::error::Error>> {
    let sha = compute_object_sha(obj_type, content);
    let obj_dir = repo_path.join("objects").join(&sha[..2]);
    fs::create_dir_all(&obj_dir)?;

    let mut uncompressed = Vec::new();
    let header = format!("{obj_type} {}\0", content.len());
    uncompressed.extend_from_slice(header.as_bytes());
    uncompressed.extend_from_slice(content);

    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(&uncompressed)?;
    let compressed = encoder.finish()?;

    let obj_file = obj_dir.join(&sha[2..]);
    fs::write(obj_file, compressed)?;

    Ok(sha)
}

fn mock_meta_with_depth() -> SendforgeRepoMeta {
    SendforgeRepoMeta {
        name: "security-audit".into(),
        description: Some("Adversarial Security Test Repo".into()),
        owner: Some("auditor".into()),
        clone_url: Some("https://git.example.com/security-audit.git".into()),
        default_branch: "main".into(),
        branches: vec![BranchMeta {
            name: "main".into(),
            target: "0123456789abcdef0123456789abcdef01234567".into(),
            is_default: true,
            latest_commit_date: Some("2026-08-20T04:00:00Z".into()),
        }],
        tags: Vec::new(),
        head: Some(HeadMeta {
            target_ref: "refs/heads/main".into(),
            sha: "0123456789abcdef0123456789abcdef01234567".into(),
        }),
        latest_commit: None,
        stats: RepoStats {
            branch_count: 1,
            tag_count: 0,
            commit_count: 42,
            file_count: 10,
            pull_count: 5,
            open_pull_count: 3,
            issue_count: 7,
            open_issue_count: 4,
        },
        has_readme: true,
        readme_filename: Some("README.md".into()),
        updated_at: "2026-08-20T04:30:00Z".into(),
    }
}

// =========================================================================
// 1. XSS SANITIZATION & MARKDOWN VECTORS
// =========================================================================

#[test]
fn test_adversarial_xss_markdown_and_html_vectors() {
    let attack_vectors = vec![
        // Direct script tags
        ("<script>alert('xss')</script>", "&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;"),
        ("<SCRIPT SRC=http://evil.com/xss.js></SCRIPT>", "&lt;SCRIPT SRC=http://evil.com/xss.js&gt;&lt;/SCRIPT&gt;"),
        // Event handlers in tags
        ("<img src=x onerror=alert(1)>", "&lt;img src=x onerror=alert(1)&gt;"),
        ("<svg onload=alert(document.domain)>", "&lt;svg onload=alert(document.domain)&gt;"),
        ("<body onload=alert('xss')>", "&lt;body onload=alert(&#39;xss&#39;)&gt;"),
        ("<iframe src=\"javascript:alert('xss')\"></iframe>", "&lt;iframe src=&quot;javascript:alert(&#39;xss&#39;)&quot;&gt;&lt;/iframe&gt;"),
        // Javascript URIs in markdown links
        ("[Click Me](javascript:alert(1))", "href=\"#\""),
        ("[Click Me](javascript:alert(document.cookie))", "href=\"#\""),
        ("[Click Me](  javascript:alert(1))", "href=\"#\""),
        ("[Click Me](JAVASCRIPT:alert(1))", "href=\"#\""),
        ("[Click Me](vbscript:alert(1))", "href=\"#\""),
        ("[Click Me](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)", "href=\"#\""),
        // Javascript URIs in markdown images
        ("![Alt](javascript:alert(1))", "src=\"#\""),
        ("![Alt](data:text/html,<script>alert(1)</script>)", "src=\"#\""),
        // HTML Entities and nested payloads
        ("<a href=\"javascript:alert(1)\">link</a>", "&lt;a href=&quot;javascript:alert(1)&quot;&gt;link&lt;/a&gt;"),
        ("<details open ontoggle=alert(1)>", "&lt;details open ontoggle=alert(1)&gt;"),
        ("<style>body{display:none}</style>", "&lt;style&gt;body{display:none}&lt;/style&gt;"),
        ("<object data=\"javascript:alert(1)\">", "&lt;object data=&quot;javascript:alert(1)&quot;&gt;"),
        ("<embed src=\"javascript:alert(1)\">", "&lt;embed src=&quot;javascript:alert(1)&quot;&gt;"),
        ("<math><mtext><script>alert(1)</script></mtext></math>", "&lt;math&gt;&lt;mtext&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;/mtext&gt;&lt;/math&gt;"),
    ];

    for (input, expected_contain) in attack_vectors {
        let rendered = render_markdown(input);
        assert!(
            rendered.contains(expected_contain),
            "Failed XSS sanitization check for input:\nInput: {input}\nRendered: {rendered}\nExpected contain: {expected_contain}"
        );
        assert!(
            !rendered.contains("<script>")
                && !rendered.contains("<script ")
                && !rendered.contains("<SCRIPT"),
            "Rendered output contains unescaped <script>: {rendered}"
        );
        assert!(
            !rendered.contains("<iframe") && !rendered.contains("<IFRAME"),
            "Rendered output contains unescaped <iframe: {rendered}"
        );
        if input.starts_with("![") {
            assert!(
                !rendered.contains("src=\"javascript:") && !rendered.contains("src=\"data:"),
                "Image contains dangerous src: {rendered}"
            );
        } else {
            assert!(
                !rendered.contains("<img ") && !rendered.contains("<IMG "),
                "Rendered output contains unescaped <img tag: {rendered}"
            );
        }
        assert!(
            !rendered.contains("<svg") && !rendered.contains("<SVG"),
            "Rendered output contains unescaped <svg tag: {rendered}"
        );
        assert!(
            !rendered.contains("<body") && !rendered.contains("<BODY"),
            "Rendered output contains unescaped <body tag: {rendered}"
        );
        assert!(
            !rendered.contains("<details") && !rendered.contains("<style"),
            "Rendered output contains unescaped html tag: {rendered}"
        );
        assert!(
            !rendered.contains("href=\"javascript:"),
            "Rendered output contains executable javascript: URI in href: {rendered}"
        );
        assert!(
            !rendered.contains("src=\"javascript:"),
            "Rendered output contains executable javascript: URI in src: {rendered}"
        );
    }
}

#[test]
fn test_adversarial_xss_in_all_pr_and_issue_template_fields() {
    let meta = mock_meta_with_depth();

    let malicious_pr = PullRequest {
        id: "1<script>".into(),
        number: 1,
        title: "Malicious PR Title <script>alert('title')</script>".into(),
        description:
            "# PR Header <img src=x onerror=alert('desc')>\n[Click Link](javascript:alert('link'))"
                .into(),
        author: Author {
            name: "Hacker <script>alert('author')</script>".into(),
            email: "hacker<script>@example.com".into(),
        },
        target_branch: "main<script>alert('target')</script>".into(),
        source_branch: "feat<script>alert('source')</script>".into(),
        head_commit: "0123456789abcdef0123456789abcdef01234567<script>".into(),
        status: PullRequestStatus::Open,
        created_at: 1740000000,
        updated_at: 1740001000,
        labels: vec!["security<script>".into(), "<b>bold-label</b>".into()],
        comments: vec![Comment {
            id: "c1".into(),
            author: Author {
                name: "Commenter <script>alert('c_author')</script>".into(),
                email: "c@example.com".into(),
            },
            body: "Comment body <script>alert('c_body')</script>\n<svg onload=alert(1)>".into(),
            created_at: 1740000500,
        }],
    };

    let pulls_list = render_pulls_html(&meta, std::slice::from_ref(&malicious_pr));
    assert!(!pulls_list.contains("<script>"));
    assert!(!pulls_list.contains("<img"));
    assert!(!pulls_list.contains("<b>"));
    assert!(pulls_list.contains("&lt;script&gt;"));
    assert!(pulls_list.contains("&lt;b&gt;bold-label&lt;/b&gt;"));

    let pull_detail = render_pull_detail_html(&meta, &malicious_pr);
    eprintln!("pull_detail description: {}", pull_detail);
    assert!(!pull_detail.contains("<script>"));
    assert!(!pull_detail.contains("<img src="));
    assert!(!pull_detail.contains("<svg"));
    assert!(!pull_detail.contains("href=\"javascript:"));
    assert!(pull_detail.contains("&lt;script&gt;"));

    let malicious_issue = Issue {
        id: "2<script>".into(),
        number: 2,
        title: "Malicious Issue <img src=x onerror=alert('issue-title')>".into(),
        description: "Issue markdown body <iframe src='evil.html'></iframe>".into(),
        author: Author {
            name: "Author <script>".into(),
            email: "a@a.com".into(),
        },
        status: IssueStatus::Open,
        created_at: 1740000000,
        updated_at: 1740000000,
        labels: vec!["<svg onload=alert(1)>".into()],
        comments: vec![Comment {
            id: "c2".into(),
            author: Author {
                name: "Commenter <img src=1>".into(),
                email: "c@c.com".into(),
            },
            body: "Comment markdown with [Evil](javascript:steal())".into(),
            created_at: 1740000100,
        }],
    };

    let issues_list = render_issues_html(&meta, std::slice::from_ref(&malicious_issue));
    assert!(!issues_list.contains("<script>"));
    assert!(!issues_list.contains("<img"));
    assert!(!issues_list.contains("<svg"));

    let issue_detail = render_issue_detail_html(&meta, &malicious_issue);
    assert!(!issue_detail.contains("<script>"));
    assert!(!issue_detail.contains("<iframe"));
    assert!(!issue_detail.contains("<img src=1>"));
    assert!(!issue_detail.contains("href=\"javascript:"));
}

// =========================================================================
// 2. NAV BAR TAB DEPTH CALCULATIONS & LINK CORRECTNESS
// =========================================================================

#[test]
fn test_nav_bar_depth_and_relative_links() {
    let meta = mock_meta_with_depth();

    // Depth 0 (Root level: index.html, log.html, issues.html, pulls.html)
    let nav_depth_0_code = render_nav_bar(NavTab::Code, &meta, 0);
    assert!(nav_depth_0_code.contains(r#"<a href="./" class="active">📁 Code</a>"#));
    assert!(nav_depth_0_code.contains(r#"<a href="log.html">📜 Commits (42)</a>"#));
    assert!(nav_depth_0_code.contains(r#"<a href="issues.html">🎯 Issues (4)</a>"#));
    assert!(nav_depth_0_code.contains(r#"<a href="pulls.html">🔀 Pull Requests (3)</a>"#));

    let nav_depth_0_commits = render_nav_bar(NavTab::Commits, &meta, 0);
    assert!(
        nav_depth_0_commits.contains(r#"<a href="log.html" class="active">📜 Commits (42)</a>"#)
    );

    let nav_depth_0_issues = render_nav_bar(NavTab::Issues, &meta, 0);
    assert!(
        nav_depth_0_issues.contains(r#"<a href="issues.html" class="active">🎯 Issues (4)</a>"#)
    );

    let nav_depth_0_pulls = render_nav_bar(NavTab::Pulls, &meta, 0);
    assert!(nav_depth_0_pulls
        .contains(r#"<a href="pulls.html" class="active">🔀 Pull Requests (3)</a>"#));

    // Depth 1 (Sub-pages: pulls/<id>.html, issues/<id>.html)
    let nav_depth_1_pulls = render_nav_bar(NavTab::Pulls, &meta, 1);
    assert!(nav_depth_1_pulls.contains(r#"<a href=".././">📁 Code</a>"#));
    assert!(nav_depth_1_pulls.contains(r#"<a href="../log.html">📜 Commits (42)</a>"#));
    assert!(nav_depth_1_pulls.contains(r#"<a href="../issues.html">🎯 Issues (4)</a>"#));
    assert!(nav_depth_1_pulls
        .contains(r#"<a href="../pulls.html" class="active">🔀 Pull Requests (3)</a>"#));

    let nav_depth_1_issues = render_nav_bar(NavTab::Issues, &meta, 1);
    assert!(nav_depth_1_issues.contains(r#"<a href=".././">📁 Code</a>"#));
    assert!(nav_depth_1_issues.contains(r#"<a href="../log.html">📜 Commits (42)</a>"#));
    assert!(
        nav_depth_1_issues.contains(r#"<a href="../issues.html" class="active">🎯 Issues (4)</a>"#)
    );
    assert!(nav_depth_1_issues.contains(r#"<a href="../pulls.html">🔀 Pull Requests (3)</a>"#));

    // Check detail page breadcrumb links and style/script assets
    let pr = PullRequest {
        id: "42".into(),
        number: 42,
        title: "Test PR".into(),
        description: "Desc".into(),
        author: Author {
            name: "A".into(),
            email: "a@a.com".into(),
        },
        target_branch: "main".into(),
        source_branch: "feat".into(),
        head_commit: "0123456789abcdef0123456789abcdef01234567".into(),
        status: PullRequestStatus::Open,
        created_at: 1740000000,
        updated_at: 1740000000,
        labels: Vec::new(),
        comments: Vec::new(),
    };
    let pr_detail_html = render_pull_detail_html(&meta, &pr);
    assert!(pr_detail_html.contains(
        r#"<a href="../">security-audit</a> / <a href="../pulls.html">Pull Requests</a> / #42"#
    ));
    assert!(pr_detail_html.contains(r#"<link rel="stylesheet" href="../style.css">"#));
    assert!(pr_detail_html.contains(r#"<script type="module" src="../app.js"></script>"#));

    let issue = Issue {
        id: "7".into(),
        number: 7,
        title: "Test Issue".into(),
        description: "Desc".into(),
        author: Author {
            name: "B".into(),
            email: "b@b.com".into(),
        },
        status: IssueStatus::Open,
        created_at: 1740000000,
        updated_at: 1740000000,
        labels: Vec::new(),
        comments: Vec::new(),
    };
    let issue_detail_html = render_issue_detail_html(&meta, &issue);
    assert!(issue_detail_html.contains(
        r#"<a href="../">security-audit</a> / <a href="../issues.html">Issues</a> / #7"#
    ));
    assert!(issue_detail_html.contains(r#"<link rel="stylesheet" href="../style.css">"#));
    assert!(issue_detail_html.contains(r#"<script type="module" src="../app.js"></script>"#));
}

// =========================================================================
// 3. COMPLETE EXPORT DIRECTORY TREE VALIDATION
// =========================================================================

#[test]
fn test_export_complete_directory_tree_validation() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path().join("audit_repo.git");
    let export_dir = dir.path().join("exported_full");
    let frontend_dist = dir.path().join("dist");

    init_bare_repo(&repo_path, &InitOptions::default())?;

    // Create frontend dist files
    fs::create_dir_all(&frontend_dist)?;
    fs::write(frontend_dist.join("app.js"), b"/* spa js */")?;
    fs::write(frontend_dist.join("style.css"), b"/* css */")?;
    fs::write(frontend_dist.join("favicon.ico"), b"ico")?;

    // Create a commit on main
    let empty_tree = helper_write_loose_object(&repo_path, ObjectType::Tree, b"")?;
    let commit_1 = helper_write_loose_object(
        &repo_path,
        ObjectType::Commit,
        format!("tree {empty_tree}\nauthor Tester <t@t.com> 1740000000 +0000\ncommitter Tester <t@t.com> 1740000000 +0000\n\nInitial commit\n").as_bytes(),
    )?;

    // Update refs/heads/main
    let refs_heads = repo_path.join("refs/heads");
    fs::create_dir_all(&refs_heads)?;
    fs::write(refs_heads.join("main"), format!("{commit_1}\n"))?;

    // Create PR 1 with loose JSON meta
    let pr_meta_json = r#"{
        "id": "1",
        "number": 1,
        "title": "Add Collaboration Layer",
        "description": "Details on collab",
        "author": { "name": "Alice", "email": "alice@example.com" },
        "target_branch": "main",
        "source_branch": "feature/collab",
        "head_commit": "0123456789abcdef0123456789abcdef01234567",
        "status": "open",
        "created_at": 1740000000,
        "updated_at": 1740001000,
        "labels": ["feature"],
        "comments": [
            {
                "id": "c1",
                "author": { "name": "Bob", "email": "bob@example.com" },
                "body": "Looks great!",
                "created_at": 1740000500
            }
        ]
    }"#;
    let pr_meta_blob =
        helper_write_loose_object(&repo_path, ObjectType::Blob, pr_meta_json.as_bytes())?;
    let pr_dir = repo_path.join("refs/pull/1");
    fs::create_dir_all(&pr_dir)?;
    fs::write(pr_dir.join("meta"), format!("{pr_meta_blob}\n"))?;
    fs::write(pr_dir.join("head"), format!("{commit_1}\n"))?;

    // Create Issue 1 with commit fallback
    let issue_commit = helper_write_loose_object(
        &repo_path,
        ObjectType::Commit,
        format!("tree {empty_tree}\nauthor Charlie <c@c.com> 1740000000 +0000\ncommitter Charlie <c@c.com> 1740000000 +0000\n\nBug in export\n\nDetailed explanation of export bug.\n").as_bytes(),
    )?;
    let issue_dir = repo_path.join("refs/issues");
    fs::create_dir_all(&issue_dir)?;
    fs::write(issue_dir.join("1"), format!("{issue_commit}\n"))?;

    let options = ExportOptions {
        frontend_dist: Some(frontend_dist),
        base_url: Some("/forge/".into()),
        no_objects: false,
    };

    export_static_site(&repo_path, &export_dir, &options)?;

    // Complete Directory Tree Assertions:
    // 1. Root HTML and metadata
    assert!(
        export_dir.join("index.html").is_file(),
        "index.html must exist"
    );
    assert!(export_dir.join("log.html").is_file(), "log.html must exist");
    assert!(
        export_dir.join("pulls.html").is_file(),
        "pulls.html must exist"
    );
    assert!(
        export_dir.join("issues.html").is_file(),
        "issues.html must exist"
    );
    assert!(
        export_dir.join("meta.json").is_file(),
        "meta.json must exist"
    );
    assert!(
        export_dir.join("pulls.json").is_file(),
        "pulls.json must exist"
    );
    assert!(
        export_dir.join("issues.json").is_file(),
        "issues.json must exist"
    );

    // 2. Subdirectory detail pages
    assert!(
        export_dir.join("pulls").is_dir(),
        "pulls/ directory must exist"
    );
    assert!(
        export_dir.join("pulls/1.html").is_file(),
        "pulls/1.html must exist"
    );
    assert!(
        export_dir.join("issues").is_dir(),
        "issues/ directory must exist"
    );
    assert!(
        export_dir.join("issues/1.html").is_file(),
        "issues/1.html must exist"
    );

    // 3. Frontend distribution assets
    assert!(export_dir.join("app.js").is_file(), "app.js must exist");
    assert!(
        export_dir.join("style.css").is_file(),
        "style.css must exist"
    );
    assert!(
        export_dir.join("favicon.ico").is_file(),
        "favicon.ico must exist"
    );

    // 4. Git Dumb HTTP & server configuration files
    assert!(export_dir.join("HEAD").is_file(), "HEAD must exist");
    assert!(export_dir.join("config").is_file(), "config must exist");
    assert!(
        export_dir.join("info/refs").is_file(),
        "info/refs must exist"
    );
    assert!(export_dir.join("_headers").is_file(), "_headers must exist");
    assert!(
        export_dir.join("objects").is_dir(),
        "objects/ directory must exist"
    );

    // Verify meta.json content has counts
    let meta_str = fs::read_to_string(export_dir.join("meta.json"))?;
    let parsed_meta: serde_json::Value = serde_json::from_str(&meta_str)?;
    assert_eq!(parsed_meta["stats"]["pull_count"], 1);
    assert_eq!(parsed_meta["stats"]["open_pull_count"], 1);
    assert_eq!(parsed_meta["stats"]["issue_count"], 1);
    assert_eq!(parsed_meta["stats"]["open_issue_count"], 1);

    // Verify pulls.json and issues.json schemas
    let pulls_str = fs::read_to_string(export_dir.join("pulls.json"))?;
    let parsed_pulls: Vec<PullRequest> = serde_json::from_str(&pulls_str)?;
    assert_eq!(parsed_pulls.len(), 1);
    assert_eq!(parsed_pulls[0].title, "Add Collaboration Layer");

    let issues_str = fs::read_to_string(export_dir.join("issues.json"))?;
    let parsed_issues: Vec<Issue> = serde_json::from_str(&issues_str)?;
    assert_eq!(parsed_issues.len(), 1);
    assert_eq!(parsed_issues[0].title, "Bug in export");

    Ok(())
}

// =========================================================================
// 4. PATH TRAVERSAL RESILIENCE IN REFS AND METADATA IDs
// =========================================================================

#[test]
fn test_path_traversal_sanitization_in_refs() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let repo_path = dir.path().join("traversal_repo.git");
    init_bare_repo(&repo_path, &InitOptions::default())?;

    let empty_tree = helper_write_loose_object(&repo_path, ObjectType::Tree, b"")?;
    let commit_sha = helper_write_loose_object(
        &repo_path,
        ObjectType::Commit,
        format!("tree {empty_tree}\nauthor T <t@t.com> 1740000000 +0000\ncommitter T <t@t.com> 1740000000 +0000\n\nCommit\n").as_bytes(),
    )?;

    // 1. Write packed-refs with path traversal ref names
    let packed_content = format!(
        "# pack-refs with:
{commit_sha} refs/pull/../../escape_pr/head
{commit_sha} refs/issues/../../escape_issue
{commit_sha} refs/heads/../../escape_branch
{commit_sha} refs/pull/1/head
"
    );
    fs::write(repo_path.join("packed-refs"), packed_content)?;

    let all_refs = discover_all_refs(&repo_path)?;
    assert!(all_refs.contains_key("refs/pull/../../escape_pr/head"));

    let pulls = sendforge::collab::pulls::scan_pull_requests(&repo_path, &all_refs, "main")?;
    let issues = sendforge::collab::issues::scan_issues(&repo_path, &all_refs)?;

    assert!(!pulls.is_empty());
    assert!(!issues.is_empty());

    // 2. Run hook pipeline
    run_hook_update(&repo_path, None, true)?;

    let static_dir = repo_path.join("static");
    assert!(static_dir.is_dir());

    // Verified: IDs are sanitized and files stay strictly inside static/issues/ and static/pulls/
    let escaped_issue_file = repo_path.join("escape_issue.html");
    let escaped_pr_file = repo_path.join("escape_pr.html");
    assert!(
        !escaped_issue_file.exists(),
        "Security assertion passed: escape_issue.html must NOT be written outside static/issues/"
    );
    assert!(
        !escaped_pr_file.exists(),
        "Security assertion passed: escape_pr.html must NOT be written outside static/pulls/"
    );

    assert!(
        static_dir.join("issues/escape_issue.html").is_file(),
        "Sanitized issue detail page must exist in static/issues/"
    );
    assert!(
        static_dir.join("pulls/escape_pr.html").is_file(),
        "Sanitized pull detail page must exist in static/pulls/"
    );
    assert!(
        static_dir.join("pulls/1.html").is_file(),
        "Pull detail page 1.html must exist in static/pulls/"
    );

    Ok(())
}

#[test]
fn test_path_traversal_sanitization_in_metadata_id() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempdir()?;
    let parent_dir = dir.path();
    let repo_path = parent_dir.join("repo.git");
    init_bare_repo(&repo_path, &InitOptions::default())?;

    let empty_tree = helper_write_loose_object(&repo_path, ObjectType::Tree, b"")?;
    let commit_sha = helper_write_loose_object(
        &repo_path,
        ObjectType::Commit,
        format!("tree {empty_tree}\nauthor T <t@t.com> 1740000000 +0000\ncommitter T <t@t.com> 1740000000 +0000\n\nCommit\n").as_bytes(),
    )?;

    // PR metadata blob with path traversal ID
    let evil_json = r#"{
        "id": "../../../pwn_outside_repo",
        "number": 1,
        "title": "Escape PR",
        "description": "Escape",
        "author": { "name": "Evil", "email": "evil@example.com" },
        "target_branch": "main",
        "source_branch": "evil",
        "head_commit": "0123456789abcdef0123456789abcdef01234567",
        "status": "open",
        "created_at": 1740000000,
        "updated_at": 1740000000,
        "labels": [],
        "comments": []
    }"#;
    let evil_blob = helper_write_loose_object(&repo_path, ObjectType::Blob, evil_json.as_bytes())?;

    let pr_dir = repo_path.join("refs/pull/1");
    fs::create_dir_all(&pr_dir)?;
    fs::write(pr_dir.join("meta"), format!("{evil_blob}\n"))?;
    fs::write(pr_dir.join("head"), format!("{commit_sha}\n"))?;

    run_hook_update(&repo_path, None, true)?;

    let outside_file = parent_dir.join("pwn_outside_repo.html");
    assert!(
        !outside_file.exists(),
        "Security assertion passed: pwn_outside_repo.html must NOT be written outside repository root"
    );

    let contained_file = repo_path.join("static/pulls/pwn_outside_repo.html");
    assert!(
        contained_file.is_file(),
        "Sanitized PR detail page must be safely confined inside static/pulls/"
    );

    Ok(())
}

#[test]
fn test_validate_path_containment_guards() {
    let base = std::path::Path::new("/tmp/repo/static/pulls");
    let safe_child = std::path::Path::new("/tmp/repo/static/pulls/1.html");
    let safe_sub = std::path::Path::new("/tmp/repo/static/pulls/sub/2.html");
    let escaping = std::path::Path::new("/tmp/repo/static/pulls/../../escape.html");
    let absolute_escape = std::path::Path::new("/etc/passwd");

    assert!(sendforge::hook::validate_path_containment(base, safe_child).is_ok());
    assert!(sendforge::hook::validate_path_containment(base, safe_sub).is_ok());
    assert!(sendforge::hook::validate_path_containment(base, escaping).is_err());
    assert!(sendforge::hook::validate_path_containment(base, absolute_escape).is_err());
}
