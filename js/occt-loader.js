// ============================================
// Partcraft – OpenCascade.js v2 Loader
// Full OCCT kernel for STEP loading + B-rep edge extraction
// ============================================

let oc = null;

// ── Init ──

export async function initOCCT(onStatus) {
    if (oc) return oc;
    onStatus?.('Loading CAD kernel (≈37 MB)…');

    // Method 1: Use the package's built-in initializer
    try {
        const mod = await import('opencascade.js');
        const initFn = mod.default;
        oc = await initFn({
            locateFile: (path) => {
                if (path.endsWith('.wasm')) return '/wasm/opencascade.full.wasm';
                return path;
            }
        });
    } catch (e) {
        console.error('OCCT init failed:', e);
        throw e;
    }

    // Verify key APIs exist
    const required = ['STEPControl_Reader_1', 'BRepMesh_IncrementalMesh_2', 'TopExp_Explorer_2'];
    for (const key of required) {
        if (!oc[key]) console.warn(`OCCT: Missing ${key}`);
        else console.log(`OCCT: ✓ ${key}`);
    }

    onStatus?.('CAD kernel ready.');
    return oc;
}

export function getOC() { return oc; }

// ── STEP Loading ──

export function loadSTEP(buffer, onStatus) {
    if (!oc) throw new Error('OCCT not initialized');
    onStatus?.('Parsing STEP file…');

    const data = new Uint8Array(buffer);

    // Detect source units from STEP file header before OCCT processes it
    const sourceUnit = detectStepUnits(data);
    console.log('OCCT: Source file units:', sourceUnit);

    // OCCT always outputs geometry in millimeters
    // Convert to inches for our drawing system
    const MM_TO_IN = 1.0 / 25.4;
    const scaleFactor = MM_TO_IN;
    console.log('OCCT: Scale factor (mm→in):', scaleFactor);

    // Write to Emscripten virtual filesystem
    try { oc.FS.unlink('/model.step'); } catch (_) {}
    oc.FS.createDataFile('/', 'model.step', data, true, true, true);

    // Read STEP file
    const reader = new oc.STEPControl_Reader_1();
    const status = reader.ReadFile('/model.step');

    if (status.value !== oc.IFSelect_ReturnStatus.IFSelect_RetDone.value) {
        cleanup();
        return { success: false, error: `STEP read failed (status ${status.value})` };
    }
    console.log('OCCT: STEP file read OK');

    // Transfer roots to shapes
    onStatus?.('Transferring geometry…');
    reader.TransferRoots(new oc.Message_ProgressRange_1());
    const shape = reader.OneShape();
    cleanup();

    if (shape.IsNull()) {
        return { success: false, error: 'Empty shape' };
    }
    console.log('OCCT: Shape transferred');

    // Triangulate for Three.js visualization
    onStatus?.('Triangulating…');
    new oc.BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.5, true);

    // Extract mesh and apply unit conversion
    const meshData = extractMesh(shape, scaleFactor);
    console.log('OCCT: Mesh:', meshData.attributes.position.array.length / 3, 'vertices');

    // Extract B-rep edges with classification and unit conversion
    onStatus?.('Extracting edges…');
    let curveDetails = [];
    try {
        curveDetails = extractEdges(shape, scaleFactor);
    } catch (e) {
        console.warn('OCCT: Edge extraction error (non-fatal):', e.message);
    }

    return { success: true, shape, meshes: [meshData], curveDetails, units: 'inch', sourceUnit };
}

function cleanup() {
    try { oc.FS.unlink('/model.step'); } catch (_) {}
}

/**
 * Detect units from STEP file header.
 * Scans for SI_UNIT or length_measure patterns.
 */
function detectStepUnits(data) {
    // Read first ~10KB of file as text to find unit declaration
    const header = new TextDecoder().decode(data.slice(0, Math.min(data.length, 10000)));

    // Look for common STEP unit patterns
    if (/MILLI/.test(header)) return 'mm';
    if (/\.METRE\./.test(header) && !/MILLI/.test(header)) return 'm';
    if (/INCH|\.IN\./.test(header)) return 'inch';
    if (/CENTI/.test(header)) return 'cm';
    if (/MICRO/.test(header)) return 'um';

    // Check for SI_UNIT with prefix
    const siMatch = header.match(/SI_UNIT\s*\([^)]*\.\s*(\w+)\.\s*,/);
    if (siMatch) {
        const prefix = siMatch[1].toUpperCase();
        if (prefix === 'MILLI') return 'mm';
        if (prefix === 'CENTI') return 'cm';
        if (prefix === 'MICRO') return 'um';
    }

    // Default assumption: mm (most CAD software exports in mm)
    console.log('OCCT: Could not detect units from header, assuming mm');
    return 'mm';
}

// ── Mesh Extraction ──

function extractMesh(shape, scaleFactor) {
    const positions = [], normals = [], indices = [];
    let offset = 0;

    const exp = new oc.TopExp_Explorer_2(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE
    );

    while (exp.More()) {
        try {
            const face = oc.TopoDS.Face_1(exp.Current());
            const loc = new oc.TopLoc_Location_1();
            const hTri = oc.BRep_Tool.Triangulation(face, loc);

            if (hTri && !hTri.IsNull()) {
                const tri = hTri.get();
                const nV = tri.NbNodes();
                const nT = tri.NbTriangles();
                const xf = loc.Transformation();
                const reversed = face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED;

                for (let i = 1; i <= nV; i++) {
                    const p = tri.Node(i).Transformed(xf);
                    positions.push(p.X() * scaleFactor, p.Y() * scaleFactor, p.Z() * scaleFactor);
                    normals.push(0, 0, 0);
                }

                for (let i = 1; i <= nT; i++) {
                    const t = tri.Triangle(i);
                    const a = t.Value(1) - 1 + offset;
                    const b = t.Value(2) - 1 + offset;
                    const c = t.Value(3) - 1 + offset;
                    reversed ? indices.push(a, c, b) : indices.push(a, b, c);
                }
                offset += nV;
            }
        } catch (e) { /* skip face */ }
        exp.Next();
    }

    computeNormals(positions, indices, normals);

    return {
        name: 'Part', color: null,
        attributes: {
            position: { array: new Float32Array(positions) },
            normal: { array: new Float32Array(normals) },
        },
        index: { array: new Uint32Array(indices) },
    };
}

function computeNormals(pos, idx, nrm) {
    for (let i = 0; i < idx.length; i += 3) {
        const [a, b, c] = [idx[i], idx[i+1], idx[i+2]];
        const ax = pos[a*3], ay = pos[a*3+1], az = pos[a*3+2];
        const bx = pos[b*3]-ax, by = pos[b*3+1]-ay, bz = pos[b*3+2]-az;
        const cx = pos[c*3]-ax, cy = pos[c*3+1]-ay, cz = pos[c*3+2]-az;
        const nx = by*cz - bz*cy, ny = bz*cx - bx*cz, nz = bx*cy - by*cx;
        for (const j of [a, b, c]) {
            nrm[j*3] += nx; nrm[j*3+1] += ny; nrm[j*3+2] += nz;
        }
    }
    for (let i = 0; i < nrm.length; i += 3) {
        const l = Math.sqrt(nrm[i]**2 + nrm[i+1]**2 + nrm[i+2]**2);
        if (l > 0) { nrm[i] /= l; nrm[i+1] /= l; nrm[i+2] /= l; }
    }
}

// ── Edge Extraction ──

function extractEdges(shape, scaleFactor) {
    const details = [];
    const seen = new Set();

    const exp = new oc.TopExp_Explorer_2(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_EDGE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE
    );

    while (exp.More()) {
        try {
            const edge = oc.TopoDS.Edge_1(exp.Current());
            const h = edge.HashCode(1e8);
            if (!seen.has(h)) {
                seen.add(h);
                const d = classifyEdge(edge, scaleFactor);
                if (d) details.push(d);
            }
        } catch (_) {}
        exp.Next();
    }

    console.log('OCCT:', details.length, 'edges classified');
    return details;
}

function classifyEdge(edge, sf) {
    const f = { current: 0 }, l = { current: 0 };
    const hCurve = oc.BRep_Tool.Curve_2(edge, f, l);
    if (!hCurve || hCurve.IsNull()) return null;

    const curve = hCurve.get();
    const tStart = f.current, tEnd = l.current;

    // Ask OCCT what type this curve is
    let typeName = '';
    try { typeName = curve.DynamicType().get().Name(); } catch (_) {}

    // ── Geom_Line: extract start + end ──
    if (typeName.includes('Geom_Line')) {
        const pS = curve.Value(tStart);
        const pE = curve.Value(tEnd);
        return {
            type: 'line',
            points: [
                { x: pS.X() * sf, y: pS.Y() * sf, z: pS.Z() * sf },
                { x: pE.X() * sf, y: pE.Y() * sf, z: pE.Z() * sf },
            ],
        };
    }

    // ── Geom_Circle: exact center, radius, normal from OCCT ──
    if (typeName.includes('Geom_Circle')) {
        const circ = curve.Circ();
        const loc = circ.Location();
        const radius = circ.Radius() * sf;
        const ax = circ.Axis().Direction();
        const center = { x: loc.X() * sf, y: loc.Y() * sf, z: loc.Z() * sf };
        const normal = { x: ax.X(), y: ax.Y(), z: ax.Z() };
        const isFullCircle = Math.abs(tEnd - tStart) > (2 * Math.PI - 0.01);
        const points = sampleCurve(curve, tStart, tEnd, sf, 32);
        return { type: isFullCircle ? 'circle' : 'arc', points, center, radius, normal };
    }

    // ── Geom_Ellipse: center + approximate radius ──
    if (typeName.includes('Geom_Ellipse')) {
        const loc = curve.Location();
        const center = { x: loc.X() * sf, y: loc.Y() * sf, z: loc.Z() * sf };
        const ax = curve.Axis().Direction();
        const normal = { x: ax.X(), y: ax.Y(), z: ax.Z() };
        const points = sampleCurve(curve, tStart, tEnd, sf, 32);
        const r = points.reduce((max, p) => Math.max(max, dist(p, center)), 0);
        return { type: 'arc', points, center, radius: r, normal };
    }

    // ── BSpline / Bezier / other: sample + fallback classify ──
    const pts = sampleCurve(curve, tStart, tEnd, sf, 24);
    if (pts.length < 2) return null;
    if (isLinear(pts)) return { type: 'line', points: [pts[0], pts[pts.length - 1]] };
    const fit = fitCircle(pts);
    if (fit && fit.err < 0.005 * fit.r) {
        const closed = dist(pts[0], pts[pts.length - 1]) < fit.r * 0.1;
        return { type: closed ? 'circle' : 'arc', points: pts, center: fit.c, radius: fit.r, normal: fit.n };
    }
    return { type: 'arc', points: pts };
}

function sampleCurve(curve, tStart, tEnd, sf, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
        try {
            const p = curve.Value(tStart + (tEnd - tStart) * i / n);
            pts.push({ x: p.X() * sf, y: p.Y() * sf, z: p.Z() * sf });
        } catch (_) { break; }
    }
    return pts;
}

// ── Geometry helpers ──

function isLinear(pts) {
    if (pts.length < 3) return true;
    const a = pts[0], b = pts[pts.length - 1];
    const dx = b.x-a.x, dy = b.y-a.y, dz = b.z-a.z;
    const len2 = dx*dx + dy*dy + dz*dz;
    if (len2 < 1e-16) return true;
    for (let i = 1; i < pts.length - 1; i++) {
        const t = ((pts[i].x-a.x)*dx + (pts[i].y-a.y)*dy + (pts[i].z-a.z)*dz) / len2;
        const ex = a.x+t*dx - pts[i].x, ey = a.y+t*dy - pts[i].y, ez = a.z+t*dz - pts[i].z;
        if (ex*ex + ey*ey + ez*ez > 1e-6) return false;
    }
    return true;
}

function fitCircle(pts) {
    if (pts.length < 3) return null;
    const p1 = pts[0], p2 = pts[Math.floor(pts.length / 2)], p3 = pts[pts.length - 1];
    const cc = circumcenter(p1, p2, p3);
    if (!cc) return null;
    const r = dist(cc, p1);

    // Normal
    const v1x = p2.x-p1.x, v1y = p2.y-p1.y, v1z = p2.z-p1.z;
    const v2x = p3.x-p1.x, v2y = p3.y-p1.y, v2z = p3.z-p1.z;
    const nx = v1y*v2z - v1z*v2y, ny = v1z*v2x - v1x*v2z, nz = v1x*v2y - v1y*v2x;
    const nl = Math.sqrt(nx*nx + ny*ny + nz*nz);
    const n = nl > 0 ? { x: nx/nl, y: ny/nl, z: nz/nl } : null;

    // Error
    let tot = 0;
    for (const p of pts) tot += Math.abs(dist(p, cc) - r);
    return { c: cc, r, n, err: tot / pts.length };
}

function circumcenter(p1, p2, p3) {
    const abx = p2.x-p1.x, aby = p2.y-p1.y, abz = p2.z-p1.z;
    const acx = p3.x-p1.x, acy = p3.y-p1.y, acz = p3.z-p1.z;
    const ab2 = abx*abx + aby*aby + abz*abz;
    const ac2 = acx*acx + acy*acy + acz*acz;
    const abac = abx*acx + aby*acy + abz*acz;
    const d = 2 * (ab2 * ac2 - abac * abac);
    if (Math.abs(d) < 1e-12) return null;
    const s = (ab2 * ac2 - ac2 * abac) / d;
    const t = (ac2 * ab2 - ab2 * abac) / d;
    return { x: p1.x + s*abx + t*acx, y: p1.y + s*aby + t*acy, z: p1.z + s*abz + t*acz };
}

function dist(a, b) {
    return Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2 + (a.z-b.z)**2);
}
