// Static pages are served straight from the built `_site` assets without running
// this code. Only paths listed in `assets.run_worker_first` (wrangler.jsonc) reach
// it: those are large files (WebAssembly apps, big media) stored in R2, where the
// R2 key is the URL path without the leading slash: /apps/foo/index.html -> apps/foo/index.html

const R2_PREFIXES = ["/apps/", "/media/"];

// Fallback when an object was uploaded without a content type.
const CONTENT_TYPES = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  wasm: "application/wasm",
  data: "application/octet-stream",
  pck: "application/octet-stream",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  svg: "image/svg+xml",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (R2_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
      return serveFromR2(request, env, url);
    }
    return env.ASSETS.fetch(request);
  },
};

async function serveFromR2(request, env, url) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }

  let key = decodeURIComponent(url.pathname.slice(1));
  if (key.endsWith("/")) {
    key += "index.html";
  } else if (!key.split("/").pop().includes(".")) {
    // /apps/foo -> /apps/foo/ so the app's relative URLs resolve inside its folder.
    return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 301);
  }

  const object =
    request.method === "HEAD"
      ? await env.FILES.head(key)
      : await env.FILES.get(key, { range: request.headers, onlyIf: request.headers });

  if (object === null) {
    return notFound(request, env, url);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  if (!headers.has("content-type")) {
    const ext = key.split(".").pop().toLowerCase();
    headers.set("content-type", CONTENT_TYPES[ext] ?? "application/octet-stream");
  }
  if (!headers.has("cache-control")) {
    // Always revalidate (cheap 304 via ETag) so re-uploaded builds show up immediately.
    headers.set("cache-control", "public, max-age=0, must-revalidate");
  }
  if (key.startsWith("apps/")) {
    // Cross-origin isolation: required for SharedArrayBuffer / WebAssembly threads.
    headers.set("cross-origin-opener-policy", "same-origin");
    headers.set("cross-origin-embedder-policy", "require-corp");
    headers.set("cross-origin-resource-policy", "same-origin");
  }

  // Precompressed uploads (foo.wasm.br) carry Content-Encoding in their metadata;
  // "manual" stops the runtime from compressing the already-compressed bytes again.
  const init = { headers, encodeBody: "manual" };

  if (request.method === "HEAD") {
    headers.set("content-length", String(object.size));
    return new Response(null, init);
  }

  // `get` with `onlyIf` returns an object without a body when a precondition fails.
  if (!("body" in object)) {
    const status = request.headers.has("if-none-match") || request.headers.has("if-modified-since") ? 304 : 412;
    return new Response(null, { ...init, status });
  }

  console.log("RANGE", JSON.stringify(object.range), typeof object.range, object.range && Object.keys(object.range));
  if (object.range && request.headers.has("range")) {
    const { offset, length } = resolveRange(object.range, object.size);
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    return new Response(object.body, { ...init, status: 206 });
  }

  return new Response(object.body, init);
}

function resolveRange(range, size) {
  if (range.suffix !== undefined) {
    const length = Math.min(range.suffix, size);
    return { offset: size - length, length };
  }
  const offset = range.offset ?? 0;
  const length = range.length ?? size - offset;
  return { offset, length };
}

async function notFound(request, env, url) {
  const page = await env.ASSETS.fetch(new Request(new URL("/404", url), request));
  return new Response(page.body, { status: 404, headers: page.headers });
}
