# DCC - DCS Campaign Creator

This repository is a Germany Cold War / Escalation fork of DCC.

DCC is an Electron desktop app for building and managing DCS World campaigns.
It combines a campaign planning UI, map-based operations tooling, shared DCS
data packages, and mission generation logic in one TypeScript monorepo.

## What It Does

- Build and manage campaign state in a desktop app
- Visualize campaign data in a React-based map interface
- Generate DCS mission content from shared contracts and domain data
- Package mission data into `.miz`-compatible output
- Optionally use AI-assisted mission planning inside the app settings

## Stack

- Electron for the desktop shell and main process
- React 19 and Vite for the renderer apps
- TypeScript across apps and shared packages
- ORPC and Zod for typed client/server contracts
- TanStack Query and XState Store for frontend state flows
- MapLibre GL and Turf.js for map rendering and spatial logic
- Turborepo for workspace task orchestration
- Bun as the package manager/runtime entrypoint

## Workspace Layout

```text
apps/
  core/       Electron main process, window lifecycle, backend APIs
  campaign/   Primary renderer for campaign planning and map workflows
  document/   Secondary renderer for document/reference views

packages/
  contracts/    Shared ORPC contracts and Zod schemas
  data/         Static DCS data such as aircraft, factions, theatres, scenarios
  generate-miz/ Mission assembly pipeline for `.miz` output
  lua-table/    Lua table parser/stringifier utilities
```

## Getting Started

On Windows, clone this repo and double-click `install.bat`. That installs
[Bun](https://bun.sh/), downloads dependencies, fetches the Germany campaign
map (~1 GB, not stored on GitHub), and builds `dist\win-unpacked\dcc.exe`.

DCS World must already be installed. On first launch, pick the game folder
that contains `bin\DCS.exe` (not Saved Games).

Manual steps (no `.bat`) are in
`INSTALL (if you don't want to run the .bat).txt`.

### Prerequisites

- [Bun](https://bun.sh/) 1.3+
- Node.js 20+
- Windows 10 or 11 to use `install.bat` / the packaged `dcc.exe`

### Install

```bash
bun install
```

Germany campaign map (only if the file is not already on disk):

```bash
bun run cache:map
```

### Run In Development

This starts the Electron app plus the renderer dev servers through Turborepo.

```bash
bun run dev
```

Renderer dev servers:

- Campaign UI: `http://localhost:5173`
- Document UI: `http://localhost:5174`

### Build

Build all apps and packages:

```bash
bun run build
```

Package desktop builds:

```bash
# Windows
bun run build:win

# macOS
bun run build:mac

# Linux
bun run build:linux

# Unpacked directory only
bun run build:unpack
```

## Quality Checks

```bash
bun run lint
bun run lint:fix
bun run tsc
```

## Mission Generator Notes

The core app supports AI-backed mission planning. API keys are configured inside
the application settings rather than through required repo-level environment
variables. The current code supports OpenAI, Anthropic, and OpenRouter-backed
models.

## Architecture

1. The `campaign` renderer collects user input and drives campaign workflows.
2. Shared contracts from `@dcc/contracts` define the typed request/response boundary.
3. The Electron `core` app handles orchestration and backend operations.
4. Domain data from `@dcc/data` and generation logic from `@dcc/generate-miz`
   are used to assemble mission output.
5. Lua-oriented serialization helpers from `@dcc/lua-table` support DCS file generation.

## License

MIT. See [LICENSE](./LICENSE).
