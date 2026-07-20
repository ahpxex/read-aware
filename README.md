<div align="center">
  <img src="apps/landing/public/favicon.png" alt="ReadAware" width="72" height="72" />
  <h1>ReadAware</h1>
  <p><strong>Reading that remembers.</strong></p>
  <p>
    A modern, meticulously tuned reader with an agent that understands your
    books, your annotations, and the ideas you keep returning to.
  </p>
  <p>
    <a href="https://readaware.app">Website</a> ·
    <a href="https://github.com/ahpxex/read-aware/releases/latest">Download</a> ·
    <a href="https://discord.gg/whDrKXwHWU">Discord</a>
  </p>
  <p>
    English · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a>
  </p>
</div>

![A multilingual library in ReadAware](apps/landing/public/screenshots/shelf.webp)

## Read beautifully. Remember deeply.

ReadAware is a free and open-source reader for macOS, Windows, Linux, Android,
and iOS. It combines a carefully crafted reading experience with a built-in
agent that can use tools, answer questions in context, and build an evolving
memory from the books, passages, notes, and conversations that matter to you.

- **Stay with the sentence.** Sentence-by-sentence reading keeps the page calm,
  focused, and ADHD-friendly.
- **Mark things your way.** Underline, highlight, and write notes without
  breaking your reading flow.
- **Ask from the page.** Chat with AI about an unfamiliar passage, follow an
  idea further, or look up a word without leaving the book.
- **Keep words for later.** Annotate vocabulary as you read so it can become
  useful review material instead of a one-off lookup.
- **Make the page yours.** Switch languages, color themes, fonts, type sizes,
  spacing, and other reading settings.
- **See the habit forming.** Reading-time statistics make progress visible
  across books and sessions.
- **Bring almost any book.** EPUB, MOBI, AZW3, FB2, and PDF share one reading,
  selection, annotation, and progress model, with no format conversion.

<table>
  <tr>
    <td width="50%"><img src="apps/landing/public/screenshots/reader.webp" alt="ReadAware sentence-by-sentence reader" /></td>
    <td width="50%"><img src="apps/landing/public/screenshots/context.webp" alt="ReadAware context-aware assistant" /></td>
  </tr>
</table>

## Why it feels different

The interface has been tuned down to the pixel. The result is intentionally
quiet, coherent, and free of AI slop.

AI stays beside the reading experience rather than taking it over. The agent
can retrieve context, call tools, and update memory, while the page remains a
page: typography first, controls only when they are useful, and details that
reward long reading sessions.

## Platforms

| Platform | Status |
| --- | --- |
| macOS | Available |
| Android | Available |
| Windows | Available; broader real-world testing is welcome |
| Linux | Available; broader real-world testing is welcome |
| iOS | Supported; App Store distribution is not available yet |

Cross-device sync is planned. Today, ReadAware is local-first: books, reading
progress, annotations, conversations, and memory stay on the device, while
remote model inference remains optional and provider-controlled.

## How it works

ReadAware uses one agent to orchestrate retrieval, context assembly, tool use,
and memory updates. Chat transcripts are source material rather than the memory
system itself: durable context is built from the reader's ongoing trace across
books.

```text
ReadAware app
├── React interface          shelf, reader, annotations, chat, settings
├── Local agent runtime      tools, retrieval, context, memory updates
├── SQLite                   product data, event log, FTS, projections
└── Native filesystem        imported books and large blobs

Remote services
├── Model provider           optional inference through the reader's account
└── Sync relay               planned encrypted event and blob transport
```

The source of truth is local. Raw domain events form the syncable record;
memory and search state are rebuildable projections. Retrieval uses SQLite FTS
plus scope, recency, and importance signals rather than requiring a vector
database.

## Repository

ReadAware is a Bun workspace monorepo orchestrated by Turborepo.

| Path | Responsibility |
| --- | --- |
| `apps/web` | React 19 interface, TanStack Router, Jotai, Tailwind CSS v4 |
| `apps/desktop` | Tauri 2 shell and native storage/platform commands |
| `apps/landing` | Public website and release downloads |
| `packages/agent` | Agent runtime, model adapters, retrieval, and memory pipelines |
| `packages/core` | Domain entities, events, and storage contracts |
| `packages/ui` | Shared design system and co-located Storybook stories |

Architecture decisions and target data contracts live in
[`docs/agent-architecture.md`](docs/agent-architecture.md) and
[`docs/data-model.md`](docs/data-model.md).

## Run locally

Prerequisites: [Bun](https://bun.sh/), the Rust toolchain, and the native
dependencies required by Tauri for your platform.

```bash
bun install
bun run dev
```

Useful workspace commands:

| Command | Purpose |
| --- | --- |
| `bun run dev` | Run the Tauri app in development |
| `bun run dev:web` | Run only the UI shell in Vite |
| `bun run storybook` | Browse the design system and feature stories |
| `bun run typecheck` | Type-check all workspaces |
| `bun run build` | Build and type-check the application frontend |
| `bun run build:desktop` | Produce native desktop release bundles |
| `bun run build:landing` | Build the public website |

Product behavior must be verified in Tauri. A plain browser does not provide
the native IPC, SQLite, filesystem, book-blob, or production CSP paths used by
the shipped application.

## Releases

Version tags build macOS, Windows, Linux, and Android artifacts through
`.github/workflows/release.yml`. See the
[latest release](https://github.com/ahpxex/read-aware/releases/latest) for
current downloads and installation files.

## Community

Questions, ideas, bug reports, and reading stories are welcome on the
[ReadAware Discord](https://discord.gg/whDrKXwHWU).

## License

ReadAware is free and open source under the [MIT License](LICENSE).
