# Phase 3: Vector Edge Projection (Layer 2)

## Goal

Project 3D classified edge chains into 2D sheet coordinates to produce crisp, scalable vector lines for the PDF. This is the technical core of the pipeline – Phase 4 (dimensions) reuses the same projection math.

## New Module

**`js/projection.js`**

## Dependencies

- `js/sheet.js` (`modelToSheet()`, `getViewExtents()`)
- `js/state.js` (`analysisResults`, `modelCenter`)
- `js/edges.js` (access to classified edge data)
- `js/math.js` (vector ops)

---

## Core Concept

The classified edge data in `analysisResults.partcraft.curveDetails` contains arrays of 3D points for every edge chain, already tagged as `line`, `arc`, or `circle`. Projection means: for each 3D point, call `modelToSheet()` to get a 2D sheet coordinate. The result is a set of 2D polylines, arcs, and circles with metadata.

---

## Data Structures

### Projected Edge

```javascript
{
    type: 'line' | 'arc' | 'circle',
    points2D: [ { x, y }, { x, y }, ... ],    // sheet coordinates (inches)
    chainIndex: 0,                              // original chain index

    // Only for arcs/circles:
    center2D: { x, y } | null,                 // projected center
    radius2D: 0.0,                             // radius in sheet inches
    startAngle: 0,                             // degrees (for arc PDF commands)
    endAngle: 0,

    // Visibility
    facing: 'front' | 'back',                  // for hidden-line classification
    visible: true                              // after hidden-line pass
}
```

### ProjectionResult

```javascript
{
    viewportId: 'front',
    edges: [ ProjectedEdge, ... ],
    boundingBox: { minX, minY, maxX, maxY }    // sheet coordinates
}
```

---

## Functions to Implement

### `projectEdgesToSheet(viewport)`

Main entry point. Returns a `ProjectionResult`.

**Steps:**

1. Read `analysisResults.partcraft.curveDetails`
2. For each curve:
   a. Project every 3D point via `modelToSheet(point3D, viewport)`
   b. If type is `arc` or `circle`, also project the center
   c. Calculate the 2D radius as `distance(center2D, points2D[0])`
   d. For arcs, calculate start/end angles in 2D via `atan2`
3. Classify visibility (see Hidden Line Strategy below)
4. Return the ProjectionResult

### `projectPoint(point3D, viewport)`

Thin wrapper around `sheet.modelToSheet()`. Exists so projection.js has a single entry point for coordinate transforms that can be reused by Phase 4.

### `classifyEdgeVisibility(curveDetail, viewDirection)`

Determines if an edge should be drawn solid (front-facing) or dashed (back-facing).

**Method:** For each edge chain, check the face normals of the adjacent B-rep faces. If both adjacent faces point toward the camera (dot product with view direction > 0), the edge is front-facing. If both point away, it's back-facing. If one faces toward and one away, it's a silhouette edge (always visible).

**Simplified approach for v1:** Since occt-import-js doesn't expose face-edge adjacency directly, use a simpler heuristic:

1. For each edge segment, sample the midpoint
2. Cast a ray from the camera through that midpoint
3. If the midpoint is on the near side of the model (comparing depth values), mark visible
4. Otherwise mark as hidden

**Even simpler for v0 (ship first):** Draw ALL edges as solid. Add hidden-line removal as a follow-up. Most engineering drawings include hidden lines (just dashed), so showing everything is actually useful.

### `projectArcTo2D(arcCurve, viewport)`

Special handling for arc/circle projection:

1. Project center to 2D
2. Project a point on the arc to 2D
3. 2D radius = distance between projected center and projected point
4. For arcs: project start point and end point, calculate 2D angles via:
   ```javascript
   const startAngle = Math.atan2(startPt2D.y - center2D.y, startPt2D.x - center2D.x);
   const endAngle = Math.atan2(endPt2D.y - center2D.y, endPt2D.x - center2D.x);
   ```
5. This gives you the data needed for a PDF arc command (or jsPDF's `ellipse` / manual arc path)

**Important:** In orthographic projection, circles viewed head-on remain circles. Circles viewed at an angle become ellipses. For the four standard views (front/top/left/right), all features in the plane of the view project as true circles. Features perpendicular to the view plane project as lines (which is correct – they're edge-on). So for standard views, circle→circle projection is correct.

---

## View Direction Vectors

For depth sorting and visibility:

| View | View Direction (camera looks along) | Depth Axis |
|------|--------------------------------------|------------|
| Front | -Z | Z (higher Z = nearer) |
| Top | -Y | Y (higher Y = nearer) |
| Left | +X | X (lower X = nearer) |
| Right | -X | X (higher X = nearer) |

---

## Line Style Mapping

| Edge State | PDF Line Style |
|------------|---------------|
| Visible edge | Solid, 0.3pt weight, black |
| Hidden edge | Dashed (2pt dash, 1pt gap), 0.15pt weight, gray |
| Silhouette | Solid, 0.5pt weight, black |
| Construction | Dot-dash, 0.1pt, light gray (future) |

For v1: just solid black for all edges. Add dash patterns in a follow-up.

---

## Optimization Notes

- The projection is pure math (no GPU involved). Even a model with 10,000 edge points projects in <1ms.
- Group edges by type for efficient PDF output: all lines in one path, all arcs as arc commands, etc.
- Pre-sort edges by depth for eventual hidden-line removal.

---

## Immediate Testability

Before PDF exists, render the projected 2D edges onto a `<canvas>` element overlaid on the page:

```javascript
function debugDrawProjection(projectionResult) {
    const canvas = document.createElement('canvas');
    canvas.width = 1100; canvas.height = 850;  // 100 DPI letter
    const ctx = canvas.getContext('2d');

    // White background
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw edges
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    for (const edge of projectionResult.edges) {
        ctx.beginPath();
        const pts = edge.points2D;
        ctx.moveTo(pts[0].x * 100, canvas.height - pts[0].y * 100); // flip Y
        for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].x * 100, canvas.height - pts[i].y * 100);
        }
        ctx.stroke();
    }

    document.body.appendChild(canvas);
}
```

This gives instant visual feedback on whether the projection is correct.

---

## Edge Cases

- **Degenerate edges:** After projection, some 3D edges may collapse to a point in 2D (edge-on to the camera). Filter out edges where all projected points are within 0.001" of each other.
- **Very short edges:** Keep them – they may be small features like chamfer breaks.
- **Duplicate edges:** Two faces can share an edge, which occt-import-js may report twice. `detectEdgesPartcraft` already deduplicates via chaining, but verify after projection.
- **Arc distortion:** If an arc is not in a plane parallel to the view plane, its projection is an ellipse, not a circular arc. For v1, render it as a polyline (the projected points will trace the ellipse). True ellipse fitting is a future enhancement.

---

## Acceptance Criteria

1. `projectEdgesToSheet()` returns 2D points in correct sheet coordinates (inches from bottom-left)
2. For a front view of a rectangular block: projected edges form a rectangle matching the X/Y bounding box, centered in the viewport
3. For a front view of a plate with holes: holes project as circles with correct 2D center and radius
4. Debug canvas rendering matches the Three.js orthographic view (same shape, same proportions)
5. All edge types (line/arc/circle) are present in the projection result with correct metadata
6. Performance: projection of 500+ edge chains completes in <10ms
7. Existing 3D viewer is unaffected
