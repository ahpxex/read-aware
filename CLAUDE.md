## Project Context

- Product: `RadAware`
- Type: AI-native reading application
- Core capability: context-rich reading and AI-assisted understanding
- Runtime shell: `Tauri`
- Frontend: `React 19`
- Styling: `Tailwind CSS v4` (tokens via `@theme` in `src/index.css`)
- State management: `Jotai`
- Bundler: `Vite`
- Package manager: `bun`

## AI Architecture Decisions

- Product architecture: single-agent system
- User experience: one persistent chat surface, not multiple conversation windows like ChatGPT
- System model: memory-first, not transcript-first
- Agent backend: `Python + LangGraph`
- Frontend app shell: `React + TypeScript + Tauri`
- Primary database: `Postgres`
- Semantic memory retrieval layer: `Qdrant`

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
- User-visible chat should feel continuous, but the backend should not rely on dumping all prior messages into the prompt
- Treat chat transcripts as raw source material, not as the memory layer itself
- Memory should be modeled in layers:
  - raw events
  - working memory
  - long-term user memory
  - book / highlight / note memory
  - exportable context bundles
- Memory retrieval should consider more than semantic similarity, including:
  - relevance to the current reading goal
  - recency
  - importance
  - explicit user feedback
  - repeated appearance across books or conversations

### Storage Responsibilities

- `Postgres` is the source of truth for structured application data:
  - users
  - books
  - highlights
  - notes
  - chat events
  - memory metadata
  - context bundle versions
- `Qdrant` is used for semantic retrieval over memories and reading artifacts
- Do not treat the vector store as the primary database

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

The component library lives in `src/components/` with co-located Storybook stories. Run `bun run storybook` to browse.

### Design Tokens

Defined in `src/index.css` via `@theme` block:
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

Import from `src/components` barrel: `import { Button, Card, Display } from "./components";`

### Utility

Use `cn()` from `src/components/lib/cn.ts` for className composition (clsx + tailwind-merge).

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

```
src/
  components/          # Design system (shared, reusable)
    typography/        # Display, Heading, Body, Eyebrow, Caption
    lib/cn.ts          # clsx + tailwind-merge utility
    docs/              # Storybook MDX guidelines
    index.ts           # Barrel export
  features/            # Feature modules (domain-specific)
    shelf/             # Book collection / library view
    reader/            # Reading experience
    context/           # AI-assisted context panel
    notes/             # User annotations
    settings/          # Preferences
    navigation/        # App-level nav
    library/           # Content management
  stories/             # Interface composition stories (fullscreen mockups)
  state/               # Jotai atoms
    ui.ts              # UI state (active nav, etc.)
```

## Conventions

- Components use `forwardRef` for form controls, plain functions for everything else
- Polymorphic components use `as` prop with `ElementType` + `ComponentPropsWithRef`
- All interactive components must be keyboard-navigable with proper ARIA
- Stories co-located next to components: `Component.stories.tsx`
- Storybook hierarchy: `Design System/Components/...`, `Design System/Guidelines/...`, `Interface/...`
