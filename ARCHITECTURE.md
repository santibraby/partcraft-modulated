# Partcraft Architecture Document
## Version 0.0.46

### Overview

Partcraft is a single-file HTML application for viewing and analyzing STEP/STP CAD files in the browser. It provides:

- 3D visualization with orthographic and axonometric views
- Automatic curve classification (lines, arcs, circles)
- Ordinate dimensioning system with 3 detail levels
- Diameter annotations for circular features

---

## Technology Stack

| Component | Library | Version | CDN URL |
|-----------|---------|---------|---------|
| CAD Parser | occt-import-js | 0.0.23 | cdn.jsdelivr.net/npm/occt-import-js@0.0.23 |
| 3D Renderer | Three.js | r128 | cdnjs.cloudflare.com/ajax/libs/three.js/r128 |
| Camera Controls | OrbitControls | 0.128.0 | cdn.jsdelivr.net/npm/three@0.128.0 |

---

## File Structure

```
partcraft-v0_0_46.html (single file, ~1900 lines)
├── HTML (~165 lines)
│   ├── Upload area with drag-drop
│   ├── Results panel with part info
│   ├── Control toggles (View, Colors, Annotations, etc.)
│   └── 3D viewer container
├── CSS (~35 lines, embedded in <style>)
│   └── Dark theme, flexbox layout
└── JavaScript (~1700 lines)
    ├── State Management
    ├── Three.js Scene Setup
    ├── STEP File Processing
    ├── Curve Classification System
    ├── Edge Chaining Algorithm
    ├── Annotation System
    └── Event Handlers
```

---

## State Variables

```javascript
// Core rendering
let occt = null;                    // OpenCASCADE instance
let scene, camera, orthoCamera, renderer, controls;
let currentGroup = null;            // THREE.Group containing the model

// Mesh storage
let meshObjects = { 
    solid: null,      // Solid color mesh
    random: null,     // Random face colors mesh
    geometry: null    // Raw geometry for edge extraction
};
let edgeObjects = { current: null };
let analysisResults = null;         // Curve classification results
let faceColors = [];

// Model metrics
let modelCenter = new THREE.Vector3();
let modelSize = 1;

// Display modes
let colorMode = 'black';            // 'black' | 'classified' | 'random'
let faceMode = 'solid';             // 'solid' | 'random'
let wireMode = false;               // Mesh wireframe overlay
let currentView = 'axon';           // 'top' | 'front' | 'left' | 'right' | 'axon'

// Annotation system
let annotationGroup = null;
let axesHelper = null;
let annotationLevel = 0;            // 0=off, 1=overall, 2=+centers, 3=all
let axesOn = true;

// Constants
const CURVE_COLORS = { 
    line: 0x00ffff,    // Cyan
    arc: 0xff00ff,     // Magenta
    circle: 0xffff00,  // Yellow
    unknown: 0x000000 
};
```

---

## Core Systems

### 1. STEP File Processing Pipeline

```
User drops .stp/.step file
        ↓
file.arrayBuffer()
        ↓
occt.ReadStepFile(buffer, { linearUnit: 'inch' })
        ↓
result.meshes[] → THREE.BufferGeometry
        ↓
detectEdgesPartcraft(geometry) → Edge chains
        ↓
classifyCurve() on each chain → line/arc/circle
        ↓
buildEdgeVisualization() → THREE.Line objects
```

### 2. Curve Classification Algorithm

Located in `classifyCurve(points)` function (~120 lines).

**Method: Perpendicular Bisector Circle Detection**

1. Sample 3 points from the curve (start, middle, end)
2. Compute perpendicular bisectors of segments AB and BC
3. Find intersection point (potential circle center)
4. Check if all points lie on the circle within tolerance

**Classification Logic:**
```
if (isClosed && all points on circle) → "circle"
else if (all points on circle) → "arc"  
else → "line"
```

**Tolerances:**
- Circle fit: 2% of radius
- Closure detection: 0.1% of total length
- Corner detection: 15° angle threshold

### 3. Edge Chaining System

Located in `chainEdges(edges)` and `findCorners(chain)`.

**Process:**
1. Extract edges from Three.js geometry
2. Chain connected edges into continuous paths
3. Detect corners (sharp angle changes > 15°)
4. Split chains at corners
5. Classify each sub-chain

### 4. Annotation System

Three detail levels controlled by `annotationLevel`:

| Level | Ordinate Dimensions | Diameter Callouts |
|-------|---------------------|-------------------|
| L1 | Bounding box only | None |
| L2 | Bounding box + circle/arc centers | Yes |
| L3 | All features (lines, arcs, circles) | Yes |

**Ordinate Dimension Geometry (4-point elbow):**
```
P1: 2" from model edge (all features align here)
P2: P1 + 2" toward text
P3: P2 + 2" (evenly spaced between min/max feature values)
P4: P3 + 2"
Text: P4 + 2" (right-aligned for left annotations)
```

**Diameter Annotation Geometry (3-point elbow):**
```
P1: Circle/arc center (arrow points here)
P2: 2" from opposite edge, evenly spaced
P3: P2 + 2" (text position, left-aligned)
```

**View-Axis Mapping:**
| View | Left Axis | Bottom Axis | Annotation Plane |
|------|-----------|-------------|------------------|
| Left | Y | Z | X (min) |
| Right | Y | Z | X (max) |
| Front | Y | X | Z (max) |
| Top | Z | X | Y (max) |

---

## Key Functions Reference

### Scene Management
| Function | Purpose |
|----------|---------|
| `initThreeJS()` | Initialize scene, cameras, lights, controls |
| `setView(viewName)` | Switch between ortho/axon views |
| `fitCameraToObject(object)` | Auto-zoom to fit model |
| `animate()` | Render loop |

### Geometry Processing
| Function | Purpose |
|----------|---------|
| `processFile(file)` | Main entry point for STEP files |
| `getEdgesFromThreeJS(geometry)` | Extract edges from buffer geometry |
| `chainEdges(edges)` | Connect edges into continuous chains |
| `findCorners(chain, angleThreshold)` | Detect sharp corners in chain |
| `splitAtCorners(chain, cornerIndices)` | Break chain at corners |
| `detectEdgesPartcraft(geometry)` | Full edge detection pipeline |

### Curve Classification
| Function | Purpose |
|----------|---------|
| `classifyCurve(points)` | Determine if chain is line/arc/circle |
| `circleFrom3Points(A, B, C)` | Calculate circle from 3 points |
| `pointOnCircle(point, center, radius, tol)` | Check if point lies on circle |
| `calculateSweep(points, center, normal)` | Calculate arc sweep angle |

### Annotation System
| Function | Purpose |
|----------|---------|
| `createAnnotations()` | Main annotation entry point |
| `getFeaturePoints(level)` | Extract features based on detail level |
| `createSideAnnotations(...)` | Build ordinate dimensions |
| `createDiameterAnnotations(...)` | Build diameter callouts |
| `createTextSprite(text, pos, rot, align)` | Create text labels |
| `getUniqueValues(points, axis, tol)` | Deduplicate coordinates |

### Display Updates
| Function | Purpose |
|----------|---------|
| `updateEdgeDisplay()` | Refresh edge visualization |
| `updateFaceDisplay()` | Toggle solid/random face colors |
| `createAxesHelper()` | Create XYZ indicator |
| `buildEdgeVisualization(...)` | Generate edge line objects |

---

## Vector Math Utilities

2D vectors (`vec2`):
```javascript
vec2(x, y), v2sub(a, b), v2add(a, b), v2scale(v, s), v2len(v), v2dist(a, b)
```

3D vectors (`vec3`):
```javascript
vec3(x, y, z), v3sub(a, b), v3add(a, b), v3scale(v, s)
v3dot(a, b), v3cross(a, b), v3len(v), v3norm(v), v3dist(a, b)
```

---

## UI Controls

| Control | Options | Default |
|---------|---------|---------|
| View | Top, Front, Left, Right, Axon | Axon |
| Edge Colors | Black, Classified, Random | Black |
| Face Colors | Solid, Random | Solid |
| Mesh Wires | Off, On | Off |
| Annotations | Off, L1, L2, L3 | Off |
| XYZ Axes | Off, On | On |

---

## Known Limitations

1. **Single mesh support**: Currently processes first mesh in STEP file
2. **Circle detection**: Requires 8+ points for reliable classification
3. **Arc sweep**: Limited to single-plane arcs
4. **Performance**: Large models (>100k triangles) may lag
5. **Units**: Hardcoded to inches

---

## Future Development Ideas

1. **Multi-body support**: Handle assemblies with multiple meshes
2. **Dimension editing**: Allow manual dimension placement
3. **Export**: Generate 2D drawings (SVG/DXF)
4. **Measurement tools**: Point-to-point, angle measurement
5. **Section views**: Cut planes for internal features
6. **Tolerance annotations**: GD&T symbols
7. **Bill of Materials**: Extract part metadata
8. **Metric units**: Toggle inch/mm display

---

## File Version History

| Version | Key Changes |
|---------|-------------|
| v0.0.13 | Initial STEP viewer |
| v0.0.22 | Curve classifier with perpendicular bisector |
| v0.0.28 | Circle detection with relaxed tolerances |
| v0.0.34 | Orthographic views (Top/Front/Left/Right) |
| v0.0.41 | 4-point elbow ordinate dimensions |
| v0.0.43 | Diameter annotations with centermarks |
| v0.0.46 | 3 annotation levels, XYZ toggle |
