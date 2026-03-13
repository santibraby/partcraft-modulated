// ============================================
// Partcraft – Shared Application State
// ============================================

// NOTE: THREE is loaded as a global via CDN <script> tag

export let oc = null;             // OpenCascade.js instance
export let currentShape = null;   // TopoDS_Shape from OCCT

export let scene = null;
export let orthoCamera = null;
export let renderer = null;
export let currentGroup = null;

export const meshObjects = { solid: null, geometry: null };
export const edgeObjects = { current: null };
export let analysisResults = null;

export const modelCenter = new THREE.Vector3();
export let modelSize = 1;
export let modelBounds = null;

export let currentSheet = null;
export let partName = '';

export let captures = {};
export let annotationLevel = 0;
export let hlrResults = null;
export let showVisible = true;
export let showHidden = true;
export let showRaster1 = true;   // dilated silhouette outline layer
export let showRaster2 = true;   // soft raster (0pt lines)
export let outlineThickness = 4; // dilation pixels for raster1 outline
export let showDebugGeom = false; // color-coded geometry overlay

export const CURVE_COLORS = { line: 0x00ffff, arc: 0xff00ff, circle: 0xffff00, unknown: 0x000000 };

export function setOC(val)              { oc = val; }
export function setCurrentShape(val)    { currentShape = val; }
export function setScene(val)           { scene = val; }
export function setOrthoCamera(val)     { orthoCamera = val; }
export function setRenderer(val)        { renderer = val; }
export function setCurrentGroup(val)    { currentGroup = val; }
export function setAnalysisResults(val) { analysisResults = val; }
export function setModelSize(val)       { modelSize = val; }
export function setModelBounds(val)     { modelBounds = val; }
export function setCurrentSheet(val)    { currentSheet = val; }
export function setPartName(val)        { partName = val; }
export function setCaptures(val)        { captures = val; }
export function setAnnotationLevel(val) { annotationLevel = val; }
export function setHlrResults(val)     { hlrResults = val; }
export function setShowVisible(val)    { showVisible = val; }
export function setShowHidden(val)     { showHidden = val; }
export function setShowRaster1(val)    { showRaster1 = val; }
export function setShowRaster2(val)    { showRaster2 = val; }
export function setOutlineThickness(val) { outlineThickness = Math.max(0, Math.min(20, val)); }
export function setShowDebugGeom(val)   { showDebugGeom = val; }
