import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(__dirname, '..', 'node_modules', 'opencascade.js', 'dist', 'opencascade.full.wasm');
const destDir = path.join(__dirname, '..', 'public', 'wasm');
const dest = path.join(destDir, 'opencascade.full.wasm');

fs.mkdirSync(destDir, { recursive: true });

if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    const sizeMB = (fs.statSync(dest).size / 1024 / 1024).toFixed(1);
    console.log(`✓ Copied opencascade.full.wasm (${sizeMB} MB) to public/wasm/`);
} else {
    console.error('✗ WASM file not found at', src);
    process.exit(1);
}
