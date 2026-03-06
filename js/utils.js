// ============================================
// Partcraft – General Utilities
// ============================================

export function log(msg) {
    document.getElementById('status').textContent = msg;
}

export function toFloat32Array(arr) {
    return arr instanceof Float32Array ? arr : new Float32Array(arr);
}

export function toUint32Array(arr) {
    return arr instanceof Uint32Array ? arr : new Uint32Array(arr);
}

export function generateDistinctColors(count) {
    const colors = [];
    for (let i = 0; i < count; i++) {
        colors.push({ h: (i * 137.508) % 360, s: 70 + (i % 3) * 10, l: 50 + (i % 2) * 15 });
    }
    return colors;
}

export function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = n => {
        const k = (n + h / 30) % 12;
        return Math.round(255 * (l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1))).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}
