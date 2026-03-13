// ============================================
// Partcraft – Three.js Scene (off-screen)
//
// Camera is FIXED: looks down -Z at XY plane.
// Model is ROTATED for each view:
//
//   Sheet layout:
//   ┌──────────┬──────────┐
//   │  axon    │  front   │
//   ├──────────┼──────────┤
//   │  right   │  top     │
//   └──────────┴──────────┘
//
//   top:   no rotation (XY plane as-is)
//   front: rotated to show front elevation (XZ plane)
//   right: rotated to show right elevation (YZ plane)
//   axon:  isometric rotation
// ============================================

import * as S from './state.js';

const CAP_W = 2400;
const CAP_H = 1800;

export function initThreeJS() {
    const scene = new THREE.Scene();
    scene.background = null; // transparent — alpha composited in preview

    const aspect = CAP_W / CAP_H;
    const orthoCamera = new THREE.OrthographicCamera(-50 * aspect, 50 * aspect, 50, -50, 0.1, 10000);

    const renderer = new THREE.WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true,
        alpha: true,   // enable transparent background
    });
    renderer.setClearColor(0x000000, 0); // fully transparent clear
    renderer.setSize(CAP_W, CAP_H);
    renderer.setPixelRatio(1);

    scene.add(new THREE.AmbientLight(0x606060, 0.6));
    const l1 = new THREE.DirectionalLight(0xffffff, 0.7); l1.position.set(50, 100, 50); scene.add(l1);
    const l2 = new THREE.DirectionalLight(0xffffff, 0.35); l2.position.set(-50, -50, -50); scene.add(l2);

    S.setScene(scene);
    S.setOrthoCamera(orthoCamera);
    S.setRenderer(renderer);
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

// ── View rotations (Euler angles applied to model around its center) ──

const VIEW_ROTATIONS = {
    front: { x: -Math.PI / 2, y: Math.PI / 2,  z: Math.PI / 2 },
    top:   { x: 0,             y: 0,            z: 0 },
    right: { x: 0,             y: Math.PI / 2,  z: Math.PI },
    axon:  { x: -Math.atan(1 / Math.sqrt(2)), y: Math.PI / 4, z: 165 * Math.PI / 180 },
};

function setupCamera() {
    const mc = S.modelCenter;
    const d = S.modelSize * 2;
    const aspect = CAP_W / CAP_H;
    const fs = S.modelSize * 0.7;

    S.orthoCamera.left   = -fs * aspect;
    S.orthoCamera.right  =  fs * aspect;
    S.orthoCamera.top    =  fs;
    S.orthoCamera.bottom = -fs;
    S.orthoCamera.updateProjectionMatrix();

    // Fixed: looking down -Z at XY plane
    S.orthoCamera.position.set(mc.x, mc.y, mc.z + d);
    S.orthoCamera.up.set(0, 1, 0);
    S.orthoCamera.lookAt(mc);
}

/** Capture all 4 views by rotating model, return data URLs (transparent bg) */
export function captureAllViews() {
    const group = S.currentGroup;
    if (!group) return {};

    const mc = S.modelCenter;
    const captures = {};

    // Save original
    const origPos = group.position.clone();
    const origRot = group.rotation.clone();

    for (const v of ['axon', 'top', 'right', 'front']) {
        setupCamera();

        // Reset
        group.position.copy(origPos);
        group.rotation.set(0, 0, 0);

        // Rotate around model center using a pivot
        const rot = VIEW_ROTATIONS[v];
        const pivot = new THREE.Group();
        pivot.position.copy(mc);
        pivot.rotation.set(rot.x, rot.y, rot.z, 'YXZ');

        S.scene.remove(group);
        group.position.sub(mc);
        pivot.add(group);
        S.scene.add(pivot);

        S.renderer.render(S.scene, S.orthoCamera);
        captures[v] = S.renderer.domElement.toDataURL('image/png');

        // Restore
        pivot.remove(group);
        S.scene.remove(pivot);
        group.position.copy(origPos);
        group.rotation.copy(origRot);
        S.scene.add(group);
    }

    S.setCaptures(captures);
    return captures;
}
