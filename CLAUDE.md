# bmgblog

Static blog built with Eleventy, hosted on Cloudflare Workers (static assets) with large files in R2.

## Layout

- `src/posts/<slug>/index.md` — a post. Media files sit in the same folder and are referenced relatively.
- `src/projects/<slug>/index.md` — a write-up page for a WebAssembly app; `app:` front matter is the launch link.
- `src/_includes/layouts/` — `base`, `post`, `project` templates. `src/_data/site.js` — title, description, social links.
- `src/posts/media-example/` — draft reference showing every media pattern. It never ships; copy from it.
- `worker/index.js` — only runs for `/apps/*` and `/media/*`, which it serves from the R2 bucket `bmgblog-files`
  (key = URL path without the leading `/`). Everything else is served as static assets without invoking the worker.
- `scripts/new.mjs`, `scripts/r2-put.mjs` — scaffolding and R2 upload.

## Commands

| Task | Command |
| --- | --- |
| New post | `npm run new -- "Title"` |
| New project page | `npm run new -- --project "Title"` |
| Dev server (drafts visible, no R2) | `npm run dev` → http://localhost:8080 |
| Full local preview (worker + local R2) | `npm run preview` → http://localhost:8787 |
| Production build | `npm run build` (drafts excluded) |
| Upload to R2 | `npm run r2:put -- <file-or-dir> <apps/...|media/...> [--local]` |
| Deploy from this machine | `npm run deploy` |

## Writing posts

Front matter: `title`, `date` (YYYY-MM-DD), optional `description`, `draft: true` until ready to publish.

- Images: `![alt text](photo.jpg)`. Always write meaningful alt text. The build resizes and converts to AVIF/WebP.
  Captions: `<figure><img src="photo.jpg" alt="..."><figcaption>...</figcaption></figure>`; add `class="wide"` to
  break out of the text column.
- Video/audio up to 25 MiB: put the file in the post folder, `<video src="clip.mp4" controls playsinline preload="metadata"></video>`.
- Anything over 25 MiB (Workers static asset limit per file): `npm run r2:put -- ./big.mp4 media/<slug>/big.mp4`,
  then reference `/media/<slug>/big.mp4`. Never commit large binaries.

## WebAssembly projects

1. Build the app in its own repo (Emscripten, Rust/wasm-bindgen, Godot, Unity, …). The output folder must have `index.html`.
2. `npm run r2:put -- <build-dir> apps/<slug>`. It sets `Content-Type` (`application/wasm` etc.) and, for
   `*.br`/`*.gz` files, `Content-Encoding`, so precompressed builds work. Max 300 MiB per file via wrangler.
3. `npm run new -- --project "Title"`, write it up, set `draft: false`.

`/apps/*` responses are sent with COOP/COEP headers (cross-origin isolated), so SharedArrayBuffer/threads work,
but the app can't load cross-origin resources that lack CORS/CORP headers. Keep everything inside the app folder.
Threaded apps only get isolation when opened directly, not inside an `<iframe>` on a post.

R2 uploads go live immediately and are independent of site deploys. Re-uploading overwrites but never deletes
stale files; use a new slug (e.g. `apps/<slug>-v2`) if the file set changes substantially.

## Deploying

- Push to `main` → GitHub Actions builds and runs `wrangler deploy` (production).
- Open a PR → Actions uploads a preview version and comments its URL (`https://pr-<n>-bmgblog.<account>.workers.dev`).
- Prefer the PR flow so the owner can review the preview before merging.
- Before pushing, run `npm run build` and fix any errors. Check pages with `npm run dev` or `npm run preview`.
