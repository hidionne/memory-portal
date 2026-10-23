// Copies the MediaPipe Tasks Vision WASM runtime into public/ and downloads the
// hand-landmarker model, so the app serves both from its own origin.
//
//   node scripts/setup-assets.mjs              copy WASM + download model if missing
//   node scripts/setup-assets.mjs --wasm-only  copy WASM only (used by postinstall)
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDst = join(root, 'public/mediapipe/wasm');
const modelDst = join(root, 'public/models/hand_landmarker.task');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

async function exists(path) {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}

await mkdir(wasmDst, { recursive: true });
for (const file of WASM_FILES) {
  await copyFile(join(wasmSrc, file), join(wasmDst, file));
}
console.log(`[setup-assets] copied MediaPipe WASM to public/mediapipe/wasm`);

if (!process.argv.includes('--wasm-only')) {
  if (await exists(modelDst)) {
    console.log('[setup-assets] model already present at public/models/hand_landmarker.task');
  } else {
    console.log(`[setup-assets] downloading ${MODEL_URL}`);
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`Model download failed: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await mkdir(dirname(modelDst), { recursive: true });
    await writeFile(modelDst, buf);
    console.log(`[setup-assets] saved model (${(buf.length / 1e6).toFixed(1)} MB)`);
  }
}
