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
