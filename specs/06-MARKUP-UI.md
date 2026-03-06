# Phase 6: Markup UI (Layer 4)

## Goal

Add a simple annotation/markup overlay that lets users draw on the PDF preview before exporting. Think Bluebeam-lite: freehand pen, text boxes, rectangles, clouds, and stamps. Markups export as PDF annotation objects that other tools (Acrobat, Bluebeam) can read and edit.

## New Module

**`js/markup.js`**

## Dependencies

- `js/sheet.js` (page dimensions for coordinate mapping)
- `js/state.js` (markup state storage)
- `js/pdf.js` (markup export to PDF annotations)

---

## Architecture

The markup system has three parts:

1. **Data Model** – array of markup objects stored in state
2. **Overlay Canvas** – transparent `<canvas>` element positioned over the PDF preview, handles mouse input
3. **PDF Export** – converts markup data to jsPDF annotation objects

---

## Markup Data Model

### MarkupElement

```javascript
{
    id: 'mk_001',
    type: 'pen' | 'text' | 'rect' | 'cloud' | 'stamp',
    created: '2025-06-15T10:30:00Z',

    // Coordinates in sheet space (inches from bottom-left)
    // All markup types use these differently:

    // pen: array of points
    points: [ { x, y }, { x, y }, ... ],

    // text: single position + content
    position: { x, y },
    text: 'Check this dimension',
    fontSize: 10,

    // rect: corner + size
    origin: { x, y },
    width: 2.0,
    height: 1.0,

    // cloud: same as rect but rendered with scalloped edges
    // stamp: same as rect but with predefined content

    // Common style
    color: '#ff0000',
    lineWeight: 1.0,        // points
    opacity: 1.0,

    // Stamp-specific
    stampType: 'APPROVED' | 'REJECTED' | 'FOR REVIEW' | 'DRAFT'
}
```

### State Addition

```javascript
// In state.js:
export let markupElements = [];
export function setMarkupElements(val) { markupElements = val; }
export function addMarkupElement(el)   { markupElements.push(el); }
export function removeMarkupElement(id) { markupElements = markupElements.filter(e => e.id !== id); }

export let activeMarkupTool = null;    // null | 'pen' | 'text' | 'rect' | 'cloud' | 'stamp'
export function setActiveMarkupTool(val) { activeMarkupTool = val; }
```

---

## UI Design

### Markup Toolbar

Add a toolbar that appears when viewing the PDF preview (not during normal 3D viewing):

```html
<div class="markup-toolbar" id="markup-toolbar" style="display: none;">
    <button class="markup-btn" data-tool="pen" title="Freehand Pen">✏️</button>
    <button class="markup-btn" data-tool="text" title="Text Box">T</button>
    <button class="markup-btn" data-tool="rect" title="Rectangle">▭</button>
    <button class="markup-btn" data-tool="cloud" title="Cloud">☁</button>
    <button class="markup-btn" data-tool="stamp" title="Stamp">◉</button>
    <span class="markup-separator"></span>
    <input type="color" id="markup-color" value="#ff0000" title="Color">
    <button class="markup-btn" data-action="undo" title="Undo">↩</button>
    <button class="markup-btn" data-action="clear" title="Clear All">🗑</button>
</div>
```

### Overlay Canvas

A `<canvas>` element sized to match the PDF preview area. It sits on top of the preview with `position: absolute` and `pointer-events: auto` when a markup tool is active.

```javascript
const overlayCanvas = document.createElement('canvas');
overlayCanvas.id = 'markup-overlay';
overlayCanvas.style.cssText = 'position: absolute; top: 0; left: 0; pointer-events: none; z-index: 10;';
previewContainer.appendChild(overlayCanvas);
```

When a tool is active: `pointer-events: auto` (captures mouse).
When no tool is active: `pointer-events: none` (click-through to preview).

---

## Tool Implementations

### Pen Tool

**mousedown:** Start a new pen markup, begin collecting points
**mousemove:** Add points to the current markup, draw incrementally on the overlay
**mouseup:** Finalize the markup, simplify the point array (Douglas-Peucker with 0.01" tolerance)

Point simplification is important – raw mousemove events produce far too many points.

```javascript
function simplifyPoints(points, tolerance) {
    // Douglas-Peucker algorithm
    // Reduces a 500-point freehand stroke to ~30-50 points
    // Keeps visual fidelity while reducing PDF file size
}
```

### Text Tool

**click:** Show an input field at the click position
**Enter/blur:** Finalize the text markup

The input field is a temporary `<input>` or `<textarea>` element positioned absolutely over the canvas. After the user types and confirms, it becomes a markup element and the input is removed.

### Rectangle Tool

**mousedown:** Record origin corner
**mousemove:** Draw preview rectangle on overlay
**mouseup:** Finalize with origin, width, height

### Cloud Tool

Same interaction as rectangle, but rendered with scalloped edges (series of small arcs along the perimeter).

**Cloud arc rendering:**
```javascript
function drawCloudRect(ctx, x, y, w, h, arcRadius = 8) {
    // Walk along the perimeter, drawing arcs
    const perimeter = 2 * (w + h);
    const numArcs = Math.round(perimeter / (arcRadius * 1.5));
    const arcStep = perimeter / numArcs;

    ctx.beginPath();
    for (let i = 0; i < numArcs; i++) {
        // Calculate arc center on the perimeter
        // Draw a small arc that bulges outward
    }
    ctx.stroke();
}
```

### Stamp Tool

**click:** Place a predefined stamp graphic at the click position

Stamps are rectangles with bold text inside:
- APPROVED → green border, green text
- REJECTED → red border, red text
- FOR REVIEW → orange border, orange text
- DRAFT → gray border, gray text

Each stamp is 1.5" × 0.5" and contains the stamp text + date.

---

## Overlay Rendering

All markup elements are re-rendered on the overlay canvas whenever the markup list changes:

```javascript
function renderMarkupOverlay() {
    const ctx = overlayCanvas.getContext('2d');
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    for (const mk of markupElements) {
        ctx.strokeStyle = mk.color;
        ctx.lineWidth = mk.lineWeight;
        ctx.globalAlpha = mk.opacity;

        switch (mk.type) {
            case 'pen': drawPenMarkup(ctx, mk); break;
            case 'text': drawTextMarkup(ctx, mk); break;
            case 'rect': drawRectMarkup(ctx, mk); break;
            case 'cloud': drawCloudMarkup(ctx, mk); break;
            case 'stamp': drawStampMarkup(ctx, mk); break;
        }
    }
}
```

**Coordinate conversion:** The overlay canvas uses pixel coordinates. Convert from sheet inches:

```javascript
function sheetToCanvas(sheetX, sheetY) {
    const scaleX = overlayCanvas.width / currentSheet.pageWidth;
    const scaleY = overlayCanvas.height / currentSheet.pageHeight;
    return {
        x: sheetX * scaleX,
        y: (currentSheet.pageHeight - sheetY) * scaleY    // flip Y
    };
}

function canvasToSheet(canvasX, canvasY) {
    const scaleX = currentSheet.pageWidth / overlayCanvas.width;
    const scaleY = currentSheet.pageHeight / overlayCanvas.height;
    return {
        x: canvasX * scaleX,
        y: currentSheet.pageHeight - canvasY * scaleY      // flip Y
    };
}
```

---

## PDF Export Integration

### In `js/pdf.js` – ADD:

#### `drawMarkupLayer(doc, markupElements, pageHeight)`

Converts markup elements to PDF drawing commands:

```javascript
function drawMarkupLayer(doc, markupElements, pageHeight) {
    for (const mk of markupElements) {
        doc.setDrawColor(mk.color);
        doc.setLineWidth(mk.lineWeight);

        switch (mk.type) {
            case 'pen': {
                const pts = mk.points;
                for (let i = 0; i < pts.length - 1; i++) {
                    const a = sheetToPdf(pts[i].x, pts[i].y, pageHeight);
                    const b = sheetToPdf(pts[i+1].x, pts[i+1].y, pageHeight);
                    doc.line(a.x, a.y, b.x, b.y);
                }
                break;
            }
            case 'text': {
                const pos = sheetToPdf(mk.position.x, mk.position.y, pageHeight);
                doc.setFontSize(mk.fontSize);
                doc.setTextColor(mk.color);
                doc.text(mk.text, pos.x, pos.y);
                break;
            }
            case 'rect': {
                const tl = sheetToPdf(mk.origin.x, mk.origin.y + mk.height, pageHeight);
                doc.rect(tl.x, tl.y, mk.width * 72, mk.height * 72, 'S');
                break;
            }
            // cloud, stamp similar...
        }
    }
}
```

### PDF Annotation Objects (stretch goal)

For interoperability with Acrobat/Bluebeam, markups should ideally be PDF annotation objects (`/Type /Annot`) rather than drawn content. jsPDF has limited annotation support, but it can create:

- Text annotations (sticky notes)
- Ink annotations (freehand)
- Square/circle annotations

This is a stretch goal. For v1, drawing markups directly into the content stream is fine. Users can still see them; they just can't edit them in Acrobat.

---

## Undo System

Simple array-based undo:

```javascript
let undoStack = [];

function addMarkup(element) {
    addMarkupElement(element);
    undoStack.push(element.id);
    renderMarkupOverlay();
}

function undo() {
    const lastId = undoStack.pop();
    if (lastId) {
        removeMarkupElement(lastId);
        renderMarkupOverlay();
    }
}
```

---

## PDF Preview Mode

This phase requires a new UI mode: **PDF Preview**. The flow is:

1. User loads STEP file → 3D viewer (existing)
2. User clicks "Export PDF" → enters PDF Preview mode
3. PDF Preview shows a 2D rendering of the sheet with all layers
4. Markup toolbar appears
5. User adds markups
6. User clicks "Download PDF" → generates and saves
7. User clicks "Back to 3D" → returns to the 3D viewer

The PDF Preview is a `<canvas>` or `<div>` that replaces the 3D viewer temporarily. It renders the same content as the PDF at screen resolution.

---

## Acceptance Criteria

1. Markup toolbar appears in PDF Preview mode with all 5 tools
2. Pen tool: freehand drawing appears on the overlay, strokes are smooth
3. Text tool: clicking places a text input, submitting creates a text markup
4. Rectangle tool: drag-to-draw creates a rectangle outline
5. Cloud tool: drag-to-draw creates a scalloped rectangle
6. Stamp tool: clicking places a stamp with text and date
7. Color picker changes the color of subsequent markups
8. Undo removes the last markup
9. Clear removes all markups (with confirmation)
10. All markups survive PDF export – they appear in the downloaded PDF
11. Returning to 3D view and re-entering PDF Preview preserves markups
12. Markups are positioned correctly relative to the drawing (aligned with model features)
