# DCC Project Germany

This is a personal **mod** of [Digital Crew Chief (DCC)](https://web.digitalcrewchief.at/) made by [Samuelblew](https://github.com/Samuelblew).

I do **not** claim credit for creating DCC. I changed and extended an existing program to fit a Germany Cold War / Escalation campaign. Almost all of the app — campaign planning, the map, mission generation, factions, and the DCS `.miz` pipeline — comes from the original DCC team.

## Credits

DCC was originally created by **[Kilcekru](https://github.com/Kilcekru/dcc)**.

The current official project is **[Digital Crew Chief](https://web.digitalcrewchief.at/)**, maintained by **[rhyver](https://codeberg.org/rhyver/dcc)** on Codeberg.

This repository is an unofficial personal fork. If you want the stock DCC experience, use the official site and the Codeberg repo above.

## What is DCC?

DCC (Digital Crew Chief) is an Electron desktop app for building and managing [DCS World](https://www.digitalcombatsimulator.com/) campaigns. You pick a scenario and factions, the campaign runs on a map, both sides fly and fight over time, and you can jump into a planned flight and export it as a DCS mission.

It combines a campaign planning UI, map-based operations tooling, shared DCS data packages, and mission generation logic in one TypeScript monorepo.

- Build and manage campaign state in a desktop app
- Visualize campaign data in a React-based map interface
- Generate DCS mission content from shared contracts and domain data
- Package mission data into `.miz`-compatible output
- Optionally use AI-assisted mission planning inside the app settings

This mod keeps that workflow and adds a Cold War Germany theatre (Fulda Gap), era escalation, and related campaign changes.

## Installation

You need **Windows 10 or 11**, **DCS World already installed**, internet for the first setup, and about **3 GB** free (dependencies plus the Germany map).

The Germany campaign map is about **1 GB** and is **not** stored on GitHub. Either install path below downloads it.

On first launch, point DCC at your DCS World folder: the one that contains `bin\DCS.exe` (not Saved Games).

After a successful build, you do not need commands day to day. Open:

```text
dist\win-unpacked\dcc.exe
```

### Optional: `install.bat`

Running `install.bat` is **optional**. It is only a shortcut. Double-click it if you want the script to install [Bun](https://bun.sh/), download dependencies, fetch the Germany map, and build `dcc.exe` for you.

If Windows blocks the `.bat`, right-click it and choose Run anyway.

### Manual install (no `.bat`)

The same steps are also written in
`INSTALL (if you don't want to run the .bat).txt`.

1. Install [Bun](https://bun.sh/) 1.3+ (Node.js 20+ is also useful for some tooling).

   ```powershell
   powershell -ExecutionPolicy Bypass -Command "irm https://bun.sh/install.ps1 | iex"
   ```

   Close the terminal and open a new one so Bun is on PATH.

2. Open a terminal in this folder and install dependencies:

   ```bash
   bun install
   ```

3. Download the Germany campaign map (the map background in the app, not DCS terrain). Skip this if the file is already on disk:

   ```bash
   bun run cache:map
   ```

4. Build and launch:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/build-local.ps1
   ```

   Output: `dist\win-unpacked\dcc.exe`

Run `install.bat` or the build script again only when the code changed and you want a new build. Close DCC first, or the build cannot replace `dcc.exe`.

### If something fails

- `bun is not recognized`: the terminal was opened before Bun was installed. Close it and open a new one.
- Blank Germany map: run `bun run cache:map` and build again.
- DCS not found: the correct folder is the game install (with `bin\DCS.exe`), not `Saved Games\DCS`.
- Out of disk space or a dropped connection during `cache:map`: run the same command again.

AI keys (OpenAI and so on), if you use them, go in DCC settings. They are not in this repository.

## Run in development

This starts the Electron app plus the renderer dev servers through Turborepo.

```bash
bun run dev
```

Renderer dev servers:

- Campaign UI: `http://localhost:5173`
- Document UI: `http://localhost:5174`

## Build

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

## Stack

- Electron for the desktop shell and main process
- React 19 and Vite for the renderer apps
- TypeScript across apps and shared packages
- ORPC and Zod for typed client/server contracts
- TanStack Query and XState Store for frontend state flows
- MapLibre GL and Turf.js for map rendering and spatial logic
- Turborepo for workspace task orchestration
- Bun as the package manager/runtime entrypoint

## Workspace layout

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

## Quality checks

```bash
bun run lint
bun run lint:fix
bun run tsc
```

## Mission generator notes

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

MIT. See [LICENSE](./LICENSE). Copyright for the original DCC belongs to [digitalcrewchief.at](https://web.digitalcrewchief.at/).
