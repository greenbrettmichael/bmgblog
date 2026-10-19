import { FFmpeg } from "./vendor/ffmpeg/index.js";
import { zipSync } from "./vendor/fflate.js";
import { FORMATS, SAMPLE_RATES, CHANNELS, parseTime, buildArgs } from "./formats.js";

// The wasm is stored brotli-compressed and served with Content-Encoding: br,
// so browsers download ~8 MB instead of ~31 MB and decompress it transparently.
const CORE_URL = new URL("core/ffmpeg-core.js", import.meta.url).href;
const WASM_URL = new URL("core/ffmpeg-core.wasm.br", import.meta.url).href;
const INPUT_DIR = "/input";
const SETTINGS_KEY = "audio-converter-settings";

const $ = (id) => document.getElementById(id);
const els = {
  format: $("format"),
  quality: $("quality"),
  qualityField: $("quality-field"),
  qualityLabel: $("quality-label"),
  channels: $("channels"),
  sampleRate: $("sample-rate"),
  volume: $("volume"),
  gain: $("gain"),
  gainField: $("gain-field"),
  start: $("start"),
  end: $("end"),
  settingsError: $("settings-error"),
  drop: $("drop"),
  picker: $("picker"),
  files: $("files"),
  convert: $("convert"),
  cancel: $("cancel"),
  zip: $("zip"),
  clear: $("clear"),
  engine: $("engine"),
};

/** @type {{id:number, file:File, el:HTMLLIElement, status:string, probe:object|null, info:string, progress:number, output:{blob:Blob,url:string,name:string}|null, key:string|null, error:string, log:string}[]} */
let items = [];
let nextId = 1;
let running = false;
let canceled = false;

// ---------------------------------------------------------------------------
// ffmpeg engine: one worker, every call serialized through `exclusive`.

let ffmpeg = null;
let loading = null;
let chain = Promise.resolve();
let logSink = null;
let progressSink = null;

function engine() {
  if (!loading) {
    ffmpeg = new FFmpeg();
    ffmpeg.on("log", ({ message }) => logSink?.(message));
    // `time` is the output position in microseconds.
    ffmpeg.on("progress", ({ time }) => progressSink?.(time / 1e6));
    setEngineStatus("Loading converter…");
    loading = ffmpeg
      .load({ coreURL: CORE_URL, wasmURL: WASM_URL })
      .then(async () => {
        await ffmpeg.createDir(INPUT_DIR);
        setEngineStatus("Ready · files stay on this device");
        return ffmpeg;
      })
      .catch((error) => {
        loading = null;
        setEngineStatus(`Couldn't load the converter (${error.message}). Reload to try again.`);
        throw error;
      });
  }
  return loading;
}

function exclusive(task) {
  const result = chain.then(task);
  chain = result.catch(() => {});
  return result;
}

function restartEngine() {
  ffmpeg?.terminate();
  ffmpeg = null;
  loading = null;
  chain = Promise.resolve();
  engine().catch(() => {});
}

const isTerminated = (error) => error?.message === "called FFmpeg.terminate()";

// Mounts the File read-only instead of copying it into wasm memory, so large
// inputs don't have to fit in RAM twice.
async function withInput(ff, file, task) {
  await ff.mount("WORKERFS", { files: [file] }, INPUT_DIR);
  try {
    return await task(`${INPUT_DIR}/${file.name}`);
  } finally {
    await ff.unmount(INPUT_DIR).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Settings

function fillSelect(select, options, value) {
  select.replaceChildren(...options.map(({ value, label }) => new Option(label, value)));
  if (value != null && options.some((o) => o.value === String(value))) select.value = String(value);
}

function syncFormatOptions(saved = {}) {
  const format = FORMATS[els.format.value];
  els.qualityField.hidden = !format.qualities;
  if (format.qualities) {
    els.qualityLabel.textContent = format.qualityLabel;
    const keep = saved.quality ?? format.defaultQuality;
    fillSelect(els.quality, format.qualities.map((q, i) => ({ value: String(i), label: q.label })), keep);
  }
  const rates = SAMPLE_RATES.filter((r) => !format.sampleRates || format.sampleRates.includes(r));
  fillSelect(
    els.sampleRate,
    [{ value: "", label: "Same as source" }, ...rates.map((r) => ({ value: String(r), label: `${r.toLocaleString()} Hz` }))],
    saved.sampleRate ?? els.sampleRate.value,
  );
}

function readSettings() {
  const start = parseTime(els.start.value);
  const end = parseTime(els.end.value);
  let error = "";
  if (Number.isNaN(start) || Number.isNaN(end)) error = "Trim times look like 90, 1:30 or 1:02:03.5.";
  else if (end != null && end <= (start ?? 0)) error = "Trim end must be after trim start.";
  els.settingsError.hidden = !error;
  els.settingsError.textContent = error;
  if (error) return null;

  const format = FORMATS[els.format.value];
  return {
    format: els.format.value,
    quality: format.qualities ? Number(els.quality.value) : null,
    channels: els.channels.value,
    sampleRate: Number(els.sampleRate.value) || null,
    volume: els.volume.value,
    gain: els.volume.value === "gain" ? Number(els.gain.value) || 0 : 0,
    start,
    end,
  };
}

function saveSettings() {
  els.gainField.hidden = els.volume.value !== "gain";
  const settings = readSettings();
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ ...settings, start: els.start.value, end: els.end.value, gain: els.gain.value }),
    );
  } catch {}
  updateControls();
}

function initSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {};
  } catch {}

  fillSelect(els.format, Object.entries(FORMATS).map(([value, f]) => ({ value, label: f.label })), saved.format ?? "mp3");
  fillSelect(els.channels, CHANNELS, saved.channels ?? "");
  syncFormatOptions(saved);
  if (saved.volume != null) els.volume.value = saved.volume;
  els.gain.value = saved.gain || "0";
  els.start.value = saved.start ?? "";
  els.end.value = saved.end ?? "";
  els.gainField.hidden = els.volume.value !== "gain";

  els.format.addEventListener("change", () => {
    syncFormatOptions();
    saveSettings();
  });
  for (const el of [els.quality, els.channels, els.sampleRate, els.volume, els.gain, els.start, els.end]) {
    el.addEventListener("change", saveSettings);
    el.addEventListener("input", saveSettings);
  }
}

// ---------------------------------------------------------------------------
// File list

function addFiles(fileList) {
  for (const file of fileList) {
    const item = {
      id: nextId++,
      file,
      el: document.createElement("li"),
      status: "probing",
      probe: null,
      info: "Reading…",
      progress: 0,
      output: null,
      key: null,
      error: "",
      log: "",
    };
    item.el.className = "file";
    items.push(item);
    els.files.append(item.el);
    render(item);
    probe(item);
  }
  updateControls();
}

async function probe(item) {
  try {
    const ff = await engine();
    item.probe = await exclusive(() =>
      withInput(ff, item.file, async (path) => {
        // No output file: ffmpeg prints the input's details and exits with an error.
        // (ff.ffprobe would be neater, but it aborts the wasm runtime and silences
        // all later log output.)
        const log = [];
        logSink = (line) => log.push(line);
        try {
          await ff.exec(["-hide_banner", "-i", path]);
        } finally {
          logSink = null;
        }
        return parseProbe(log);
      }),
    );
    if (!items.includes(item)) return;
    if (item.probe) {
      item.status = "ready";
      item.info = describeSource(item);
    } else {
      item.status = "unsupported";
      item.info = formatBytes(item.file.size);
      item.error = "No audio track found.";
    }
  } catch (error) {
    if (isTerminated(error)) return probe(item);
    if (!items.includes(item)) return;
    item.status = "unsupported";
    item.info = formatBytes(item.file.size);
    item.error = error.message;
  }
  render(item);
  updateControls();
}

// Reads duration and the first audio stream from `ffmpeg -i` output, e.g.
//   Duration: 00:03:21.45, start: 0.000000, bitrate: 320 kb/s
//   Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 320 kb/s
function parseProbe(log) {
  if (!log.some((line) => line.startsWith("Input #0"))) throw new Error("Not a recognized audio or video file.");
  const audio = log.find((line) => /^\s*Stream #0:\d+.*: Audio: /.test(line));
  if (!audio) return null;
  const parts = audio.split(": Audio: ")[1].split(", ");
  const rateIndex = parts.findIndex((part) => / Hz$/.test(part));
  const duration = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(log.find((line) => line.includes("Duration:")) ?? "");
  return {
    codec: parts[0].split(" ")[0],
    sampleRate: rateIndex >= 0 ? parseInt(parts[rateIndex], 10) : null,
    layout: rateIndex >= 0 ? parts[rateIndex + 1] : null,
    duration: duration ? +duration[1] * 3600 + +duration[2] * 60 + +duration[3] : null,
  };
}

function describeSource(item) {
  const { codec, sampleRate, layout, duration } = item.probe;
  return [
    formatBytes(item.file.size),
    codec?.toUpperCase(),
    sampleRate && `${(sampleRate / 1000).toLocaleString()} kHz`,
    layout,
    duration && formatDuration(duration),
  ]
    .filter(Boolean)
    .join(" · ");
}

function render(item) {
  const { el, status } = item;
  el.replaceChildren();

  const name = document.createElement("div");
  name.className = "file-name";
  name.textContent = item.file.name;

  const info = document.createElement("div");
  info.className = "file-info";
  info.textContent = item.info;
  const note = document.createElement("span");
  if (status === "unsupported" || status === "failed") {
    note.className = "bad";
    note.textContent = ` — ${item.error}`;
  } else if (status === "queued") {
    note.textContent = " — waiting";
  } else if (status === "converting") {
    note.textContent = ` — converting ${Math.round(item.progress * 100)}%`;
  } else if (status === "done") {
    note.className = "good";
    note.textContent = ` → ${item.output.name} (${formatBytes(item.output.blob.size)})`;
  }
  info.append(note);

  const actions = document.createElement("div");
  actions.className = "file-actions";
  if (item.output) {
    const link = document.createElement("a");
    link.className = "button";
    link.href = item.output.url;
    link.download = item.output.name;
    link.textContent = "Download";
    actions.append(link);
  }
  const remove = document.createElement("button");
  remove.className = "icon";
  remove.textContent = "✕";
  remove.title = `Remove ${item.file.name}`;
  remove.setAttribute("aria-label", remove.title);
  remove.disabled = status === "converting" || status === "queued";
  remove.addEventListener("click", () => removeItem(item));
  actions.append(remove);

  el.append(name, info, actions);

  if (status === "converting") {
    const bar = document.createElement("progress");
    bar.max = 1;
    bar.value = item.progress;
    el.append(bar);
  }
  if (status === "failed" && item.log) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "FFmpeg log";
    const pre = document.createElement("pre");
    pre.textContent = item.log;
    details.append(summary, pre);
    el.append(details);
  }
}

function removeItem(item) {
  if (item.output) URL.revokeObjectURL(item.output.url);
  item.el.remove();
  items = items.filter((i) => i !== item);
  updateControls();
}

const needsConversion = (item, key) =>
  item.status === "ready" || item.status === "failed" || (item.status === "done" && item.key !== key);

function updateControls() {
  const settings = readSettings();
  const key = settings && JSON.stringify(settings);
  const pending = items.filter((i) => needsConversion(i, key)).length;
  els.convert.disabled = running || !settings || pending === 0;
  els.convert.textContent = pending > 1 ? `Convert ${pending} files` : "Convert";
  els.cancel.hidden = !running;
  els.zip.disabled = running || !items.some((i) => i.status === "done");
  els.clear.disabled = running || items.length === 0;
}

// ---------------------------------------------------------------------------
// Conversion

async function convertAll() {
  const settings = readSettings();
  if (!settings) return;
  const key = JSON.stringify(settings);
  const queue = items.filter((i) => needsConversion(i, key));
  if (!queue.length) return;

  running = true;
  canceled = false;
  for (const item of queue) {
    item.status = "queued";
    render(item);
  }
  updateControls();

  for (const item of queue) {
    if (canceled) break;
    await convert(item, settings, key);
  }

  for (const item of queue) {
    if (item.status === "queued" || item.status === "converting") {
      item.status = item.output ? "done" : "ready";
      render(item);
    }
  }
  running = false;
  updateControls();
}

async function convert(item, settings, key) {
  const format = FORMATS[settings.format];
  const outputPath = `/output.${format.ext}`;
  const log = [];
  item.status = "converting";
  item.progress = 0;
  render(item);

  try {
    const ff = await engine();
    const data = await exclusive(() =>
      withInput(ff, item.file, async (inputPath) => {
        const { args, duration } = buildArgs(settings, item.probe, inputPath, outputPath);
        logSink = (line) => {
          log.push(line);
          if (log.length > 300) log.shift();
        };
        progressSink = (seconds) => {
          if (!duration) return;
          item.progress = Math.min(1, Math.max(0, seconds / duration));
          item.el.querySelector("progress").value = item.progress;
          item.el.querySelector(".file-info span").textContent = ` — converting ${Math.round(item.progress * 100)}%`;
        };
        try {
          const code = await ff.exec(args);
          if (code !== 0) throw new Error(`FFmpeg exited with code ${code}`);
          return await ff.readFile(outputPath);
        } finally {
          logSink = null;
          progressSink = null;
          await ff.deleteFile(outputPath).catch(() => {});
        }
      }),
    );

    if (item.output) URL.revokeObjectURL(item.output.url);
    const blob = new Blob([data], { type: mimeType(format) });
    item.output = { blob, url: URL.createObjectURL(blob), name: outputName(item, format.ext) };
    item.key = key;
    item.status = "done";
  } catch (error) {
    if (isTerminated(error)) return;
    item.status = "failed";
    item.error = summarizeError(log) ?? error.message;
    item.log = log.join("\n");
  }
  render(item);
}

function cancelAll() {
  canceled = true;
  restartEngine();
}

function summarizeError(log) {
  const line = [...log].reverse().find((l) => /error|invalid|not supported|unsupported|failed/i.test(l));
  return line?.trim();
}

function mimeType(format) {
  return (
    { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", opus: "audio/ogg", flac: "audio/flac",
      wav: "audio/wav", aiff: "audio/aiff", wma: "audio/x-ms-wma", ac3: "audio/ac3" }[format.ext] ?? "application/octet-stream"
  );
}

// "song.flac" -> "song.mp3"; avoids clashes with other outputs in the list.
function outputName(item, ext) {
  const base = item.file.name.replace(/\.[^.]+$/, "") || "audio";
  const taken = new Set(items.filter((i) => i !== item && i.output).map((i) => i.output.name));
  let name = `${base}.${ext}`;
  for (let n = 2; taken.has(name); n++) name = `${base} (${n}).${ext}`;
  return name;
}

async function downloadZip() {
  els.zip.disabled = true;
  const entries = {};
  for (const item of items) {
    if (item.status === "done") entries[item.output.name] = new Uint8Array(await item.output.blob.arrayBuffer());
  }
  // Audio is already compressed; storing (level 0) is as small and much faster.
  const zip = zipSync(entries, { level: 0 });
  const url = URL.createObjectURL(new Blob([zip], { type: "application/zip" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: "converted-audio.zip" });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  updateControls();
}

// ---------------------------------------------------------------------------
// Helpers and wiring

function setEngineStatus(text) {
  els.engine.textContent = text;
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(i && bytes < 10 ? 1 : 0)} ${units[i]}`;
}

function formatDuration(seconds) {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

initSettings();
engine().catch(() => {});

els.picker.addEventListener("change", () => {
  addFiles(els.picker.files);
  els.picker.value = "";
});

// Drops anywhere on the page add files; the drop zone just highlights.
let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  e.preventDefault();
  if (++dragDepth === 1) els.drop.classList.add("over");
});
window.addEventListener("dragleave", () => {
  if (--dragDepth === 0) els.drop.classList.remove("over");
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  els.drop.classList.remove("over");
  if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files);
});

els.convert.addEventListener("click", convertAll);
els.cancel.addEventListener("click", cancelAll);
els.zip.addEventListener("click", downloadZip);
els.clear.addEventListener("click", () => {
  for (const item of [...items]) removeItem(item);
});
