// ============================================
// Partcraft – 2D Dimension System
// L1: bounding box only
// L2: + visible line endpoints, circle/arc/curve centers, diameter callouts
// L3: + hidden edges, arc/circle/curve endpoints
// ============================================

import * as S from './state.js';
import { LAYOUT as L } from './layout.js';

export const VIEW_CONFIG = {
    front: { hAxis: 'x', vAxis: 'z', fh: -1, fv:  1, leftDir: -1, bottomDir: -1, depthAxis: 'y', depthSign: +1 },
    top:   { hAxis: 'x', vAxis: 'y', fh:  1, fv:  1, leftDir: +1, bottomDir: -1, depthAxis: 'z', depthSign: +1 },
    right: { hAxis: 'z', vAxis: 'y', fh:  1, fv: -1, leftDir: +1, bottomDir: +1, depthAxis: 'x', depthSign: +1 },
};

export const DIM = {
    color:      '#000000',
    lineW:      0.012,
    fontSize:   0.10,
    leaderGap:  0.35,
    leaderStep: 0.25,
    textOffset: 0.06,
    arrowSize:  0.12,
    cmSize:     0.12,
    cmDash:     0.035,
    cmGap:      0.025,
};

const DEPTH_TOL = 0.01;   // deduplication tolerance for circle centers
const LEADER_LW = () => 0.5 * (window.devicePixelRatio || 1);  // 0.5pt fixed

// ── Public entry ──

export function drawDimensions(ctx, sheet, level, s2c, fi, sc) {
    if (!level || !S.modelBounds) return;

    for (const vp of sheet.viewports) {
        const cfg = VIEW_CONFIG[vp.view];
        if (!cfg) continue;

        const { points, circles } = extractViewData(vp.view, cfg, level);
        if (points.length === 0) continue;

        const proj = makeProjector(vp, cfg);
        const bnd = getBounds2D(cfg);

        // Dashed grey lines from circle centers to ordinate dimension lines
        if (circles.length > 0) {
            drawCenterLeaders(ctx, cfg, circles, bnd, proj, s2c, sc, vp);
        }

        drawOrdinateSide(ctx, 'left',   cfg.vAxis, cfg.hAxis, cfg.leftDir,   points, bnd, proj, s2c, fi, sc, vp);
        drawOrdinateSide(ctx, 'bottom', cfg.hAxis, cfg.vAxis, cfg.bottomDir, points, bnd, proj, s2c, fi, sc, vp);

        if (circles.length > 0) {
            drawDiameters(ctx, cfg, circles, bnd, proj, s2c, fi, sc, vp);
        }
    }
}

// ── Debug geometry overlay ──
// Draws extracted edges color-coded: lines=cyan, circles/arcs=magenta, bbox=yellow

const DEBUG_COLORS = { line: '#00ffff', circle: '#ff00ff', arc: '#ff00ff', curve: '#00ff00', bbox: '#ffff00' };

export function drawDebugGeometry(ctx, sheet, s2c, sc) {
    if (!S.modelBounds) return;

    for (const vp of sheet.viewports) {
        const cfg = VIEW_CONFIG[vp.view];
        if (!cfg) continue;

        const edges = getEdgesForView(vp.view, cfg);
        const proj  = makeProjector(vp, cfg);
        const bnd   = getBounds2D(cfg);
        const lw    = Math.max(1, 1.5 * (window.devicePixelRatio || 1));

        // Bounding rectangle (yellow)
        ctx.strokeStyle = DEBUG_COLORS.bbox;
        ctx.lineWidth = lw;
        ctx.setLineDash([]);
        const tl = s2c(proj(bnd.hMin, bnd.vMax).sx, proj(bnd.hMin, bnd.vMax).sy);
        const br = s2c(proj(bnd.hMax, bnd.vMin).sx, proj(bnd.hMax, bnd.vMin).sy);
        ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);

        // Edges
        for (const e of edges) {
            if (!e.points || e.points.length < 2) continue;
            ctx.strokeStyle = DEBUG_COLORS[e.type] || '#888888';
            ctx.lineWidth = lw;
            ctx.setLineDash([]);
            ctx.beginPath();
            for (let i = 0; i < e.points.length; i++) {
                const pt = e.points[i];
                const sp = proj(pt[cfg.hAxis], pt[cfg.vAxis]);
                const cp = s2c(sp.sx, sp.sy);
                if (i === 0) ctx.moveTo(cp.x, cp.y);
                else ctx.lineTo(cp.x, cp.y);
            }
            ctx.stroke();
        }
    }
}

// ── Single-pass geometry extraction ──
// Gathers everything in one sweep per view:
//   points  → bounding box corners, line endpoints, circle/arc centers, arc/circle endpoints
//   circles → diameter callout data {center, radius, diameter, normal}

export function extractViewData(viewName, cfg, level) {
    const edges = getEdgesForView(viewName, cfg, level);
    const points  = [];
    const circles = [];

    // 1. Bounding box corners
    const mn = S.modelBounds.min, mx = S.modelBounds.max;
    for (const [x, y, z] of [
        [mn.x, mn.y, mn.z], [mx.x, mx.y, mx.z],
        [mn.x, mx.y, mn.z], [mx.x, mn.y, mx.z],
        [mn.x, mn.y, mx.z], [mx.x, mx.y, mn.z],
        [mn.x, mx.y, mx.z], [mx.x, mn.y, mn.z],
    ]) points.push({ x, y, z, src: 'bbox' });

    // 2. Single pass over edges → points + circles
    // L2: line endpoints, circle/arc/curve centers, diameter callouts
    // L3: + arc/circle/curve endpoints
    if (level >= 2) {
        for (const e of edges) {
            const pts = e.points;

            if (e.type === 'line') {
                if (pts?.length >= 2) {
                    points.push({ ...pts[0], src: 'line-ep' });
                    points.push({ ...pts[pts.length - 1], src: 'line-ep' });
                }
            } else if (e.type === 'circle' || e.type === 'arc' || e.type === 'curve') {
                if (e.center) points.push({ ...e.center, src: 'center' });
                if (e.center && e.radius) {
                    circles.push({ center: e.center, radius: e.radius, diameter: e.radius * 2, normal: e.normal });
                }
                if (level >= 3 && pts?.length >= 2) {
                    points.push({ ...pts[0], src: 'arc-ep' });
                    points.push({ ...pts[pts.length - 1], src: 'arc-ep' });
                }
            }
        }

        // 3. Merge B-rep circles the HLR may have missed
        mergeBrepCircles(circles, points, cfg);
    }

    return { points, circles };
}

// ── Edge source selection ──

function getEdgesForView(viewName, cfg, level) {
    const hlr = S.hlrResults?.[viewName];
    if (hlr?.visible?.length) {
        // L2: visible only, L3: visible + hidden
        if (level >= 3 && hlr.hidden?.length) {
            return [...hlr.visible, ...hlr.hidden];
        }
        return hlr.visible;
    }

    // Fallback: original B-rep edges, depth-filtered to front face
    const original = S.analysisResults?.partcraft?.curveDetails || [];
    if (!S.modelBounds) return original;
    const b = S.modelBounds, da = cfg.depthAxis;
    const depth = b.max[da] - b.min[da];
    const front = cfg.depthSign > 0 ? b.max[da] : b.min[da];
    return original.filter(e => {
        const pt = e.center || e.points?.[0];
        return !pt || Math.abs(pt[da] - front) <= depth * 0.15;
    });
}

// ── B-rep circle merge (catches circles HLR didn't emit) ──

function mergeBrepCircles(circles, points, cfg) {
    const original = S.analysisResults?.partcraft?.curveDetails || [];
    if (!S.modelBounds || !original.length) return;

    const b = S.modelBounds, da = cfg.depthAxis;
    const depth = b.max[da] - b.min[da];
    const front = cfg.depthSign > 0 ? b.max[da] : b.min[da];
    const tol   = depth * 0.2;

    for (const e of original) {
        if ((e.type !== 'circle' && e.type !== 'arc') || !e.center || !e.radius) continue;
        if (Math.abs(e.center[da] - front) > tol) continue;

        // Skip if already present (center within tolerance)
        const isDup = circles.some(c =>
            Math.abs(c.center.x - e.center.x) < DEPTH_TOL &&
            Math.abs(c.center.y - e.center.y) < DEPTH_TOL &&
            Math.abs(c.center.z - e.center.z) < DEPTH_TOL
        );
        if (isDup) continue;

        circles.push({ center: e.center, radius: e.radius, diameter: e.radius * 2, normal: e.normal });
        points.push({ ...e.center, src: 'center' });
    }
}

// ── Projection helpers ──

export function makeProjector(vp, cfg) {
    const mc = S.modelCenter;
    const cx = vp.x + vp.width / 2, cy = vp.y + vp.height / 2;
    const s = vp.scale;
    const fh = cfg.fh || 1, fv = cfg.fv || 1;
    return (h, v) => ({
        sx: cx + (h - mc[cfg.hAxis]) * s * fh,
        sy: cy + (v - mc[cfg.vAxis]) * s * fv,
    });
}

export function getBounds2D(cfg) {
    const b = S.modelBounds;
    return { hMin: b.min[cfg.hAxis], hMax: b.max[cfg.hAxis], vMin: b.min[cfg.vAxis], vMax: b.max[cfg.vAxis] };
}

export function uniqueVals(points, axis, tol = 0.01) {
    const vals = points.map(p => p[axis]).sort((a, b) => a - b);
    const u = [];
    for (const v of vals) {
        if (u.length === 0 || Math.abs(v - u[u.length - 1]) > tol) u.push(v);
    }
    return u;
}

// ── Center-to-dimension leader lines (dashed grey) ──

function drawCenterLeaders(ctx, cfg, circles, bnd, proj, s2c, sc, vp) {
    const s = vp.scale || 1;
    const gap = DIM.leaderGap / s;

    // Leader start positions (matching ordinate layout)
    const rightEdge  = cfg.leftDir   > 0 ? bnd.hMax : bnd.hMin;
    const bottomEdge = cfg.bottomDir > 0 ? bnd.vMax : bnd.vMin;
    const rightP1  = rightEdge  + cfg.leftDir   * gap;
    const bottomP1 = bottomEdge + cfg.bottomDir * gap;

    ctx.strokeStyle = '#999999';
    ctx.lineWidth = LEADER_LW();
    const dpr = window.devicePixelRatio || 1;
    ctx.setLineDash([8 * dpr, 3 * dpr, 2 * dpr, 3 * dpr]);  // dash-dot center line

    for (const c of circles) {
        const ch = c.center[cfg.hAxis];
        const cv = c.center[cfg.vAxis];

        // Horizontal: center → right ordinate leader
        const a1 = s2c(proj(ch, cv).sx, proj(ch, cv).sy);
        const b1 = s2c(proj(rightP1, cv).sx, proj(rightP1, cv).sy);
        ctx.beginPath(); ctx.moveTo(a1.x, a1.y); ctx.lineTo(b1.x, b1.y); ctx.stroke();

        // Vertical: center → bottom ordinate leader
        const a2 = s2c(proj(ch, cv).sx, proj(ch, cv).sy);
        const b2 = s2c(proj(ch, bottomP1).sx, proj(ch, bottomP1).sy);
        ctx.beginPath(); ctx.moveTo(a2.x, a2.y); ctx.lineTo(b2.x, b2.y); ctx.stroke();
    }

    ctx.setLineDash([]);
}

// ── Ordinate dimensions ──

function drawOrdinateSide(ctx, side, valueAxis, perpAxis, dir, features, bnd, proj, s2c, fi, sc, vp) {
    const uv = uniqueVals(features, valueAxis);
    if (uv.length === 0) return;

    const isLeft = side === 'left';
    const origin = isLeft ? bnd.vMin : bnd.hMin;
    const edgeVal = dir > 0 ? (isLeft ? bnd.hMax : bnd.vMax) : (isLeft ? bnd.hMin : bnd.vMin);

    const s = vp.scale || 1;
    const gap = DIM.leaderGap / s, step = DIM.leaderStep / s, txtOff = DIM.textOffset / s;
    const p1P = edgeVal + dir * gap;
    const p2P = p1P + dir * step;
    const p3P = p2P + dir * step;
    const p4P = p3P + dir * step;
    const tP = p4P + dir * txtOff;
    const mn = uv[0], mx = uv[uv.length - 1];

    ctx.strokeStyle = DIM.color;
    ctx.fillStyle = DIM.color;
    ctx.lineWidth = LEADER_LW();

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

        // Leader
        ctx.beginPath();
        let p = s2c(pts[0].sx, pts[0].sy);
        ctx.moveTo(p.x, p.y);
        for (let j = 1; j < pts.length; j++) { p = s2c(pts[j].sx, pts[j].sy); ctx.lineTo(p.x, p.y); }
        ctx.stroke();

        // Text
        p = s2c(tp.sx, tp.sy);
        ctx.font = `500 ${fi(DIM.fontSize)}px ${L.fonts.sans}`;
        if (isLeft) {
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillText(dimText, p.x, p.y);
        } else {
            ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(-Math.PI / 2);
            ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
            ctx.fillText(dimText, 0, 0); ctx.restore();
        }
    }
}

// ── Diameter callouts ──

function drawDiameters(ctx, cfg, circlesArcs, bnd, proj, s2c, fi, sc, vp) {
    const uf = [];
    for (const f of circlesArcs) {
        if (!uf.some(e => Math.abs(f.center[cfg.vAxis] - e.center[cfg.vAxis]) < 0.001)) uf.push(f);
    }
    if (!uf.length) return;
    uf.sort((a, b) => a.center[cfg.vAxis] - b.center[cfg.vAxis]);

    const rDir = -cfg.leftDir;
    const edge = rDir > 0 ? bnd.hMax : bnd.hMin;
    const s = vp.scale || 1;
    const gap = DIM.leaderGap / s, step = DIM.leaderStep / s;
    const p2P = edge + rDir * (gap + step);
    const p3P = p2P + rDir * step;
    const tP = p3P + rDir * (DIM.textOffset / s);
    // Space labels evenly across the full bounding box height
    const mnV = bnd.vMin, mxV = bnd.vMax;

    ctx.strokeStyle = DIM.color; ctx.fillStyle = DIM.color;
    ctx.lineWidth = LEADER_LW();

    for (let i = 0; i < uf.length; i++) {
        const { center, diameter, radius } = uf[i];
        const sv = uf.length === 1 ? center[cfg.vAxis] : mnV + (i / (uf.length - 1)) * (mxV - mnV);

        const edgeH = center[cfg.hAxis] + rDir * radius;
        const p1 = proj(edgeH, center[cfg.vAxis]);
        const p2 = proj(p2P, sv), p3 = proj(p3P, sv), tp = proj(tP, sv);

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
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(`Ø ${diameter.toFixed(3)}"`, p.x, p.y);
    }
}

function drawCM(ctx, center, cfg, proj, s2c, sc, vpScale) {
    const sz = DIM.cmSize / vpScale, dash = DIM.cmDash / vpScale, gap = DIM.cmGap / vpScale;
    for (let d = -sz; d < sz; d += dash + gap) {
        const end = Math.min(d + dash, sz);
        let a = s2c(...Object.values(proj(center[cfg.hAxis] + d, center[cfg.vAxis])));
        let b = s2c(...Object.values(proj(center[cfg.hAxis] + end, center[cfg.vAxis])));
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        a = s2c(...Object.values(proj(center[cfg.hAxis], center[cfg.vAxis] + d)));
        b = s2c(...Object.values(proj(center[cfg.hAxis], center[cfg.vAxis] + end)));
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
}

function drawArrow(ctx, p1, p2, s2c, sc, vpScale) {
    const aLen = DIM.arrowSize / vpScale;
    const dx = p1.sx - p2.sx, dy = p1.sy - p2.sy;
    const d = Math.sqrt(dx*dx + dy*dy);
    if (d < 0.0001) return;
    const ux = dx/d*aLen, uy = dy/d*aLen;
    const aw = aLen * 0.4, px = -uy*aw/aLen, py = ux*aw/aLen;

    const tip = s2c(p1.sx, p1.sy);
    const left = s2c(p1.sx-ux+px, p1.sy-uy+py);
    const right = s2c(p1.sx-ux-px, p1.sy-uy-py);
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y); ctx.lineTo(left.x, left.y); ctx.lineTo(right.x, right.y);
    ctx.closePath(); ctx.fill();
}
