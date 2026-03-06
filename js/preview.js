// ============================================
// Partcraft – Sheet Preview Renderer
// Matches titleblock_preview.html exactly
// ============================================

import * as S from './state.js';
import { LAYOUT as L } from './layout.js';
import { drawDimensions } from './dimensions.js';

let canvas, ctx;
let images = {};
let dpr = 1;
let sc = 1;
let ox = 0, oy = 0;

export function initPreview() {
    canvas = document.getElementById('sheet-canvas');
    ctx = canvas.getContext('2d');
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    resize();
    window.addEventListener('resize', resize);
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

    const pad = L.workspace.padding * dpr;
    sc = Math.min((cw - pad * 2) / sheet.pageWidth, (ch - pad * 2) / sheet.pageHeight);
    const spW = sheet.pageWidth * sc, spH = sheet.pageHeight * sc;
    ox = (cw - spW) / 2;
    oy = (ch - spH) / 2;

    // Paper
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.15)';
    ctx.shadowBlur = 24 * dpr;
    ctx.shadowOffsetY = 4 * dpr;
    ctx.fillStyle = '#fff';
    ctx.fillRect(ox, oy, spW, spH);
    ctx.restore();

    drawViewports(sheet);
    drawSidebarTopDown(sheet);

    // Dimensions overlay
    if (S.annotationLevel > 0) {
        drawDimensions(ctx, sheet, S.annotationLevel, s2c, fi, sc);
    }
}

// ============================================================
// VIEWPORTS
// ============================================================

function drawViewports(sheet) {
    // Uniform image scale: find the smallest contain-fit factor across all viewports
    // so the model appears at the same size in every view
    let minImgScale = Infinity;
    for (const vp of sheet.viewports) {
        const img = images[vp.view];
        if (!img) continue;
        const vpRect = pxRect(vp.x, vp.y, vp.width, vp.height);
        const sx = vpRect.w / img.width;
        const sy = vpRect.h / img.height;
        const fitScale = Math.min(sx, sy);
        if (fitScale < minImgScale) minImgScale = fitScale;
    }
    if (minImgScale === Infinity) minImgScale = 1;

    for (const vp of sheet.viewports) {
        const img = images[vp.view];
        if (img) {
            // Draw at uniform scale, centered in viewport
            const vpRect = pxRect(vp.x, vp.y, vp.width, vp.height);
            const dw = img.width * minImgScale;
            const dh = img.height * minImgScale;
            ctx.drawImage(img,
                vpRect.x + (vpRect.w - dw) / 2,
                vpRect.y + (vpRect.h - dh) / 2,
                dw, dh
            );
        }

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
