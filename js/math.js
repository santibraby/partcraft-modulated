// ============================================
// Partcraft – Vector Math Utilities
// ============================================

// --- 2D ---
export function vec2(x, y) { return { x, y }; }
export function v2sub(a, b) { return vec2(a.x - b.x, a.y - b.y); }
export function v2add(a, b) { return vec2(a.x + b.x, a.y + b.y); }
export function v2scale(v, s) { return vec2(v.x * s, v.y * s); }
export function v2len(v) { return Math.sqrt(v.x * v.x + v.y * v.y); }
export function v2dist(a, b) { return v2len(v2sub(a, b)); }

// --- 3D ---
export function vec3(x, y, z) { return { x, y, z }; }
export function v3sub(a, b) { return vec3(a.x - b.x, a.y - b.y, a.z - b.z); }
export function v3add(a, b) { return vec3(a.x + b.x, a.y + b.y, a.z + b.z); }
export function v3scale(v, s) { return vec3(v.x * s, v.y * s, v.z * s); }
export function v3dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
export function v3cross(a, b) { return vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
export function v3len(v) { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); }
export function v3norm(v) { const l = v3len(v); return l > 1e-10 ? v3scale(v, 1 / l) : vec3(0, 0, 0); }
export function v3dist(a, b) { return v3len(v3sub(a, b)); }

// --- Angle between two 3D vectors (degrees) ---
export function angleBetween(v1, v2) {
    const len1 = v3len(v1);
    const len2 = v3len(v2);
    if (len1 < 1e-10 || len2 < 1e-10) return 0;
    const dot = v3dot(v1, v2) / (len1 * len2);
    return Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
}
