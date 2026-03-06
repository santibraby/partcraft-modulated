# Phase 5: PDF Assembly

## Goal

Combine all four data layers into a single layered PDF file using jsPDF. Each layer maps to a PDF Optional Content Group (OCG) so users can toggle visibility in Acrobat/Bluebeam.

## New Module

**`js/pdf.js`**

## Dependencies

- `js/sheet.js` (page size, title block)
- `js/export.js` (raster capture → PNG data URL)
- `js/projection.js` (projected edges, projected annotations)
- `js/state.js` (current sheet, annotation level)
- **jsPDF** (loaded via CDN as global `window.jspdf`)

---

## CDN Addition

Add to `index.html` before the app module script:

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
```

Access via `const { jsPDF } = window.jspdf;`

---

## PDF Coordinate System

jsPDF default: origin at **top-left**, Y increases **downward**, units in **points** (72 per inch).

Our sheet model: origin at **bottom-left**, Y increases **upward**, units in **inches**.

**Conversion:**

```javascript
function sheetToPdf(sheetX, sheetY, pageHeightInches) {
    return {
        x: sheetX * 72,                                    // inches → points
        y: (pageHeightInches - sheetY) * 72                // flip Y, inches → points
    };
}
```

Apply this to every coordinate before passing to jsPDF.

---

## Layer Architecture

| PDF Layer (OCG) | Content | Source |
|-----------------|---------|--------|
| `Shading` | Raster PNG of shaded model | `export.js captureViewportRaster()` |
| `Lines` | Vector edge lines | `projection.js projectEdgesToSheet()` |
| `Dimensions` | Leader lines, text, title block | `projection.js projectAnnotations()` + `sheet.js generateTitleBlock()` |
| `Markup` | User annotations (Phase 6) | `markup.js` (added later) |

---

## Functions to Implement

### `generatePDF(sheet, options)`

Main entry point. Returns a `jsPDF` instance (caller can `.save()` or `.output()`).

**Parameters:**
```javascript
options = {
    dpi: 150,                // raster resolution
    annotationLevel: 2,      // 0-3
    includeRaster: true,     // include shading layer
    includeVectors: true,    // include edge lines layer
    includeDimensions: true, // include dimensions layer
    filename: 'partcraft-export.pdf'
}
```

**Steps:**

```javascript
async function generatePDF(sheet, options) {
    const { jsPDF } = window.jspdf;

    // 1. Create PDF document
    const doc = new jsPDF({
        orientation: sheet.pageWidth > sheet.pageHeight ? 'landscape' : 'portrait',
        unit: 'pt',         // points
        format: [sheet.pageWidth * 72, sheet.pageHeight * 72]
    });

    // 2. Draw sheet border and title block (always present)
    drawSheetBorder(doc, sheet);
    drawTitleBlock(doc, sheet);

    // 3. Layer 1: Raster shading
    if (options.includeRaster) {
        for (const vp of sheet.viewports.filter(v => v.active)) {
            const pngDataUrl = await captureViewportRaster(vp, options.dpi);
            const pdfPos = sheetToPdf(vp.x, vp.y + vp.height, sheet.pageHeight);
            doc.addImage(
                pngDataUrl, 'PNG',
                pdfPos.x, pdfPos.y,
                vp.width * 72, vp.height * 72
            );
        }
    }

    // 4. Layer 2: Vector lines
    if (options.includeVectors) {
        for (const vp of sheet.viewports.filter(v => v.active)) {
            const projection = projectEdgesToSheet(vp);
            drawVectorEdges(doc, projection, sheet.pageHeight);
        }
    }

    // 5. Layer 3: Dimensions
    if (options.includeDimensions && options.annotationLevel > 0) {
        for (const vp of sheet.viewports.filter(v => v.active)) {
            const annoGeom = getAnnotationGeometry3D(vp.view, options.annotationLevel);
            const annoPrimitives = projectAnnotations(vp, annoGeom);
            drawAnnotationPrimitives(doc, annoPrimitives, sheet.pageHeight);
        }
    }

    return doc;
}
```

### `drawSheetBorder(doc, sheet)`

Draws the outer page border (thin black rectangle inset 0.25" from page edges).

```javascript
function drawSheetBorder(doc, sheet) {
    const border = { x: 0.25, y: 0.25, w: sheet.pageWidth - 0.5, h: sheet.pageHeight - 0.5 };
    doc.setDrawColor(0);
    doc.setLineWidth(1);  // 1pt
    const tl = sheetToPdf(border.x, border.y + border.h, sheet.pageHeight);
    doc.rect(tl.x, tl.y, border.w * 72, border.h * 72);
}
```

### `drawTitleBlock(doc, sheet)`

Renders the title block cells, labels, and values.

```javascript
function drawTitleBlock(doc, sheet) {
    const tb = generateTitleBlock(sheet);

    // Draw cell borders
    doc.setDrawColor(0);
    doc.setLineWidth(0.5);
    for (const cell of tb.cells) {
        const tl = sheetToPdf(cell.x, cell.y + cell.height, sheet.pageHeight);
        doc.rect(tl.x, tl.y, cell.width * 72, cell.height * 72);

        // Label (small, gray)
        doc.setFontSize(6);
        doc.setTextColor(128);
        const labelPos = sheetToPdf(cell.x + 0.05, cell.y + cell.height - 0.05, sheet.pageHeight);
        doc.text(cell.label, labelPos.x, labelPos.y);

        // Value (larger, black, bold)
        doc.setFontSize(10);
        doc.setTextColor(0);
        doc.setFont('helvetica', 'bold');
        const valPos = sheetToPdf(cell.x + 0.05, cell.y + 0.1, sheet.pageHeight);
        doc.text(cell.value, valPos.x, valPos.y);
        doc.setFont('helvetica', 'normal');
    }
}
```

### `drawVectorEdges(doc, projection, pageHeight)`

Draws projected edge lines to the PDF.

```javascript
function drawVectorEdges(doc, projection, pageHeight) {
    doc.setDrawColor(0);        // black

    for (const edge of projection.edges) {
        // Line weight based on visibility
        doc.setLineWidth(edge.visible ? 0.3 : 0.15);

        // Dash pattern for hidden lines
        if (!edge.visible) {
            // jsPDF doesn't have native dash support in all versions
            // Use setLineDash if available, otherwise draw as solid
        }

        if (edge.type === 'circle' && edge.center2D && edge.radius2D) {
            // Draw circle
            const c = sheetToPdf(edge.center2D.x, edge.center2D.y, pageHeight);
            doc.circle(c.x, c.y, edge.radius2D * 72, 'S');  // 'S' = stroke only
        } else {
            // Draw polyline
            const pts = edge.points2D;
            if (pts.length < 2) continue;
            for (let i = 0; i < pts.length - 1; i++) {
                const a = sheetToPdf(pts[i].x, pts[i].y, pageHeight);
                const b = sheetToPdf(pts[i+1].x, pts[i+1].y, pageHeight);
                doc.line(a.x, a.y, b.x, b.y);
            }
        }
    }
}
```

### `drawAnnotationPrimitives(doc, primitives, pageHeight)`

Draws dimension leaders, text, and arrowheads.

```javascript
function drawAnnotationPrimitives(doc, primitives, pageHeight) {
    for (const prim of primitives) {
        switch (prim.type) {
            case 'leader-line': {
                doc.setDrawColor(68, 136, 255);  // #4488ff
                doc.setLineWidth(prim.lineWeight || 0.3);
                const pts = prim.points2D;
                for (let i = 0; i < pts.length - 1; i++) {
                    const a = sheetToPdf(pts[i].x, pts[i].y, pageHeight);
                    const b = sheetToPdf(pts[i+1].x, pts[i+1].y, pageHeight);
                    doc.line(a.x, a.y, b.x, b.y);
                }
                break;
            }
            case 'text': {
                doc.setFontSize(prim.fontSize || 8);
                doc.setTextColor(68, 136, 255);
                const pos = sheetToPdf(prim.position2D.x, prim.position2D.y, pageHeight);
                // Handle rotation for bottom annotations
                if (prim.rotation) {
                    doc.text(prim.text, pos.x, pos.y, { angle: prim.rotation });
                } else {
                    doc.text(prim.text, pos.x, pos.y, { align: prim.align || 'left' });
                }
                break;
            }
            case 'arrowhead': {
                doc.setFillColor(68, 136, 255);
                const tip = sheetToPdf(prim.tip2D.x, prim.tip2D.y, pageHeight);
                // Draw filled triangle
                // Calculate base points from tip, direction, and size
                // ... (use prim.direction2D and prim.size)
                break;
            }
            case 'centermark': {
                doc.setDrawColor(68, 136, 255);
                doc.setLineWidth(0.2);
                // Draw dashed crosshair at center
                // ... (use prim.center2D and prim.size)
                break;
            }
        }
    }
}
```

---

## UI Changes

### Export Button

Add to the controls bar in `index.html`:

```html
<div class="toggle-group">
    <label>Export</label>
    <div class="toggle-buttons">
        <button class="toggle-btn" id="btn-export-pdf">PDF</button>
        <button class="toggle-btn" id="btn-export-png">PNG</button>
    </div>
</div>
```

### Export Flow

When user clicks "PDF":

1. Show status: "Generating PDF..."
2. Create sheet from current view and model
3. Call `generatePDF(sheet, options)`
4. Trigger download: `doc.save(filename)`
5. Show status: "✓ PDF exported!"

### Settings (future)

Eventually: a modal dialog letting the user choose page size, DPI, annotation level, which layers to include. For v1, use sensible defaults (Letter landscape, 150 DPI, L2 annotations, all layers on).

---

## Optional Content Groups (OCG)

jsPDF v2.5+ supports OCG via internal API. If available, wrap each layer in an OCG so Acrobat shows a layer panel:

```javascript
// This is aspirational – test whether jsPDF supports it
doc.setOCGState(true, 'Shading');
// ... draw raster layer ...
doc.setOCGState(true, 'Lines');
// ... draw vector layer ...
```

If jsPDF's OCG support is unreliable, skip it for v1 and draw everything in a single content stream. The layers still exist conceptually in the code, even if the PDF doesn't have togglable layers yet.

---

## Acceptance Criteria

1. Clicking "Export PDF" downloads a valid PDF file that opens in Acrobat/Chrome
2. PDF page size matches the sheet definition (Letter landscape = 11" × 8.5")
3. Sheet border and title block are drawn in correct positions
4. Raster shading layer shows the model centered in the viewport
5. Vector edges overlay the raster cleanly (lines align with shaded geometry)
6. Dimension leaders, text values, and arrowheads appear in correct positions
7. Dimension text is readable at 100% zoom (8pt minimum)
8. Title block shows correct part name, current date, and scale
9. PDF file size is reasonable (<5MB for typical parts at 150 DPI)
10. Export completes in <5 seconds for a typical part
