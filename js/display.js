// ============================================
// Partcraft – Display Updates
// Edge/face toggling, stats panel rendering
// ============================================

import * as S from './state.js';
import { buildEdgeVisualization } from './edges.js';
import { generateDistinctColors, hslToHex } from './utils.js';

export function updateEdgeDisplay() {
    if (!S.currentGroup || !S.analysisResults) return;
    if (S.edgeObjects.current) S.currentGroup.remove(S.edgeObjects.current);
    const partcraft = S.analysisResults.partcraft;
    S.edgeObjects.current = buildEdgeVisualization(partcraft.edges, S.colorMode, partcraft.totalChains, S.meshObjects.geometry, S.wireMode);
    S.currentGroup.add(S.edgeObjects.current);
    updateStatsDisplay();
    document.getElementById('color-legend').style.display = S.colorMode === 'classified' ? 'flex' : 'none';
}

export function updateFaceDisplay() {
    if (!S.currentGroup || !S.meshObjects.solid || !S.meshObjects.random) return;
    S.meshObjects.solid.visible = (S.faceMode === 'solid');
    S.meshObjects.random.visible = (S.faceMode === 'random');
    updateStatsDisplay();
}

export function updateStatsDisplay() {
    const partcraft = S.analysisResults.partcraft;
    const counts = partcraft.counts;
    const chainColors = generateDistinctColors(partcraft.totalChains || 50);

    let curveDetailsHtml = '';
    if (partcraft.curveDetails?.length) {
        curveDetailsHtml = '<div class="curve-details">';
        for (const curve of partcraft.curveDetails) {
            let badgeStyle = '';
            if (S.colorMode === 'random') {
                const c = chainColors[curve.index % chainColors.length];
                badgeStyle = `style="background: ${hslToHex(c.h, c.s, c.l)}; color: #000;"`;
            }
            curveDetailsHtml += `<div class="curve-detail-item"><span class="curve-type-badge ${S.colorMode !== 'random' ? curve.type : ''}" ${badgeStyle}>${curve.type}</span>${curve.detail}</div>`;
        }
        curveDetailsHtml += '</div>';
    }

    let facesHtml = '';
    if (S.faceMode === 'random' && S.faceColors.length) {
        facesHtml = '<div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #3a3a5a;"><h4 style="color: #6c63ff; margin-bottom: 10px;">B-Rep Faces</h4>' +
            S.faceColors.map((fc, i) => `<div class="edge-stat"><span><span class="face-color-box" style="background: ${hslToHex(fc.h, fc.s, fc.l)};"></span>Face ${i}</span><span>${fc.triangles} tris</span></div>`).join('') + '</div>';
    }

    document.getElementById('edge-stats').innerHTML = `
        <div style="margin-bottom: 15px;">
            <h4 style="color: #6c63ff; margin-bottom: 10px;">Edge Classification</h4>
            <div class="edge-stat"><span>Edge Chains:</span><span>${partcraft.chains}</span></div>
            <div class="edge-stat"><span style="color: #00ffff;">Lines:</span><span>${counts.line || 0}</span></div>
            <div class="edge-stat"><span style="color: #ff00ff;">Arcs:</span><span>${counts.arc || 0}</span></div>
            <div class="edge-stat"><span style="color: #ffff00;">Circles:</span><span>${counts.circle || 0}</span></div>
            ${curveDetailsHtml}
        </div>
        <div style="border-top: 1px solid #3a3a5a; padding-top: 15px;">
            <h4 style="color: #6c63ff; margin-bottom: 10px;">Geometry</h4>
            <div class="edge-stat"><span>Vertices:</span><span>${S.analysisResults.vertices}</span></div>
            <div class="edge-stat"><span>Triangles:</span><span>${S.analysisResults.triangles}</span></div>
            <div class="edge-stat"><span>B-Rep Faces:</span><span>${S.analysisResults.brepFaces}</span></div>
        </div>
        ${facesHtml}
    `;
}
