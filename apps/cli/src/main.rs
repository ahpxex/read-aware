//! `ra` — headless ReadAware without the agent.
//!
//! Reads and writes the desktop app's library and imports books, through the
//! same store the app runs (`read-aware-store`): the same schema, event log,
//! projections and import pipeline. It works whether or not the app is
//! running; a running app notices its writes and refreshes.
mod commands;
mod library;
mod output;

use clap::{Parser, Subcommand};
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser)]
#[command(
    name = "ra",
    version,
    about = "Headless ReadAware: read the library and import books"
)]
struct Cli {
    /// Library directory (default: the desktop app's, or $READAWARE_DATA_DIR)
    #[arg(long, global = true, value_name = "PATH", conflicts_with = "dev")]
    data_dir: Option<PathBuf>,
    /// Use the development build's library
    #[arg(long, global = true)]
    dev: bool,
    /// Print machine-readable JSON instead of text
    #[arg(long, global = true)]
    json: bool,
    /// Log diagnostics to stderr (-vv for more)
    #[arg(short, long, global = true, action = clap::ArgAction::Count)]
    verbose: u8,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Books on the shelf
    #[command(subcommand)]
    Books(BooksCommand),
    /// Import book files into the library
    Import {
        /// Book files (EPUB, PDF, MOBI/AZW3, FB2, CBZ/CBR, TXT, HTML)
        #[arg(required = true, value_name = "FILE")]
        files: Vec<PathBuf>,
    },
    /// Create a new, empty library in the library directory
    Init,
}

#[derive(Subcommand)]
enum BooksCommand {
    /// List every book
    List,
    /// Show one book by id (or a unique id prefix)
    Show { id: String },
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    output::init_logging(cli.verbose);
    let out = output::Output { json: cli.json };
    let dir = match library::resolve_dir(cli.data_dir.as_deref(), cli.dev) {
        Ok(dir) => dir,
        Err(error) => return out.fail(&error),
    };
    let result = match cli.command {
        Command::Books(BooksCommand::List) => commands::books_list(&dir, &out),
        Command::Books(BooksCommand::Show { id }) => commands::books_show(&dir, &id, &out),
        Command::Import { files } => commands::import(&dir, &files, &out),
        Command::Init => commands::init(&dir, &out),
    };
    match result {
        Ok(code) => code,
        Err(error) => out.fail(&error),
    }
}
