# Phase 2: Raster Capture (Layer 1)

## Goal

Capture the shaded 3D model as a high-resolution PNG image, positioned and sized to match a sheet viewport. This becomes Layer 1 of the PDF.

## New Module

**`js/export.js`**

## Dependencies

- `js/sheet.js` (viewport definition, scale)
- `js/state.js` (scene, meshObjects, orthoCamera, modelCenter, modelSize)
- `js/scene.js` (setView, getActiveCamera)

---

## Approach

Create a temporary off-screen `WebGLRenderer` at the target pixel resolution, set up the orthographic camera to match the viewport's view and scale, render only the shaded mesh (no edges, no annotations, no axes), and extract the canvas as a PNG data URL.

---

## Functions to Implement

### `captureViewportRaster(viewport, dpi)`

Returns a `Promise<string>` – a PNG data URL of the shaded render.

**Parameters:**
- `viewport` – a viewport object from the sheet
- `dpi` – target resolution (default 150 for screen, 300 for print)

**Steps:**

1. **Calculate pixel dimensions:**
   ```javascript
   const pixelWidth = Math.round(viewport.width * dpi);
   const pixelHeight = Math.round(viewport.height * dpi);
   ```

2. **Create off-screen renderer:**
   ```javascript
   const offRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
   offRenderer.setSize(pixelWidth, pixelHeight);
   offRenderer.setPixelRatio(1); // exact pixel control
   ```

3. **Create a clean scene for capture:**
   ```javascript
   const captureScene = new THREE.Scene();
   captureScene.background = new THREE.Color(0xffffff); // white background for print
   // Clone lights from main scene
   captureScene.add(new THREE.AmbientLight(0x404040, 0.5));
   const light1 = new THREE.DirectionalLight(0xffffff, 0.8);
   light1.position.set(50, 100, 50);
   captureScene.add(light1);
   const light2 = new THREE.DirectionalLight(0xffffff, 0.4);
   light2.position.set(-50, -50, -50);
   captureScene.add(light2);
   // Add ONLY the solid mesh (not edges, not random colors, not annotations)
   captureScene.add(meshObjects.solid.clone());
   ```

4. **Set up orthographic camera matching viewport:**
   ```javascript
   const extents = getViewExtents(viewport.view);
   const hExtent = extents.horizontal / 2;
   const vExtent = extents.vertical / 2;
   const aspect = viewport.width / viewport.height;

   // Camera frustum sized to model extents (same padding as viewport scale)
   const cam = new THREE.OrthographicCamera(
       -hExtent * 1.05, hExtent * 1.05,    // small padding
       vExtent * 1.05, -vExtent * 1.05,
       0.1, 10000
   );
   // Position camera for the view
   // Use same logic as setView() in scene.js
   ```

5. **Render and extract:**
   ```javascript
   offRenderer.render(captureScene, cam);
   const dataUrl = offRenderer.domElement.toDataURL('image/png');
   offRenderer.dispose();
   return dataUrl;
   ```

### `captureAllViewports(sheet, dpi)`

Iterates over all active viewports in the sheet and returns an array of `{ viewportId, dataUrl, x, y, width, height }` objects ready for PDF embedding.

---

## Camera Positioning per View

Reuse the exact same camera positioning logic from `scene.js setView()`:

| View | Camera Position | Up Vector |
|------|----------------|-----------|
| Front | (cx, cy, cz + dist) | (0, 1, 0) |
| Top | (cx, cy + dist, cz) | (0, 0, -1) |
| Left | (cx - dist, cy, cz) | (0, 1, 0) |
| Right | (cx + dist, cy, cz) | (0, 1, 0) |

Where `cx, cy, cz` = model center and `dist` = modelSize * 2.

**Important:** The off-screen camera frustum must be sized to match the viewport scale exactly, not the on-screen frustum. Use `getViewExtents()` from `sheet.js` to get the correct frustum dimensions.

---

## Background Options

For the raster layer:
- **White background** – standard for engineering drawings, prints cleanly
- **Transparent background** – allows vector lines underneath to show cleanly

Recommend: white background with reduced opacity (80%) when composited in PDF, so vector lines are visible through it. Or: render with transparent background (`alpha: true` in WebGLRenderer constructor, no scene background) and let the PDF white page show through.

Start with **transparent background** – it composites better with the vector layer.

```javascript
const offRenderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
    alpha: true                    // transparent background
});
// Don't set scene.background – leave it null for transparency
```

---

## State Additions

None – this module is stateless. It takes a viewport definition and returns image data.

---

## Immediate Testability

Before PDF assembly exists, add a temporary "Export PNG" button that:
1. Creates a default sheet
2. Captures the current view as a raster
3. Opens the PNG in a new browser tab via `window.open(dataUrl)`

This lets you visually verify the capture quality, resolution, and framing without needing the PDF pipeline.

---

## Edge Cases

- **No model loaded**: Return early / disable button
- **Very small models** (< 0.1"): Ensure frustum doesn't collapse to zero
- **Very large models** (> 100"): Ensure renderer doesn't exceed GPU texture limits. Cap at 4096×4096 pixels.
- **Memory**: Dispose the off-screen renderer after each capture to avoid GPU memory leaks

---

## Acceptance Criteria

1. "Export PNG" button produces a PNG of the shaded model in the correct orthographic view
2. PNG resolution matches `viewport.width * dpi` × `viewport.height * dpi` pixels
3. PNG shows ONLY the shaded solid mesh – no edges, no annotations, no axes, no background grid
4. Background is transparent (or white – match chosen approach)
5. Model is centered and scaled correctly within the viewport bounds
6. Memory: after export, GPU memory usage returns to pre-export levels (check via Chrome DevTools → Performance Monitor)
7. Existing 3D viewer is unaffected (no visual glitches after export)
