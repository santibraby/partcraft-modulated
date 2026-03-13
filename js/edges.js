// ============================================
// Partcraft – Edge Detection & Visualization
// Chaining, corner splitting, edge rendering
// ============================================

import { vec3, v3sub, v3dist, angleBetween } from './math.js';
import { classifyCurve } from './classifier.js';
import { generateDistinctColors, hslToHex } from './utils.js';
import { CURVE_COLORS } from './state.js';

// ---- Raw edge extraction from Three.js ----

function getEdgesFromThreeJS(geometry) {
    const edgesGeometry = new THREE.EdgesGeometry(geometry, 30);
    const positions = edgesGeometry.attributes.position.array;
    const edges = [];
    for (let i = 0; i < positions.length; i += 6) {
        edges.push({
            start: vec3(positions[i], positions[i + 1], positions[i + 2]),
            end:   vec3(positions[i + 3], positions[i + 4], positions[i + 5])
        });
    }
    return edges;
}

function getAllMeshEdges(geometry) {
    const wireframeGeom = new THREE.WireframeGeometry(geometry);
    const positions = wireframeGeom.attributes.position.array;
    const edges = [];
    for (let i = 0; i < positions.length; i += 6) {
        edges.push({
            start: vec3(positions[i], positions[i + 1], positions[i + 2]),
            end:   vec3(positions[i + 3], positions[i + 4], positions[i + 5])
        });
    }
    return edges;
}

// ---- Edge chaining ----

function chainEdges(edges) {
    const tolerance = 0.001;
    const used = new Array(edges.length).fill(false);
    const rawChains = [];

    function pointsEqual(p1, p2) { return v3dist(p1, p2) < tolerance; }

    function findConnecting(point) {
        for (let i = 0; i < edges.length; i++) {
            if (used[i]) continue;
            if (pointsEqual(edges[i].start, point)) return { idx: i, reverse: false };
            if (pointsEqual(edges[i].end, point))   return { idx: i, reverse: true };
        }
        return null;
    }

    // Step 1: Build raw chains
    for (let i = 0; i < edges.length; i++) {
        if (used[i]) continue;
        const chain = [edges[i].start, edges[i].end];
        used[i] = true;

        let found;
        while ((found = findConnecting(chain[chain.length - 1]))) {
            used[found.idx] = true;
            chain.push(found.reverse ? edges[found.idx].start : edges[found.idx].end);
        }
        while ((found = findConnecting(chain[0]))) {
            used[found.idx] = true;
            chain.unshift(found.reverse ? edges[found.idx].start : edges[found.idx].end);
        }
        rawChains.push(chain);
    }

    // Step 2: Split at corners
    const finalChains = [];

    for (let rc = 0; rc < rawChains.length; rc++) {
        const chain = rawChains[rc];
        if (chain.length <= 2) { finalChains.push(chain); continue; }

        let totalLen = 0, maxSeg = 0;
        for (let i = 0; i < chain.length - 1; i++) {
            const segLen = v3dist(chain[i], chain[i + 1]);
            totalLen += segLen;
            maxSeg = Math.max(maxSeg, segLen);
        }
        const avgSeg = totalLen / (chain.length - 1);
        const chainGap = v3dist(chain[0], chain[chain.length - 1]);
        const chainClosed = chainGap < avgSeg * 2;
        const isCircleCandidate = chainClosed && chain.length > 8 && maxSeg < Math.max(avgSeg * 3, 1.0);

        console.log(`Raw chain ${rc}: ${chain.length} pts, gap=${chainGap.toFixed(4)}", avgSeg=${avgSeg.toFixed(4)}", closed=${chainClosed}, circleCandidate=${isCircleCandidate}`);

        if (isCircleCandidate) {
            console.log(`  → CIRCLE CANDIDATE, not splitting`);
            finalChains.push(chain);
            continue;
        }

        const cornerIndices = findCorners(chain);
        if (cornerIndices.length === 0) {
            finalChains.push(chain);
        } else {
            const splits = splitAtCorners(chain, cornerIndices);
            console.log(`  → Split into ${splits.length} chains at corners: [${cornerIndices.join(', ')}]`);
            finalChains.push(...splits);
        }
    }
    return finalChains;
}

// ---- Corner detection ----

function findCorners(chain, angleThreshold = 15, lengthThreshold = 0.5) {
    const corners = [];
    if (chain.length < 3) return corners;

    const segLengths = [];
    for (let i = 0; i < chain.length - 1; i++) segLengths.push(v3dist(chain[i], chain[i + 1]));

    const sortedLengths = [...segLengths].sort((a, b) => a - b);
    const medianLength = sortedLengths[Math.floor(sortedLengths.length / 2)];

    function isLongSegment(len) { return len > lengthThreshold || len > medianLength * 2; }

    for (let i = 1; i < chain.length - 1; i++) {
        const prevLen = segLengths[i - 1];
        const nextLen = segLengths[i];
        const prevIsLong = isLongSegment(prevLen);
        const nextIsLong = isLongSegment(nextLen);

        if (prevIsLong !== nextIsLong) {
            console.log(`  Corner at ${i}: segment length transition (${prevLen.toFixed(3)}" -> ${nextLen.toFixed(3)}")`);
            corners.push(i);
            continue;
        }
        if (prevIsLong && nextIsLong) {
            console.log(`  Corner at ${i}: between two long segments`);
            corners.push(i);
            continue;
        }

        const angle = angleBetween(v3sub(chain[i], chain[i - 1]), v3sub(chain[i + 1], chain[i]));
        if (angle > angleThreshold) {
            console.log(`  Corner at ${i}: angle ${angle.toFixed(1)}° > ${angleThreshold}°`);
            corners.push(i);
        }
    }
    return [...new Set(corners)].sort((a, b) => a - b);
}

function splitAtCorners(chain, cornerIndices) {
    const result = [];
    const sorted = [...cornerIndices].sort((a, b) => a - b);
    let start = 0;
    for (const cornerIdx of sorted) {
        if (cornerIdx > start) result.push(chain.slice(start, cornerIdx + 1));
        start = cornerIdx;
    }
    if (start < chain.length - 1) result.push(chain.slice(start));
    return result.filter(c => c.length >= 2);
}

// ---- Main detection pipeline ----

export function detectEdgesPartcraft(geometry) {
    const rawEdges = getEdgesFromThreeJS(geometry);
    console.log(`Raw edges from Three.js: ${rawEdges.length}`);

    const chains = chainEdges(rawEdges);
    console.log(`Chains after corner splitting: ${chains.length}`);

    let totalSegments = 0, longSegments = 0;
    for (const chain of chains) {
        for (let i = 0; i < chain.length - 1; i++) {
            totalSegments++;
            if (v3dist(chain[i], chain[i + 1]) > 1.0) longSegments++;
        }
    }
    console.log(`Segment stats: ${longSegments} long (>1") out of ${totalSegments} total`);

    const classified = [];
    const counts = { line: 0, arc: 0, circle: 0 };
    const curveDetails = [];

    for (let i = 0; i < chains.length; i++) {
        const result = classifyCurve(chains[i]);
        counts[result.type]++;

        let maxSegLen = 0;
        for (let j = 0; j < result.points.length - 1; j++) maxSegLen = Math.max(maxSegLen, v3dist(result.points[j], result.points[j + 1]));

        const gap = v3dist(result.points[0], result.points[result.points.length - 1]);
        let maxAngle = 0;
        for (let j = 1; j < result.points.length - 1; j++) {
            maxAngle = Math.max(maxAngle, angleBetween(v3sub(result.points[j], result.points[j - 1]), v3sub(result.points[j + 1], result.points[j])));
        }

        let detail = `#${i}: ${result.type.toUpperCase()} (${result.numPoints} pts)`;
        if (result.type === 'line') {
            detail += ` len=${result.length.toFixed(3)}"`;
            if (result.numPoints > 10) detail += ` [gap=${gap.toFixed(3)}", maxAng=${maxAngle.toFixed(1)}°]`;
        } else if (result.type === 'arc') {
            detail += ` R=${result.radius.toFixed(3)}" sweep=${result.sweep.toFixed(1)}°`;
        } else if (result.type === 'circle') {
            detail += ` R=${result.radius.toFixed(3)}"`;
        }
        if (maxSegLen > 0.5) detail += ` [maxSeg=${maxSegLen.toFixed(2)}"]`;

        curveDetails.push({ index: i, type: result.type, detail, ...result });
        console.log(`Chain ${i}: ${detail}`);

        for (let j = 0; j < result.points.length - 1; j++) {
            classified.push({ start: result.points[j], end: result.points[j + 1], type: result.type, chainIndex: i });
        }
    }

    return { edges: classified, chains: chains.length, counts, curveDetails, totalChains: chains.length };
}

// ---- Edge matching helpers ----

function edgesMatch(e1, e2, tolerance = 0.0001) {
    return (v3dist(e1.start, e2.start) < tolerance && v3dist(e1.end, e2.end) < tolerance) ||
           (v3dist(e1.start, e2.end) < tolerance && v3dist(e1.end, e2.start) < tolerance);
}

function getNonClassifiedEdges(allMeshEdges, classifiedEdges) {
    const nonClassified = [];
    for (const meshEdge of allMeshEdges) {
        let isClassified = false;
        for (const classEdge of classifiedEdges) {
            if (edgesMatch(meshEdge, classEdge)) { isClassified = true; break; }
        }
        if (!isClassified) nonClassified.push(meshEdge);
    }
    return nonClassified;
}

// ---- Build Three.js line objects for rendering ----

export function buildEdgeVisualization(edges, mode, totalChains, geometry, showMeshWires) {
    const group = new THREE.Group();

    // Mesh wire overlay
    if (showMeshWires && geometry) {
        const allMeshEdges = getAllMeshEdges(geometry);
        const nonClassifiedEdges = getNonClassifiedEdges(allMeshEdges, edges);
        console.log(`Mesh wires: ${allMeshEdges.length} total, ${edges.length} classified, ${nonClassifiedEdges.length} non-classified (white)`);

        if (nonClassifiedEdges.length > 0) {
            const positions = [];
            for (const edge of nonClassifiedEdges) positions.push(edge.start.x, edge.start.y, edge.start.z, edge.end.x, edge.end.y, edge.end.z);
            const geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            group.add(new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 })));
        }
    }

    if (mode === 'classified') {
        const byType = {};
        for (const edge of edges) { const type = edge.type || 'unknown'; (byType[type] ??= []).push(edge); }
        for (const [type, typeEdges] of Object.entries(byType)) {
            const positions = [];
            for (const edge of typeEdges) positions.push(edge.start.x, edge.start.y, edge.start.z, edge.end.x, edge.end.y, edge.end.z);
            if (positions.length > 0) {
                const geom = new THREE.BufferGeometry();
                geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
                group.add(new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ color: CURVE_COLORS[type] || 0 })));
            }
        }
    } else if (mode === 'random') {
        const chainColors = generateDistinctColors(totalChains || 50);
        const byChain = {};
        for (const edge of edges) { const idx = edge.chainIndex || 0; (byChain[idx] ??= []).push(edge); }
        for (const [chainIdx, chainEdges] of Object.entries(byChain)) {
            const positions = [];
            for (const edge of chainEdges) positions.push(edge.start.x, edge.start.y, edge.start.z, edge.end.x, edge.end.y, edge.end.z);
            if (positions.length > 0) {
                const geom = new THREE.BufferGeometry();
                geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
                const colorData = chainColors[chainIdx % chainColors.length];
                group.add(new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ color: new THREE.Color(hslToHex(colorData.h, colorData.s, colorData.l)) })));
            }
        }
    } else {
        const positions = [];
        for (const edge of edges) positions.push(edge.start.x, edge.start.y, edge.start.z, edge.end.x, edge.end.y, edge.end.z);
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        group.add(new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ color: 0x000000 })));
    }
    return group;
}
