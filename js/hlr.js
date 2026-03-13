// ============================================
// Partcraft – Hidden Line Removal
//
// Single-layer pipeline using HLRBRep_Algo:
//   - Sharp, smooth, silhouette edges with full occlusion
//   - Hide_1() for full occlusion and complete outlines
//   - BRepAdaptor_Curve for exact geometry on all output edges
//   - GCPnts_TangentialDeflection for adaptive arc sampling
//
// All output is in projector space (Z=0) → remap to model axes
// ============================================

import { getOC } from './occt-loader.js';

// ── Coordinate remap per view ──

const S3 = Math.sqrt(3);

const VIEWS = {
    front: {
        dir: [0, 1, 0], xDir: [1, 0, 0],
        remap: (px, py, pz, sf) => ({ x: px*sf, y: pz*sf, z: -py*sf }),
    },
    top: {
        dir: [0, 0, 1], xDir: [1, 0, 0],
        remap: (px, py, pz, sf) => ({ x: px*sf, y: py*sf, z: pz*sf }),
    },
    right: {
        dir: [1, 0, 0], xDir: [0, 0, -1],
        remap: (px, py, pz, sf) => ({ x: pz*sf, y: py*sf, z: -px*sf }),
    },
    axon: {
        dir: [1/S3, 1/S3, 1/S3], xDir: [-1, 1, 0],
        remap: (px, py, pz, sf) => ({ x: px*sf, y: py*sf, z: 0 }),
    },
};

// ── Entry point ──

export function computeHLR(shape, sf) {
    const oc = getOC();
    if (!oc || !shape) return {};

    const results = {};
    for (const [name, vDef] of Object.entries(VIEWS)) {
        try {
            results[name] = runHLR(oc, shape, vDef, sf, name);
            const r = results[name];
            console.log(`HLR: ${name} → ${r.visible.length} vis, ${r.hidden.length} hid`);
        } catch (e) {
            console.error(`HLR: ${name} failed:`, e.message);
            results[name] = { visible: [], hidden: [] };
        }
    }
    return results;
}

// ── HLRBRep_Algo — all edges with full occlusion ──

function runHLR(oc, shape, vDef, sf, name) {
    const outliner = new oc.HLRTopoBRep_OutLiner_2(shape);
    const hOutliner = new oc.Handle_HLRTopoBRep_OutLiner_2(outliner);
    const algo = new oc.HLRBRep_Algo_1();
    algo.Load_2(hOutliner, 0);

    const origin = new oc.gp_Pnt_1();
    const dir = new oc.gp_Dir_4(vDef.dir[0], vDef.dir[1], vDef.dir[2]);
    const xDir = new oc.gp_Dir_4(vDef.xDir[0], vDef.xDir[1], vDef.xDir[2]);
    const ax2 = new oc.gp_Ax2_2(origin, dir, xDir);
    const proj = new oc.HLRAlgo_Projector_2(ax2);
    algo.Projector_1(proj);

    algo.Update();
    algo.Hide_1();  // Full occlusion — produces more complete outlines than PartialHide()

    const hAlgo = new oc.Handle_HLRBRep_Algo_2(algo);
    const toShape = new oc.HLRBRep_HLRToShape(hAlgo);

    const visible = [];
    const hidden = [];

    // Visible: sharp + smooth + visible outlines + visible surface curves
    extractCompound(oc, toShape, 'VCompound_1',         sf, visible, 'V-sharp',      vDef.remap, name);
    extractCompound(oc, toShape, 'Rg1LineVCompound_1',  sf, visible, 'V-smooth',     vDef.remap, name);
    extractCompound(oc, toShape, 'OutLineVCompound_1',  sf, visible, 'V-outline',    vDef.remap, name);
    extractCompound(oc, toShape, 'RgNLineVCompound_1',  sf, visible, 'V-surface',    vDef.remap, name);

    // Hidden: sharp + smooth + hidden outlines + hidden surface curves (dashed lines)
    extractCompound(oc, toShape, 'HCompound_1',         sf, hidden,  'H-sharp',      vDef.remap, name);
    extractCompound(oc, toShape, 'Rg1LineHCompound_1',  sf, hidden,  'H-smooth',     vDef.remap, name);
    extractCompound(oc, toShape, 'OutLineHCompound_1',  sf, hidden,  'H-outline',    vDef.remap, name);
    extractCompound(oc, toShape, 'RgNLineHCompound_1',  sf, hidden,  'H-surface',    vDef.remap, name);

    // Capture results before cleanup — a WASM .delete() must not discard them
    const result = { visible, hidden };

    // Cleanup — HLR objects are the heaviest in the pipeline
    try {
        toShape.delete();
        hAlgo.delete();
        algo.delete();
        hOutliner.delete();
        outliner.delete();
        origin.delete(); dir.delete(); xDir.delete(); ax2.delete(); proj.delete();
    } catch (e) {
        console.warn(`HLR[${name}]: cleanup error (non-fatal):`, e.message);
    }

    return result;
}

// ── Edge extraction ──

function extractCompound(oc, toShape, method, sf, dest, label, coordMap, viewName) {
    let compound;
    try { compound = toShape[method](); } catch (_) { return; }
    if (!compound || compound.IsNull()) return;

    const before = dest.length;
    const exp = new oc.TopExp_Explorer_2(
        compound, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE
    );
    while (exp.More()) {
        try {
            const edge = oc.TopoDS.Edge_1(exp.Current());
            const d = classify(oc, edge, sf, coordMap);
            if (d) { d.edgeKind = label; dest.push(d); }
        } catch (_) {}
        exp.Next();
    }
    exp.delete();
    const count = dest.length - before;
    if (count > 0) console.log(`HLR[${viewName}]: ${label}: ${count} edges`);
}

// ── Edge classification via BRepAdaptor_Curve ──

function classify(oc, edge, sf, coordMap) {
    let adaptor;
    try { adaptor = new oc.BRepAdaptor_Curve_2(edge); }
    catch (_) { return vertexFallback(oc, edge, sf, coordMap); }

    const t0 = adaptor.FirstParameter();
    const t1 = adaptor.LastParameter();
    const curveType = adaptor.GetType();

    // ── Line ──
    if (curveType.value === oc.GeomAbs_CurveType.GeomAbs_Line.value) {
        const a = adaptor.Value(t0);
        const b = adaptor.Value(t1);
        const result = {
            type: 'line',
            points: [coordMap(a.X(), a.Y(), a.Z(), sf), coordMap(b.X(), b.Y(), b.Z(), sf)],
        };
        a.delete(); b.delete(); adaptor.delete();
        return result;
    }

    // ── Circle ──
    if (curveType.value === oc.GeomAbs_CurveType.GeomAbs_Circle.value) {
        const circ = adaptor.Circle();
        const loc = circ.Location();
        const ax = circ.Axis().Direction();
        const center = coordMap(loc.X(), loc.Y(), loc.Z(), sf);
        const radius = circ.Radius() * sf;
        const nRaw = coordMap(ax.X(), ax.Y(), ax.Z(), 1);
        const nLen = Math.sqrt(nRaw.x**2 + nRaw.y**2 + nRaw.z**2);
        const normal = nLen > 0 ? { x: nRaw.x/nLen, y: nRaw.y/nLen, z: nRaw.z/nLen } : null;
        const full = Math.abs(t1 - t0) > (2 * Math.PI - 0.01);
        const points = sampleAdaptor(oc, adaptor, t0, t1, sf, coordMap);
        adaptor.delete();
        return { type: full ? 'circle' : 'arc', points, center, radius, normal };
    }

    // ── Ellipse ──
    if (curveType.value === oc.GeomAbs_CurveType.GeomAbs_Ellipse.value) {
        const elips = adaptor.Ellipse();
        const loc = elips.Location();
        const center = coordMap(loc.X(), loc.Y(), loc.Z(), sf);
        const r = Math.max(elips.MajorRadius(), elips.MinorRadius()) * sf;
        const points = sampleAdaptor(oc, adaptor, t0, t1, sf, coordMap);
        adaptor.delete();
        return { type: 'arc', points, center, radius: r };
    }

    // ── BSpline, Bezier, other ──
    const points = sampleAdaptor(oc, adaptor, t0, t1, sf, coordMap);
    adaptor.delete();
    if (points.length < 2) return vertexFallback(oc, edge, sf, coordMap);

    // Check if curve is actually a straight line (max deviation from endpoint-to-endpoint)
    if (isLinear(points, 1e-4)) {
        return { type: 'line', points: [points[0], points[points.length - 1]] };
    }
    return { type: 'curve', points };
}

// ── Linearity test: max perpendicular deviation from first→last line ──

function isLinear(pts, tol) {
    if (pts.length <= 2) return true;
    const a = pts[0], b = pts[pts.length - 1];
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len2 = dx * dx + dy * dy + dz * dz;
    if (len2 < 1e-12) return true; // degenerate (zero-length)
    for (let i = 1; i < pts.length - 1; i++) {
        const px = pts[i].x - a.x, py = pts[i].y - a.y, pz = pts[i].z - a.z;
        // cross product magnitude² / len² = perpendicular distance²
        const cx = py * dz - pz * dy;
        const cy = pz * dx - px * dz;
        const cz = px * dy - py * dx;
        const dist2 = (cx * cx + cy * cy + cz * cz) / len2;
        if (dist2 > tol * tol) return false;
    }
    return true;
}

// ── Adaptive sampling via GCPnts_TangentialDeflection ──

function sampleAdaptor(oc, adaptor, t0, t1, sf, coordMap) {
    const pts = [];
    let disc;
    try {
        disc = new oc.GCPnts_TangentialDeflection_3(
            adaptor,
            t0, t1,
            0.1,    // angular deflection (radians)
            0.01,   // curvature deflection (model units mm)
            3,      // minimum points
            1e-7,   // UTol
            0       // minLen
        );
        for (let i = 1; i <= disc.NbPoints(); i++) {
            const p = disc.Value(i);
            pts.push(coordMap(p.X(), p.Y(), p.Z(), sf));
            p.delete();
        }
    } catch (_) {
        // Fallback to uniform sampling
        for (let i = 0; i <= 24; i++) {
            try {
                const p = adaptor.Value(t0 + (t1 - t0) * i / 24);
                pts.push(coordMap(p.X(), p.Y(), p.Z(), sf));
                p.delete();
            } catch (_) { break; }
        }
    } finally {
        if (disc) disc.delete();
    }
    return pts;
}

// ── Vertex fallback ──

function vertexFallback(oc, edge, sf, coordMap) {
    try {
        const vF = new oc.TopoDS_Vertex(), vL = new oc.TopoDS_Vertex();
        oc.TopExp.Vertices_1(edge, vF, vL, true);
        const a = oc.BRep_Tool.Pnt(vF), b = oc.BRep_Tool.Pnt(vL);
        const start = coordMap(a.X(), a.Y(), a.Z(), sf);
        const end = coordMap(b.X(), b.Y(), b.Z(), sf);
        a.delete(); b.delete(); vF.delete(); vL.delete();
        const dx = end.x-start.x, dy = end.y-start.y, dz = end.z-start.z;
        if (dx*dx + dy*dy + dz*dz < 1e-12) return null;
        return { type: 'line', points: [start, end] };
    } catch (_) { return null; }
}
