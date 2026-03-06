// ============================================
// Partcraft – Main Application
// Upload → Process → Sheet Preview + Props
// ============================================

import * as S from './state.js';
import { log, toFloat32Array, toUint32Array } from './utils.js';
import { initThreeJS, fitCameraToObject, captureAllViews } from './scene.js';
import { detectEdgesPartcraft, buildEdgeVisualization } from './edges.js';
import { createSheet } from './sheet.js';
import { initPreview, loadCaptures, loadLogo, render as renderPreview } from './preview.js';
import { LAYOUT as L } from './layout.js';

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

/** Populate form with defaults from layout.js */
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

/** Read form values and push into sheet + layout, then re-render */
function applyProps() {
    if (!S.currentSheet) return;

    // Drawing fields
    S.currentSheet.fields.drawingTitle = propFields.drawingTitle.value;
    S.currentSheet.fields.drawingNo = propFields.drawingNo.value;

    // Company fields (mutate layout sidebar so preview reads them)
    L.sidebar.company.name = propFields.companyName.value;
    L.sidebar.address.lines = propFields.address.value.split('\n').filter(l => l.trim());
    L.sidebar.contact.lines = [
        propFields.contactName.value,
        propFields.contactEmail.value,
        propFields.contactPhone.value,
    ].filter(l => l.trim());

    // Project fields
    L.sidebar.project.name = propFields.projectName.value;
    L.sidebar.project.type = propFields.projectType.value;
    L.sidebar.project.address = propFields.projectAddress.value;

    // Issue
    if (S.currentSheet.issueRows.length > 0) {
        S.currentSheet.issueRows[0].no = propFields.issueNo.value;
        S.currentSheet.issueRows[0].desc = propFields.issueDesc.value;
    }

    renderPreview();
}

/** Wire up live-update on all prop fields */
function wireProps() {
    for (const field of Object.values(propFields)) {
        field.addEventListener('input', applyProps);
    }

    // Logo file picker
    const logoInput = document.getElementById('logo-input');
    document.getElementById('btn-change-logo').addEventListener('click', () => logoInput.click());
    logoInput.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        document.getElementById('logo-file-name').textContent = file.name;
        const url = URL.createObjectURL(file);
        loadLogo(url);
    });
}

// ---- STEP processing ----

async function processFile(file) {
    log('Reading ' + file.name + '…');

    try {
        const buffer = await file.arrayBuffer();
        log('Parsing STEP…');
        const result = S.occt.ReadStepFile(new Uint8Array(buffer), { linearUnit: 'inch' });
        if (!result.success) throw new Error('Parse failed');

        let partName = file.name.replace(/\.(stp|step)$/i, '');
        if (result.meshes[0]?.name) partName = result.meshes[0].name;
        S.setPartName(partName);

        log('Building geometry…');
        if (!S.scene) initThreeJS();
        if (S.currentGroup) S.scene.remove(S.currentGroup);

        const group = new THREE.Group();
        S.setCurrentGroup(group);
        S.setFaceColors([]);

        for (const meshData of result.meshes) {
            const geometry = new THREE.BufferGeometry();
            const positions = toFloat32Array(meshData.attributes.position.array);
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

            if (meshData.attributes.normal?.array)
                geometry.setAttribute('normal', new THREE.Float32BufferAttribute(toFloat32Array(meshData.attributes.normal.array), 3));
            else geometry.computeVertexNormals();

            if (meshData.index?.array)
                geometry.setIndex(new THREE.Uint32BufferAttribute(toUint32Array(meshData.index.array), 1));

            const solidMat = new THREE.MeshPhongMaterial({
                color: meshData.color ? new THREE.Color(...meshData.color) : 0xb0b8c8,
                side: THREE.DoubleSide,
                polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
            });
            S.meshObjects.solid = new THREE.Mesh(geometry, solidMat);
            group.add(S.meshObjects.solid);
            S.meshObjects.geometry = geometry;

            log('Classifying edges…');
            const analysis = detectEdgesPartcraft(geometry);
            S.setAnalysisResults({ partcraft: analysis });

            const edgeGroup = buildEdgeVisualization(analysis.edges, 'black', analysis.totalChains, geometry, false);
            S.edgeObjects.current = edgeGroup;
            group.add(edgeGroup);
        }

        S.scene.add(group);
        fitCameraToObject(group);

        createSheet(partName);
        populateDefaults(partName);

        log('Rendering views…');
        const captures = captureAllViews();

        // Show workspace FIRST so canvas gets real dimensions
        uploadArea.classList.add('hidden');
        workspace.classList.add('show');

        // Wait for browser to lay out the canvas, then render
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                loadCaptures(captures);
                log('');
            });
        });
    } catch (err) {
        log('Error: ' + err.message);
        console.error(err);
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
        S.meshObjects.solid = null; S.meshObjects.random = null; S.meshObjects.geometry = null;
        S.setAnalysisResults(null); S.setCurrentSheet(null); S.setPartName('');
        S.setCaptures({});
        fileInput.value = '';
        log('Ready. Upload a STEP file.');
    });

    wireProps();

    // Dimension level buttons
    dimBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const level = parseInt(btn.dataset.level);
            S.setAnnotationLevel(level);
            dimBtns.forEach(b => b.classList.toggle('active', b === btn));
            renderPreview();
        });
    });
}

// ---- Boot ----

(async function init() {
    initPreview();
    loadLogo('CREATIVE-LOGO.png');

    try {
        log('Loading STEP parser…');
        S.setOcct(await occtimportjs({
            locateFile: name => 'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/' + name
        }));
        log('Ready. Upload a STEP file.');
        uploadArea.classList.remove('disabled');
    } catch (err) {
        log('Failed to load: ' + err.message);
    }
    wireEvents();
})();
