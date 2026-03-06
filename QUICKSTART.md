# Developer Quickstart

**Read this first.** It tells you everything you need to start building.

---

## What Is This

Partcraft is a browser-based STEP file viewer that we're extending into a STEP-to-PDF drawing generator. The user uploads a CAD file, the app renders it, classifies geometry, adds engineering dimensions, and exports a layered PDF. Think "free-to-view, pay-to-export" SaaS.

The app is **100% client-side** – no server, no build step, no framework. Just ES modules served by any HTTP server.

---

## Get Running

```bash
# 1. Clone / unzip the project
cd partcraft

# 2. Start a local server (pick one)
npx serve .
# or
python3 -m http.server 8000

# 3. Open http://localhost:3000 (or :8000)
# 4. Drop a .stp or .step file onto the upload area
```

You need a STEP file to test with. If you don't have one, any CAD community site (GrabCAD, etc.) has free ones. A simple bracket or plate with holes is ideal for testing all features.

---

## Project Structure

```
partcraft/
├── index.html          ← HTML shell, loads CDN libs then app module
├── css/styles.css      ← All styling (dark theme)
├── js/
│   ├── app.js          ← Entry point. Boot, STEP processing, events.
│   ├── state.js        ← All shared state. Read by everyone.
│   ├── scene.js        ← Three.js setup, cameras, views.
│   ├── classifier.js   ← Line/arc/circle detection algorithm.
│   ├── edges.js        ← Edge chaining + visualization.
│   ├── annotations.js  ← Ordinate dimensions + diameter callouts.
│   ├── display.js      ← Edge/face toggling, stats panel.
│   ├── math.js         ← Vector math (2D + 3D).
│   └── utils.js        ← Colors, logging, type coercion.
```

---

## How the Existing Code Works

**Data flow when a STEP file is loaded:**

```
file.arrayBuffer()
    → occt.ReadStepFile() → meshes with positions, normals, indices, brep_faces
        → THREE.BufferGeometry → solid mesh + random-color mesh
        → THREE.EdgesGeometry → raw edges
            → chainEdges() → continuous chains
                → findCorners() + splitAtCorners() → split at sharp angles
                    → classifyCurve() per chain → line / arc / circle
                        → stored in state.analysisResults
```

**Key globals** (all in `state.js`):
- `scene`, `orthoCamera`, `renderer`, `controls` – Three.js rendering
- `currentGroup` – THREE.Group containing the model
- `meshObjects.solid` / `.random` / `.geometry` – the actual mesh data
- `analysisResults.partcraft.curveDetails` – classified edge chains (THIS IS THE DATA YOU'LL PROJECT)
- `modelCenter`, `modelSize` – bounding box info

**The classifier** (`classifier.js`) uses perpendicular bisector circle fitting: take 3 points, find the unique circle through them, check if all other points lie on it. If yes → arc (or circle if closed). If no → line.

**Annotations** (`annotations.js`) work in 3D space. They build a `THREE.Group` with leader lines (4-point elbows), text sprites, and arrowheads. The calculation depends on the current view (front/top/left/right) which determines which axes map to horizontal/vertical.

---

## What You're Building

Six phases that stack on each other. **Build them in order.**

| Phase | What | New File(s) | Spec |
|-------|------|-------------|------|
| 1 | Sheet layout data model (page, viewports, title block) | `js/sheet.js` | `specs/01-SHEET-LAYOUT.md` |
| 2 | Capture 3D render as PNG | `js/export.js` | `specs/02-RASTER-CAPTURE.md` |
| 3 | Project 3D edges → 2D sheet coordinates | `js/projection.js` | `specs/03-VECTOR-PROJECTION.md` |
| 4 | Project annotations → 2D, refactor annotations.js | (updates) | `specs/04-DIMENSION-EXPORT.md` |
| 5 | Assemble everything into a layered PDF | `js/pdf.js` | `specs/05-PDF-ASSEMBLY.md` |
| 6 | Markup overlay (pen, text, rect, cloud, stamp) | `js/markup.js` | `specs/06-MARKUP-UI.md` |

Read `PROJECT_PLAN.md` for the full roadmap and `MODULE_CONTRACTS.md` for all interface definitions.

---

## Critical Things to Know

### THREE is a global, not an import

Three.js loads via `<script>` tag in index.html. All modules access it as the global `THREE`. Do NOT try to `import * as THREE` – it won't work with the CDN version.

Same for `occtimportjs` – it's a global.

### State uses setter functions

ES module exports are read-only bindings. You can't do `state.colorMode = 'classified'` from another module. Instead: `state.setColorMode('classified')`. Every piece of state has a corresponding setter.

### Coordinates are in inches

Model space, sheet space, and all internal geometry use inches. Only convert to PDF points (72/inch) or canvas pixels at the final rendering step. See the coordinate system table in `MODULE_CONTRACTS.md`.

### No bundler

The project intentionally has no build step. All modules use native ES `import`/`export`. New modules just need a `.js` file in `js/` and an `import` in whatever file uses them. New CDN libs go as `<script>` tags in `index.html` before the module script.

### jsPDF is needed starting Phase 5

Add this to index.html:
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
```
Access as `const { jsPDF } = window.jspdf;`

---

## Testing

No test framework. Manual testing with real STEP files. After each phase:

1. Run the acceptance criteria from the spec
2. Verify with at least 2 STEP files (one simple block, one with holes/arcs)
3. Check that all existing features still work (3D viewer, views, annotations, edge classification)

---

## Version Bumps

Increment the version in these places:
- `index.html` – the `<div class="version">` tag
- `README.md` – the badge

Follow the existing convention: `v0.0.XX` where XX increments per meaningful change.

---

## Deployment

When ready to go live:
1. Push to GitHub
2. Connect repo to Vercel
3. It just works – Vercel serves index.html as a static site

No build config, no vercel.json, no environment variables needed for the static version.
