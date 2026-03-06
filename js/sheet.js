// ============================================
// Partcraft – Sheet Layout Model
// Computes viewports and field data from layout.js
// Sidebar visual layout is handled by preview.js
// ============================================

import * as S from './state.js';
import { LAYOUT as L } from './layout.js';

export function createSheet(partName) {
    const pg = L.page;
    const bm = pg.borderMargin;
    const sw = L.sidebar.width;
    const gr = L.grid;

    // Sidebar x
    const sidebarX = pg.width - bm - sw;

    // Viewport grid
    const gridX = bm;
    const gridW = sidebarX - bm;
    const gridH = pg.height - bm * 2;

    const totalColR = gr.colRatio[0] + gr.colRatio[1];
    const totalRowR = gr.rowRatio[0] + gr.rowRatio[1];
    const colWidths = [gridW * gr.colRatio[0] / totalColR, gridW * gr.colRatio[1] / totalColR];
    const rowHeights = [gridH * gr.rowRatio[0] / totalRowR, gridH * gr.rowRatio[1] / totalRowR];

    const viewports = [];
    let yOff = bm + gridH;
    for (let row = 0; row < 2; row++) {
        yOff -= rowHeights[row];
        let xOff = gridX;
        for (let col = 0; col < 2; col++) {
            const viewName = gr.views[row][col];
            const vp = {
                id: viewName,
                view: viewName,
                label: gr.labels[viewName] || viewName.toUpperCase(),
                x: xOff, y: yOff,
                width: colWidths[col], height: rowHeights[row],
                scale: null, scaleText: '',
            };
            viewports.push(vp);
            xOff += colWidths[col];
        }
    }

    // Uniform scale: find the tightest fit across all viewports,
    // then every view uses that same scale so 1" on sheet = same real distance everywhere
    let uniformScale = Infinity;
    for (const vp of viewports) {
        const s = calcScale(vp);
        if (s < uniformScale) uniformScale = s;
    }
    for (const vp of viewports) {
        vp.scale = uniformScale;
        vp.scaleText = fmtScale(uniformScale);
    }

    const sheet = {
        pageWidth: pg.width,
        pageHeight: pg.height,
        borderMargin: bm,
        viewports,
        sidebar: { x: sidebarX, w: sw },
        issueRows: [
            { no: '01', date: fmtDate(), desc: 'Issue 001' },
        ],
        fields: {
            drawingTitle: partName || L.titleBlock.defaults.drawingTitle,
            drawingNo: L.titleBlock.defaults.drawingNo,
            scale: fmtScale(uniformScale),
            sheetNo: L.titleBlock.defaults.sheetNo,
        },
    };

    S.setCurrentSheet(sheet);
    return sheet;
}

export function getViewExtents(viewName) {
    if (!S.modelBounds) return { horizontal: 1, vertical: 1 };
    const b = S.modelBounds;
    switch (viewName) {
        case 'front': return { horizontal: b.max.x - b.min.x, vertical: b.max.y - b.min.y };
        case 'top':   return { horizontal: b.max.x - b.min.x, vertical: b.max.z - b.min.z };
        case 'right': return { horizontal: b.max.z - b.min.z, vertical: b.max.y - b.min.y };
        case 'axon': {
            const dx = b.max.x - b.min.x, dy = b.max.y - b.min.y, dz = b.max.z - b.min.z;
            return { horizontal: (dx + dz) * 0.7, vertical: dy + (dx + dz) * 0.35 };
        }
        default: return { horizontal: 1, vertical: 1 };
    }
}

function calcScale(vp) {
    const ext = getViewExtents(vp.view);
    if (ext.horizontal === 0 && ext.vertical === 0) return 1;
    return Math.min(vp.width / Math.max(ext.horizontal, 0.01), vp.height / Math.max(ext.vertical, 0.01)) * 0.75;
}

function fmtScale(s) {
    if (!s || s === 0) return '1:1';
    if (s >= 1) return `${s.toFixed(0)}:1`;
    return `1:${Math.round(1 / s)}`;
}

function fmtDate() {
    const d = new Date();
    return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;
}
