# ReadAware

ReadAware is the web client for an AI-native reading experience built with React, TypeScript, Vite, and Bun.

## Development

- `bun install`
- `bun dev`
- `bun build`
- `bun run storybook`

## Cloudflare Pages

- Build command: `bun run build`
- Build output directory: `dist`
- Local Pages preview: `bun run preview`

The default build uses Nitro's `cloudflare_pages` preset and emits `dist/_worker.js`
plus the static assets Cloudflare Pages expects.
