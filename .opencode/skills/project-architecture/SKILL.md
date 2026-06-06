---
name: project-architecture
description: Project architecture and module structure for Timage Catalog. Describes the Electron + Three.js app layout, key classes, and module responsibilities. Use when the user asks about architecture, structure, modules, classes, or how the app is organized.
---

# Timage Catalog — Architecture

Electron desktop app (Windows/Mac/Linux) for browsing spare parts catalogs in 3D and 2D exploded-view SVG.

## Tech Stack

- **Electron** (main/renderer process, `contextIsolation: true`)
- **Three.js** (3D viewer via WebGL)
- **Vite** (bundler for the renderer)
- **No framework** — vanilla JS modules
- **Data** — JSON files on the filesystem loaded via IPC

## File Layout

```
timage-catalog/
├── main.js                    # Electron main process
├── preload.js                 # Context bridge (catalog.* API)
├── vite.config.js             # Vite bundler config
├── package.json               # Electron + Three.js deps
├── data/                      # Catalog data (shipped with app)
│   ├── catalog.json           # Model index
│   └── models/<serial>/       # One folder per machine
│       ├── parts.json         # All spare parts
│       ├── groups.json        # Sections/groups/tables hierarchy
│       ├── translations.json  # UI translations
│       ├── 3d/<model>.glb     # 3D model (glTF Binary)
│       └── svg/               # Exploded-view SVG files
├── src/                       # Renderer source (Vite root)
│   ├── index.html             # Main layout
│   ├── css/app.css            # All styles
│   ├── components/
│   │   └── tree-nav.js        # TreeNav component
│   └── js/
│       ├── app.js             # Main App orchestrator
│       ├── catalog.js         # CatalogManager (data layer)
│       ├── viewer-3d.js       # Viewer3D (Three.js)
│       ├── viewer-svg.js      # SvgViewer (pan/zoom/annotations)
│       ├── cart.js            # Cart (order management)
│       ├── search.js          # SearchManager
│       └── splitter.js        # Sidebar splitter
├── dist/                      # Vite build output
└── dist-electron/             # electron-builder output
```

## Key Classes

### App (`src/js/app.js`)
Orchestrator. Creates all sub-modules, binds events, manages navigation history and view switching (3D vs Esplosi).

| Method | Purpose |
|---|---|
| `init()` | Load catalog, build tree, init 3D, bind events |
| `switchView(view)` | Toggle between '3d' and 'tree' (esplosi) views |
| `onTreeSelect(node)` | Navigate tree: machine/section/group/table/part |
| `go3DBack()` / `reset3DView()` | 3D navigation history |

### CatalogManager (`src/js/catalog.js`)
Data layer. Loads JSON via IPC, builds indexes.

| Method | Purpose |
|---|---|
| `init()` | Load `catalog.json`, pick first model |
| `loadModel(serial)` | Load `parts.json`, `groups.json`, `translations.json` |
| `getTreeData()` / `getTreeData3D()` | Build flat tree for Esplosi / 3D view |
| `getTreeDataNested()` / `getTreeData3DNested()` | Build nested tree |
| `getPartsForGroup(code)` | Look up parts by group |
| `getPartsForTable(tableId)` | Look up parts by table |
| `getTablesForGroup(groupId)` | Look up tables for a group |

### Viewer3D (`src/js/viewer-3d.js`)
Three.js 3D viewer. Loads glTF/GLB, provides hierarchical navigation (root → section → group → part).

Key features:
- **Grayscale rendering** — all materials converted to `MeshLambertMaterial` (neutral gray)
- **Ghost/transparency** — context parts at 5% opacity, selected parts opaque
- **Hover** — amber highlight via shared `_hoverMaterial`
- **Click/select** — orange highlight via `_highlightParts`
- **Navigation levels**: `root` (full machine) → `section` (isolates one section) → `group` (isolates group, ghosts context)
- **Part lookup** — fuzzy name matching (ignores dots/dashes/case)
- **Camera animation** — `_animateCamera()` with `easeOutQuad`
- **Tooltip** — shows part code/description on hover

### SvgViewer (`src/js/viewer-svg.js`)
2D SVG exploded-view viewer. Pan/zoom via mouse wheel + drag.

Key features:
- **Annotated SVG** — paths with `data-piece-id`, `data-piece-name`, `data-piece-color`, `data-piece-category`
- **Best-fit click/hover** — when overlapping pieces, picks smallest bbox
- **Interactive text** — `TAV-*`, section numbers, group codes are clickable for navigation
- **Thumbnail extraction** — `_renderPieceThumbnail()` extracts single part from SVG

### Cart (`src/js/cart.js`)
Order management. Adds/removes parts, persists to localStorage. Exports to CSV/HTML/print.

### TreeNav (`src/components/tree-nav.js`)
Recursive tree component. Supports two modes:
- **Flat** — Machine → Section → Group → Table/Part
- **Nested** — Sub-groups nested inside parent groups (accordion behavior)

## IPC API (via `window.catalog.*`)

| Method | Returns | Purpose |
|---|---|---|
| `readJson(path)` | `object` | Read JSON from data folder |
| `readSvg(path)` | `string` | Read SVG as text |
| `resolveDataPath(path)` | `string` | Absolute path for file:// URL |
| `getDataPath()` | `string` | Base data directory |
| `listModels()` | `string[]` | List available model serials |
| `saveFile(options)` | `string\|null` | Save dialog + write file |
| `saveBinary(options)` | `string\|null` | Save dialog + write binary |

## View Navigation Flow

```
root (machine)
  └── section
       ├── group
       │    ├── part (3D view — tree leaf)
       │    └── table (Esplosi view — tree leaf: SVG page)
       └── (sub-group in nested view)
```

- **3D view**: tree shows Section → Group → Part; click part to highlight in 3D
- **Esplosi view**: tree shows Section → Group → Table; click table to load SVG
