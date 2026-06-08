## Project Context

- Product: `ReadAware`
- Type: AI-native reading application
- Core capability: context-rich reading and AI-assisted understanding
- Repo: `monorepo` managed by `Turborepo` over `bun` workspaces (`apps/*`, `packages/*`)
- Runtime shells: `Web browser / PWA` and a `Tauri` desktop app that wraps the same web frontend
- Frontend: `React 19` as a client-rendered SPA (no SSR)
- Routing: `TanStack Router` (file-based, via the Vite router plugin)
- Styling: `Tailwind CSS v4` (tokens via `@theme` in `apps/web/src/index.css`)
- State management: `Jotai`
- Bundler: `Vite`
- Package manager: `bun`

## AI Architecture Decisions

> **Implementation status:** The codebase is currently a frontend-only monorepo
> (`apps/web` + `apps/desktop`); the Python backend has been removed. The
> sections below are **decided direction** (local-first), not mere aspiration —
> but most of the data/memory layer is not built yet.

- Product architecture: single-agent system (one orchestrator over deterministic pipelines, not one LLM loop doing everything)
- User experience: one persistent chat surface, not multiple conversation windows like ChatGPT
- System model: memory-first, not transcript-first
- Deployment model: **local-first** — data and retrieval live on-device; the remote backend is a sync/relay layer, not where business logic lives
- Two independent axes — keep them separate:
  - **Data + retrieval: local** (on-device store + embedded vector search)
  - **LLM inference: remote** (BYO API key or a thin proxy; no local model required)
- Frontend app shells: `React + TypeScript` web SPA + `Tauri` desktop wrapper (desktop-first)
- On-device storage: `SQLite` (source of truth) + `LanceDB` (embedded vector store)
- Remote backend: sync + relay only (see Storage Responsibilities)

### Agent Model

- ReadAware uses one core agent that orchestrates the product's intelligence
- This agent is responsible for:
  - building and updating the user's profile
  - updating user memory over time
  - retrieving relevant book notes, highlights, and prior conversations
  - assembling the right context for the current reading moment
- Do not model the product as multiple user-visible agents unless the product direction explicitly changes

### Memory and Context

- The core system problem is memory management, not chat history management
- User-visible chat should feel continuous, but the system should not rely on dumping all prior messages into the prompt
- Treat chat transcripts as raw source material, not as the memory layer itself
- Memory is **event-sourced**. Model it in layers:
  - `raw events` — append-only, immutable; **this is the unit of sync** (see Storage Responsibilities)
  - working memory — local projection
  - long-term user memory — local projection
  - book / highlight / note memory — local projection
  - exportable context bundles — local projection
- Everything above `raw events` is a **local projection rebuilt from the event log** — projections are recomputed on-device, never synced directly
- Design the **write / consolidation pipeline** as explicitly as retrieval; it is the harder half:
  - promotion from raw events into long-term memory (summarization / consolidation)
  - conflict resolution when new information contradicts old memory
  - decay / forgetting so memory does not grow into noise
  - dedup / entity resolution behind "repeated appearance across books or conversations"
- Memory retrieval should consider more than semantic similarity, including:
  - relevance to the current reading goal
  - recency
  - importance
  - explicit user feedback
  - repeated appearance across books or conversations

### Storage Responsibilities

- On-device `SQLite` is the source of truth for structured application data:
  - users / profile
  - books
  - highlights
  - notes
  - raw events (the append-only log)
  - memory metadata
  - context bundle versions
- On-device `LanceDB` is the embedded vector store for semantic retrieval over memories and reading artifacts
- Do not treat the vector store as the primary database; vectors are a derived index, rebuilt on-device from the event log / SQLite
- The remote backend is **sync + relay only**, never a source of truth. Its only jobs:
  - identity / auth
  - durable storage of the (preferably E2E-encrypted) event log + large blobs (book files, derivatives) for multi-device merge and new-device bootstrap
  - a change feed to sync event logs across devices
  - optionally, an LLM proxy (to hide / meter API keys)
- The backend holds no business logic — consolidation, retrieval, and bundle assembly all run on-device
- Reach storage through a pluggable `StorageAdapter` (native filesystem on desktop; OPFS / wa-sqlite in the browser) so the same engine can later run in a web client

### Context Portability

- Context must be dynamically updatable
- Context must be exportable at any time
- Exported context should be usable by external agents or systems
- Prefer structured context bundles over ad hoc prompt strings
- Likely bundle types include:
  - `user_profile_context`
  - `reading_intent_context`
  - `book_memory_context`
  - `conversation_insights_context`

### Platform Direction

- **Local-first**: the app must be fully usable offline against on-device data; the network is for sync and (optional) remote inference, not for core reads/writes
- **Desktop-first**: target the Tauri desktop app first; the web SPA is a secondary shell that shares the same frontend and (eventually) the same engine via a WASM `StorageAdapter`
- Conscious tradeoff — **E2E encryption vs a server-backed web client**: end-to-end encrypting synced data means the server cannot hold a cloud replica or run server-side search to feed a thin web client. Default to E2E-friendly design; revisit only if a richer web client becomes a priority
- Do not use no-code / visual agent platforms as the core product architecture
- Keep the AI layer code-first and product-native
- Prefer explicit state, explicit memory writes, and explicit retrieval pipelines over opaque agent magic

### Reader Engine Strategy

- Primary reading engines:
  - `epub.js` for EPUB rendering and navigation
  - `pdf.js` for PDF rendering and text selection
- Secondary formats:
  - Accept `.mobi` and `.azw3` via ingestion and conversion to normalized EPUB using Calibre `ebook-convert`
- Conversion boundaries:
  - Do not convert EPUB <-> PDF
  - Keep both original source files and normalized derivatives
  - Surface DRM-protected files as unsupported with explicit UX messaging

## Design System

The component library lives in `apps/web/src/components/` with co-located Storybook stories. Run `bun run storybook` to browse.

### Design Tokens

Defined in `apps/web/src/index.css` via `@theme` block:
- Colors: `paper`, `paper-warm`, `border` (plus Tailwind's built-in `stone-*` palette)
- Fonts: `sans` (Inter), `serif`, `mono`
- Sizes: `text-eyebrow` (11px), `text-caption` (12px)
- Tracking: `tracking-eyebrow` (0.28em)
- Leading: `leading-display` (0.98), `leading-body` (2rem)

### Component Library

Always use these components instead of raw HTML + Tailwind classes:

**Typography:** `Display`, `Heading`, `Body`, `Eyebrow`, `Caption`
**Form controls:** `TextField`, `TextArea`, `Select`, `Checkbox`, `Radio`, `Toggle`
**Buttons:** `Button` (solid/outline/ghost/link/danger), `IconButton`
**Navigation:** `NavItem`, `Breadcrumb`, `Tabs`
**Data display:** `Avatar`, `Badge`, `Tag`, `Kbd`, `DefinitionList`, `Progress`, `Skeleton`, `Spinner`
**Layout:** `Stack`, `Divider`, `Card` (compound: Header/Body/Footer)
**Feedback:** `Alert`, `EmptyState`, `Tooltip`
**Overlays:** `Dialog`, `Sidebar`, `DropdownMenu`, `Popover`, `Accordion`

Import from the `components` barrel (within `apps/web/src`): `import { Button, Card, Display } from "./components";`

### Utility

Use `cn()` from `apps/web/src/components/lib/cn.ts` for className composition (clsx + tailwind-merge).

### Design Principles

- Editorial restraint: no gradients, no badges, no ornamental highlights
- Paper-toned canvas, monochrome stone palette, warm and quiet
- Typography carries hierarchy; the interface stays visually spare
- Serif for display, sans for everything else
- `stone-600` minimum for text on paper backgrounds (WCAG AA)

### Iconography Rule

- Use `@phosphor-icons/react` for all product UI icons
- Do not hand-draw inline SVG icons in feature or app code
- Keep icons functional and quiet (avoid decorative icon usage)

## Project Structure

Monorepo managed by Turborepo + bun workspaces. Commands run from the repo root:
`bun run dev` (web), `bun run dev:desktop` (Tauri), `bun run build`, `bun run storybook`.

```
read-aware/
  package.json         # workspace root: bun workspaces + turbo scripts
  turbo.json           # Turborepo task graph
  apps/
    web/               # React 19 + TanStack Router SPA (Vite)
      index.html       # SPA entry document
      vite.config.ts
      .storybook/      # Storybook config
      src/
        main.tsx       # SPA mount (createRoot + RouterProvider)
        router.tsx     # Router factory + type registration
        routes/        # File-based routes (__root.tsx, index.tsx)
        index.css      # Tailwind v4 @theme tokens
        components/    # Design system (shared, reusable)
          typography/  # Display, Heading, Body, Eyebrow, Caption
          lib/cn.ts    # clsx + tailwind-merge utility
          docs/        # Storybook MDX guidelines
          index.ts     # Barrel export
        features/      # Feature modules (domain-specific)
          shelf/       # Book collection / library view
          reader/      # Reading experience
          context/     # AI-assisted context panel
          notes/       # User annotations
          settings/    # Preferences
          navigation/  # App-level nav
          library/     # Content management
        state/         # Jotai atoms (ui.ts, local.ts)
    desktop/           # Tauri 2 desktop shell (wraps apps/web)
      src-tauri/       # Rust crate, tauri.conf.json, capabilities, icons
  packages/
    tsconfig/          # Shared TypeScript base config
```

Note: design-system imports inside `apps/web` use the `./components` barrel, e.g.
`import { Button, Card, Display } from "./components";`.

## Conventions

- Components use `forwardRef` for form controls, plain functions for everything else
- Polymorphic components use `as` prop with `ElementType` + `ComponentPropsWithRef`
- All interactive components must be keyboard-navigable with proper ARIA
- Stories co-located next to components: `Component.stories.tsx`
- Storybook hierarchy: `Design System/Components/...`, `Design System/Guidelines/...`, `Interface/...`

### Responsibility Boundaries

- Every file must have one clear responsibility. Do not let rendering, state orchestration, DOM measurement, async data flows, and pure data transforms accumulate in the same file.
- Components should focus on UI structure and prop composition. If a component starts owning non-trivial effects, async workflows, or cross-feature coordination, extract that logic into a hook.
- Hooks should own stateful client logic, browser APIs, subscriptions, measurements, and async orchestration. If the logic does not need React, it should not live in a hook.
- `lib/` and `utils/` modules should stay pure and reusable. Put formatting, derived data, mappers, and domain helpers there instead of inside components.
- Before adding new code to an existing file, first decide whether it belongs in a component, a hook, or a util. Prefer extraction over growing a mixed-responsibility file.
