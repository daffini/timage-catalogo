---
name: build-and-dev
description: Build, dev, and packaging commands for Timage Catalog. Covers npm scripts, dev workflow, building for distribution. Use when asked about building, running, dev, packaging, or distribution.
---

# Timage Catalog — Build & Dev

## Prerequisites

- Node.js 18+
- npm

## Install

```bash
npm install
```

## Development

```bash
npm run dev
```

This runs `vite build --watch` (auto-rebuild on changes) and `electron .` simultaneously.

For faster iteration on the renderer only:
```bash
npx vite build --watch
```

Then in another terminal:
```bash
npx electron .
```

Build output goes to `dist/`. The `main.js` Electron process loads `dist/index.html` if it exists, otherwise falls back to `src/index.html`.

DevTools open automatically in development (`app.isPackaged === false`).

## Production Build

### Windows (portable .exe)
```bash
npm run build:win
```
Output: `dist-electron/Timage Catalog.exe` (portable, no installer needed)

### macOS
```bash
npm run build:mac
```
Output: `dist-electron/Timage Catalog.dmg`

### Linux
```bash
npm run build:linux
```
Output: `dist-electron/Timage Catalog.AppImage`

### Manual renderer build
```bash
npm run build:renderer
```

## Build Details

- **electron-builder** packages `dist/` (Vite output), `main.js`, `preload.js`, and `assets/`
- Data files are bundled via `extraResources` from `data/` → `data/` in the packaged app
- `main.js` resolves data path: first `process.resourcesPath/data`, then `__dirname/data`
- Vite config: root is `src/`, output to `dist/`, copies Draco decoders from `src/draco/`

## Debugging

- Renderer `console.log` is relayed to the terminal with `[RENDERER LOG]` prefix
- Open DevTools manually via `Ctrl+Shift+I` in the running app (toggle `mainWindow.webContents.openDevTools()` in `main.js` if needed)
