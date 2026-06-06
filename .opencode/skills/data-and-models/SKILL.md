---
name: data-and-models
description: Data format and 3D model preparation for Timage Catalog. Covers catalog.json, groups.json, parts.json, SVG annotations, and glTF model requirements. Use when working with data files, adding models, or preparing 3D assets.
---

# Timage Catalog — Data & Models

## Catalog Index: `data/catalog.json`

```json
{
  "models": [
    {
      "serial": "M.VRTX.CLSR.000012",
      "name": "CT PACK",
      "rev": "1.3",
      "client": "",
      "languages": ["it", "es"],
      "3dModel": "3d/M.VRTX.CLSR.000012.glb",
      "version": ""
    }
  ]
}
```

- `serial`: unique identifier, used as folder name under `data/models/`
- `3dModel`: path relative to the model folder
- `languages`: UI language list (`it` must be first as default)

## Per-Model Data: `data/models/<serial>/`

```
models/<serial>/
├── parts.json           # All spare parts (array)
├── groups.json          # Hierarchy: sections → groups → tables
├── translations.json    # UI labels translations
├── 3d/<model>.glb       # 3D model (glTF Binary, Draco-compressed)
└── svp/                 # SVG exploded-view drawings
```

### `groups.json`

```json
{
  "sections": [
    {
      "id": "SEZ-01",
      "name": { "it": "TRASPORTO SCATOLE", "es": "TRANSPORTE CAJAS" },
      "3dNode": "G.TRSP.LNCT.000035",
      "groups": [
        {
          "id": "G.TRSP.LNCT.000035",
          "code": "G.TRSP.LNCT.000035",
          "name": { "it": "NASTRO LANCIATORE SCATOLE", ... },
          "3dNode": "G.TRSP.LNCT.000035",
          "tables": [
            "G.TRSP.LNCT.000035_00_12",   // cover page
            "G.TRSP.LNCT.000035_01_12",   // detail page 1
            ...
          ]
        }
      ]
    }
  ]
}
```

- `3dNode` (optional): maps the catalog section/group to a node in the glTF model
- `tables`: SVG filenames (without `.svg`), format: `<groupCode>_<page>_<total>.svg`
  - `_00_<total>` = cover page (hidden from tree, only shown in strip)
  - `_01_<total>`+ = detail pages

### `parts.json`

Array of part objects:

```json
{
  "code": "C.ANEL.SGST.000017",
  "description": { "it": "SEEGER", "es": "SEEGER" },
  "extraCode": "Seeger per esterni D=20 UNI 7435-75 INOX",
  "quantity": 3,
  "dimensions": "D=20 UNI 7435-75 INOX",
  "group": "G.TRSP.LNCT.000035",
  "section": "SEZ-01",
  "table": 2,
  "id": 0,
  "maintenance": ""
}
```

- `table`: 1-based index into the detail tables of the group (`_01_` = 1, `_02_` = 2, etc.)
- `group`: must match a `code` in `groups.json`
- `code`: naming convention `X.XXXX.XXXX.NNNNNN` (e.g., `C.ANEL.SGST.000017`)
- Parts with code starting with `TAV-` are table references (filtered out from 3D tree)

## SVG Annotations

SVG files can have annotated paths for interactive piece highlighting:

```svg
<path data-piece-id="0" data-piece-name="1" data-piece-color="#E6194B" data-piece-category="bolts" ... d="..." />
```

- `data-piece-id`: unique numeric ID (0-based, corresponds to index in parts array)
- `data-piece-name`: position number (as shown in the drawing balloon)
- `data-piece-color`: color for the piece in the drawing
- `data-piece-category`: category (bolts, standard, etc.)

The viewer creates invisible hit areas (rect) over each piece's bbox for click/hover.

Interactive text elements (no annotation needed):
- `TAV-<group>.<code>.<page>/<total>` → navigates to that table page
- `NN` (2-digit number) → navigates to that section
- `X.XXXX.XXXX.NNNNNN` → navigates to that group

### SVG filename convention

`<groupCode>_<page>_<totalPages>.svg`

- `G.TRSP.LNCT.000035_00_12.svg` = page 0 (cover) of 12 for group `G.TRSP.LNCT.000035`
- `G.TRSP.LNCT.000035_01_12.svg` = page 1 (first detail) of 12
- `layout.svg` = machine overview layout

## 3D Model Requirements

### Format
- **glTF Binary (.glb)** with **Draco compression** or **meshopt compression**
- Decoders: `src/draco/` (copied to `dist/draco/` at build time)

### Node naming
- Node names in the glTF must match (or fuzzy-match) part codes from `parts.json`
- Fuzzy matching: dots, dashes, and spaces are removed; case is folded
  - e.g., `C.ANEL.SGST.000017` matches node named `CANELSGS T000017` or `C.ANEL.SGST.000017`
- Group nodes should use the `3dNode` value from `groups.json` (or fall back to `code`)

### Scene structure (recommended)

```
gltf.scene
  └── Root (real root of CAD — found by _findRealRoot)
       ├── Container_A  (physical container for section A)
       │   ├── Group_1  (3dNode match)
       │   │   ├── Part_A (mesh named with part code)
       │   │   └── Part_B (mesh named with part code)
       │   └── Group_2
       │       └── Part_C
       └── Container_B  (physical container for section B)
           └── ...
```

### Material handling
- All materials are converted to `MeshLambertMaterial` (neutral gray `#bfbfbf`) at load time
- No PBR, no roughness/metalness maps (performance optimization)
- Hover: amber (`#f3b54a`)
- Selection: orange (`#ff6600`)
- Ghost context: 5% opacity gray (`#999999`)

### Export tips
- Export from CAD using glTF 2.0 with Draco compression
- Keep node names matching final part codes
- Use meshopt decoder (preferred) or Draco JS decoder
- Avoid very deep hierarchies (3–4 levels ideal)
