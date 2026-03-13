// ============================================
// Partcraft – Sheet Preview Renderer
// Matches titleblock_preview.html exactly
// ============================================

import * as S from './state.js';
import { LAYOUT as L } from './layout.js';
import { drawDimensions, drawDebugGeometry, VIEW_CONFIG, DIM, extractViewData, makeProjector, getBounds2D, uniqueVals } from './dimensions.js';

let canvas, ctx;
let images = {};
let dpr = 1;
let sc = 1;
let ox = 0, oy = 0;

// ── Dilation cache: keyed by "view:thickness", cleared on new captures ──
let dilationCache = {};

// Zoom & pan state
let zoom = 1;
let panX = 0, panY = 0;
let isPanning = false;
let isCtrlZooming = false;
let panStartX = 0, panStartY = 0;
let zoomStartY = 0, zoomStartZoom = 1;

export function initPreview() {
    canvas = document.getElementById('sheet-canvas');
    ctx = canvas.getContext('2d');
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    resize();
    window.addEventListener('resize', resize);

    // Zoom with mouse wheel
    canvas.addEventListener('wheel', e => {
        e.preventDefault();
        const zoomFactor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const newZoom = Math.max(0.2, Math.min(10, zoom * zoomFactor));

        // Zoom toward mouse position
        const rect = canvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left) * dpr;
        const my = (e.clientY - rect.top) * dpr;

        panX = mx - (mx - panX) * (newZoom / zoom);
        panY = my - (my - panY) * (newZoom / zoom);
        zoom = newZoom;
        render();
    }, { passive: false });

    // Pan with right-click drag, Zoom with Ctrl+right-click drag
    canvas.addEventListener('mousedown', e => {
        if (e.button === 2) {
            if (e.ctrlKey) {
                // Ctrl+right-click = zoom mode
                isCtrlZooming = true;
                zoomStartY = e.clientY;
                zoomStartZoom = zoom;
                canvas.style.cursor = 'ns-resize';
            } else {
                // Right-click = pan mode
                isPanning = true;
                panStartX = e.clientX * dpr - panX;
                panStartY = e.clientY * dpr - panY;
                canvas.style.cursor = 'grabbing';
            }
            e.preventDefault();
        }
    });

    window.addEventListener('mousemove', e => {
        if (isCtrlZooming) {
            // Drag up = zoom in, drag down = zoom out
            const delta = zoomStartY - e.clientY;
            const factor = Math.pow(1.01, delta);
            const newZoom = Math.max(0.2, Math.min(10, zoomStartZoom * factor));

            // Zoom toward center of canvas
            const cx = canvas.width / 2;
            const cy = canvas.height / 2;
            panX = cx - (cx - panX) * (newZoom / zoom);
            panY = cy - (cy - panY) * (newZoom / zoom);
            zoom = newZoom;
            render();
        } else if (isPanning) {
            panX = e.clientX * dpr - panStartX;
            panY = e.clientY * dpr - panStartY;
            render();
        }
    });

    window.addEventListener('mouseup', e => {
        if (e.button === 2) {
            isPanning = false;
            isCtrlZooming = false;
            canvas.style.cursor = 'default';
        }
    });

    // Prevent context menu on canvas
    canvas.addEventListener('contextmenu', e => e.preventDefault());
}

function resize() {
    // Canvas is flex:1 inside a flex row — read its laid-out size
    const cw = canvas.clientWidth || canvas.parentElement.clientWidth;
    const ch = canvas.clientHeight || canvas.parentElement.clientHeight;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    render();
}

export function loadCaptures(captures) {
    // Reset view images and dilation cache for new model (keep __logo)
    const logo = images['__logo'];
    images = {};
    if (logo) images['__logo'] = logo;
    dilationCache = {};

    let pending = Object.keys(captures).length;
    for (const [view, url] of Object.entries(captures)) {
        const img = new Image();
        img.onload = () => {
            images[view] = img;
            if (--pending === 0) {
                resize();  // ensure canvas has correct dimensions before first render
            }
        };
        img.src = url;
    }
}

export function loadLogo(url) {
    const img = new Image();
    img.onload = () => { images['__logo'] = img; render(); };
    img.onerror = () => console.warn('Logo not found:', url);
    img.src = url;
}

export function render() {
    if (!canvas || !ctx) return;
    const sheet = S.currentSheet;
    const cw = canvas.width, ch = canvas.height;

    ctx.fillStyle = L.workspace.background;
    ctx.fillRect(0, 0, cw, ch);
    if (!sheet) return;

    // Base scale: fit sheet to canvas
    const pad = L.workspace.padding * dpr;
    const baseSc = Math.min((cw - pad * 2) / sheet.pageWidth, (ch - pad * 2) / sheet.pageHeight);

    // Apply zoom
    sc = baseSc * zoom;
    const spW = sheet.pageWidth * sc, spH = sheet.pageHeight * sc;

    // Base centering + pan offset
    const baseOx = (cw - sheet.pageWidth * baseSc) / 2;
    const baseOy = (ch - sheet.pageHeight * baseSc) / 2;
    ox = baseOx * zoom + panX;
    oy = baseOy * zoom + panY;

    // Paper
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.15)';
    ctx.shadowBlur = 24 * dpr;
    ctx.shadowOffsetY = 4 * dpr;
    ctx.fillStyle = '#fff';
    ctx.fillRect(ox, oy, spW, spH);
    ctx.restore();

    drawViewports(sheet);
    drawHLREdges(sheet);
    drawSidebarTopDown(sheet);

    // Dimensions overlay
    if (S.annotationLevel > 0) {
        drawDimensions(ctx, sheet, S.annotationLevel, s2c, fi, sc);
    }

    // Debug geometry overlay (color-coded edges + bbox)
    if (S.showDebugGeom) {
        drawDebugGeometry(ctx, sheet, s2c, sc);
    }

}

// ============================================================
// SILHOUETTE DILATION (Blender-style outline from transparent PNG)
// ============================================================

/**
 * Create a dilated silhouette from a transparent PNG.
 * Extracts opaque pixels as a binary mask, expands by `dilationPx`
 * in 8 directions, then fills the expanded region with `outlineColor`.
 *
 * @param {Image} sourceImg   Transparent-bg PNG of the model
 * @param {number} dilationPx Outline thickness in source-image pixels
 * @param {string} outlineColor  Hex color for the outline (default black)
 * @returns {HTMLCanvasElement} Offscreen canvas with the dilated outline
 */
function createDilatedSilhouette(sourceImg, dilationPx, outlineColor = '#000000') {
    if (!sourceImg || dilationPx <= 0) return null;

    const cw = sourceImg.width;
    const ch = sourceImg.height;

    // ── Step 1: extract binary silhouette ──
    const silCanvas = document.createElement('canvas');
    silCanvas.width = cw;
    silCanvas.height = ch;
    const silCtx = silCanvas.getContext('2d');
    silCtx.drawImage(sourceImg, 0, 0);

    const imgData = silCtx.getImageData(0, 0, cw, ch);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 128) {
            d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255;
        } else {
            d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 0;
        }
    }
    silCtx.putImageData(imgData, 0, 0);

    // ── Step 2: dilate by drawing at 8 offsets ──
    const dilCanvas = document.createElement('canvas');
    dilCanvas.width = cw;
    dilCanvas.height = ch;
    const dilCtx = dilCanvas.getContext('2d');

    const offsets = [
        [0, -dilationPx], [dilationPx, -dilationPx],
        [dilationPx, 0],  [dilationPx, dilationPx],
        [0, dilationPx],  [-dilationPx, dilationPx],
        [-dilationPx, 0], [-dilationPx, -dilationPx],
    ];

    dilCtx.globalCompositeOperation = 'lighter';
    for (const [dx, dy] of offsets) {
        dilCtx.drawImage(silCanvas, dx, dy);
    }
    // Punch out the original silhouette so only the dilated border remains
    dilCtx.globalCompositeOperation = 'destination-out';
    dilCtx.drawImage(silCanvas, 0, 0);

    // ── Step 3: recolor to outlineColor ──
    const outData = dilCtx.getImageData(0, 0, cw, ch);
    const o = outData.data;
    const rgb = parseInt(outlineColor.slice(1), 16);
    const rr = (rgb >> 16) & 255, gg = (rgb >> 8) & 255, bb = rgb & 255;

    for (let i = 0; i < o.length; i += 4) {
        if (o[i + 3] > 0) {
            o[i] = rr; o[i + 1] = gg; o[i + 2] = bb; o[i + 3] = 255;
        }
    }
    dilCtx.putImageData(outData, 0, 0);

    return dilCanvas;
}

/** Get (or create + cache) a dilated silhouette for the given view. */
function getDilated(view) {
    const thickness = S.outlineThickness;
    if (thickness <= 0) return null;
    const img = images[view];
    if (!img) return null;

    const key = `${view}:${thickness}`;
    if (!dilationCache[key]) {
        dilationCache[key] = createDilatedSilhouette(img, thickness, '#000000');
    }
    return dilationCache[key];
}

// ============================================================
// VIEWPORTS
// ============================================================

function drawViewports(sheet) {
    // The Three.js capture frustum half-height = modelSize * 0.7
    // So the capture shows modelSize * 1.4 model inches vertically
    // and modelSize * 1.4 * (captureW/captureH) horizontally.
    // We draw the image at vp.scale so it matches dimension projection.
    const captureModelH = S.modelSize * 1.4;          // model inches visible in capture
    const captureModelW = captureModelH * (2400 / 1800); // capture aspect = 4:3

    for (const vp of sheet.viewports) {
        // Image size in sheet inches at the viewport's scale
        const imgSheetW = captureModelW * vp.scale;
        const imgSheetH = captureModelH * vp.scale;

        // Convert to canvas pixels
        const dw = imgSheetW * sc;
        const dh = imgSheetH * sc;

        const vpRect = pxRect(vp.x, vp.y, vp.width, vp.height);
        const imgX = vpRect.x + (vpRect.w - dw) / 2;
        const imgY = vpRect.y + (vpRect.h - dh) / 2;

        const img = images[vp.view];

        // ── Outline layer: dilated silhouette ring ──
        if (S.showRaster1) {
            const dilated = getDilated(vp.view);
            if (dilated) {
                ctx.save();
                ctx.globalAlpha = 1.0;
                ctx.drawImage(dilated, imgX, imgY, dw, dh);
                ctx.restore();
            }
        }

        // ── Raster layer: normal 3D render at 50% opacity ──
        if (S.showRaster2 && img) {
            ctx.save();
            ctx.globalAlpha = 0.25;
            ctx.drawImage(img, imgX, imgY, dw, dh);
            ctx.restore();
        }

        // Viewport label + scale text
        const vl = L.vpLabel;
        const lx = vp.x + vl.leftOffset;
        const ly = vp.y + vl.bottomOffset;

        // Title
        const titleY = ly + L.text.vpTitle + vl.scaleMarginTop + L.text.vpScale;
        const titlePos = s2c(lx, titleY);
        ctx.fillStyle = L.colors.black;
        ctx.font = `700 ${fi(L.text.vpTitle)}px ${L.fonts.sans}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(vp.label.toUpperCase(), titlePos.x, titlePos.y);

        // Underline
        const tw = ctx.measureText(vp.label.toUpperCase()).width;
        ctx.strokeStyle = L.colors.black;
        ctx.lineWidth = lw();
        ctx.beginPath();
        ctx.moveTo(titlePos.x, titlePos.y + lw() / 2);
        ctx.lineTo(titlePos.x + tw, titlePos.y + lw() / 2);
        ctx.stroke();

        // Scale
        const scalePos = s2c(lx, ly);
        ctx.font = `400 ${fi(L.text.vpScale)}px ${L.fonts.sans}`;
        ctx.textBaseline = 'bottom';
        ctx.fillText(`Scale = ${vp.scaleText}`, scalePos.x, scalePos.y);
    }
}

function drawImageContain(img, sx, sy, sw, sh) {
    const vpRect = pxRect(sx, sy, sw, sh);
    const imgAspect = img.width / img.height;
    const vpAspect = vpRect.w / vpRect.h;
    let dw, dh;
    if (imgAspect > vpAspect) { dw = vpRect.w; dh = vpRect.w / imgAspect; }
    else { dh = vpRect.h; dw = vpRect.h * imgAspect; }
    ctx.drawImage(img, vpRect.x + (vpRect.w - dw) / 2, vpRect.y + (vpRect.h - dh) / 2, dw, dh);
}

// ============================================================
// HLR EDGE LAYERS (drawn on top of both raster layers)
// Order: hidden (dashed) → visible (solid)
// ============================================================

const HLR_AXES = {
    front: { hAxis: 'x', vAxis: 'z', fh: -1, fv:  1 },
    top:   { hAxis: 'x', vAxis: 'y', fh:  1, fv:  1 },
    right: { hAxis: 'z', vAxis: 'y', fh:  1, fv: -1 },
    axon:  { hAxis: 'x', vAxis: 'y', fh:  1, fv:  1, isAxon: true },
};

// Compute projected model center for axon view
function getAxonProjCenter() {
    const mc = S.modelCenter;
    const sf = 1/25.4;
    // Convert model center (inches) back to mm, project, scale back
    const cx = mc.x / sf, cy = mc.y / sf, cz = mc.z / sf;
    // xDir = (-1,1,0)/√2, yDir = cross(dir,xDir) normalized = (-1,-1,2)/√6
    const px = (-cx + cy) / Math.sqrt(2);
    const py = (-cx - cy + 2*cz) / Math.sqrt(6);
    return { h: px * sf, v: py * sf };
}

// Apply 2D rotation to a point around a center
function rotate2D(h, v, ch, cv, angle) {
    const dh = h - ch, dv = v - cv;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    return {
        h: ch + dh * cos - dv * sin,
        v: cv + dh * sin + dv * cos,
    };
}

function drawHLREdges(sheet) {
    if (!S.hlrResults) return;

    for (const vp of sheet.viewports) {
        const cfg = HLR_AXES[vp.view];
        if (!cfg) continue;

        const hlr = S.hlrResults[vp.view];
        if (!hlr) continue;

        const mc = S.modelCenter;
        const vpCx = vp.x + vp.width / 2;
        const vpCy = vp.y + vp.height / 2;
        const vpScale = vp.scale;

        let proj;
        if (cfg.isAxon) {
            const pc = getAxonProjCenter();
            const yRot = 315 * Math.PI / 180;  // calibrated
            proj = (h, v) => {
                const r = rotate2D(h, v, pc.h, pc.v, yRot);
                return {
                    sx: vpCx + (r.h - pc.h) * vpScale * cfg.fh,
                    sy: vpCy + (r.v - pc.v) * vpScale * cfg.fv,
                };
            };
        } else {
            const cH = mc[cfg.hAxis];
            const cV = mc[cfg.vAxis];
            proj = (h, v) => ({
                sx: vpCx + (h - cH) * vpScale * cfg.fh,
                sy: vpCy + (v - cV) * vpScale * cfg.fv,
            });
        }

        // Clip to viewport
        const vpRect = pxRect(vp.x, vp.y, vp.width, vp.height);
        ctx.save();
        ctx.beginPath();
        ctx.rect(vpRect.x, vpRect.y, vpRect.w, vpRect.h);
        ctx.clip();

        // Layer 1: Hidden edges — thin dashed white lines
        if (S.showHidden && hlr.hidden) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 0.5 * dpr;
            ctx.setLineDash([6 * dpr, 4 * dpr]);
            for (const edge of hlr.hidden) drawEdgePath(ctx, edge, cfg, proj);
            ctx.setLineDash([]);
        }

        // Visible edges — all 1pt solid black lines
        if (S.showVisible && hlr.visible) {
            ctx.strokeStyle = '#000000';
            ctx.setLineDash([]);
            ctx.lineWidth = 1 * dpr;
            for (const edge of hlr.visible) drawEdgePath(ctx, edge, cfg, proj);
        }

        ctx.restore();
    }
}

function drawEdgePath(ctx, edge, cfg, proj) {
    if (!edge.points || edge.points.length < 2) return;
    ctx.beginPath();
    for (let i = 0; i < edge.points.length; i++) {
        const pt = edge.points[i];
        const sp = proj(pt[cfg.hAxis], pt[cfg.vAxis]);
        const cp = s2c(sp.sx, sp.sy);
        if (i === 0) ctx.moveTo(cp.x, cp.y);
        else ctx.lineTo(cp.x, cp.y);
    }
    ctx.stroke();
}

// ============================================================
// SIDEBAR — rendered top-down like the HTML flex layout.
// A cursor `cy` starts at the top of the sidebar and moves
// downward as each section is drawn. Text is always placed
// right below the preceding line using small fixed padding.
// ============================================================

function drawSidebarTopDown(sheet) {
    const sb = sheet.sidebar;
    const sbl = L.sidebar;
    const sx = sb.x;
    const sw = sb.w;
    const bm = sheet.borderMargin;
    const px = L.titleBlock.paddingH;  // horizontal inset for text
    const fp = sbl.fieldPadding;       // small vertical padding inside cells

    // cy = cursor, starts at top of sidebar, moves DOWN
    let cy = sheet.pageHeight - bm;
    const sidebarBottom = bm;

    // ─── Logo (square = sw × sw) ───
    cy -= sw;
    if (images['__logo']) {
        const lpad = sbl.logo.padding;
        drawImageContain(images['__logo'], sx + lpad, cy + lpad, sw - lpad * 2, sw - lpad * 2);
    }
    hLine(sx, cy, sw);

    // ─── Company Name ───
    const compH = sbl.company.padding * 2 + L.text.companyName;
    cy -= compH;
    ctx.fillStyle = L.colors.black;
    drawSpacedText(
        sbl.company.name.toUpperCase(),
        sx + sw / 2, cy + compH / 2,
        L.text.companyName, sbl.company.letterSpacing,
        '700', 'center', 'middle'
    );
    hLine(sx, cy, sw);

    // ─── Address / Contact (two-column, no bottom border) ───
    // Compute height: label + lines
    const addrLineCount = Math.max(sbl.address.lines.length, sbl.contact.lines.length);
    const addrBlockH = fp + L.text.label * 1.1 + addrLineCount * L.text.value * 1.3 + fp;
    cy -= addrBlockH;

    // Address column
    let ty = cy + addrBlockH - fp;
    ctx.fillStyle = L.colors.black;
    ctx.font = `700 ${fi(L.text.label)}px ${L.fonts.sans}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let p = s2c(sx + px, ty);
    ctx.fillText(sbl.address.label.toUpperCase(), p.x, p.y);
    ty -= L.text.label * 1.1;
    ctx.font = `400 ${fi(L.text.value)}px ${L.fonts.sans}`;
    for (const line of sbl.address.lines) {
        p = s2c(sx + px, ty);
        ctx.fillText(line, p.x, p.y);
        ty -= L.text.value * 1.3;
    }

    // Contact column
    ty = cy + addrBlockH - fp;
    ctx.font = `700 ${fi(L.text.label)}px ${L.fonts.sans}`;
    p = s2c(sx + sw / 2, ty);
    ctx.fillText(sbl.contact.label.toUpperCase(), p.x, p.y);
    ty -= L.text.label * 1.1;
    ctx.font = `400 ${fi(L.text.value)}px ${L.fonts.sans}`;
    for (const line of sbl.contact.lines) {
        p = s2c(sx + sw / 2, ty);
        ctx.fillText(line, p.x, p.y);
        ty -= L.text.value * 1.3;
    }
    // No line below

    // ─── Project Name (square = sw × sw) ───
    cy -= sw;
    const projCx = sx + sw / 2;
    const projCy = cy + sw / 2;
    ctx.fillStyle = L.colors.black;
    drawSpacedText(sbl.project.name.toUpperCase(), projCx, projCy + L.text.projectName * 0.3,
        L.text.projectName, 0.033, '700', 'center', 'bottom');
    ctx.fillStyle = L.colors.black;
    drawSpacedText(sbl.project.type.toUpperCase(), projCx, projCy - L.text.projectType * 0.3,
        L.text.projectType, 0.050, '400', 'center', 'top');
    ctx.fillStyle = L.colors.grey60;
    ctx.font = `400 ${fi(L.text.projectAddr)}px ${L.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    let addrY = projCy - L.text.projectType * 0.3 - sbl.project.addressMarginTop;
    for (const line of sbl.project.address.split('\n')) {
        p = s2c(projCx, addrY);
        ctx.fillText(line, p.x, p.y);
        addrY -= L.text.projectAddr * 1.3;
    }

    // ─── Drawing Issue ───
    hLine(sx, cy, sw);  // border-top
    const isl = L.issue;
    const ix = sx + px;
    const iw = sw - px * 2;

    ty = cy - isl.padding;  // start just below line

    // Title
    ctx.fillStyle = L.colors.black;
    ctx.font = `700 ${fi(L.text.label)}px ${L.fonts.sans}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    p = s2c(ix, ty);
    ctx.fillText('Drawing Issue', p.x, p.y);
    ty -= L.text.label + isl.titleMarginBottom;

    // Column headers
    ctx.font = `500 ${fi(L.text.issueHeader)}px ${L.fonts.sans}`;
    ctx.fillStyle = L.colors.black;
    ctx.textBaseline = 'top';
    let colX = ix;
    for (const col of isl.columns) {
        p = s2c(colX, ty);
        ctx.fillText(col.label, p.x, p.y);
        colX += iw * col.pct;
    }
    ty -= L.text.issueHeader + 0.02;

    // Grey line under headers
    ctx.strokeStyle = L.colors.grey50;
    ctx.lineWidth = lw();
    const ulL = s2c(ix, ty);
    const ulR = s2c(ix + iw, ty);
    ctx.beginPath(); ctx.moveTo(ulL.x, ulL.y); ctx.lineTo(ulR.x, ulR.y); ctx.stroke();
    ty -= 0.05;

    // Rows
    ctx.font = `400 ${fi(L.text.issueRow)}px ${L.fonts.sans}`;
    ctx.fillStyle = L.colors.black;
    ctx.textBaseline = 'top';
    for (const row of sheet.issueRows) {
        colX = ix;
        const vals = [row.no, row.date, row.desc];
        for (let i = 0; i < isl.columns.length; i++) {
            p = s2c(colX, ty);
            ctx.fillText(vals[i], p.x, p.y);
            colX += iw * isl.columns[i].pct;
        }
        ty -= L.text.issueRow + 0.05;
    }

    // ─── Bottom fixed sections (drawn from bottom up) ───
    // These pin to the bottom of the sidebar.
    const tbl = L.titleBlock;
    let by = sidebarBottom;  // cursor from bottom going UP

    // Bottom row: Scale + Sheet No.
    const brH = fp + L.text.bottomLabel * 1.1 + L.text.bottomValue + fp;
    drawBottomRowAt(sheet, sx, sw, by, brH);
    by += brH;

    // Drawing No.
    hLine(sx, by, sw);
    const dnLines = [sheet.fields.drawingNo];
    const dnH = tbl.padding + L.text.drawTitleLabel * 1.1 + L.text.drawNumber + tbl.padding;
    drawTitleSectionAt(sx, sw, by, dnH, 'Drawing No.', dnLines, L.text.drawNumber, tbl.numberLetterSpacing);
    by += dnH;

    // Drawing Title (height depends on line count)
    hLine(sx, by, sw);
    const dtLines = wrapSpacedText(sheet.fields.drawingTitle.toUpperCase(), L.text.drawTitle, L.titleBlock.titleLetterSpacing, sw - tbl.paddingH * 2);
    const dtH = tbl.padding + L.text.drawTitleLabel * 1.1 + dtLines.length * L.text.drawTitle * 1.15 + tbl.padding;
    drawTitleSectionAt(sx, sw, by, dtH, 'Drawing Title', dtLines, L.text.drawTitle, L.titleBlock.titleLetterSpacing);
    by += dtH;

    // Spacer: line at top of spacer
    hLine(sx, by, sw);
}

// ── Title section (pinned from bottom) ──

function drawTitleSectionAt(sx, sw, bottomY, height, label, lines, valueFontSize, letterSpacing) {
    const tbl = L.titleBlock;
    const px = tbl.paddingH;

    // Label sits at top of section
    let ty = bottomY + height - tbl.padding;
    ctx.fillStyle = L.colors.black;
    ctx.font = `700 ${fi(L.text.drawTitleLabel)}px ${L.fonts.sans}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let p = s2c(sx + px, ty);
    ctx.fillText(label, p.x, p.y);

    // Value lines below label
    ty -= L.text.drawTitleLabel * 1.1;
    ctx.fillStyle = L.colors.black;
    for (const line of lines) {
        drawSpacedText(line, sx + px, ty, valueFontSize, letterSpacing, '700', 'left', 'top');
        ty -= valueFontSize * 1.15;
    }
}

// ── Bottom row (Scale / Sheet No.) ──

function drawBottomRowAt(sheet, sx, sw, bottomY, height) {
    const tbl = L.titleBlock;
    const fp = L.sidebar.fieldPadding;
    const px = tbl.paddingH;
    const cellW = (sw - px * 2) / 2;

    hLine(sx, bottomY + height, sw);

    let ty = bottomY + height - fp;

    // Scale
    ctx.fillStyle = L.colors.black;
    ctx.font = `700 ${fi(L.text.bottomLabel)}px ${L.fonts.sans}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let p = s2c(sx + px, ty);
    ctx.fillText('Scale', p.x, p.y);
    ctx.font = `400 ${fi(L.text.bottomValue)}px ${L.fonts.sans}`;
    p = s2c(sx + px, ty - L.text.bottomLabel * 1.1);
    ctx.fillText(sheet.fields.scale, p.x, p.y);

    // Sheet No.
    ctx.font = `700 ${fi(L.text.bottomLabel)}px ${L.fonts.sans}`;
    p = s2c(sx + px + cellW, ty);
    ctx.fillText('Sheet No.', p.x, p.y);
    ctx.font = `400 ${fi(L.text.bottomValue)}px ${L.fonts.sans}`;
    p = s2c(sx + px + cellW, ty - L.text.bottomLabel * 1.1);
    ctx.fillText(sheet.fields.sheetNo, p.x, p.y);
}

// ============================================================
// DRAWING HELPERS
// ============================================================

function hLine(x, y, w) {
    ctx.strokeStyle = L.colors.black;
    ctx.lineWidth = lw();
    const a = s2c(x, y);
    const b = s2c(x + w, y);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
}

/** Word-wrap text accounting for letter-spacing. Returns array of lines. */
function wrapSpacedText(text, fontInches, spacingInches, maxWidthInches) {
    const fontSize = fi(fontInches);
    const spacing = spacingInches * sc;
    const maxPx = maxWidthInches * sc;
    ctx.font = `700 ${fontSize}px ${L.fonts.sans}`;

    function measureSpaced(str) {
        let w = 0;
        for (let i = 0; i < str.length; i++) {
            w += ctx.measureText(str[i]).width;
            if (i < str.length - 1) w += spacing;
        }
        return w;
    }

    const words = text.split(' ');
    const lines = [];
    let cur = '';
    for (const word of words) {
        const test = cur ? cur + ' ' + word : word;
        if (measureSpaced(test) > maxPx && cur) {
            lines.push(cur);
            cur = word;
        } else {
            cur = test;
        }
    }
    if (cur) lines.push(cur);
    return lines;
}

function drawSpacedText(text, sheetX, sheetY, fontInches, spacingInches, weight, align, baseline) {
    const fontSize = fi(fontInches);
    const spacing = spacingInches * sc;
    ctx.font = `${weight} ${fontSize}px ${L.fonts.sans}`;
    let totalW = 0;
    for (let i = 0; i < text.length; i++) {
        totalW += ctx.measureText(text[i]).width;
        if (i < text.length - 1) totalW += spacing;
    }
    const p = s2c(sheetX, sheetY);
    let startX;
    if (align === 'left') startX = p.x;
    else if (align === 'right') startX = p.x - totalW;
    else startX = p.x - totalW / 2;
    ctx.textAlign = 'left';
    ctx.textBaseline = baseline || 'bottom';
    let cx = startX;
    for (let i = 0; i < text.length; i++) {
        ctx.fillText(text[i], cx, p.y);
        cx += ctx.measureText(text[i]).width + spacing;
    }
}

// ============================================================
// COORDINATE HELPERS
// ============================================================

function s2c(sx, sy) {
    return { x: ox + sx * sc, y: oy + (S.currentSheet.pageHeight - sy) * sc };
}
function pxRect(sx, sy, sw, sh) {
    const tl = s2c(sx, sy + sh);
    return { x: tl.x, y: tl.y, w: sw * sc, h: sh * sc };
}
function fi(inches) { return Math.max(1, inches * sc); }
function lw() { return Math.max(0.3, L.line * sc); }

// ============================================================
// PDF EXPORT
// Renders the sheet to an offscreen canvas at print DPI, then
// wraps it in a jsPDF document at the correct page dimensions.
// ============================================================

export function exportPDF() {
    const sheet = S.currentSheet;
    if (!sheet) return;

    const PDF_DPI = 150;
    const pxW = Math.round(sheet.pageWidth * PDF_DPI);
    const pxH = Math.round(sheet.pageHeight * PDF_DPI);

    // Create offscreen canvas
    const offCanvas = document.createElement('canvas');
    offCanvas.width = pxW;
    offCanvas.height = pxH;
    const offCtx = offCanvas.getContext('2d');

    // Save module state
    const prevCtx = ctx, prevSc = sc, prevOx = ox, prevOy = oy, prevDpr = dpr;

    // Override module state for PDF render
    ctx = offCtx;
    sc = PDF_DPI;       // 1 inch = PDF_DPI pixels
    ox = 0;
    oy = 0;
    dpr = 1;            // no device scaling needed

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pxW, pxH);

    // Render all layers (same order as screen render)
    drawViewports(sheet);
    drawHLREdges(sheet);
    drawSidebarTopDown(sheet);

    if (S.annotationLevel > 0) {
        drawDimensions(ctx, sheet, S.annotationLevel, s2c, fi, sc);
    }

    // Restore module state
    ctx = prevCtx; sc = prevSc; ox = prevOx; oy = prevOy; dpr = prevDpr;

    // Build PDF with jsPDF (landscape, inches)
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
        orientation: sheet.pageWidth > sheet.pageHeight ? 'landscape' : 'portrait',
        unit: 'in',
        format: [sheet.pageWidth, sheet.pageHeight],
    });

    const imgData = offCanvas.toDataURL('image/png');
    pdf.addImage(imgData, 'PNG', 0, 0, sheet.pageWidth, sheet.pageHeight);

    // Download
    const name = S.partName || 'drawing';
    pdf.save(`${name}.pdf`);
}

// ============================================================
// VECTOR PDF EXPORT
// Renders HLR edges + dimensions as true vector paths in PDF.
// Titleblock/sidebar rendered as raster background; viewports
// contain only vector line work — no raster images or outlines.
// ============================================================

export function exportVectorPDF() {
    const sheet = S.currentSheet;
    if (!sheet) return;

    const { jsPDF } = window.jspdf;
    const pageW = sheet.pageWidth;
    const pageH = sheet.pageHeight;

    // ── 1. Render titleblock/sidebar as raster background ──
    // We draw the sheet chrome (sidebar, border, labels) but skip
    // viewport raster images, HLR edges, dimensions, and debug overlay.
    const BG_DPI = 150;
    const bgPxW = Math.round(pageW * BG_DPI);
    const bgPxH = Math.round(pageH * BG_DPI);

    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = bgPxW;
    bgCanvas.height = bgPxH;
    const bgCtx = bgCanvas.getContext('2d');

    // Temporarily swap module state
    const prevCtx = ctx, prevSc = sc, prevOx = ox, prevOy = oy, prevDpr = dpr;
    ctx = bgCtx; sc = BG_DPI; ox = 0; oy = 0; dpr = 1;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, bgPxW, bgPxH);

    // Draw only the sidebar/titleblock (no viewports, no HLR, no dims)
    drawSidebarTopDown(sheet);

    // Draw viewport labels and scales (but not images or HLR)
    for (const vp of sheet.viewports) {
        const vl = L.vpLabel;
        const lx = vp.x + vl.leftOffset;
        const ly = vp.y + vl.bottomOffset;
        const titleY = ly + L.text.vpTitle + vl.scaleMarginTop + L.text.vpScale;
        const titlePos = s2c(lx, titleY);
        ctx.fillStyle = L.colors.black;
        ctx.font = `700 ${fi(L.text.vpTitle)}px ${L.fonts.sans}`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillText(vp.label.toUpperCase(), titlePos.x, titlePos.y);
        const tw = ctx.measureText(vp.label.toUpperCase()).width;
        ctx.strokeStyle = L.colors.black; ctx.lineWidth = lw();
        ctx.beginPath();
        ctx.moveTo(titlePos.x, titlePos.y + lw() / 2);
        ctx.lineTo(titlePos.x + tw, titlePos.y + lw() / 2);
        ctx.stroke();
        const scalePos = s2c(lx, ly);
        ctx.font = `400 ${fi(L.text.vpScale)}px ${L.fonts.sans}`;
        ctx.textBaseline = 'bottom';
        ctx.fillText(`Scale = ${vp.scaleText}`, scalePos.x, scalePos.y);
    }

    // Restore module state
    ctx = prevCtx; sc = prevSc; ox = prevOx; oy = prevOy; dpr = prevDpr;

    // ── 2. Build PDF ──
    const pdf = new jsPDF({
        orientation: pageW > pageH ? 'landscape' : 'portrait',
        unit: 'in',
        format: [pageW, pageH],
    });

    // Embed raster background
    const bgData = bgCanvas.toDataURL('image/png');
    pdf.addImage(bgData, 'PNG', 0, 0, pageW, pageH);

    // PDF coordinate helper: sheet coords → PDF coords
    // Sheet: origin bottom-left, y up. PDF: origin top-left, y down.
    const pS2P = (sx, sy) => ({ x: sx, y: pageH - sy });

    // Projector that goes directly from model coords to sheet coords
    function sheetProj(vp, cfg) {
        const mc = S.modelCenter;
        const cx = vp.x + vp.width / 2, cy = vp.y + vp.height / 2;
        const vpScale = vp.scale;
        const fh = cfg.fh || 1, fv = cfg.fv || 1;
        return (h, v) => ({
            sx: cx + (h - mc[cfg.hAxis]) * vpScale * fh,
            sy: cy + (v - mc[cfg.vAxis]) * vpScale * fv,
        });
    }

    // ── 3. Draw HLR edges as vector paths ──
    if (S.hlrResults) {
        for (const vp of sheet.viewports) {
            const cfg = HLR_AXES[vp.view];
            if (!cfg) continue;
            const hlr = S.hlrResults[vp.view];
            if (!hlr) continue;

            let proj;
            if (cfg.isAxon) {
                const pc = getAxonProjCenter();
                const yRot = 315 * Math.PI / 180;
                proj = (h, v) => {
                    const r = rotate2D(h, v, pc.h, pc.v, yRot);
                    return {
                        sx: vp.x + vp.width / 2 + (r.h - pc.h) * vp.scale * cfg.fh,
                        sy: vp.y + vp.height / 2 + (r.v - pc.v) * vp.scale * cfg.fv,
                    };
                };
            } else {
                proj = sheetProj(vp, cfg);
            }

            // Clip to viewport rectangle
            const vpTL = pS2P(vp.x, vp.y + vp.height);
            pdf.saveGraphicsState();
            // Build clip path manually, then clip + discard to avoid painting the rect
            pdf.moveTo(vpTL.x, vpTL.y);
            pdf.lineTo(vpTL.x + vp.width, vpTL.y);
            pdf.lineTo(vpTL.x + vp.width, vpTL.y + vp.height);
            pdf.lineTo(vpTL.x, vpTL.y + vp.height);
            pdf.closePath();
            pdf.clip();
            pdf.discardPath();

            // Hidden edges: thin dashed white
            if (S.showHidden && hlr.hidden) {
                pdf.setDrawColor(255, 255, 255);
                pdf.setLineWidth(0.5 / 72);  // 0.5pt in inches
                pdf.setLineDashPattern([6 / 72, 4 / 72], 0);  // dash pattern in inches
                for (const edge of hlr.hidden) {
                    drawVectorEdge(pdf, edge, cfg, proj, pS2P);
                }
            }

            // Visible edges: solid black
            if (S.showVisible && hlr.visible) {
                pdf.setDrawColor(0, 0, 0);
                pdf.setLineWidth(1 / 72);  // 1pt in inches
                pdf.setLineDashPattern([], 0);
                for (const edge of hlr.visible) {
                    drawVectorEdge(pdf, edge, cfg, proj, pS2P);
                }
            }

            pdf.restoreGraphicsState();
        }
    }

    // ── 4. Draw dimensions as vectors ──
    if (S.annotationLevel > 0 && S.modelBounds) {
        drawVectorDimensions(pdf, sheet, S.annotationLevel, pS2P, pageH);
    }

    // ── 5. Save ──
    const name = S.partName || 'drawing';
    pdf.save(`${name}_vector.pdf`);
}

// ── Vector edge path helper ──
function drawVectorEdge(pdf, edge, cfg, proj, pS2P) {
    if (!edge.points || edge.points.length < 2) return;
    const pts = edge.points.map(pt => {
        const sp = proj(pt[cfg.hAxis], pt[cfg.vAxis]);
        return pS2P(sp.sx, sp.sy);
    });
    pdf.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
        pdf.lineTo(pts[i].x, pts[i].y);
    }
    pdf.stroke();
}

// ── Vector dimensions (replicates drawDimensions logic for PDF) ──
function drawVectorDimensions(pdf, sheet, level, pS2P, pageH) {
    const PT = 1 / 72;  // 1pt in inches

    for (const vp of sheet.viewports) {
        const cfg = VIEW_CONFIG[vp.view];
        if (!cfg) continue;

        const { points, circles } = extractViewData(vp.view, cfg, level);
        if (points.length === 0) continue;

        const proj = makeProjector(vp, cfg);
        const bnd = getBounds2D(cfg);

        // Helper: sheet proj → PDF coord
        const p2p = (h, v) => { const sp = proj(h, v); return pS2P(sp.sx, sp.sy); };

        // Center leaders (dash-dot grey lines)
        if (circles.length > 0) {
            drawVectorCenterLeaders(pdf, cfg, circles, bnd, p2p, vp, PT);
        }

        // Ordinate dimensions
        drawVectorOrdinateSide(pdf, 'left',   cfg.vAxis, cfg.hAxis, cfg.leftDir,   points, bnd, p2p, vp, PT);
        drawVectorOrdinateSide(pdf, 'bottom', cfg.hAxis, cfg.vAxis, cfg.bottomDir, points, bnd, p2p, vp, PT);

        // Diameter callouts
        if (circles.length > 0) {
            drawVectorDiameters(pdf, cfg, circles, bnd, proj, p2p, vp, pS2P, PT);
        }
    }
}

function drawVectorCenterLeaders(pdf, cfg, circles, bnd, p2p, vp, PT) {
    const s = vp.scale || 1;
    const gap = DIM.leaderGap / s;
    const rightEdge  = cfg.leftDir   > 0 ? bnd.hMax : bnd.hMin;
    const bottomEdge = cfg.bottomDir > 0 ? bnd.vMax : bnd.vMin;
    const rightP1  = rightEdge  + cfg.leftDir   * gap;
    const bottomP1 = bottomEdge + cfg.bottomDir * gap;

    pdf.setDrawColor(153, 153, 153);
    pdf.setLineWidth(0.5 * PT);
    pdf.setLineDashPattern([2 * PT, 0.75 * PT, 0.5 * PT, 0.75 * PT], 0); // dash-dot

    for (const c of circles) {
        const ch = c.center[cfg.hAxis], cv = c.center[cfg.vAxis];

        // Horizontal: center → right leader
        const a1 = p2p(ch, cv), b1 = p2p(rightP1, cv);
        pdf.moveTo(a1.x, a1.y); pdf.lineTo(b1.x, b1.y); pdf.stroke();

        // Vertical: center → bottom leader
        const a2 = p2p(ch, cv), b2 = p2p(ch, bottomP1);
        pdf.moveTo(a2.x, a2.y); pdf.lineTo(b2.x, b2.y); pdf.stroke();
    }
}

function drawVectorOrdinateSide(pdf, side, valueAxis, perpAxis, dir, features, bnd, p2p, vp, PT) {
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
    const tP  = p4P + dir * txtOff;
    const mn = uv[0], mx = uv[uv.length - 1];

    pdf.setDrawColor(0, 0, 0);
    pdf.setTextColor(0, 0, 0);
    pdf.setLineWidth(0.5 * PT);
    pdf.setLineDashPattern([], 0);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(DIM.fontSize * 72);  // inches → points

    for (let i = 0; i < uv.length; i++) {
        const fv = uv[i];
        const sv = uv.length === 1 ? fv : mn + (i / (uv.length - 1)) * (mx - mn);
        const dimText = (fv - origin).toFixed(3) + '"';

        let pts, tp;
        if (isLeft) {
            pts = [p2p(p1P, fv), p2p(p2P, fv), p2p(p3P, sv), p2p(p4P, sv)];
            tp = p2p(tP, sv);
        } else {
            pts = [p2p(fv, p1P), p2p(fv, p2P), p2p(sv, p3P), p2p(sv, p4P)];
            tp = p2p(sv, tP);
        }

        // Leader line
        pdf.moveTo(pts[0].x, pts[0].y);
        for (let j = 1; j < pts.length; j++) pdf.lineTo(pts[j].x, pts[j].y);
        pdf.stroke();

        // Text
        if (isLeft) {
            pdf.text(dimText, tp.x, tp.y, { align: 'left', baseline: 'middle' });
        } else {
            pdf.text(dimText, tp.x, tp.y, { angle: 90, align: 'right', baseline: 'middle' });
        }
    }
}

function drawVectorDiameters(pdf, cfg, circlesArcs, bnd, proj, p2p, vp, pS2P, PT) {
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
    const mnV = bnd.vMin, mxV = bnd.vMax;

    pdf.setDrawColor(0, 0, 0);
    pdf.setTextColor(0, 0, 0);
    pdf.setLineWidth(0.5 * PT);
    pdf.setLineDashPattern([], 0);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(DIM.fontSize * 72);

    for (let i = 0; i < uf.length; i++) {
        const { center, diameter, radius } = uf[i];
        const sv = uf.length === 1 ? center[cfg.vAxis] : mnV + (i / (uf.length - 1)) * (mxV - mnV);

        const edgeH = center[cfg.hAxis] + rDir * radius;
        const p1 = p2p(edgeH, center[cfg.vAxis]);
        const p2 = p2p(p2P, sv), p3 = p2p(p3P, sv), tp = p2p(tP, sv);

        // Leader line
        pdf.moveTo(p1.x, p1.y); pdf.lineTo(p2.x, p2.y); pdf.lineTo(p3.x, p3.y); pdf.stroke();

        // Center mark (crosshair dashes)
        drawVectorCM(pdf, center, cfg, p2p, s, PT);

        // Arrow at p1 pointing toward circle edge
        drawVectorArrow(pdf, p1, p2, s, pS2P);

        // Label
        pdf.text(`\u00D8 ${diameter.toFixed(3)}"`, tp.x, tp.y, { align: 'right', baseline: 'middle' });
    }
}

function drawVectorCM(pdf, center, cfg, p2p, vpScale, PT) {
    const sz = DIM.cmSize / vpScale;
    const dash = DIM.cmDash / vpScale;
    const gapLen = DIM.cmGap / vpScale;
    pdf.setLineDashPattern([], 0);

    for (let d = -sz; d < sz; d += dash + gapLen) {
        const end = Math.min(d + dash, sz);
        // Horizontal dash
        let a = p2p(center[cfg.hAxis] + d, center[cfg.vAxis]);
        let b = p2p(center[cfg.hAxis] + end, center[cfg.vAxis]);
        pdf.moveTo(a.x, a.y); pdf.lineTo(b.x, b.y); pdf.stroke();
        // Vertical dash
        a = p2p(center[cfg.hAxis], center[cfg.vAxis] + d);
        b = p2p(center[cfg.hAxis], center[cfg.vAxis] + end);
        pdf.moveTo(a.x, a.y); pdf.lineTo(b.x, b.y); pdf.stroke();
    }
}

function drawVectorArrow(pdf, p1, p2, vpScale, pS2P) {
    const aLen = DIM.arrowSize / vpScale;
    const dx = p1.x - p2.x, dy = p1.y - p2.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.0001) return;
    const ux = dx / d * aLen, uy = dy / d * aLen;
    const aw = aLen * 0.4;
    const px = -uy * aw / aLen, py = ux * aw / aLen;

    // Arrow is in PDF coords already (p1, p2 are PDF coords)
    const tip = p1;
    const left = { x: p1.x - ux + px, y: p1.y - uy + py };
    const right = { x: p1.x - ux - px, y: p1.y - uy - py };

    pdf.setFillColor(0, 0, 0);
    pdf.triangle(tip.x, tip.y, left.x, left.y, right.x, right.y, 'F');
}
