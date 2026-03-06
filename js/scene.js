// ============================================
// Partcraft – Three.js Scene (off-screen)
// ============================================

import * as S from './state.js';

const CAP_W = 2400;
const CAP_H = 1800;

export function initThreeJS() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);

    const aspect = CAP_W / CAP_H;
    const orthoCamera = new THREE.OrthographicCamera(-50 * aspect, 50 * aspect, 50, -50, 0.1, 10000);
    orthoCamera.position.set(50, 50, 50);

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(CAP_W, CAP_H);
    renderer.setPixelRatio(1);

    scene.add(new THREE.AmbientLight(0x606060, 0.6));
    const l1 = new THREE.DirectionalLight(0xffffff, 0.7); l1.position.set(50, 100, 50); scene.add(l1);
    const l2 = new THREE.DirectionalLight(0xffffff, 0.35); l2.position.set(-50, -50, -50); scene.add(l2);

    S.setScene(scene);
    S.setOrthoCamera(orthoCamera);
    S.setRenderer(renderer);
}

function positionCamera(viewName) {
    const mc = S.modelCenter;
    const d = S.modelSize * 2;
    const aspect = CAP_W / CAP_H;
    const fs = S.modelSize * 0.7;

    S.orthoCamera.left   = -fs * aspect;
    S.orthoCamera.right  =  fs * aspect;
    S.orthoCamera.top    =  fs;
    S.orthoCamera.bottom = -fs;
    S.orthoCamera.updateProjectionMatrix();

    switch (viewName) {
        case 'top':   S.orthoCamera.position.set(mc.x, mc.y + d, mc.z); S.orthoCamera.up.set(0, 0, -1); break;
        case 'front': S.orthoCamera.position.set(mc.x, mc.y, mc.z + d); S.orthoCamera.up.set(0, 1, 0); break;
        case 'right': S.orthoCamera.position.set(mc.x + d, mc.y, mc.z); S.orthoCamera.up.set(0, 1, 0); break;
        case 'axon':
            S.orthoCamera.position.set(mc.x + d, mc.y + d, mc.z + d);
            S.orthoCamera.up.set(0, 1, 0); break;
    }
    S.orthoCamera.lookAt(mc);
}

export function fitCameraToObject(object) {
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    S.modelCenter.copy(center);
    S.setModelSize(Math.max(size.x, size.y, size.z));
    S.setModelBounds({
        min: { x: box.min.x, y: box.min.y, z: box.min.z },
        max: { x: box.max.x, y: box.max.y, z: box.max.z }
    });
}

/** Capture all 4 views, return { axon, top, right, front } data URLs */
export function captureAllViews() {
    const views = ['axon', 'top', 'right', 'front'];
    const captures = {};
    for (const v of views) {
        positionCamera(v);
        S.renderer.render(S.scene, S.orthoCamera);
        captures[v] = S.renderer.domElement.toDataURL('image/png');
    }
    S.setCaptures(captures);
    return captures;
}
