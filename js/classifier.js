// ============================================
// Partcraft – Curve Classification
// Perpendicular-bisector circle detection
// Only: LINE, ARC, CIRCLE
// ============================================

import { vec2, v2sub, vec3, v3sub, v3add, v3scale, v3dot, v3cross, v3len, v3norm, v3dist, angleBetween } from './math.js';

/**
 * Calculate circle from 3 points using perpendicular bisectors.
 * Projects 3D → 2D, finds bisector intersection, converts back.
 */
export function circleFrom3Points(A, B, C) {
    const AB = v3sub(B, A);
    const AC = v3sub(C, A);
    const normal = v3cross(AB, AC);
    const normalLen = v3len(normal);
    const abLen = v3len(AB);
    const acLen = v3len(AC);

    if (abLen < 1e-10 || acLen < 1e-10) return null;

    const sinAngle = normalLen / (abLen * acLen);
    if (sinAngle < 0.05) return null; // collinear

    const unitNormal = v3scale(normal, 1 / normalLen);
    const xAxis = v3norm(AB);
    const yAxis = v3cross(unitNormal, xAxis);

    function to2D(P) {
        const rel = v3sub(P, A);
        return vec2(v3dot(rel, xAxis), v3dot(rel, yAxis));
    }

    const a = to2D(A);
    const b = to2D(B);
    const c = to2D(C);

    const midAB = vec2((a.x + b.x) / 2, (a.y + b.y) / 2);
    const midBC = vec2((b.x + c.x) / 2, (b.y + c.y) / 2);
    const dirAB = v2sub(b, a);
    const perpAB = vec2(-dirAB.y, dirAB.x);
    const dirBC = v2sub(c, b);
    const perpBC = vec2(-dirBC.y, dirBC.x);

    const denom = perpAB.x * perpBC.y - perpAB.y * perpBC.x;
    if (Math.abs(denom) < 1e-10) return null;

    const diff = v2sub(midBC, midAB);
    const t = (diff.x * perpBC.y - diff.y * perpBC.x) / denom;

    const h = midAB.x + t * perpAB.x;
    const k = midAB.y + t * perpAB.y;
    const radius = Math.sqrt(h * h + k * k);
    const center3D = v3add(A, v3add(v3scale(xAxis, h), v3scale(yAxis, k)));

    return { center: center3D, radius, normal: unitNormal };
}

export function pointOnCircle(point, center, radius, tolerance) {
    return Math.abs(v3dist(point, center) - radius) <= tolerance;
}

function isClosed(points) {
    if (points.length < 3) return false;
    return v3dist(points[0], points[points.length - 1]) < 0.05;
}

function totalLength(points) {
    let len = 0;
    for (let i = 0; i < points.length - 1; i++) len += v3dist(points[i], points[i + 1]);
    return len;
}

export function calculateSweep(points, center, normal) {
    if (points.length < 2) return 0;
    const toFirst = v3norm(v3sub(points[0], center));
    const yAxis = v3cross(normal, toFirst);
    const toLast = v3sub(points[points.length - 1], center);
    let angle = Math.atan2(v3dot(toLast, yAxis), v3dot(toLast, toFirst)) * 180 / Math.PI;
    if (angle < 0) angle += 360;

    if (points.length > 2) {
        const midIdx = Math.floor(points.length / 2);
        const toMid = v3sub(points[midIdx], center);
        let midAngle = Math.atan2(v3dot(toMid, yAxis), v3dot(toMid, toFirst)) * 180 / Math.PI;
        if (midAngle < 0) midAngle += 360;
        if (midAngle > angle + 10) angle = 360 - angle;
    }
    return angle;
}

/**
 * Main classifier.  Returns { type, points, … } with type ∈ {line, arc, circle}.
 */
export function classifyCurve(points) {
    const n = points.length;

    if (n < 3) {
        return { type: 'line', points, length: n === 2 ? v3dist(points[0], points[1]) : 0, numPoints: n };
    }

    const segLengths = [];
    let totalLen = 0, maxSegLen = 0;
    for (let i = 0; i < n - 1; i++) {
        const len = v3dist(points[i], points[i + 1]);
        segLengths.push(len);
        totalLen += len;
        if (len > maxSegLen) maxSegLen = len;
    }
    const avgSegLen = totalLen / segLengths.length;

    const gap = v3dist(points[0], points[n - 1]);
    const closed = gap < avgSegLen * 2;

    let maxAngle = 0;
    for (let i = 1; i < n - 1; i++) {
        maxAngle = Math.max(maxAngle, angleBetween(v3sub(points[i], points[i - 1]), v3sub(points[i + 1], points[i])));
    }

    const segConsistent = maxSegLen < Math.max(avgSegLen * 3, 1.0);

    console.log(`  Circle check: closed=${closed}(gap=${gap.toFixed(4)}", avgSeg=${avgSegLen.toFixed(4)}"), pts=${n}, maxSeg=${maxSegLen.toFixed(3)}", maxAngle=${maxAngle.toFixed(1)}°, consistent=${segConsistent}`);

    // --- Circle ---
    if (closed && n > 8 && segConsistent && maxAngle < 25) {
        const p1 = points[0];
        const p2 = points[Math.floor(n / 3)];
        const p3 = points[Math.floor(n * 2 / 3)];
        const circle = circleFrom3Points(p1, p2, p3);
        console.log(`  → CIRCLE detected: ${n} pts, R=${circle ? circle.radius.toFixed(3) : '?'}"`);
        return {
            type: 'circle', points,
            center: circle ? circle.center : points[0],
            radius: circle ? circle.radius : totalLen / (2 * Math.PI),
            normal: circle ? circle.normal : vec3(0, 0, 1),
            numPoints: n
        };
    }

    // --- Arc check ---
    const p1 = points[0];
    const p2 = points[Math.floor(n / 2)];
    const p3 = points[n - 1];
    const circle = circleFrom3Points(p1, p2, p3);

    if (!circle) {
        console.log(`  → Collinear points, classifying as LINE`);
        return { type: 'line', points, length: totalLength(points), numPoints: n };
    }

    const tolerance = Math.max(circle.radius * 0.10, 0.005);
    let maxError = 0, failedPoint = -1;
    for (let i = 0; i < n; i++) {
        const error = Math.abs(v3dist(points[i], circle.center) - circle.radius);
        if (error > maxError) maxError = error;
        if (error > tolerance) { failedPoint = i; break; }
    }

    if (failedPoint >= 0) {
        console.log(`  → Circle fit failed at point ${failedPoint}, error=${maxError.toFixed(4)}" > tolerance=${tolerance.toFixed(4)}", R=${circle.radius.toFixed(3)}"`);
        return { type: 'line', points, length: totalLength(points), numPoints: n };
    }

    console.log(`  → ARC detected: R=${circle.radius.toFixed(3)}", maxError=${maxError.toFixed(4)}"`);
    return {
        type: 'arc', points,
        center: circle.center,
        radius: circle.radius,
        normal: circle.normal,
        sweep: calculateSweep(points, circle.center, circle.normal),
        numPoints: n
    };
}
