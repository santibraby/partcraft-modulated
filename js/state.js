// ============================================
// Partcraft – Shared Application State
// ============================================

// NOTE: THREE is loaded as a global via <script> tag

export let occt = null;
export let scene = null;
export let orthoCamera = null;
export let renderer = null;
export let currentGroup = null;

export const meshObjects = { solid: null, random: null, geometry: null };
export const edgeObjects = { current: null };
export let analysisResults = null;
export let faceColors = [];

export const modelCenter = new THREE.Vector3();
export let modelSize = 1;
export let modelBounds = null;

export let colorMode = 'black';
export let currentSheet = null;
export let partName = '';

// Captured images keyed by view name
export let captures = {};
export let annotationLevel = 0;  // 0=off, 1=overall, 2=+centers, 3=all

export const CURVE_COLORS = { line: 0x00ffff, arc: 0xff00ff, circle: 0xffff00, unknown: 0x000000 };

export function setOcct(val)            { occt = val; }
export function setScene(val)           { scene = val; }
export function setOrthoCamera(val)     { orthoCamera = val; }
export function setRenderer(val)        { renderer = val; }
export function setCurrentGroup(val)    { currentGroup = val; }
export function setAnalysisResults(val) { analysisResults = val; }
export function setFaceColors(val)      { faceColors = val; }
export function setModelSize(val)       { modelSize = val; }
export function setModelBounds(val)     { modelBounds = val; }
export function setColorMode(val)       { colorMode = val; }
export function setCurrentSheet(val)    { currentSheet = val; }
export function setPartName(val)        { partName = val; }
export function setCaptures(val)        { captures = val; }
export function setAnnotationLevel(val) { annotationLevel = val; }
