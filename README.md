# ReadAware

ReadAware is an AI-native reading experience. This repository is a **monorepo**
managed by [Turborepo](https://turbo.build/) over [bun](https://bun.sh/)
workspaces.

## Workspaces

| Path                | Package              | Description                                              |
| ------------------- | -------------------- | ------------------------------------------------------- |
| `apps/web`          | `@read-aware/web`    | React 19 + TanStack Router SPA (Vite, Tailwind v4)      |
| `apps/desktop`      | `@read-aware/desktop`| Tauri 2 desktop shell that wraps the web frontend       |
| `packages/tsconfig` | `@read-aware/tsconfig`| Shared TypeScript base config                          |

## Development

Run everything from the repo root:

- `bun install` — install all workspace dependencies
- `bun run dev` — start the web app (Vite, http://localhost:5173)
- `bun run dev:desktop` — start the Tauri desktop app (auto-starts the web dev server)
- `bun run build` — build the web app (`vite build` + `tsc --noEmit`)
- `bun run build:desktop` — build native desktop installers
- `bun run storybook` — browse the design system

## Desktop (Tauri)

The desktop app requires the Rust toolchain and platform build dependencies — see
[`apps/desktop/README.md`](apps/desktop/README.md). In development Tauri loads the
web dev server; in production it bundles the static `apps/web/dist` build.
