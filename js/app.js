// ============================================
// Partcraft – Main Application
// Upload → OCCT Process → Sheet Preview + Props
// ============================================

import * as S from './state.js';
import { log } from './utils.js';
import { initThreeJS, fitCameraToObject, captureAllViews } from './scene.js';
import { createSheet } from './sheet.js';
import { initPreview, loadCaptures, loadLogo, render as renderPreview, exportPDF, exportVectorPDF } from './preview.js';
import { LAYOUT as L } from './layout.js';
import { initOCCT, loadSTEP } from './occt-loader.js';
import { computeHLR } from './hlr.js';

const uploadArea = document.getElementById('upload-area');
const fileInput  = document.getElementById('file-input');
const workspace  = document.getElementById('workspace');
const dimBtns    = document.querySelectorAll('.dim-btn');

// ---- Properties panel fields ----

const propFields = {
    drawingTitle:  document.getElementById('prop-drawing-title'),
    drawingNo:     document.getElementById('prop-drawing-no'),
    companyName:   document.getElementById('prop-company-name'),
    address:       document.getElementById('prop-address'),
    contactName:   document.getElementById('prop-contact-name'),
    contactEmail:  document.getElementById('prop-contact-email'),
    contactPhone:  document.getElementById('prop-contact-phone'),
    projectName:   document.getElementById('prop-project-name'),
    projectType:   document.getElementById('prop-project-type'),
    projectAddress: document.getElementById('prop-project-address'),
    issueNo:       document.getElementById('prop-issue-no'),
    issueDesc:     document.getElementById('prop-issue-desc'),
};

function populateDefaults(partName) {
    const sbl = L.sidebar;
    const tbl = L.titleBlock;
    propFields.drawingTitle.value  = partName || tbl.defaults.drawingTitle;
    propFields.drawingNo.value     = tbl.defaults.drawingNo;
    propFields.companyName.value   = sbl.company.name;
    propFields.address.value       = sbl.address.lines.join('\n');
    propFields.contactName.value   = sbl.contact.lines[0] || '';
    propFields.contactEmail.value  = sbl.contact.lines[1] || '';
    propFields.contactPhone.value  = sbl.contact.lines[2] || '';
    propFields.projectName.value   = sbl.project.name;
    propFields.projectType.value   = sbl.project.type;
    propFields.projectAddress.value = sbl.project.address.replace(/\\n/g, '\n');
    propFields.issueNo.value       = '01';
    propFields.issueDesc.value     = 'Issue 001';
}

function applyProps() {
    if (!S.currentSheet) return;
    S.currentSheet.fields.drawingTitle = propFields.drawingTitle.value;
    S.currentSheet.fields.drawingNo = propFields.drawingNo.value;
    L.sidebar.company.name = propFields.companyName.value;
    L.sidebar.address.lines = propFields.address.value.split('\n').filter(l => l.trim());
    L.sidebar.contact.lines = [
        propFields.contactName.value,
        propFields.contactEmail.value,
        propFields.contactPhone.value,
    ].filter(l => l.trim());
    L.sidebar.project.name = propFields.projectName.value;
    L.sidebar.project.type = propFields.projectType.value;
    L.sidebar.project.address = propFields.projectAddress.value;
    if (S.currentSheet.issueRows.length > 0) {
        S.currentSheet.issueRows[0].no = propFields.issueNo.value;
        S.currentSheet.issueRows[0].desc = propFields.issueDesc.value;
    }
    renderPreview();
}

function wireProps() {
    for (const field of Object.values(propFields)) {
        field.addEventListener('input', applyProps);
    }
    const logoInput = document.getElementById('logo-input');
    document.getElementById('btn-change-logo').addEventListener('click', () => logoInput.click());
    logoInput.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        document.getElementById('logo-file-name').textContent = file.name;
        loadLogo(URL.createObjectURL(file));
    });
}

// ---- STEP processing (OCCT) ----

async function processFile(file) {
    log('Reading ' + file.name + '…');

    try {
        const buffer = await file.arrayBuffer();

        // Load via OpenCascade kernel
        const result = loadSTEP(buffer, log);
        if (!result.success) throw new Error(result.error || 'STEP parse failed');

        // Store the B-rep shape for future operations (HLR etc.)
        S.setCurrentShape(result.shape);

        let partName = file.name.replace(/\.(stp|step)$/i, '');
        S.setPartName(partName);

        log('Building geometry…');
        if (!S.scene) initThreeJS();
        if (S.currentGroup) S.scene.remove(S.currentGroup);

        const group = new THREE.Group();
        S.setCurrentGroup(group);

        // Build Three.js mesh from OCCT triangulation
        for (const meshData of result.meshes) {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(meshData.attributes.position.array, 3));

            if (meshData.attributes.normal?.array) {
                geometry.setAttribute('normal', new THREE.Float32BufferAttribute(meshData.attributes.normal.array, 3));
            } else {
                geometry.computeVertexNormals();
            }

            if (meshData.index?.array) {
                geometry.setIndex(new THREE.Uint32BufferAttribute(meshData.index.array, 1));
            }

            const solidMat = new THREE.MeshPhongMaterial({
                color: meshData.color ? new THREE.Color(...meshData.color) : 0xb0b8c8,
                side: THREE.DoubleSide,
                polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
            });
            const mesh = new THREE.Mesh(geometry, solidMat);
            group.add(mesh);
            S.meshObjects.solid = mesh;
            S.meshObjects.geometry = geometry;
        }

        // Build edge lines directly from OCCT B-rep edges
        log('Building edge visualization…');
        const edgeGroup = new THREE.Group();
        const edgeMat = new THREE.LineBasicMaterial({ color: 0x000000 });
        for (const detail of result.curveDetails) {
            if (detail.points && detail.points.length >= 2) {
                const pts = detail.points.map(p => new THREE.Vector3(p.x, p.y, p.z));
                const geom = new THREE.BufferGeometry().setFromPoints(pts);
                edgeGroup.add(new THREE.Line(geom, edgeMat));
            }
        }
        group.add(edgeGroup);
        S.edgeObjects.current = edgeGroup;

        S.scene.add(group);
        fitCameraToObject(group);

        // Store original B-rep edge data for dimension features
        S.setAnalysisResults({
            partcraft: {
                curveDetails: result.curveDetails || [],
                edges: [],
                totalChains: (result.curveDetails || []).length,
            }
        });

        // Run HLR for visibility classification
        log('Computing hidden lines…');
        const MM_TO_IN = 1.0 / 25.4;
        try {
            const hlrResults = computeHLR(result.shape, MM_TO_IN);
            S.setHlrResults(hlrResults);
            for (const [v, r] of Object.entries(hlrResults)) {
                console.log(`HLR: ${v} → ${r.visible.length} visible, ${r.hidden.length} hidden`);
            }
        } catch (e) {
            console.warn('HLR failed (non-fatal), dimensions will use all edges:', e.message);
            S.setHlrResults(null);
        }

        createSheet(partName);
        populateDefaults(partName);

        log('Rendering views…');
        const captures = captureAllViews();

        uploadArea.classList.add('hidden');
        workspace.classList.add('show');

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                loadCaptures(captures);
                log('');
            });
        });
    } catch (err) {
        log('Error: ' + err.message);
        console.error('processFile error:', err);
    }
}

// ---- Events ----

function wireEvents() {
    uploadArea.addEventListener('click', () => {
        if (!uploadArea.classList.contains('disabled')) fileInput.click();
    });
    uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('dragover'); });
    uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
    uploadArea.addEventListener('drop', e => {
        e.preventDefault(); uploadArea.classList.remove('dragover');
        if (e.dataTransfer.files.length) processFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', e => {
        if (e.target.files.length) processFile(e.target.files[0]);
    });

    document.getElementById('btn-new').addEventListener('click', () => {
        workspace.classList.remove('show');
        uploadArea.classList.remove('hidden');
        if (S.currentGroup) { S.scene.remove(S.currentGroup); S.setCurrentGroup(null); }
        S.meshObjects.solid = null; S.meshObjects.geometry = null;
        S.setAnalysisResults(null); S.setCurrentSheet(null); S.setPartName('');
        S.setCurrentShape(null); S.setHlrResults(null);
        S.setCaptures({});
        fileInput.value = '';
        log('Ready. Upload a STEP file.');
    });

    wireProps();

    dimBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const level = parseInt(btn.dataset.level);
            S.setAnnotationLevel(level);
            dimBtns.forEach(b => b.classList.toggle('active', b === btn));
            renderPreview();
        });
    });

    // Layer toggle buttons (multi-select, toggle on/off)
    const layerBtns = document.querySelectorAll('.layer-btn');
    layerBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            btn.classList.toggle('active');
            const on = btn.classList.contains('active');
            switch (btn.dataset.layer) {
                case 'visible':     S.setShowVisible(on); break;
                case 'hidden':      S.setShowHidden(on); break;
                case 'raster1':     S.setShowRaster1(on); break;
                case 'raster2':     S.setShowRaster2(on); break;
                case 'debug':       S.setShowDebugGeom(on); break;
            }
            renderPreview();
        });
    });

    // PDF download buttons
    document.getElementById('btn-pdf').addEventListener('click', () => {
        if (!S.currentSheet) return;
        log('Generating PDF…');
        setTimeout(() => { exportPDF(); log('PDF downloaded.'); }, 50);
    });

    document.getElementById('btn-vector-pdf').addEventListener('click', () => {
        if (!S.currentSheet) return;
        log('Generating vector PDF…');
        setTimeout(() => { exportVectorPDF(); log('Vector PDF downloaded.'); }, 50);
    });

}

// ---- Boot ----

const loadingScreen = document.getElementById('loading-screen');
const loadingText = document.getElementById('loading-text');

(async function init() {
    initPreview();
    loadLogo('CREATIVE-LOGO.png');

    try {
        const oc = await initOCCT(msg => {
            if (loadingText) loadingText.textContent = msg;
            log(msg);
        });
        S.setOC(oc);
        log('Ready. Upload a STEP file.');
        uploadArea.classList.remove('disabled');
    } catch (err) {
        log('Failed to load CAD kernel: ' + err.message);
        console.error(err);
    }

    // Fade out loading screen
    if (loadingScreen) loadingScreen.classList.add('hidden');

    wireEvents();
})();
