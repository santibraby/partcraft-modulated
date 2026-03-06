// ============================================
// Partcraft – Annotation System
// Ordinate dimensions & diameter callouts
// ============================================

import * as S from './state.js';

// ---- Text sprites ----

export function createTextSprite(text, position, rotation = 0, align = 'center') {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (rotation !== 0) { canvas.width = 64; canvas.height = 256; }
    else { canvas.width = 256; canvas.height = 64; }

    ctx.fillStyle = '#4488ff';
    ctx.font = 'bold 36px Arial';
    ctx.textBaseline = 'middle';

    if (rotation !== 0) {
        ctx.translate(32, 128);
        ctx.rotate(rotation);
        ctx.textAlign = 'center';
        ctx.fillText(text, 0, 0);
    } else {
        if (align === 'right') { ctx.textAlign = 'right'; ctx.fillText(text, 240, 32); }
        else if (align === 'left') { ctx.textAlign = 'left'; ctx.fillText(text, 16, 32); }
        else { ctx.textAlign = 'center'; ctx.fillText(text, 128, 32); }
    }

    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture }));
    sprite.position.copy(position);
    sprite.scale.set(rotation !== 0 ? 0.75 : 3, rotation !== 0 ? 3 : 0.75, 1);
    return sprite;
}

// ---- Feature point extraction ----

export function getFeaturePoints(level) {
    const features = [];

    if (S.currentGroup) {
        const box = new THREE.Box3().setFromObject(S.currentGroup);
        const mn = box.min, mx = box.max;
        // All 8 bounding-box corners
        features.push({ x: mn.x, y: mn.y, z: mn.z, type: 'boundary' });
        features.push({ x: mx.x, y: mx.y, z: mx.z, type: 'boundary' });
        features.push({ x: mn.x, y: mx.y, z: mn.z, type: 'boundary' });
        features.push({ x: mx.x, y: mn.y, z: mx.z, type: 'boundary' });
        features.push({ x: mn.x, y: mn.y, z: mx.z, type: 'boundary' });
        features.push({ x: mx.x, y: mx.y, z: mn.z, type: 'boundary' });
        features.push({ x: mn.x, y: mx.y, z: mx.z, type: 'boundary' });
        features.push({ x: mx.x, y: mn.y, z: mn.z, type: 'boundary' });
    }

    if (level === 1) { console.log(`Level 1: ${features.length} boundary points only`); return features; }

    if (!S.analysisResults?.partcraft?.curveDetails) return features;

    for (const curve of S.analysisResults.partcraft.curveDetails) {
        if (curve.type === 'circle' && curve.center) {
            features.push({ x: curve.center.x, y: curve.center.y, z: curve.center.z, type: 'circle-center' });
        } else if (curve.type === 'arc') {
            if (curve.center) features.push({ x: curve.center.x, y: curve.center.y, z: curve.center.z, type: 'arc-center' });
            if (level === 3 && curve.points?.length >= 2) {
                const s = curve.points[0], e = curve.points[curve.points.length - 1];
                features.push({ x: s.x, y: s.y, z: s.z, type: 'arc-endpoint' });
                features.push({ x: e.x, y: e.y, z: e.z, type: 'arc-endpoint' });
            }
        } else if (curve.type === 'line' && level === 3 && curve.points?.length >= 2) {
            const s = curve.points[0], e = curve.points[curve.points.length - 1];
            features.push({ x: s.x, y: s.y, z: s.z, type: 'line-endpoint' });
            features.push({ x: e.x, y: e.y, z: e.z, type: 'line-endpoint' });
        }
    }

    console.log(`Level ${level}: ${features.length} feature points extracted`);
    return features;
}

// ---- Helpers ----

export function getUniqueValues(points, axis, tolerance = 0.01) {
    const values = points.map(p => ({ val: p[axis], point: p }));
    values.sort((a, b) => a.val - b.val);
    const unique = [];
    for (const v of values) {
        if (unique.length === 0 || Math.abs(v.val - unique[unique.length - 1].val) > tolerance) unique.push(v);
    }
    return unique;
}

function getCirclesAndArcs() {
    if (!S.analysisResults?.partcraft?.curveDetails) return [];
    const features = [];
    for (const curve of S.analysisResults.partcraft.curveDetails) {
        if ((curve.type === 'circle' || curve.type === 'arc') && curve.center && curve.radius) {
            features.push({ type: curve.type, center: curve.center, radius: curve.radius, diameter: curve.radius * 2 });
        }
    }
    console.log(`Circles/Arcs found: ${features.length}`);
    return features;
}

// ---- Main annotation entry ----

export function createAnnotations() {
    clearAnnotations();
    if (S.annotationLevel === 0 || !S.currentGroup || S.currentView === 'axon') return;

    const features = getFeaturePoints(S.annotationLevel);
    if (features.length === 0) { console.log('No features found for annotation'); return; }

    S.setAnnotationGroup(new THREE.Group());
    const box = new THREE.Box3().setFromObject(S.currentGroup);

    console.log(`Creating annotations for ${S.currentView} view`);
    console.log(`Model bounds: X[${box.min.x.toFixed(2)}, ${box.max.x.toFixed(2)}], Y[${box.min.y.toFixed(2)}, ${box.max.y.toFixed(2)}], Z[${box.min.z.toFixed(2)}, ${box.max.z.toFixed(2)}]`);

    let leftAxis, bottomAxis, leftDir, bottomDir, annotationPlane, annotationPlanePos;

    switch (S.currentView) {
        case 'left':
            leftAxis = 'y'; bottomAxis = 'z'; leftDir = -1; bottomDir = -1;
            annotationPlane = 'x'; annotationPlanePos = box.min.x; break;
        case 'right':
            leftAxis = 'y'; bottomAxis = 'z'; leftDir = 1; bottomDir = -1;
            annotationPlane = 'x'; annotationPlanePos = box.max.x; break;
        case 'front':
            leftAxis = 'y'; bottomAxis = 'x'; leftDir = -1; bottomDir = -1;
            annotationPlane = 'z'; annotationPlanePos = box.max.z; break;
        case 'top':
            leftAxis = 'z'; bottomAxis = 'x'; leftDir = -1; bottomDir = 1;
            annotationPlane = 'y'; annotationPlanePos = box.max.y; break;
        default: return;
    }

    createSideAnnotations('left', leftAxis, bottomAxis, leftDir, box, annotationPlane, annotationPlanePos);
    createSideAnnotations('bottom', bottomAxis, leftAxis, bottomDir, box, annotationPlane, annotationPlanePos);

    if (S.annotationLevel >= 2) {
        createDiameterAnnotations(leftAxis, bottomAxis, leftDir, box, annotationPlane, annotationPlanePos);
    }

    S.scene.add(S.annotationGroup);
    console.log(`Annotations created (Level ${S.annotationLevel})`);
}

// ---- Ordinate dimension side ----

function createSideAnnotations(side, valueAxis, perpAxis, direction, box, planeAxis, planePos) {
    const features = getFeaturePoints(S.annotationLevel);
    const uniqueVals = getUniqueValues(features, valueAxis);
    if (uniqueVals.length === 0) return;

    console.log(`${side} annotations: ${uniqueVals.length} unique ${valueAxis.toUpperCase()} values`);
    uniqueVals.sort((a, b) => a.val - b.val);

    const minVal = uniqueVals[0].val;
    const maxVal = uniqueVals[uniqueVals.length - 1].val;
    const origin = box.min[valueAxis];
    const edgePos = direction > 0 ? box.max[perpAxis] : box.min[perpAxis];
    const p1Pos = edgePos + direction * 2;
    const p2Pos = p1Pos + direction * 2;
    const p3Pos = p2Pos + direction * 2;
    const p4Pos = p3Pos + direction * 2;
    const textPos = p4Pos + direction * 2;

    console.log(`  ${perpAxis} positions: edge=${edgePos.toFixed(2)}, P1=${p1Pos.toFixed(2)}, P2=${p2Pos.toFixed(2)}, P3=${p3Pos.toFixed(2)}, P4=${p4Pos.toFixed(2)}, text=${textPos.toFixed(2)}`);

    for (let i = 0; i < uniqueVals.length; i++) {
        const featureVal = uniqueVals[i].val;
        const dimText = (featureVal - origin).toFixed(3);
        const spacedVal = uniqueVals.length === 1 ? featureVal : minVal + (i / (uniqueVals.length - 1)) * (maxVal - minVal);

        const p1 = new THREE.Vector3();
        const p2 = new THREE.Vector3();
        const p3 = new THREE.Vector3();
        const p4 = new THREE.Vector3();
        const labelPosition = new THREE.Vector3();

        for (const pt of [p1, p2, p3, p4, labelPosition]) pt[planeAxis] = planePos;

        p1[valueAxis] = featureVal; p1[perpAxis] = p1Pos;
        p2[valueAxis] = featureVal; p2[perpAxis] = p2Pos;
        p3[valueAxis] = spacedVal;  p3[perpAxis] = p3Pos;
        p4[valueAxis] = spacedVal;  p4[perpAxis] = p4Pos;
        labelPosition[valueAxis] = spacedVal; labelPosition[perpAxis] = textPos;

        const leaderGeom = new THREE.BufferGeometry().setFromPoints([p1, p2, p3, p4]);
        S.annotationGroup.add(new THREE.Line(leaderGeom, new THREE.LineBasicMaterial({ color: 0x4488ff })));

        const isBottom = (side === 'bottom');
        S.annotationGroup.add(createTextSprite(dimText + '"', labelPosition, isBottom ? -Math.PI / 2 : 0, isBottom ? 'center' : 'right'));
    }
}

// ---- Diameter callouts ----

function createDiameterAnnotations(vertAxis, horizAxis, leftDir, box, planeAxis, planePos) {
    const circlesArcs = getCirclesAndArcs();
    if (circlesArcs.length === 0) return;

    // Deduplicate by vertical-axis position
    const tolerance = 0.001;
    const uniqueFeatures = [];
    for (const feature of circlesArcs) {
        if (!uniqueFeatures.some(e => Math.abs(feature.center[vertAxis] - e.center[vertAxis]) < tolerance)) uniqueFeatures.push(feature);
    }

    console.log(`Creating diameter annotations: ${circlesArcs.length} total, ${uniqueFeatures.length} unique by ${vertAxis.toUpperCase()} position`);

    const rightDir = -leftDir;
    const edgePos = rightDir > 0 ? box.max[horizAxis] : box.min[horizAxis];
    const p2Pos = edgePos + rightDir * 2;
    const p3Pos = p2Pos + rightDir * 2;

    console.log(`  Diameter annotations: edge=${edgePos.toFixed(2)}, P2=${p2Pos.toFixed(2)}, P3=${p3Pos.toFixed(2)} (opposite side, dir=${rightDir})`);

    uniqueFeatures.sort((a, b) => a.center[vertAxis] - b.center[vertAxis]);
    const minVert = uniqueFeatures[0].center[vertAxis];
    const maxVert = uniqueFeatures[uniqueFeatures.length - 1].center[vertAxis];

    const plusSize = 0.3, dashLength = 0.08, gapLength = 0.06;

    for (let i = 0; i < uniqueFeatures.length; i++) {
        const { center, diameter, type } = uniqueFeatures[i];
        const spacedVert = uniqueFeatures.length === 1 ? center[vertAxis] : minVert + (i / (uniqueFeatures.length - 1)) * (maxVert - minVert);

        const p1 = new THREE.Vector3();
        const p2 = new THREE.Vector3();
        const p3 = new THREE.Vector3();
        const labelPosition = new THREE.Vector3();

        for (const pt of [p1, p2, p3, labelPosition]) pt[planeAxis] = planePos;

        p1[vertAxis]  = center[vertAxis]; p1[horizAxis] = center[horizAxis];
        p2[vertAxis]  = spacedVert;       p2[horizAxis] = p2Pos;
        p3[vertAxis]  = spacedVert;       p3[horizAxis] = p3Pos;
        labelPosition[vertAxis] = spacedVert; labelPosition[horizAxis] = p3Pos + rightDir * 1.5;

        console.log(`  ${type}: Ø${diameter.toFixed(3)}" center=(${center.x.toFixed(2)},${center.y.toFixed(2)},${center.z.toFixed(2)})`);

        // Leader line
        S.annotationGroup.add(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([p1, p2, p3]),
            new THREE.LineBasicMaterial({ color: 0x4488ff })
        ));

        // Dashed plus sign at center
        for (let d = -plusSize; d < plusSize; d += dashLength + gapLength) {
            const hStart = p1.clone(); const hEnd = p1.clone();
            hStart[horizAxis] = center[horizAxis] + d;
            hEnd[horizAxis] = center[horizAxis] + Math.min(d + dashLength, plusSize);
            if (hEnd[horizAxis] > hStart[horizAxis]) {
                S.annotationGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([hStart, hEnd]), new THREE.LineBasicMaterial({ color: 0x4488ff })));
            }

            const vStart = p1.clone(); const vEnd = p1.clone();
            vStart[vertAxis] = center[vertAxis] + d;
            vEnd[vertAxis] = center[vertAxis] + Math.min(d + dashLength, plusSize);
            if (vEnd[vertAxis] > vStart[vertAxis]) {
                S.annotationGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([vStart, vEnd]), new THREE.LineBasicMaterial({ color: 0x4488ff })));
            }
        }

        // Arrow at P1
        const arrowDir = new THREE.Vector3().subVectors(p1, p2).normalize();
        const arrowLength = 0.25, arrowWidth = 0.1;
        const perpVec = new THREE.Vector3(); perpVec[vertAxis] = arrowWidth;
        const arrowBase = p1.clone().sub(arrowDir.clone().multiplyScalar(arrowLength));
        const arrowLeft = arrowBase.clone().add(perpVec);
        const arrowRight = arrowBase.clone().sub(perpVec);
        const arrowGeom = new THREE.BufferGeometry();
        arrowGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
            p1.x, p1.y, p1.z, arrowLeft.x, arrowLeft.y, arrowLeft.z, arrowRight.x, arrowRight.y, arrowRight.z
        ]), 3));
        S.annotationGroup.add(new THREE.Mesh(arrowGeom, new THREE.MeshBasicMaterial({ color: 0x4488ff, side: THREE.DoubleSide })));

        // Label
        S.annotationGroup.add(createTextSprite(`Ø ${diameter.toFixed(3)}"`, labelPosition, 0, 'left'));
    }
}

export function clearAnnotations() {
    if (S.annotationGroup) {
        S.scene.remove(S.annotationGroup);
        S.setAnnotationGroup(null);
    }
}
