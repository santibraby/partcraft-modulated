# Renderer Changes for New Titleblock Layout

This document describes every change needed in `preview.js` and `sheet.js` to match the updated `layout.js`. The HTML preview (`titleblock_preview.html`) is the source of truth — the canvas rendering should produce an identical result.

---

## preview.js Changes

### 1. Remove page border (render function, ~line 70-74)

The page border rectangle is drawn unconditionally. With `lines.border` set to `0`, the `lw()` helper clamps to `0.3` minimum, so a faint line still renders. Guard it:

```js
// BEFORE
ctx.strokeStyle = L.colors.border;
ctx.lineWidth = lw(L.lines.border);
sRect(bm, bm, sheet.pageWidth - bm * 2, sheet.pageHeight - bm * 2);

// AFTER
if (L.lines.border > 0) {
    ctx.strokeStyle = L.colors.border;
    ctx.lineWidth = lw(L.lines.border);
    sRect(bm, bm, sheet.pageWidth - bm * 2, sheet.pageHeight - bm * 2);
}
```

### 2. Remove viewport border and circle (drawViewport, ~line 84-117)

The viewport border and circled number should be skipped when their line weights are 0. Replace the entire drawViewport function:

```js
function drawViewport(vp) {
    const vl = L.viewLabel;

    // Border — only draw if weight > 0
    if (L.lines.viewportBorder > 0) {
        ctx.strokeStyle = L.colors.viewportBorder;
        ctx.lineWidth = lw(L.lines.viewportBorder);
        sRect(vp.x, vp.y, vp.width, vp.height);
    }

    // Image
    const img = images[vp.view];
    if (img) {
        const r = pxRect(vp.x, vp.y, vp.width, vp.height);
        ctx.drawImage(img, r.x, r.y, r.w, r.h);
    }

    // Label area
    const lblY = vp.y + vl.labelOffsetY;
    const lblX = vp.x;

    // Number circle — only draw if radius > 0
    let titleX = lblX;
    if (vl.circleRadius > 0) {
        const cr = vl.circleRadius;
        const circPos = s2c(lblX + cr, lblY - cr);
        const circPx = cr * sc;
        ctx.beginPath();
        ctx.arc(circPos.x, circPos.y, circPx, 0, Math.PI * 2);
        ctx.strokeStyle = L.colors.textPrimary;
        ctx.lineWidth = lw(L.lines.circleBorder);
        ctx.stroke();

        ctx.fillStyle = L.colors.textPrimary;
        ctx.font = `600 ${fi(L.text.viewNumber)}px ${L.fonts.sans}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('01', circPos.x, circPos.y);

        titleX = lblX + cr * 2 + vl.circleGap;
    }

    // View title — bold (700 weight)
    const titlePos = s2c(titleX, lblY);
    ctx.fillStyle = L.colors.textPrimary;
    ctx.font = `700 ${fi(L.text.viewTitle)}px ${L.fonts.sans}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(vp.label, titlePos.x, titlePos.y);

    // Underline
    const tw = ctx.measureText(vp.label).width;
    ctx.strokeStyle = L.colors.labelLine;
    ctx.lineWidth = lw(L.lines.labelUnderline);
    ctx.beginPath();
    ctx.moveTo(titlePos.x, titlePos.y + 1);
    ctx.lineTo(titlePos.x + tw, titlePos.y + 1);
    ctx.stroke();

    // Scale
    const scalePos = s2c(titleX, lblY + vl.scaleOffsetY);
    ctx.fillStyle = L.colors.textSecondary;
    ctx.font = `400 ${fi(L.text.viewScale || L.text.small)}px ${L.fonts.sans}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`Scale = ${vp.scaleText || '\u2014'}`, scalePos.x, scalePos.y);
}
```

**Key changes:**
- Viewport border guarded by `lines.viewportBorder > 0`
- Circle guarded by `circleRadius > 0`
- `titleX` defaults to `lblX` when no circle
- View title font weight changed from `600` to `700` (bold)
- Uses `L.text.viewScale` for scale text size (falls back to `L.text.small`)

### 3. Replace drawSidebar (complete rewrite, ~line 148-173)

The old function draws colored rectangle blocks. The new sidebar has structured content sections. Replace entirely:

```js
function drawSidebar(sheet) {
    const sb = sheet.sidebar;
    const sbl = L.sidebar;

    // NO vertical separator (lines.sidebarDiv = 0)
    if (L.lines.sidebarDiv > 0) {
        ctx.strokeStyle = L.colors.border;
        ctx.lineWidth = lw(L.lines.sidebarDiv);
        const top = s2c(sb.x, sheet.pageHeight - sheet.borderMargin);
        const bot = s2c(sb.x, sheet.borderMargin);
        ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(bot.x, bot.y); ctx.stroke();
    }

    const inset = sbl.blockInset;

    for (const b of sb.blocks) {
        const bx = b.x + inset;
        const bw = b.width - inset * 2;

        switch (b.type || b.id) {

            case 'logo': {
                // Logo image centered in square with padding
                const pad = sbl.logo?.padding || 1.0;
                if (sbl.logo?.image) {
                    // Draw logo image (loaded separately)
                    const logoImg = images['__logo'];
                    if (logoImg) {
                        const r = pxRect(b.x + pad, b.y + pad, b.width - pad * 2, b.height - pad * 2);
                        ctx.drawImage(logoImg, r.x, r.y, r.w, r.h);
                    }
                }
                // Divider line below logo
                drawHLine(b.x, b.y, b.width, L.colors.border);
                break;
            }

            case 'companyName': {
                // "FORMA ROSA CREATIVE" centered
                const name = sbl.company?.name || 'FORMA ROSA CREATIVE';
                ctx.fillStyle = L.colors.textPrimary;
                ctx.font = `700 ${fi(L.text.companyName)}px ${L.fonts.sans}`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.letterSpacing = `${fi(sbl.company?.letterSpacing || 0.04)}px`;
                const cp = s2c(b.x + b.width / 2, b.y + b.height / 2);
                ctx.fillText(name, cp.x, cp.y);
                ctx.letterSpacing = '0px';
                // Divider line below
                drawHLine(b.x, b.y, b.width, L.colors.border);
                break;
            }

            case 'addressContact': {
                // Two columns: address (left half), contact (right half)
                const halfW = bw / 2;
                const topY = b.y + b.height;

                // Address
                ctx.fillStyle = L.colors.textPrimary;
                ctx.font = `700 ${fi(L.text.fieldLabel)}px ${L.fonts.sans}`;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'bottom';
                let p = s2c(bx, topY - 0.06);
                ctx.fillText(sbl.address.label, p.x, p.y);

                ctx.font = `400 ${fi(L.text.fieldValue)}px ${L.fonts.sans}`;
                ctx.fillStyle = L.colors.textPrimary;
                let lineY = topY - 0.22;
                for (const line of sbl.address.lines) {
                    p = s2c(bx, lineY);
                    ctx.fillText(line, p.x, p.y);
                    lineY -= 0.14;
                }

                // Contact
                ctx.fillStyle = L.colors.textPrimary;
                ctx.font = `700 ${fi(L.text.fieldLabel)}px ${L.fonts.sans}`;
                ctx.textAlign = 'left';
                p = s2c(bx + halfW, topY - 0.06);
                ctx.fillText(sbl.contact.label, p.x, p.y);

                ctx.font = `400 ${fi(L.text.fieldValue)}px ${L.fonts.sans}`;
                lineY = topY - 0.22;
                for (const line of sbl.contact.lines) {
                    p = s2c(bx + halfW, lineY);
                    ctx.fillText(line, p.x, p.y);
                    lineY -= 0.14;
                }

                // NO divider line below (runs into project name)
                break;
            }

            case 'projectName': {
                // Project name + type centered, address below with gap
                const proj = sbl.project;
                const cx = b.x + b.width / 2;
                const cy = b.y + b.height / 2;

                // Project name
                ctx.fillStyle = L.colors.textPrimary;
                ctx.font = `700 ${fi(L.text.projectName)}px ${L.fonts.sans}`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                let p = s2c(cx, cy + 0.10);
                ctx.fillText(proj.name, p.x, p.y);

                // Project type
                ctx.font = `400 ${fi(L.text.projectType)}px ${L.fonts.sans}`;
                ctx.letterSpacing = `${fi(0.03)}px`;
                ctx.textBaseline = 'top';
                p = s2c(cx, cy - 0.10);
                ctx.fillText(proj.type, p.x, p.y);
                ctx.letterSpacing = '0px';

                // Project address (below type with gap)
                ctx.fillStyle = L.colors.textMuted;
                ctx.font = `400 ${fi(L.text.projectAddr)}px ${L.fonts.sans}`;
                const addrLines = proj.address.split('\n');
                let addrY = cy - 0.10 - proj.addressGap;
                for (const line of addrLines) {
                    p = s2c(cx, addrY);
                    ctx.fillText(line, p.x, p.y);
                    addrY -= 0.14;
                }

                // NO divider line below (issue table draws its own line above)
                break;
            }
        }
    }
}

// Helper: draw a horizontal line at the bottom edge of a block
function drawHLine(x, y, w, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw(L.lines.divider);
    const left = s2c(x, y);
    const right = s2c(x + w, y);
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(right.x, right.y);
    ctx.stroke();
}
```

### 4. Update drawIssueTable (~line 178-210)

Two changes:
- Draw line ABOVE the section (not via labelLine which draws below)
- Use grey color for internal table lines

```js
function drawIssueTable(sheet) {
    const it = sheet.issueTable;
    const itl = L.issueTable;
    const inset = L.sidebar.blockInset;
    const x = it.x + inset, w = it.width - inset * 2;

    // Line ABOVE drawing issue (border-top)
    const topY = it.y + it.h;
    ctx.strokeStyle = L.colors.border;
    ctx.lineWidth = lw(L.lines.divider);
    const lineLeft = s2c(it.x, topY);
    const lineRight = s2c(it.x + it.width, topY);
    ctx.beginPath();
    ctx.moveTo(lineLeft.x, lineLeft.y);
    ctx.lineTo(lineRight.x, lineRight.y);
    ctx.stroke();

    // Header label
    ctx.fillStyle = L.colors.textPrimary;
    ctx.font = `700 ${fi(L.text.label)}px ${L.fonts.sans}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const labelPos = s2c(x, topY - 0.06);
    ctx.fillText('DRAWING ISSUE', labelPos.x, labelPos.y);

    // Column headers with grey underline
    const colY = topY - itl.headerRowGap;
    ctx.font = `500 ${fi(L.text.tiny)}px ${L.fonts.sans}`;
    ctx.fillStyle = L.colors.textMuted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    for (const col of itl.columns) {
        const p = s2c(x + col.x, colY);
        ctx.fillText(col.label, p.x, p.y);
    }

    // Grey line under column headers
    ctx.strokeStyle = L.colors.issueLine;
    ctx.lineWidth = lw(L.lines.divider);
    const ulLeft = s2c(x, colY - 0.04);
    const ulRight = s2c(x + w, colY - 0.04);
    ctx.beginPath();
    ctx.moveTo(ulLeft.x, ulLeft.y);
    ctx.lineTo(ulRight.x, ulRight.y);
    ctx.stroke();

    // Rows
    ctx.font = `400 ${fi(L.text.small)}px ${L.fonts.mono}`;
    ctx.fillStyle = L.colors.textSecondary;
    for (let i = 0; i < it.rows.length; i++) {
        const row = it.rows[i];
        const rowY = colY - itl.colHeaderGap - i * itl.rowHeight;
        for (const col of itl.columns) {
            const val = col.label === 'NO.' ? row.no : col.label === 'DATE' ? row.date : row.desc;
            const p = s2c(x + col.x, rowY);
            ctx.fillText(val, p.x, p.y);
        }
    }
}
```

### 5. Update drawTitleBlock (~line 214-305)

Remove rights, signatures, seal sections. The section loop now only handles `title` and `number`. Also remove the vertical divider between Scale and Sheet No. in the bottom row:

```js
function drawTitleBlock(sheet) {
    const tb = sheet.titleBlock;
    const tbl = L.titleBlock;
    const inset = L.sidebar.blockInset;
    const x = tb.x + inset, w = tb.width - inset * 2;

    // Walk top-to-bottom through sections
    let cy = tb.y + tb.height;

    for (const sec of tbl.sections) {
        // Draw horizontal line above section
        ctx.strokeStyle = L.colors.border;
        ctx.lineWidth = lw(L.lines.divider);
        const lnL = s2c(tb.x, cy);
        const lnR = s2c(tb.x + tb.width, cy);
        ctx.beginPath(); ctx.moveTo(lnL.x, lnL.y); ctx.lineTo(lnR.x, lnR.y); ctx.stroke();

        // Section label
        ctx.fillStyle = L.colors.textPrimary;
        ctx.font = `700 ${fi(L.text.label)}px ${L.fonts.sans}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        const lp = s2c(x, cy - 0.06);
        ctx.fillText(sec.label, lp.x, lp.y);

        cy -= 0.30;

        switch (sec.id) {
            case 'title': {
                ctx.fillStyle = L.colors.textPrimary;
                ctx.font = `700 ${fi(L.text.drawTitle)}px ${L.fonts.sans}`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                const p = s2c(x + w / 2, cy);
                ctx.fillText(tb.fields.drawingTitle, p.x, p.y);
                break;
            }
            case 'number': {
                ctx.fillStyle = L.colors.textPrimary;
                ctx.font = `700 ${fi(L.text.drawNumber)}px ${L.fonts.sans}`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                const p = s2c(x + w / 2, cy);
                ctx.fillText(tb.fields.drawingNo, p.x, p.y);
                break;
            }
        }

        cy -= (sec.height - 0.30);
    }

    // Bottom row — line above, no vertical divider
    const br = tbl.bottomRow;
    const rowTopY = tb.y + br.height;

    // Horizontal line above bottom row
    ctx.strokeStyle = L.colors.border;
    ctx.lineWidth = lw(L.lines.divider);
    const brL = s2c(tb.x, rowTopY);
    const brR = s2c(tb.x + tb.width, rowTopY);
    ctx.beginPath(); ctx.moveTo(brL.x, brL.y); ctx.lineTo(brR.x, brR.y); ctx.stroke();

    let fieldX = x;
    for (const field of br.fields) {
        const fieldW = w * field.widthPct;

        // Label
        ctx.fillStyle = L.colors.textMuted;
        ctx.font = `500 ${fi(L.text.tiny)}px ${L.fonts.sans}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        let p = s2c(fieldX, tb.y + 0.38);
        ctx.fillText(field.label, p.x, p.y);

        // Value
        ctx.fillStyle = L.colors.textPrimary;
        ctx.font = `600 ${fi(L.text.value)}px ${L.fonts.mono}`;
        p = s2c(fieldX, tb.y + 0.16);
        ctx.fillText(
            field.label === 'SCALE' ? tb.fields.scale : tb.fields.sheetNo,
            p.x, p.y
        );

        // NO vertical divider between fields

        fieldX += fieldW;
    }
}
```

### 6. Logo image loading

Add a method to load the logo image for the sidebar. In `loadCaptures` or a new function:

```js
export function loadLogo(url) {
    const img = new Image();
    img.onload = () => { images['__logo'] = img; render(); };
    img.src = url;
}
```

---

## sheet.js Changes

### 1. Remove rightsText from titleBlock fields (~line 80-85)

```js
// BEFORE
fields: {
    drawingTitle: partName?.toUpperCase() || L.titleBlock.defaults.drawingTitle,
    drawingNo: L.titleBlock.defaults.drawingNo,
    scale: viewports.find(v => v.view === 'front')?.scaleText || '—',
    sheetNo: L.titleBlock.defaults.sheetNo,
    rightsText: L.titleBlock.defaults.rightsText,
},

// AFTER
fields: {
    drawingTitle: partName?.toUpperCase() || L.titleBlock.defaults.drawingTitle,
    drawingNo: L.titleBlock.defaults.drawingNo,
    scale: viewports.find(v => v.view === 'front')?.scaleText || '—',
    sheetNo: L.titleBlock.defaults.sheetNo,
},
```

### 2. Issue table default row (~line 68)

Update the default issue row description:

```js
// BEFORE
rows: [
    { no: '01', date: fmtDate(), desc: 'INITIAL SET' },
],

// AFTER
rows: [
    { no: '01', date: fmtDate(), desc: 'ISSUE 001' },
],
```

### 3. Sidebar blocks now carry `type` field

The `createSheet` function copies block definitions from layout. The new blocks have a `type` field that `preview.js` reads. No change needed in sheet.js since the spread operator (`{ ...b, x, width, y }`) already copies all properties through. Just confirm that block iteration still works with 4 blocks instead of 3.

---

## Summary of what changed

| Area | Old | New |
|------|-----|-----|
| Page border | 0.020" black rectangle | None |
| Page margin | 0.35" | 0.75" |
| Sidebar width | 5.8" | 5.25" |
| Sidebar separator | Vertical black line | None |
| Sidebar blocks | 3 colored rectangles | Logo / Company Name / Address-Contact / Project Name |
| Viewport borders | Grey rectangles | None |
| Viewport circles | Numbered circles with text | None |
| Viewport title weight | 600 (semibold) | 700 (bold) |
| Viewport title size | 0.18" | 0.12" |
| View labels | All "FIRST FLOOR CONSTRUCTION PLAN" | 3D ISOMETRIC VIEW, PLAN VIEW, SECTION/ELEVATION, DETAIL VIEW |
| Issue table | Line below, black internal | Line above, grey internal lines |
| Title block sections | rights, signatures, seal, title, number | title, number only |
| Drawing title default | GENERAL ARRANGEMENT | DRAWING TITLE |
| Drawing number default | A-001 | X-000 |
| Sheet number default | 01 / 01 | 1 / 1 |
| Scale/Sheet divider | Vertical line between | None |
| All horizontal dividers | Mixed weights | Uniform 0.010" |
