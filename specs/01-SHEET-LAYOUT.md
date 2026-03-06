# Phase 1: Sheet Layout Engine

## Goal

Create a data model for engineering drawing sheets – page size, margins, title block, and positioned viewports – so all subsequent export phases have a coordinate system to target.

## New Module

**`js/sheet.js`**

## Dependencies

- `js/state.js` (reads `modelCenter`, `modelSize`, bounding box)
- `js/math.js` (basic arithmetic only)

---

## Data Model

### Sheet

```javascript
{
    // Page dimensions in inches (all coordinates in this system are inches)
    pageWidth: 11,          // Letter landscape
    pageHeight: 8.5,
    margins: { top: 0.5, right: 0.5, bottom: 1.0, left: 0.5 },

    // Derived (computed on creation)
    drawableWidth: 10,      // pageWidth - margins.left - margins.right
    drawableHeight: 7,      // pageHeight - margins.top - margins.bottom

    // Title block (bottom-right, inside margins)
    titleBlock: {
        width: 4,
        height: 0.75,
        x: 6.5,            // right-aligned within drawable area
        y: 0,              // bottom of drawable area
        fields: {
            partName: '',
            date: '',
            scale: '',
            drawnBy: 'Partcraft',
            sheetOf: '1/1',
            units: 'INCHES'
        }
    },

    // View viewports (positioned within drawable area)
    viewports: [
        {
            id: 'front',
            view: 'front',          // maps to setView() camera name
            x: 0.5,                 // inches from left margin
            y: 1.5,                 // inches from bottom margin
            width: 4,               // viewport width in inches
            height: 3,              // viewport height in inches
            scale: null,            // auto-calculated to fit model
            active: true
        }
    ]
}
```

### Viewport Scale Calculation

Each viewport needs a scale factor that maps model inches to sheet inches:

```
scale = min(viewport.width / modelExtent_horizontal, viewport.height / modelExtent_vertical)
```

Where `modelExtent_horizontal` and `modelExtent_vertical` depend on the view direction:

| View | Horizontal Extent | Vertical Extent |
|------|-------------------|-----------------|
| Front | bbox X range | bbox Y range |
| Top | bbox X range | bbox Z range |
| Left | bbox Z range | bbox Y range |
| Right | bbox Z range | bbox Y range |

Apply a 0.85 padding factor so the model doesn't touch the viewport edges.

---

## Sheet Presets

Support at least:

| Name | Page Size | Orientation | Viewports |
|------|-----------|-------------|-----------|
| Single View – Letter | 11 × 8.5" | Landscape | 1 large front view |
| Single View – A4 | 297 × 210mm | Landscape | 1 large front view |
| 3-View – Letter | 11 × 8.5" | Landscape | Front + Top + Right |
| 4-View – D Size | 34 × 22" | Landscape | Front + Top + Right + Iso |

Start with **Single View – Letter** as the default. Others can come later.

---

## Functions to Implement

### `createSheet(preset, partName)`

Returns a Sheet object with all fields populated. Calculates viewport scales based on current model bounding box.

### `getViewExtents(viewName)`

Returns `{ horizontal, vertical }` extents of the model in the given view direction. Uses the bounding box from `currentGroup`.

### `calculateViewportScale(viewport, extents)`

Returns the scale factor for a viewport given model extents.

### `modelToSheet(point3D, viewport)`

Converts a 3D model point to 2D sheet coordinates (inches from bottom-left of page). This is the critical function that Phase 3 and Phase 4 will call heavily.

**Logic:**
1. Select the two axes visible in this viewport's view (e.g., Front view → X horizontal, Y vertical)
2. Subtract model center to center the model in the viewport
3. Multiply by viewport scale
4. Add viewport center position on the sheet

```javascript
function modelToSheet(point3D, viewport) {
    const extents = getViewExtents(viewport.view);
    const scale = viewport.scale;

    let hModelVal, vModelVal;   // which 3D axes map to horizontal/vertical
    let hCenter, vCenter;       // model center in those axes

    switch (viewport.view) {
        case 'front':
            hModelVal = point3D.x; vModelVal = point3D.y;
            hCenter = modelCenter.x; vCenter = modelCenter.y;
            break;
        case 'top':
            hModelVal = point3D.x; vModelVal = -point3D.z; // Z flips for top view
            hCenter = modelCenter.x; vCenter = -modelCenter.z;
            break;
        case 'left':
            hModelVal = -point3D.z; vModelVal = point3D.y;
            hCenter = -modelCenter.z; vCenter = modelCenter.y;
            break;
        case 'right':
            hModelVal = point3D.z; vModelVal = point3D.y;
            hCenter = modelCenter.z; vCenter = modelCenter.y;
            break;
    }

    const vpCenterX = viewport.x + viewport.width / 2;
    const vpCenterY = viewport.y + viewport.height / 2;

    return {
        x: vpCenterX + (hModelVal - hCenter) * scale,
        y: vpCenterY + (vModelVal - vCenter) * scale
    };
}
```

---

## State Additions

Add to `js/state.js`:

```javascript
export let currentSheet = null;
export function setCurrentSheet(val) { currentSheet = val; }
```

---

## UI Changes

Add an "Export" button to the controls bar (inactive until Phase 5 wires it up). For now, just the data model and a console log showing the sheet configuration when a STEP file is loaded.

No preview rendering is needed in Phase 1 – the sheet model is consumed by later phases.

---

## Acceptance Criteria

1. After loading a STEP file, `currentSheet` is populated with correct page dimensions
2. `modelToSheet()` correctly maps the model bounding box corners to the expected viewport region on the sheet
3. For a 6"×4"×2" part in front view on Letter landscape, the viewport scale leaves ~15% padding on all sides
4. Changing the view (front/top/left/right) and calling `getViewExtents()` returns the correct axis ranges
5. All existing functionality (3D viewer, annotations, edge classification) continues to work unchanged
