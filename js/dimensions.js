// ============================================
// Partcraft – 2D Dimension System
// Ordinate dimensions & diameter callouts
// drawn on the sheet canvas for each viewport
// ============================================

import * as S from './state.js';
import { LAYOUT as L } from './layout.js';

// View-axis mapping
const VIEW_CONFIG = {
    front: { hAxis: 'x', vAxis: 'y', leftDir: -1, bottomDir: -1 },
    top:   { hAxis: 'x', vAxis: 'z', leftDir: -1, bottomDir: -1 },
    right: { hAxis: 'z', vAxis: 'y', leftDir: -1, bottomDir: -1 },
};

// Annotation style (sheet inches)
const DIM = {
    color:      '#2266cc',
    lineW:      0.012,
    fontSize:   0.10,
    leaderGap:  0.35,
    leaderStep: 0.25,
    textOffset: 0.30,
    arrowSize:  0.06,
    cmSize:     0.12,   // center mark half-size
    cmDash:     0.035,
    cmGap:      0.025,
};

// ── Public entry ──

export function drawDimensions(ctx, sheet, level, s2c, fi, sc) {
    if (!level || !S.modelBounds) return;

    const features = getFeaturePoints(level);
    if (features.length === 0) return;
    const circlesArcs = level >= 2 ? getCirclesAndArcs() : [];

    for (const vp of sheet.viewports) {
        const cfg = VIEW_CONFIG[vp.view];
        if (!cfg) continue;

        const proj = makeProjector(vp, cfg);
        const bnd = getBounds2D(cfg);

        drawOrdinateSide(ctx, 'left', cfg.vAxis, cfg.hAxis, cfg.leftDir, features, level, bnd, proj, s2c, fi, sc, vp);
        drawOrdinateSide(ctx, 'bottom', cfg.hAxis, cfg.vAxis, cfg.bottomDir, features, level, bnd, proj, s2c, fi, sc, vp);

        if (circlesArcs.length > 0) {
            drawDiameters(ctx, cfg, circlesArcs, bnd, proj, s2c, fi, sc, vp);
        }
    }
}

// ── Projection ──

function makeProjector(vp, cfg) {
    const mc = S.modelCenter;
    const cx = vp.x + vp.width / 2;
    const cy = vp.y + vp.height / 2;
    const s = vp.scale;
    return (h, v) => ({
        sx: cx + (h - mc[cfg.hAxis]) * s,
        sy: cy + (v - mc[cfg.vAxis]) * s,
    });
}

function getBounds2D(cfg) {
    const b = S.modelBounds;
    return { hMin: b.min[cfg.hAxis], hMax: b.max[cfg.hAxis], vMin: b.min[cfg.vAxis], vMax: b.max[cfg.vAxis] };
}

// ── Feature extraction ──

function getFeaturePoints(level) {
    const f = [];
    const mn = S.modelBounds.min, mx = S.modelBounds.max;
    f.push({ x: mn.x, y: mn.y, z: mn.z }, { x: mx.x, y: mx.y, z: mx.z });
    f.push({ x: mn.x, y: mx.y, z: mn.z }, { x: mx.x, y: mn.y, z: mx.z });
    f.push({ x: mn.x, y: mn.y, z: mx.z }, { x: mx.x, y: mx.y, z: mn.z });
    f.push({ x: mn.x, y: mx.y, z: mx.z }, { x: mx.x, y: mn.y, z: mn.z });
    if (level === 1) return f;
    if (!S.analysisResults?.partcraft?.curveDetails) return f;
    for (const c of S.analysisResults.partcraft.curveDetails) {
        if (c.type === 'circle' && c.center) f.push(c.center);
        else if (c.type === 'arc') {
            if (c.center) f.push(c.center);
            if (level === 3 && c.points?.length >= 2) { f.push(c.points[0]); f.push(c.points[c.points.length - 1]); }
        } else if (c.type === 'line' && level === 3 && c.points?.length >= 2) {
            f.push(c.points[0]); f.push(c.points[c.points.length - 1]);
        }
    }
    return f;
}

function getCirclesAndArcs() {
    if (!S.analysisResults?.partcraft?.curveDetails) return [];
    return S.analysisResults.partcraft.curveDetails
        .filter(c => (c.type === 'circle' || c.type === 'arc') && c.center && c.radius)
        .map(c => ({ center: c.center, radius: c.radius, diameter: c.radius * 2 }));
}

function uniqueVals(points, axis, tol = 0.01) {
    const vals = points.map(p => p[axis]).sort((a, b) => a - b);
    const u = [];
    for (const v of vals) {
        if (u.length === 0 || Math.abs(v - u[u.length - 1]) > tol) u.push(v);
    }
    return u;
}

// ── Ordinate dimensions ──

function drawOrdinateSide(ctx, side, valueAxis, perpAxis, dir, features, level, bnd, proj, s2c, fi, sc, vp) {
    const uv = uniqueVals(features, valueAxis);
    if (uv.length === 0) return;

    const isLeft = side === 'left';
    const origin = isLeft ? bnd.vMin : bnd.hMin;
    const edgeVal = dir > 0 ? (isLeft ? bnd.hMax : bnd.vMax) : (isLeft ? bnd.hMin : bnd.vMin);

    // Convert sheet-inch offsets to model-space using viewport scale
    const s = vp.scale || 1;
    const gap = DIM.leaderGap / s;
    const step = DIM.leaderStep / s;
    const txtOff = DIM.textOffset / s;

    const p1P = edgeVal + dir * gap;
    const p2P = p1P + dir * step;
    const p3P = p2P + dir * step;
    const p4P = p3P + dir * step;
    const tP = p4P + dir * txtOff;

    const mn = uv[0], mx = uv[uv.length - 1];

    ctx.strokeStyle = DIM.color;
    ctx.fillStyle = DIM.color;
    ctx.lineWidth = Math.max(0.3, DIM.lineW * sc);

    for (let i = 0; i < uv.length; i++) {
        const fv = uv[i];
        const sv = uv.length === 1 ? fv : mn + (i / (uv.length - 1)) * (mx - mn);
        const dimText = (fv - origin).toFixed(3) + '"';

        let pts, tp;
        if (isLeft) {
            pts = [proj(p1P, fv), proj(p2P, fv), proj(p3P, sv), proj(p4P, sv)];
            tp = proj(tP, sv);
        } else {
            pts = [proj(fv, p1P), proj(fv, p2P), proj(sv, p3P), proj(sv, p4P)];
            tp = proj(sv, tP);
        }

        // Leader line
        ctx.beginPath();
        let p = s2c(pts[0].sx, pts[0].sy);
        ctx.moveTo(p.x, p.y);
        for (let j = 1; j < pts.length; j++) { p = s2c(pts[j].sx, pts[j].sy); ctx.lineTo(p.x, p.y); }
        ctx.stroke();

        // Text
        p = s2c(tp.sx, tp.sy);
        ctx.font = `500 ${fi(DIM.fontSize)}px ${L.fonts.sans}`;
        ctx.textAlign = isLeft ? 'right' : 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(dimText, p.x, p.y);
    }
}

// ── Diameter callouts ──

function drawDiameters(ctx, cfg, circlesArcs, bnd, proj, s2c, fi, sc, vp) {
    // Deduplicate by vertical position
    const uf = [];
    for (const f of circlesArcs) {
        if (!uf.some(e => Math.abs(f.center[cfg.vAxis] - e.center[cfg.vAxis]) < 0.001)) uf.push(f);
    }
    if (!uf.length) return;
    uf.sort((a, b) => a.center[cfg.vAxis] - b.center[cfg.vAxis]);

    const rDir = -cfg.leftDir;
    const edge = rDir > 0 ? bnd.hMax : bnd.hMin;
    const s = vp.scale || 1;
    const gap = DIM.leaderGap / s;
    const step = DIM.leaderStep / s;
    const p2P = edge + rDir * (gap + step);
    const p3P = p2P + rDir * step;
    const tP = p3P + rDir * (DIM.textOffset / s);

    const mnV = uf[0].center[cfg.vAxis];
    const mxV = uf[uf.length - 1].center[cfg.vAxis];

    ctx.strokeStyle = DIM.color;
    ctx.fillStyle = DIM.color;
    ctx.lineWidth = Math.max(0.3, DIM.lineW * sc);

    for (let i = 0; i < uf.length; i++) {
        const { center, diameter } = uf[i];
        const sv = uf.length === 1 ? center[cfg.vAxis] : mnV + (i / (uf.length - 1)) * (mxV - mnV);

        const p1 = proj(center[cfg.hAxis], center[cfg.vAxis]);
        const p2 = proj(p2P, sv);
        const p3 = proj(p3P, sv);
        const tp = proj(tP, sv);

        // Leader
        ctx.beginPath();
        let p = s2c(p1.sx, p1.sy); ctx.moveTo(p.x, p.y);
        p = s2c(p2.sx, p2.sy); ctx.lineTo(p.x, p.y);
        p = s2c(p3.sx, p3.sy); ctx.lineTo(p.x, p.y);
        ctx.stroke();

        // Center mark
        drawCM(ctx, center, cfg, proj, s2c, sc, s);

        // Arrow
        drawArrow(ctx, p1, p2, s2c, sc, s);

        // Label
        p = s2c(tp.sx, tp.sy);
        ctx.font = `500 ${fi(DIM.fontSize)}px ${L.fonts.sans}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`Ø ${diameter.toFixed(3)}"`, p.x, p.y);
    }
}

function drawCM(ctx, center, cfg, proj, s2c, sc, vpScale) {
    const sz = DIM.cmSize / vpScale;
    const dash = DIM.cmDash / vpScale;
    const gap = DIM.cmGap / vpScale;

    for (let d = -sz; d < sz; d += dash + gap) {
        const end = Math.min(d + dash, sz);
        // Horizontal
        let a = s2c(...Object.values(proj(center[cfg.hAxis] + d, center[cfg.vAxis])));
        let b = s2c(...Object.values(proj(center[cfg.hAxis] + end, center[cfg.vAxis])));
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        // Vertical
        a = s2c(...Object.values(proj(center[cfg.hAxis], center[cfg.vAxis] + d)));
        b = s2c(...Object.values(proj(center[cfg.hAxis], center[cfg.vAxis] + end)));
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
}

function drawArrow(ctx, p1, p2, s2c, sc, vpScale) {
    const aLen = DIM.arrowSize / vpScale;
    const dx = p1.sx - p2.sx, dy = p1.sy - p2.sy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.0001) return;
    const ux = dx / dist * aLen, uy = dy / dist * aLen;
    const aw = aLen * 0.4;
    const px = -uy * aw / aLen, py = ux * aw / aLen;

    const tip = s2c(p1.sx, p1.sy);
    const left = s2c(p1.sx - ux + px, p1.sy - uy + py);
    const right = s2c(p1.sx - ux - px, p1.sy - uy - py);

    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y); ctx.lineTo(left.x, left.y); ctx.lineTo(right.x, right.y);
    ctx.closePath(); ctx.fill();
}
