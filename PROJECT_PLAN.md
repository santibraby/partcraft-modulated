# Partcraft – STEP-to-PDF Pipeline: Project Plan

## Vision

Partcraft converts STEP/STP CAD files into layered, annotated engineering drawing PDFs entirely in the browser. The output PDF has four stacked layers that mirror professional CAD drawing workflows:

1. **Shaded Geometry** (raster) – photorealistic render of the 3D part
2. **Vector Edge Lines** – crisp, scalable outlines of all part edges
3. **Dimensions & Titles** (text/graphics) – ordinate dimensions, diameter callouts, title block, date
4. **User Markup** (interactive) – freehand pen, text boxes, clouds, stamps (Bluebeam-lite)

The app will be hosted on **Vercel** as a static site with an eventual Stripe paywall gating PDF export.

---

## Current State (v0.0.47)

The app is modularized into 9 ES modules served from `index.html`. It can:

- Parse STEP files via occt-import-js (client-side)
- Render 3D geometry in Three.js with orthographic + axonometric views
- Classify edges as line / arc / circle via perpendicular-bisector circle fitting
- Chain and split edges at corners
- Display 3-level ordinate dimensions and diameter callouts in the 3D scene
- Toggle edge colors (black / classified / random), face colors, mesh wires, XYZ axes

### Existing Module Map

| Module | Responsibility |
|--------|---------------|
| `js/app.js` | Boot, STEP processing, event wiring |
| `js/state.js` | All shared mutable state + setters |
| `js/scene.js` | Three.js init, cameras, views, axes, resize |
| `js/classifier.js` | Line/arc/circle detection |
| `js/edges.js` | Edge chaining, corner splitting, visualization |
| `js/annotations.js` | Ordinate dimensions, diameter callouts |
| `js/display.js` | Edge/face toggling, stats panel |
| `js/math.js` | 2D/3D vector utilities |
| `js/utils.js` | Color helpers, logging, type coercion |

### CDN Dependencies

| Library | Version | Purpose |
|---------|---------|---------|
| occt-import-js | 0.0.23 | STEP file parsing |
| Three.js | r128 | 3D rendering |
| OrbitControls | 0.128.0 | Camera interaction |

---

## Build Phases

Each phase produces a working, testable increment. Phases are sequential – each builds on the prior.

| Phase | Name | New Modules | Versions | Dependency |
|-------|------|-------------|----------|------------|
| 1 | Sheet Layout | `js/sheet.js` | v0.0.48–50 | None |
| 2 | Raster Capture | `js/export.js` | v0.0.51–52 | Phase 1 |
| 3 | Vector Projection | `js/projection.js` | v0.0.53–56 | Phase 1 |
| 4 | Dimension Export | update `js/annotations.js`, `js/projection.js` | v0.0.57–59 | Phase 3 |
| 5 | PDF Assembly | `js/pdf.js` | v0.0.58–60 | Phases 2+3+4 |
| 6 | Markup UI | `js/markup.js` | v0.0.61–65 | Phase 5 |

### Phase Dependency Graph

```
Phase 1 (Sheet Layout)
  ├──→ Phase 2 (Raster Capture)
  └──→ Phase 3 (Vector Projection)
           └──→ Phase 4 (Dimension Export)
                    └──→ Phase 5 (PDF Assembly) ←── Phase 2
                              └──→ Phase 6 (Markup UI)
```

---

## New Library Needed

**jsPDF** – client-side PDF generation. Load via CDN:

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
```

jsPDF supports: embedded images, vector path drawing, text with fonts, Optional Content Groups (PDF layers), and annotation objects. This single library covers all four output layers.

---

## File Structure After All Phases

```
partcraft/
├── index.html
├── css/
│   └── styles.css
├── js/
│   ├── app.js              ← updated: adds Export PDF button + workflow
│   ├── state.js            ← updated: adds sheet + markup state
│   ├── scene.js            ← unchanged
│   ├── classifier.js       ← unchanged
│   ├── edges.js            ← unchanged
│   ├── annotations.js      ← updated: can output 2D annotation primitives
│   ├── display.js          ← unchanged
│   ├── math.js             ← minor additions (matrix ops)
│   ├── utils.js            ← unchanged
│   ├── sheet.js            ← NEW: page layout, title block, view placement
│   ├── projection.js       ← NEW: 3D→2D orthographic projection
│   ├── export.js           ← NEW: raster capture from Three.js
│   ├── pdf.js              ← NEW: jsPDF assembly with OCG layers
│   └── markup.js           ← NEW: overlay canvas, markup tools, data model
└── api/                    ← future: Vercel serverless (Stripe, etc.)
```

---

## Detailed Specs

Each phase has its own specification document in the `specs/` directory:

1. [specs/01-SHEET-LAYOUT.md](specs/01-SHEET-LAYOUT.md) – Page model, title block, view viewports
2. [specs/02-RASTER-CAPTURE.md](specs/02-RASTER-CAPTURE.md) – Off-screen render, PNG export
3. [specs/03-VECTOR-PROJECTION.md](specs/03-VECTOR-PROJECTION.md) – 3D→2D edge projection, hidden-line strategy
4. [specs/04-DIMENSION-EXPORT.md](specs/04-DIMENSION-EXPORT.md) – Annotation projection to 2D
5. [specs/05-PDF-ASSEMBLY.md](specs/05-PDF-ASSEMBLY.md) – jsPDF integration, layered output
6. [specs/06-MARKUP-UI.md](specs/06-MARKUP-UI.md) – Overlay canvas, tools, PDF annotation export

Additionally, [MODULE_CONTRACTS.md](MODULE_CONTRACTS.md) defines the data interfaces between all modules.

---

## Testing Strategy

Since this is a client-side app without a build system, testing is manual but structured:

### Per-Phase Acceptance Tests

Each spec document ends with acceptance criteria. A phase is complete when every criterion passes with at least 2 different STEP files (one simple prismatic part, one with holes/arcs).

### Regression

After each phase, verify:
- Upload → 3D view still works
- All 5 view buttons still work
- All 3 annotation levels still work
- Edge classification still correct

### Test Files

Use at minimum:
- A simple rectangular block (tests bounding box, lines only)
- A plate with drilled holes (tests circles, arcs, diameter callouts)
- A part with fillets/chamfers (tests arc classification under corner splitting)

---

## Deployment Notes

- **Vercel**: `git push` deploys automatically. No build step needed. Static site served from root `index.html`.
- **ES Modules**: All JS uses `import`/`export`. Requires HTTP server locally (`npx serve .` or `python3 -m http.server`).
- **CDN libs**: Three.js + occt-import-js + jsPDF all loaded as `<script>` tags before the module entry point. They attach to `window` globals.
- **No bundler**: Intentional. Keeps the project simple and debuggable. Can add Vite/Rollup later if needed for production optimization.
