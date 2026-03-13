# PartCraft v0.0.48 — Architecture Audit

> Generated: 2026-03-11 | Covers all source files, specs, and module contracts

---

## 1. What PartCraft Is

PartCraft is a browser-based CAD technical drawing application. Users upload STEP files, view them in 3D via Three.js, and the app generates professional engineering drawing sheets with orthographic views, hidden-line-removed edges, ordinate dimensions, and a title block — all rendered to a 2D canvas preview destined for PDF export.

The tech stack is: **Vite + vanilla JS modules + OpenCascade.js (WASM) + Three.js r128 + Canvas 2D**.

---

## 2. File Map & Module Responsibilities

```
partcraft-v0_0_48/
├── index.html              Entry point — DOM structure, loading screen, topbar, upload, properties panel
├── app.py                  Python dev server (alternative to Vite)
├── launch.bat              Windows launcher (npm run dev)
├── vite.config.js          Vite config — CORS headers for WASM, port 3000
├── package.json            Dependencies: opencascade.js 2.0.0-beta, three 0.128.0, vite 6.0.0
│
├── css/
│   └── styles.css          Global styles — topbar, upload, properties panel, loading animation (312 LOC)
│
├── js/
│   ├── app.js              Orchestrator — file upload, OCCT loading, HLR, sheet creation, event wiring (406 LOC)
│   ├── state.js            Global singleton state — all shared variables and setter functions (58 LOC)
│   ├── occt-loader.js      OCCT init, STEP parsing, mesh extraction, edge classification (364 LOC)
│   ├── scene.js            Three.js scene, ortho camera, 4-view raster capture at 2400x1800 (128 LOC)
│   ├── preview.js          2D canvas sheet renderer — viewports, HLR edges, sidebar, title block (842 LOC)
│   ├── display.js          3D edge visualization updates, face display, stats panel (70 LOC)
│   ├── edges.js            Mesh edge extraction, chaining, corner splitting, curve classification (296 LOC)
│   ├── hlr.js              Hidden Line Removal via OCCT HLRBRep_Algo — 4 views, adaptive sampling (234 LOC)
│   ├── hlr-diagnostic.js   Console diagnostic — compares B-rep vs HLR coordinates (166 LOC)
│   ├── diagnose.js         Console diagnostic — tests OCCT API, HLR, curve types (143 LOC)
│   ├── annotations.js      3D ordinate dimensions & diameter callouts as Three.js sprites (293 LOC)
│   ├── dimensions.js       2D dimension rendering to canvas — ordinate + diameter + leaders (352 LOC)
│   ├── sheet.js            Sheet data model — viewports, scale, title block fields (113 LOC)
│   ├── layout.js           Configuration object — page size, fonts, grid, sidebar, title block (146 LOC)
│   ├── classifier.js       Curve fitting — line/arc/circle detection via perpendicular bisectors (175 LOC)
│   ├── math.js             Vec2/Vec3 utilities — add, sub, cross, dot, normalize, distance (32 LOC)
│   ├── utils.js            DOM status log, TypedArray conversion, color generation (34 LOC)
│   └── renderer_changes.md Spec for upcoming preview.js/sheet.js title block redesign (503 LOC)
│
├── scripts/
│   └── copy-wasm.js        Post-install: copies opencascade.full.wasm to public/wasm/ (20 LOC)
│
├── public/wasm/             WASM binary (copied at install time)
├── specs/                   6-phase roadmap specifications (see Section 8)
├── MODULE_CONTRACTS.md      Type signatures, function contracts, coordinate system table
└── titleblock_preview.html  Standalone title block layout prototype
```

**Total application JS: ~3,419 lines across 16 modules.**

---

## 3. Architecture Diagram

### Module Dependency Graph

```
                        ┌──────────────┐
                        │  index.html  │
                        └──────┬───────┘
                               │ loads
                        ┌──────▼───────┐
                        │    app.js    │  ← Orchestrator
                        └──┬───┬───┬───┘
                 ┌─────────┤   │   ├──────────┐
                 │         │   │   │          │
          ┌──────▼──┐  ┌───▼───▼┐ ┌▼────────┐ ┌▼────────┐
          │ scene.js │  │state.js│ │ sheet.js │ │preview.js│
          └──────────┘  └───┬────┘ └────┬─────┘ └────┬─────┘
                            │           │             │
                    ┌───────┼───────┐   │      ┌──────┼──────┐
                    │       │       │   │      │      │      │
              ┌─────▼──┐ ┌──▼────┐ ┌▼───▼──┐ ┌▼──────▼─┐ ┌──▼──────┐
              │ hlr.js │ │edges.js│ │layout.js│ │dimensions│ │ display │
              └────────┘ └───┬────┘ └────────┘ └────┬─────┘ └─────────┘
                             │                      │
                       ┌─────▼──────┐         ┌─────▼──────┐
                       │classifier.js│        │annotations.js│
                       └─────┬──────┘         └────────────┘
                             │
                        ┌────▼───┐
                        │ math.js│  ← Zero dependencies
                        └────────┘

  Standalone:  occt-loader.js (OCCT WASM init + STEP parsing)
               utils.js (DOM helpers, color gen)
               diagnose.js, hlr-diagnostic.js (console diagnostics)
```

### Data Flow (User uploads STEP file)

```
STEP file (binary buffer)
    │
    ▼
occt-loader.js ─── initOCCT() → loadSTEP() ───┐
    │                                           │
    ├─ extractMesh(shape) → positions, indices  │
    ├─ extractEdges(shape) → curveDetails       │
    └─ detectStepUnits() → (logged, not used)   │
                                                │
    ▼                                           ▼
state.js ←── currentShape, meshObjects,    analysisResults
    │         modelCenter, modelBounds
    │
    ├──► scene.js ── initThreeJS() → fitCamera() → captureAllViews()
    │       └─ Returns 4 base64 PNGs (axon, front, right, top)
    │
    ├──► hlr.js ── computeHLR(shape, scaleFactor)
    │       └─ Returns per-view visible/hidden/silhouette edges
    │
    ├──► sheet.js ── createSheet(partName)
    │       └─ Computes viewport layout, scale, title block fields
    │
    ├──► edges.js ── detectEdgesPartcraft(geometry)
    │       └─ Chains mesh edges, classifies via classifier.js
    │
    └──► preview.js ── render()
            ├─ Draws raster captures into viewports
            ├─ Draws HLR edges as 2D polylines
            ├─ Draws sidebar, title block, issue table
            └─ Calls dimensions.js for ordinate/diameter annotations
```

---

## 4. Coordinate Systems

| Space | Origin | Y Direction | Units | Used By |
|-------|--------|-------------|-------|---------|
| OCCT model | Part origin | Convention varies | Millimeters (always) | occt-loader.js, hlr.js |
| Three.js scene | Part center | Y-up | Inches (after mm→in) | scene.js, edges.js, annotations.js |
| HLR projector | Projection plane | Implicit (Z=0) | Millimeters | hlr.js output |
| Sheet | Bottom-left of page | Y-up | Inches | sheet.js, dimensions.js |
| Canvas | Top-left | Y-down | Pixels | preview.js |
| PDF (planned) | Top-left | Y-down | Points (72/in) | specs/05 |

**Critical concern:** Four coordinate spaces with implicit conversions. The mm→inch conversion (1/25.4) is applied at the OCCT boundary, but the `detectStepUnits()` result is never actually used — all files assumed to be in mm.

---

## 5. State Management

`state.js` is a flat singleton with module-level `export let` variables and 20 setter functions. Every module imports `* as S` from state.

**State categories:**

| Category | Variables | Written By | Read By |
|----------|-----------|------------|---------|
| OCCT kernel | `oc`, `currentShape` | occt-loader, app | hlr, diagnose |
| 3D scene | `scene`, `orthoCamera`, `renderer`, `currentGroup` | scene, app | preview, display |
| Geometry | `meshObjects`, `edgeObjects`, `analysisResults` | app, edges, display | preview, dimensions, annotations |
| Model bounds | `modelCenter`, `modelSize`, `modelBounds` | scene | sheet, dimensions, preview |
| Drawing | `currentSheet`, `partName`, `captures` | sheet, app, scene | preview, dimensions |
| HLR | `hlrResults` | hlr (via app) | preview, dimensions |
| UI toggles | `annotationLevel`, `showVisible/Hidden/Silhouettes` | app (UI events) | preview |

**Problems:** No encapsulation, no validation on setters, no cleanup/disposal pattern, no reactive updates, unused variables suggest abandoned features.

---

## 6. Critical Issues Found

### Severity: CRITICAL

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 1 | **Unit conversion bug** — `detectStepUnits()` detects units but result is never used. All files assumed mm. Inch-native STEP files get double-converted. | occt-loader.js L51-58 | Incorrect geometry dimensions |
| 2 | **HLR coordinate remap is empirical** — View remapping uses hardcoded axis swaps and magic angles (315°, marked "calibrated"). No derivation from projection math. | hlr.js L19-36, preview.js L307 | Fragile; breaks if views change |
| 3 | **Memory leaks** — ObjectURLs never revoked, Three.js geometries/materials not disposed on reload, OCCT WASM objects leak on exceptions. | app.js, hlr.js, scene.js | Progressive memory growth |
| 4 | **Beta dependency** — opencascade.js 2.0.0-beta.fb983cd. Unstable, unsupported, commit-hash pinned. | package.json | Reproducibility risk |
| 5 | **Python server missing CORS headers** — app.py doesn't set Cross-Origin-Embedder-Policy. WASM fails to load when using Python server. | app.py | Broken alternative dev server |
| 6 | **Silent error swallowing** — try/catch blocks throughout HLR and edge processing catch and discard errors. | hlr.js, occt-loader.js, edges.js | Incomplete results without warning |

### Severity: HIGH

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 7 | **Version inconsistency** — Directory: v0_0_48, package.json: 0.0.49, app.py: 0.0.48, launch.bat: 0.0.49 | Multiple files | User confusion |
| 8 | **No input debouncing** — `applyProps()` fires on every keystroke, triggering full canvas re-render | app.js L77 | UI jank during typing |
| 9 | **Hardcoded tolerances** — Chain matching (0.001), corner detection (15°, 0.5), circle fit (10% radius), HLR sampling (0.1 rad, 0.01 units). None configurable or scale-adaptive. | edges.js, classifier.js, hlr.js | Incorrect results on non-standard models |
| 10 | **MODULE_CONTRACTS.md out of sync** — Documents functions not yet implemented (projection.js, export.js). Types don't match actual code structures. | MODULE_CONTRACTS.md | Misleading documentation |
| 11 | **Display.js HTML injection** — Stats panel built via string concatenation without escaping. If edge data contained HTML, it would execute. | display.js L32-68 | XSS vulnerability |
| 12 | **No null guards on state access** — dimensions.js, display.js, annotations.js all assume state is populated. Crash if called before file load. | Multiple | Runtime crashes |

### Severity: MODERATE

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 13 | Camera hardcoded Y-up; Z-up CAD models render incorrectly | scene.js L80 | Wrong view orientation |
| 14 | Capture resolution hardcoded 2400x1800; not configurable | scene.js L22-23 | Can't adjust for DPI/performance |
| 15 | DPR capped at 2.0; blurry on 3x displays | preview.js L27 | Visual quality |
| 16 | Three.js r128 outdated (current r160+) | package.json | Missing fixes and features |
| 17 | Excessive console.log throughout edge/chain processing | edges.js | Performance and console noise |
| 18 | Circle/arc detection uses heuristics, not least-squares fit | classifier.js, edges.js | Misclassification on complex curves |
| 19 | Axon view HLR remap discards Z coordinate entirely | hlr.js L34 | Loss of depth information |
| 20 | Canvas state (translate/rotate) not in save/restore pairs | dimensions.js, preview.js | Corrupted canvas state on error |

---

## 7. Module-by-Module Detail

### app.js (406 LOC) — Orchestrator
- **Responsibilities:** File upload, OCCT loading, HLR computation, sheet creation, view capture, property panel sync, UI event binding, diagnostic tool
- **Too many responsibilities.** Should be split: file-handler, ui-controller, diagnostic
- **Key flow:** `processFile()` → loadSTEP → build mesh → compute HLR → create sheet → capture views → render preview
- **Double requestAnimationFrame** (L190-194) suggests timing workaround, not proper fix

### state.js (58 LOC) — Global State
- **Anti-pattern:** Module-level `export let` with setter functions
- **No validation, no reactive updates, no cleanup**
- **3 unused variables:** colorMode, faceColors, meshObjects.random

### occt-loader.js (364 LOC) — STEP Processing
- **High complexity:** OCCT WASM FFI, parametric curve extraction, mesh triangulation, edge classification
- **classifyEdge()** (L240-299) — dense nested conditionals with 5 curve type branches
- **Magic numbers:** mesh tolerance 0.1, arc threshold 2π-0.01, fit tolerance 0.005, sample counts 24/32

### scene.js (128 LOC) — 3D Scene
- **Clean and focused.** Initializes Three.js, manages camera, captures 4 orthographic views
- **View rotations defined as Euler angles** with hardcoded YXZ order
- **No error handling** in captureAllViews; orphaned pivot groups on failure

### preview.js (842 LOC) — 2D Sheet Renderer (largest module)
- **Handles:** viewport drawing, HLR edge projection, sidebar rendering, title block, edge debug overlay
- **Axon projection uses empirical "calibrated" values** — extremely fragile
- **Canvas zoom/pan** with module-level state (not persisted)
- **drawSpacedText()** measures each character individually — slow for large text

### hlr.js (234 LOC) — Hidden Line Removal
- **OCCT integration:** HLRBRep_Algo + HLRToShape for 4 views (front, top, right, axon)
- **Adaptive sampling** via GCPnts_TangentialDeflection with hardcoded parameters
- **Remap functions** convert projector-space coordinates to model-space per view
- **Silent catch blocks** — failed edges simply disappear from results

### edges.js (296 LOC) — Mesh Edge Analysis
- **Pipeline:** extract edges → chain into polylines → split at corners → classify curves
- **Chain matching tolerance (0.001)** not scale-adaptive
- **Corner detection** uses both angle (15°) and segment length (0.5) thresholds — OR logic
- **~10 console.log statements** per pipeline run

### classifier.js (175 LOC) — Curve Fitting
- **Pure math module** — good isolation, only depends on math.js
- **3-point circle fitting** via perpendicular bisector method
- **Collinearity check** (sinAngle < 0.05) may reject valid low-curvature arcs
- **Closed-curve detection** uses gap < 2× average segment length — arbitrary

### dimensions.js (352 LOC) — 2D Dimensions
- **Renders ordinate and diameter dimensions** on canvas for each viewport
- **HLR/B-rep fallback logic** — uses HLR edges if available, otherwise original B-rep
- **Depth filtering** (15% of front boundary) to reduce clutter — undocumented threshold
- **Arrow drawing** has divide-by-zero risk when p1 ≈ p2

### annotations.js (293 LOC) — 3D Annotations
- **Creates Three.js sprites** for ordinate dimensions and diameter callouts
- **Canvas-based text** at hardcoded 36px bold Arial, 64x256 or 256x64 texture
- **Hardcoded color #4488ff** throughout — not configurable
- **No unit conversion** — assumes model is in inches

### sheet.js (113 LOC) — Sheet Model
- **Creates viewport grid** (2x2: axon, front, right, top), computes uniform scale
- **Scale calculation** has magic factor 0.375 — undocumented
- **Axon extents** use formula `(dx+dz)*0.7` and `dy+(dx+dz)*0.35` — magic numbers
- **Fallback** returns 1x1 extents if bounds missing — hides errors

### layout.js (146 LOC) — Configuration
- **Pure data object** — page dimensions (A1 landscape 33.11"x23.39"), fonts, colors, grid ratios, sidebar, title block
- **Good:** single source of truth for visual layout
- **Grid assumes 2x2** — no validation, no support for other layouts
- **Some sizes mixed:** sidebar logo padding in px (40px) while everything else in inches

### math.js (32 LOC) — Vector Utilities
- **Clean, minimal, zero dependencies.** Vec2 and Vec3 operations.
- **No SIMD optimization** — fine for CAD-scale data

### utils.js (34 LOC) — Helpers
- **DOM status logger** hardcoded to `#status` element — crashes if missing
- **Color generation** via golden-angle hue distribution

### diagnose.js / hlr-diagnostic.js — Console Diagnostics
- **Not production code** — designed to be pasted into browser console
- **Committed as modules** but should be in a `test/` or `debug/` directory
- **Fragile dynamic imports** — may not resolve through Vite

---

## 8. Roadmap Status

Six specification documents define a phased pipeline for PDF export:

| Phase | Spec File | Feature | Status |
|-------|-----------|---------|--------|
| 1 | 01-SHEET-LAYOUT.md | Sheet layout engine & coordinate transforms | **Partially implemented** — sheet.js exists but doesn't match spec (no presets, no modelToSheet) |
| 2 | 02-RASTER-CAPTURE.md | Off-screen WebGL capture at target DPI | **Partially implemented** — scene.js captures 4 views but at fixed resolution, not configurable DPI |
| 3 | 03-VECTOR-PROJECTION.md | 3D→2D edge projection for vector lines | **Partially implemented** — HLR edges rendered on canvas, but no dedicated projection.js module |
| 4 | 04-DIMENSION-EXPORT.md | Annotation refactor + title block export | **Not implemented** — annotations.js is 3D-only, no 2D export pipeline |
| 5 | 05-PDF-ASSEMBLY.md | jsPDF multi-layer PDF generation | **Not implemented** — no pdf.js module, no jsPDF dependency |
| 6 | 06-MARKUP-UI.md | Bluebeam-style markup overlay | **Not implemented** — no markup.js module |

**Current state:** The app is a functional 3D viewer + 2D sheet preview. The PDF export pipeline (Phases 4-6) is entirely planned. The foundational phases (1-3) are partially implemented but diverge from specs.

**Key gaps in specs:**
- Hidden-line removal deferred in Phase 3 (all edges solid in v0) — but actually implemented in hlr.js already
- No ellipse support — arcs at angles become polylines
- PDF Preview mode (Phase 6) rendering approach unspecified
- No multi-sheet or assembly drawing support
- Performance targets unvalidated

---

## 9. Recommendations

### Immediate (pre-feature work)

1. **Fix unit conversion** — Either use `detectStepUnits()` result or document the mm-only assumption clearly
2. **Add error boundaries** — Replace silent catch blocks with logged warnings + user status messages
3. **Debounce property inputs** — 200ms debounce on `applyProps()` to prevent render spam
4. **Dispose Three.js resources** — Add cleanup in processFile before creating new geometry
5. **Reconcile version numbers** — Single source of truth (package.json), auto-populate elsewhere
6. **Escape HTML in display.js** — Use textContent or DOMPurify for stats panel

### Short-term (architecture)

7. **Extract coordinate transforms** — Implement the `modelToSheet()`, `sheetToCanvas()`, `sheetToPdf()` functions from MODULE_CONTRACTS.md as a dedicated transforms.js module
8. **Centralize constants** — Move all magic numbers (tolerances, thresholds, colors, sizes) to a config.js
9. **Refactor state.js** — At minimum, add validation to setters and a `reset()` function for cleanup
10. **Split app.js** — Separate file-handling, UI-wiring, and diagnostic concerns
11. **Sync MODULE_CONTRACTS.md** — Mark unimplemented functions, update types to match reality

### Medium-term (roadmap)

12. **Formalize HLR coordinate remapping** — Derive remap functions mathematically from projection direction vectors instead of empirical calibration
13. **Add adaptive tolerances** — Scale chain matching, corner detection, and circle fitting thresholds based on model bounding box
14. **Implement Phase 4 annotation refactor** — Separate annotation geometry calculation from Three.js rendering before attempting PDF export
15. **Add test infrastructure** — Unit tests for math.js, classifier.js, sheet.js; integration test for STEP→preview pipeline

---

## 10. Metrics Summary

| Metric | Value |
|--------|-------|
| Total JS source files | 16 |
| Total JS lines of code | ~3,419 |
| Largest module | preview.js (842 LOC) |
| External dependencies | 2 (opencascade.js, three) |
| Dev dependencies | 1 (vite) |
| Coordinate spaces | 4 (OCCT, Three.js, Sheet, Canvas) + 1 planned (PDF) |
| Critical issues | 6 |
| High issues | 6 |
| Moderate issues | 8+ |
| Spec phases planned | 6 |
| Spec phases partially done | 3 |
| Spec phases not started | 3 |
