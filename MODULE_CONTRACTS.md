# Module Interface Contracts

This document defines the data structures and function signatures shared between modules. When building or modifying a module, use this as the source of truth for what other modules expect.

---

## Dependency Graph

```
math.js ──────────────┐
utils.js ─────────────┤
                      ▼
state.js ◄──── (everyone reads/writes state)
                      │
              ┌───────┼───────────┐
              ▼       ▼           ▼
        classifier.js edges.js   scene.js
              │       │
              ▼       ▼
        ┌─────────────┘
        ▼
   annotations.js ──────►  projection.js
        │                       │
        ▼                       ▼
   display.js              sheet.js
                               │
                               ▼
                           export.js
                               │
                               ▼
                            pdf.js
                               │
                               ▼
                          markup.js
```

---

## Shared Type Definitions

### Vec3 (used everywhere)

```javascript
// Plain object, NOT a THREE.Vector3
{ x: number, y: number, z: number }
```

Created via `vec3(x, y, z)` from `math.js`. All internal geometry uses this format. Convert to `THREE.Vector3` only at the rendering boundary (scene.js, edges.js visualization).

### Vec2

```javascript
{ x: number, y: number }
```

Used for 2D sheet coordinates and 2D math. Created via `vec2(x, y)` from `math.js`.

### ClassifiedEdge (edges.js → display.js, projection.js)

```javascript
{
    start: Vec3,
    end: Vec3,
    type: 'line' | 'arc' | 'circle',
    chainIndex: number
}
```

### CurveDetail (edges.js → annotations.js, projection.js)

```javascript
{
    index: number,
    type: 'line' | 'arc' | 'circle',
    detail: string,           // human-readable description
    points: Vec3[],           // all points in the chain
    numPoints: number,

    // Line-only:
    length: number,           // total length in inches

    // Arc-only:
    center: Vec3,
    radius: number,           // inches
    normal: Vec3,
    sweep: number,            // degrees

    // Circle-only:
    center: Vec3,
    radius: number,           // inches
    normal: Vec3
}
```

### AnalysisResults (edges.js → state.js → everyone)

```javascript
{
    partcraft: {
        edges: ClassifiedEdge[],
        chains: number,
        counts: { line: number, arc: number, circle: number },
        curveDetails: CurveDetail[],
        totalChains: number
    },
    vertices: number,
    triangles: number,
    brepFaces: number
}
```

Stored in `state.analysisResults`. Set via `state.setAnalysisResults()`.

---

## New Types (Phases 1–6)

### Sheet (sheet.js → pdf.js, export.js, markup.js)

```javascript
{
    pageWidth: number,          // inches
    pageHeight: number,         // inches
    margins: { top, right, bottom, left },  // inches
    drawableWidth: number,      // computed
    drawableHeight: number,     // computed
    titleBlock: {
        width: number,
        height: number,
        x: number,              // sheet coordinates
        y: number,
        fields: {
            partName: string,
            date: string,
            scale: string,
            drawnBy: string,
            sheetOf: string,
            units: string
        }
    },
    viewports: Viewport[]
}
```

### Viewport (sheet.js → export.js, projection.js, pdf.js)

```javascript
{
    id: string,                 // 'front', 'top', etc.
    view: string,               // camera view name (matches setView() param)
    x: number,                  // inches from left edge of page
    y: number,                  // inches from bottom edge of page
    width: number,              // inches
    height: number,             // inches
    scale: number,              // model-inches per sheet-inch
    active: boolean
}
```

### ProjectedEdge (projection.js → pdf.js)

```javascript
{
    type: 'line' | 'arc' | 'circle',
    points2D: Vec2[],           // sheet coordinates
    chainIndex: number,
    center2D: Vec2 | null,      // arcs/circles only
    radius2D: number,           // sheet inches, arcs/circles only
    startAngle: number,         // degrees, arcs only
    endAngle: number,           // degrees, arcs only
    facing: 'front' | 'back',
    visible: boolean
}
```

### ProjectionResult (projection.js → pdf.js)

```javascript
{
    viewportId: string,
    edges: ProjectedEdge[],
    boundingBox: { minX, minY, maxX, maxY }
}
```

### AnnotationPrimitive (projection.js → pdf.js)

```javascript
{
    type: 'leader-line' | 'text' | 'arrowhead' | 'centermark',

    // leader-line:
    points2D: Vec2[],
    lineWeight: number,         // points
    color: string,              // hex
    dashPattern: number[] | null,

    // text:
    text: string,
    position2D: Vec2,
    fontSize: number,           // points
    align: string,
    rotation: number,           // degrees

    // arrowhead:
    tip2D: Vec2,
    direction2D: Vec2,
    size: number,               // inches

    // centermark:
    center2D: Vec2,
    size: number,               // inches
    dashPattern: number[]
}
```

### AnnotationGeometry3D (annotations.js → projection.js)

```javascript
{
    leaderLines: [
        { points: Vec3[], type: 'ordinate' | 'diameter' }
    ],
    textLabels: [
        { text: string, position: Vec3, rotation: number, align: string }
    ],
    arrowheads: [
        { tip: Vec3, baseLeft: Vec3, baseRight: Vec3 }
    ],
    centermarks: [
        { center: Vec3, horizontalAxis: string, verticalAxis: string }
    ]
}
```

### TitleBlockData (sheet.js → pdf.js)

```javascript
{
    border: { x, y, width, height },
    cells: [
        { label: string, value: string, x, y, width, height }
    ],
    sheetBorder: { x, y, width, height }
}
```

### MarkupElement (markup.js → pdf.js)

```javascript
{
    id: string,
    type: 'pen' | 'text' | 'rect' | 'cloud' | 'stamp',
    created: string,            // ISO date

    // Geometry (varies by type)
    points: Vec2[],             // pen
    position: Vec2,             // text, stamp
    origin: Vec2,               // rect, cloud
    width: number,              // rect, cloud, stamp
    height: number,             // rect, cloud, stamp
    text: string,               // text, stamp

    // Style
    color: string,              // hex
    lineWeight: number,         // points
    opacity: number,
    fontSize: number,           // text only
    stampType: string           // stamp only
}
```

---

## Function Signatures by Module

### sheet.js

```javascript
export function createSheet(preset, partName) → Sheet
export function getViewExtents(viewName) → { horizontal: number, vertical: number }
export function calculateViewportScale(viewport, extents) → number
export function modelToSheet(point3D, viewport) → Vec2
export function generateTitleBlock(sheet) → TitleBlockData
```

### export.js

```javascript
export async function captureViewportRaster(viewport, dpi) → string  // PNG data URL
export async function captureAllViewports(sheet, dpi) → RasterResult[]
```

### projection.js

```javascript
export function projectEdgesToSheet(viewport) → ProjectionResult
export function projectPoint(point3D, viewport) → Vec2
export function projectAnnotations(viewport, annoGeom3D) → AnnotationPrimitive[]
export function classifyEdgeVisibility(curveDetail, viewDirection) → 'front' | 'back'
```

### annotations.js (NEW export)

```javascript
// EXISTING (unchanged):
export function createAnnotations() → void     // builds Three.js objects
export function clearAnnotations() → void

// NEW:
export function getAnnotationGeometry3D(view, level) → AnnotationGeometry3D
```

### pdf.js

```javascript
export async function generatePDF(sheet, options) → jsPDF
export function drawSheetBorder(doc, sheet) → void
export function drawTitleBlock(doc, sheet) → void
export function drawVectorEdges(doc, projection, pageHeight) → void
export function drawAnnotationPrimitives(doc, primitives, pageHeight) → void
export function drawMarkupLayer(doc, markupElements, pageHeight) → void
```

### markup.js

```javascript
export function initMarkupOverlay(previewContainer) → void
export function setActiveTool(toolName) → void
export function renderMarkupOverlay() → void
export function undo() → void
export function clearAllMarkups() → void
export function getMarkupElements() → MarkupElement[]
```

---

## Coordinate Systems Summary

| System | Origin | Y Direction | Units | Used By |
|--------|--------|-------------|-------|---------|
| Model Space | Part origin (from STEP) | Up | Inches | edges.js, classifier.js, annotations.js |
| Three.js Scene | Same as model | Up | Inches | scene.js (rendering) |
| Sheet Space | Bottom-left of page | Up | Inches | sheet.js, projection.js, markup.js |
| PDF Space | Top-left of page | Down | Points (72/inch) | pdf.js |
| Canvas Pixels | Top-left of canvas | Down | Pixels | markup.js (overlay), export.js (raster) |

### Conversion Functions

| From | To | Function | Location |
|------|----|----------|----------|
| Model → Sheet | `modelToSheet(vec3, viewport)` | sheet.js |
| Sheet → PDF | `sheetToPdf(x, y, pageHeight)` | pdf.js |
| Sheet → Canvas | `sheetToCanvas(x, y)` | markup.js |
| Canvas → Sheet | `canvasToSheet(x, y)` | markup.js |

---

## Rules for Module Authors

1. **Never import THREE inside math-only modules** (math.js, classifier.js, sheet.js, projection.js). THREE is only for rendering code.
2. **Use Vec3/Vec2 plain objects** for all geometry data. Convert to `THREE.Vector3` only in scene.js and edges.js visualization code.
3. **All state mutations go through setter functions** in state.js. Never reassign a module-level exported `let` from another module.
4. **New state variables** require both the `export let` and an `export function set*()`.
5. **Console logging**: Use `console.log` for debug info during development. Use `log()` from utils.js for user-visible status messages.
6. **Units**: All internal measurements are in inches unless converting to PDF points or canvas pixels at the very last step.
7. **Error handling**: Functions that can fail should return `null` (not throw) and log the error. The caller checks for null.
