// Assembles dist/ for upload to R2 (`npm run r2:put -- apps/audio-converter/dist apps/audio-converter`
// from the repo root). No bundler: the app is plain ES modules plus vendored copies of
// ffmpeg.wasm and fflate.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { brotliCompressSync, constants } from "node:zlib";

const dist = "dist";
rmSync(dist, { recursive: true, force: true });
cpSync("src", dist, { recursive: true });

mkdirSync(`${dist}/vendor/ffmpeg`, { recursive: true });
const ffmpegDir = "node_modules/@ffmpeg/ffmpeg/dist/esm";
for (const file of readdirSync(ffmpegDir).filter((f) => f.endsWith(".js"))) {
  cpSync(`${ffmpegDir}/${file}`, `${dist}/vendor/ffmpeg/${file}`);
}
cpSync("node_modules/fflate/esm/browser.js", `${dist}/vendor/fflate.js`);

// The worker serves *.br objects with Content-Encoding: br (see scripts/r2-put.mjs).
mkdirSync(`${dist}/core`);
cpSync("node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js", `${dist}/core/ffmpeg-core.js`);
const wasm = readFileSync("node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm");
const compressed = brotliCompressSync(wasm, {
  params: {
    [constants.BROTLI_PARAM_QUALITY]: 11,
    [constants.BROTLI_PARAM_SIZE_HINT]: wasm.length,
  },
});
writeFileSync(`${dist}/core/ffmpeg-core.wasm.br`, compressed);

const mb = (n) => (n / 1024 / 1024).toFixed(1);
console.log(`dist/ ready (wasm ${mb(wasm.length)} MB -> ${mb(compressed.length)} MB brotli)`);
