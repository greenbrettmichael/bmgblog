// Uploads a file or a whole directory to the site's R2 bucket.
//   npm run r2:put -- <file-or-dir> <key-prefix> [--local]
//
// Examples:
//   npm run r2:put -- ~/code/mygame/build apps/mygame   -> https://<site>/apps/mygame/
//   npm run r2:put -- ./talk.mp4 media/talk.mp4         -> https://<site>/media/talk.mp4
//
// --local writes to the local bucket used by `npm run preview` instead of Cloudflare.
// Re-uploading overwrites keys with the same name; it does not delete files that
// were removed from the build.
import { execFile } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";

const BUCKET = process.env.R2_BUCKET ?? "bmgblog-files";
const MAX_BYTES = 300 * 1024 * 1024; // wrangler's single-request upload limit
const CONCURRENCY = 4; // remote only; the local bucket is a SQLite file that can't take parallel writers

const CONTENT_TYPES = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  map: "application/json",
  txt: "text/plain; charset=utf-8",
  wasm: "application/wasm",
  data: "application/octet-stream",
  pck: "application/octet-stream",
  bin: "application/octet-stream",
  unityweb: "application/octet-stream",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  ttf: "font/ttf",
  woff: "font/woff",
  woff2: "font/woff2",
  pdf: "application/pdf",
  zip: "application/zip",
};

const ENCODINGS = { br: "br", gz: "gzip" };

const args = process.argv.slice(2);
const local = args.includes("--local");
const [source, prefix] = args.filter((a) => a !== "--local");
if (!source || !prefix) {
  console.error("Usage: npm run r2:put -- <file-or-dir> <key-prefix> [--local]");
  process.exit(1);
}

const cleanPrefix = prefix.replace(/^\/+|\/+$/g, "");
if (!/^(apps|media)\//.test(cleanPrefix + "/")) {
  console.error(`Key prefix must start with apps/ or media/ (the paths the worker serves), got "${prefix}"`);
  process.exit(1);
}

const isDir = statSync(source).isDirectory();
const uploads = (isDir ? walk(source) : [source]).map((file) => ({
  file,
  key: isDir ? `${cleanPrefix}/${relative(source, file).split(sep).join("/")}` : cleanPrefix,
}));

const tooBig = uploads.filter(({ file }) => statSync(file).size > MAX_BYTES);
if (tooBig.length) {
  console.error("These files exceed wrangler's 300 MiB upload limit. Upload them with an");
  console.error("S3-compatible client (rclone, aws s3 cp) against R2's S3 endpoint instead:");
  for (const { file } of tooBig) console.error(`  ${file}`);
  process.exit(1);
}

const run = promisify(execFile);
const wrangler = join("node_modules", ".bin", "wrangler");
let done = 0;

async function upload({ file, key }) {
  const flags = ["r2", "object", "put", `${BUCKET}/${key}`, "--file", file, local ? "--local" : "--remote"];
  const parts = key.toLowerCase().split(".");
  let ext = parts.pop();
  if (ENCODINGS[ext]) {
    // game.wasm.br -> Content-Type: application/wasm, Content-Encoding: br
    flags.push("--content-encoding", ENCODINGS[ext]);
    ext = parts.pop();
  }
  flags.push("--content-type", CONTENT_TYPES[ext] ?? "application/octet-stream");
  try {
    await run(wrangler, flags, { maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    console.error(`Failed to upload ${key}:\n${error.stderr || error.stdout || error.message}`);
    process.exit(1);
  }
  console.log(`[${++done}/${uploads.length}] ${key}`);
}

const queue = [...uploads];
await Promise.all(
  Array.from({ length: local ? 1 : Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) await upload(queue.shift());
  }),
);

const entry = uploads.some(({ key }) => key === `${cleanPrefix}/index.html`) ? `/${cleanPrefix}/` : `/${uploads[0].key}`;
console.log(`Uploaded ${uploads.length} file(s) to ${local ? "local" : "remote"} bucket ${BUCKET}. Served at ${entry}`);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
