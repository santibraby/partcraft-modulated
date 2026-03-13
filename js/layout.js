// ============================================
// Partcraft – Sheet Layout Configuration
// Derived from titleblock_preview.html at 30ppi
// ALL measurements in INCHES on printed sheet
// ============================================

export const LAYOUT = {

    // ── Page ──────────────────────────────────
    page: {
        width:  33.11,          // A1 landscape (993px / 30ppi)
        height: 23.39,          // (702px / 30ppi)
        borderMargin: 0.767,    // 23px / 30
    },

    // ── Fonts ─────────────────────────────────
    fonts: {
        sans: "'Inter', sans-serif",
    },

    // ── Text heights (px / 30 = inches) ───────
    text: {
        label:          0.150,  // 4.5px – field labels, issue title, bottom labels
        value:          0.183,  // 5.5px – field values (address, contact)
        companyName:    0.300,  // 9px    – Forma Rosa Creative
        projectName:    0.367,  // 11px   – PROJECT NAME
        projectType:    0.233,  // 7px    – PROJECT TYPE
        projectAddr:    0.183,  // 5.5px  – project address placeholder
        issueHeader:    0.167,  // 5px    – issue table column headers
        issueRow:       0.167,  // 5px    – issue table data
        drawTitleLabel: 0.200,  // 6px    – "Drawing Title" / "Drawing No." labels
        drawTitle:      0.533,  // 16px   – DRAWING TITLE value
        drawNumber:     0.800,  // 24px   – X-000 value
        bottomLabel:    0.183,  // 5.5px  – Scale / Sheet No. labels
        bottomValue:    0.233,  // 7px    – scale/sheet values
        vpTitle:        0.200,  // 6px    – viewport title text
        vpScale:        0.167,  // 5px    – viewport scale text
    },

    // ── Colors ────────────────────────────────
    colors: {
        black:          '#000000',
        grey50:         '#808080',
        grey60:         '#999999',
        white:          '#ffffff',
    },

    // ── Line weight ───────────────────────────
    line: 0.017,                // 0.5px / 30 — uniform across all dividers

    // ── Viewport grid ─────────────────────────
    // Asymmetric: columns 1.6fr / 1fr, rows 1.2fr / 1fr
    grid: {
        colRatio: [1.6, 1.0],
        rowRatio: [1.2, 1.0],

        // [row][col] → view name. Row 0=top, Col 0=left
        views: [
            ['axon',  'front'],
            ['right', 'top'  ],
        ],

        labels: {
            axon:  'Isometric View',
            front: 'Front View',
            right: 'Right View',
            top:   'Top View',
        },
    },

    // ── Viewport label (inside viewport, bottom-left) ──
    vpLabel: {
        bottomOffset: 0.133,    // 4px
        leftOffset:   0.200,    // 6px
        titleUnderline: true,
        scaleMarginTop: 0.033,  // 1px
    },

    // ── Right sidebar ─────────────────────────
    sidebar: {
        width: 5.267,           // 158px / 30

        logo: {
            // Square block = sidebar width × sidebar width
            padding: 1.333,     // 40px / 30
            // image: set at runtime via loadLogo()
        },

        company: {
            name: 'Forma Rosa Technologies',
            letterSpacing: 0.067,   // 2px / 30
            padding: 0.200,         // 6px / 30 top/bottom
        },

        address: {
            label: 'Address',
            lines: ['5900 Decatur St.', 'Ridgewood, NY 11385'],
        },
        contact: {
            label: 'Contact',
            lines: ['Santiago Braby Brown', 'creative@formarosastudio.com', '1 (360) 224-4875'],
        },
        fieldPadding: 0.100,    // 3px / 30

        project: {
            // Square block = sidebar width × sidebar width
            name: 'Project Name',
            type: 'Project Type',
            address: 'Add your project\naddress here',
            addressMarginTop: 0.400, // 12px / 30
        },
    },

    // ── Drawing issue table ───────────────────
    issue: {
        padding: 0.133,         // 4px / 30
        titleMarginBottom: 0.100, // 3px
        columns: [
            { label: 'No.',         pct: 0.15 },
            { label: 'Date',        pct: 0.35 },
            { label: 'Description', pct: 0.50 },
        ],
    },

    // ── Title block ───────────────────────────
    titleBlock: {
        padding: 0.133,         // 4px / 30 top/bottom
        paddingH: 0.200,        // 6px / 30 left/right
        titleLetterSpacing: 0.033,  // 1px / 30
        numberLetterSpacing: 0.067, // 2px / 30

        defaults: {
            drawingTitle: 'Drawing Title',
            drawingNo:    'X-000',
            sheetNo:      '1 / 1',
        },
    },

    // ── Workspace ─────────────────────────────
    workspace: {
        background: '#e0e0e0',
        paperShadow: '0 4px 24px rgba(0,0,0,0.15)',
        padding: 40,
    },
};
