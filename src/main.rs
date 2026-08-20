//! Sendforge CLI application binary.

#![forbid(unsafe_code)]
#![deny(
    clippy::all,
    clippy::pedantic,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::todo,
    clippy::unimplemented
)]

use std::env;
use std::path::PathBuf;

use anyhow::Context;
use clap::{Parser, Subcommand};

use sendforge::export::{export_static_site, ExportOptions};
use sendforge::hook::{handle_post_receive_stdin, run_hook_update};
use sendforge::repo::{init_bare_repo, InitOptions};
use sendforge::server::{run_server, ServerOptions};

#[derive(Parser, Debug)]
#[command(
    name = "sendforge",
    author = "Sendforge Contributors",
    version = "0.1.0",
    about = "High-performance static-first Git forge CLI, hook, exporter, and server",
    propagate_version = true
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Initialize a bare Git repository configured for Sendforge
    Init {
        /// Path to create or configure the bare Git repository
        #[arg(value_name = "PATH")]
        path: PathBuf,

        /// Repository display name
        #[arg(short, long)]
        name: Option<String>,

        /// Repository description
        #[arg(short, long)]
        description: Option<String>,

        /// Default branch name (default: "main")
        #[arg(short = 'b', long = "default-branch")]
        default_branch: Option<String>,

        /// Repository owner handle
        #[arg(short, long)]
        owner: Option<String>,

        /// Public clone URL
        #[arg(short = 'u', long = "clone-url")]
        clone_url: Option<String>,

        /// Initialize as a bare repository (Sendforge repositories are bare by default; flag accepted for Git CLI compatibility)
        #[arg(long)]
        bare: bool,

        /// Overwrite or reinitialize if directory already exists
        #[arg(short, long)]
        force: bool,
    },

    /// Run the Git post-receive hook routine (reads stdin ref updates)
    Hook {
        /// Path to the bare repository (default: current directory or `$GIT_DIR`)
        #[arg(short, long)]
        repo: Option<PathBuf>,

        /// Output directory for static assets (default: <REPO>/static)
        #[arg(short, long)]
        output: Option<PathBuf>,

        /// Suppress progress messages, printing errors only
        #[arg(short, long)]
        quiet: bool,
    },

    /// Manually scan a bare repository and regenerate metadata and static HTML fallbacks
    Update {
        /// Path to the bare Git repository
        #[arg(value_name = "PATH")]
        path: PathBuf,

        /// Output directory for static assets (default: <PATH>/static)
        #[arg(short, long)]
        output: Option<PathBuf>,

        /// Suppress progress messages, printing errors only
        #[arg(short, long)]
        quiet: bool,
    },

    /// Export a standalone static directory ready for S3, Cloudflare Pages, Caddy, or Nginx
    Export {
        /// Path to the source bare Git repository
        #[arg(value_name = "REPO_PATH")]
        repo_path: PathBuf,

        /// Destination directory for the exported static site
        #[arg(value_name = "OUTPUT_DIR")]
        output_dir: PathBuf,

        /// Path to compiled frontend SPA distribution assets to merge
        #[arg(long = "frontend-dist")]
        frontend_dist: Option<PathBuf>,

        /// Base URL prefix for static links
        #[arg(long = "base-url")]
        base_url: Option<String>,

        /// Exclude Git objects directory from export
        #[arg(long = "no-objects")]
        no_objects: bool,
    },

    /// Run a local static HTTP server with CORS, dumb HTTP, and Range header support
    Serve {
        /// Directory to serve (default: current directory)
        #[arg(value_name = "SERVE_DIR")]
        serve_dir: Option<PathBuf>,

        /// TCP port to bind
        #[arg(short, long, default_value_t = 8080)]
        port: u16,

        /// Host address to bind
        #[arg(short = 'H', long, default_value = "127.0.0.1")]
        host: String,

        /// Enable permissive CORS headers
        #[arg(long, default_value_t = true)]
        cors: bool,

        /// Route missing paths to index.html for client-side routing
        #[arg(long)]
        spa: bool,
    },
}

fn resolve_repo_path(repo_arg: Option<PathBuf>) -> anyhow::Result<PathBuf> {
    if let Some(p) = repo_arg {
        return Ok(p);
    }

    if let Ok(git_dir) = env::var("GIT_DIR") {
        return Ok(PathBuf::from(git_dir));
    }

    let cwd = env::current_dir().context("Failed to get current working directory")?;
    Ok(cwd)
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Init {
            path,
            name,
            description,
            default_branch,
            owner,
            clone_url,
            bare: _,
            force,
        } => {
            let options = InitOptions {
                name,
                description,
                default_branch,
                owner,
                clone_url,
                force,
            };
            init_bare_repo(&path, &options)
                .with_context(|| format!("Failed to initialize bare repository at {}", path.display()))?;
            eprintln!("[sendforge] Initialized bare repository at {}", path.display());
        }

        Commands::Hook {
            repo,
            output,
            quiet,
        } => {
            let repo_path = resolve_repo_path(repo)?;
            handle_post_receive_stdin(&repo_path, output.as_deref(), quiet)
                .with_context(|| format!("Failed to execute post-receive hook for {}", repo_path.display()))?;
        }

        Commands::Update {
            path,
            output,
            quiet,
        } => {
            run_hook_update(&path, output.as_deref(), quiet)
                .with_context(|| format!("Failed to update repository at {}", path.display()))?;
        }

        Commands::Export {
            repo_path,
            output_dir,
            frontend_dist,
            base_url,
            no_objects,
        } => {
            let options = ExportOptions {
                frontend_dist,
                base_url,
                no_objects,
            };
            export_static_site(&repo_path, &output_dir, &options)
                .with_context(|| format!("Failed to export static site to {}", output_dir.display()))?;
            eprintln!(
                "[sendforge] Successfully exported static site to {}",
                output_dir.display()
            );
        }

        Commands::Serve {
            serve_dir,
            port,
            host,
            cors,
            spa,
        } => {
            let target_dir = serve_dir.unwrap_or_else(|| PathBuf::from("."));
            let options = ServerOptions {
                host,
                port,
                cors,
                spa,
            };
            run_server(&target_dir, &options)
                .with_context(|| format!("Static HTTP server error serving {}", target_dir.display()))?;
        }
    }

    Ok(())
}
