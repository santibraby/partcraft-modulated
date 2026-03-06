# Phase 4: Dimension & Title Export (Layer 3)

## Goal

Project the annotation system's ordinate dimensions and diameter callouts into 2D sheet coordinates, and generate a title block. This produces Layer 3 of the PDF – all text and dimension graphics.

## Module Changes

- **Update `js/annotations.js`** – add a function that returns annotation geometry as data (not Three.js objects)
- **Update `js/projection.js`** – add annotation projection functions
- **New data in `js/sheet.js`** – title block rendering data

## Dependencies

- `js/sheet.js` (`modelToSheet()`, `currentSheet`, title block definition)
- `js/projection.js` (`projectPoint()`)
- `js/annotations.js` (existing feature point extraction, view-axis mapping)
- `js/state.js` (`analysisResults`, `annotationLevel`, `currentView`)

---

## Core Concept

The existing annotation system in `annotations.js` builds Three.js objects (lines, sprites, meshes) in 3D space. For PDF export, we need the same geometry as abstract 2D primitives: line segments, text labels, and arrowheads. The approach is to factor out the annotation *calculation* from the annotation *rendering*, then project the calculated geometry to 2D.

---

## Data Structures

### AnnotationPrimitive

```javascript
// A single drawable annotation element
{
    type: 'leader-line' | 'text' | 'arrowhead' | 'centermark',

    // For leader-line:
    points2D: [ { x, y }, ... ],        // sheet coordinates
    lineWeight: 0.2,                     // points
    color: '#4488ff',
    dashPattern: null,                   // null = solid, [2, 1] = dashed

    // For text:
    text: '1.500"',
    position2D: { x, y },               // sheet coordinates
    fontSize: 8,                         // points
    align: 'right' | 'left' | 'center',
    rotation: 0,                         // degrees

    // For arrowhead:
    tip2D: { x, y },
    direction2D: { x, y },              // unit vector pointing toward tip
    size: 0.06,                          // inches

    // For centermark:
    center2D: { x, y },
    size: 0.1,                           // half-length of each dash
    dashPattern: [0.03, 0.02]            // dash, gap
}
```

### DimensionExportResult

```javascript
{
    viewportId: 'front',
    level: 2,                            // annotation level used
    primitives: [ AnnotationPrimitive, ... ],
    titleBlock: TitleBlockData
}
```

### TitleBlockData

```javascript
{
    // Outer border
    border: { x, y, width, height },     // sheet coordinates

    // Cell positions and text
    cells: [
        { label: 'PART NAME', value: 'Widget Bracket', x, y, width, height },
        { label: 'DATE', value: '2025-06-15', x, y, width, height },
        { label: 'SCALE', value: '1:2', x, y, width, height },
        { label: 'DRAWN BY', value: 'Partcraft', x, y, width, height },
        { label: 'SHEET', value: '1/1', x, y, width, height },
        { label: 'UNITS', value: 'INCHES', x, y, width, height },
    ],

    // Sheet border (outermost rectangle)
    sheetBorder: { x: 0.25, y: 0.25, width: 10.5, height: 8.0 }
}
```

---

## Functions to Implement

### In `js/annotations.js` – ADD:

#### `getAnnotationGeometry3D(view, level)`

Returns the raw 3D geometry of all annotations for a given view and level, WITHOUT creating Three.js objects. This extracts the calculation logic from the existing `createAnnotations()`, `createSideAnnotations()`, and `createDiameterAnnotations()` functions.

**Returns:**
```javascript
{
    leaderLines: [
        { points: [ vec3, vec3, vec3, vec3 ], type: 'ordinate' },
        { points: [ vec3, vec3, vec3 ], type: 'diameter' }
    ],
    textLabels: [
        { text: '1.500"', position: vec3, rotation: 0, align: 'right' },
        { text: 'Ø 0.500"', position: vec3, rotation: 0, align: 'left' }
    ],
    arrowheads: [
        { tip: vec3, baseLeft: vec3, baseRight: vec3 }
    ],
    centermarks: [
        { center: vec3, horizontalAxis: 'x' | 'z', verticalAxis: 'y' | 'z' }
    ]
}
```

**Implementation:** Refactor `createSideAnnotations()` and `createDiameterAnnotations()` so the core calculation is shared. The existing functions call the new one then build Three.js objects; the new function just returns data.

### In `js/projection.js` – ADD:

#### `projectAnnotations(viewport, annotationGeometry3D)`

Takes the 3D annotation geometry and projects everything to 2D sheet coordinates.

**Steps:**
1. For each leader line: project each 3D point via `projectPoint()`
2. For each text label: project position, keep rotation and align
3. For each arrowhead: project all three vertices
4. For each centermark: project center point
5. Return array of `AnnotationPrimitive` objects

### In `js/sheet.js` – ADD:

#### `generateTitleBlock(sheet)`

Generates `TitleBlockData` with all cell positions calculated from the sheet's title block definition.

**Title block layout (standard engineering drawing format):**

```
+------------------------------------------+
| PART NAME                    Widget Bracket|
+--------------------+---------------------+
| DATE    2025-06-15 | SCALE          1:2  |
+--------------------+---------------------+
| DRAWN BY Partcraft | SHEET    1/1  INCHES|
+--------------------+---------------------+
```

All coordinates in sheet inches. Border drawn with 0.5pt black lines. Labels in 6pt gray. Values in 8pt black bold.

---

## Refactoring Strategy for `annotations.js`

The goal is to NOT break the existing 3D annotation system while adding 2D export capability.

**Before (current):**
```
createAnnotations() → builds Three.js Group with lines/sprites/meshes
```

**After (refactored):**
```
getAnnotationGeometry3D() → returns raw data (points, text, arrows)
    ↕ (shared calculation)
createAnnotations() → calls getAnnotationGeometry3D() then builds Three.js objects
projectAnnotations() → calls getAnnotationGeometry3D() then projects to 2D
```

The shared calculation includes:
- View-axis mapping (which axis is left, bottom, plane)
- Feature point extraction and deduplication
- Ordinate position calculation (P1→P2→P3→P4 elbow)
- Diameter leader line positions
- Text values and formatting

---

## Text Sizing for PDF

Three.js sprites auto-scale with the camera. PDF text has a fixed point size. The conversion:

- Title block labels: 6pt, gray (#888888)
- Title block values: 10pt, black, bold
- Dimension values: 8pt, blue (#4488ff)
- Diameter values: 8pt, blue (#4488ff)
- Sheet border line weight: 1pt
- Dimension leader lines: 0.3pt

These are standard engineering drawing conventions.

---

## Acceptance Criteria

1. `getAnnotationGeometry3D('front', 2)` returns leader lines, text, and arrows matching what the 3D viewer shows
2. `projectAnnotations()` correctly maps 3D annotation geometry to 2D sheet coordinates
3. Projected dimension text values match 3D annotation text (same numbers, same formatting)
4. Title block renders in the correct position (bottom-right of drawable area)
5. Title block fields are populated from the sheet and part data (name, date, scale)
6. Refactoring does NOT break the existing 3D annotation display – all 3 levels still render correctly in the 3D viewer
7. For L2 annotations on a part with 3 holes: 3 diameter callouts appear with correct Ø values
