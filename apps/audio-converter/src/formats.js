// Output formats and how their settings map to ffmpeg arguments.
// Each format has a list of quality presets; `defaultQuality` indexes into it.

const kbps = (rates) => rates.map((rate) => ({ label: `${rate} kbps`, args: ["-b:a", `${rate}k`] }));

export const FORMATS = {
  mp3: {
    label: "MP3",
    ext: "mp3",
    codec: "libmp3lame",
    qualityLabel: "Quality",
    qualities: [
      { label: "VBR V0 (~245 kbps)", args: ["-q:a", "0"] },
      { label: "VBR V2 (~190 kbps)", args: ["-q:a", "2"] },
      { label: "VBR V5 (~130 kbps)", args: ["-q:a", "5"] },
      ...kbps([320, 256, 192, 128, 96, 64]),
    ],
    defaultQuality: 1,
    sampleRates: [8000, 11025, 16000, 22050, 32000, 44100, 48000],
  },
  m4a: {
    label: "M4A (AAC)",
    ext: "m4a",
    codec: "aac",
    qualityLabel: "Bitrate",
    qualities: kbps([320, 256, 192, 160, 128, 96, 64]),
    defaultQuality: 2,
    extraArgs: ["-movflags", "+faststart"],
  },
  aac: {
    label: "AAC (raw ADTS)",
    ext: "aac",
    codec: "aac",
    qualityLabel: "Bitrate",
    qualities: kbps([320, 256, 192, 160, 128, 96, 64]),
    defaultQuality: 2,
    extraArgs: ["-f", "adts"],
  },
  ogg: {
    label: "OGG (Vorbis)",
    ext: "ogg",
    codec: "libvorbis",
    qualityLabel: "Quality",
    qualities: [
      { label: "q8 (~256 kbps)", args: ["-q:a", "8"] },
      { label: "q6 (~192 kbps)", args: ["-q:a", "6"] },
      { label: "q5 (~160 kbps)", args: ["-q:a", "5"] },
      { label: "q4 (~128 kbps)", args: ["-q:a", "4"] },
      { label: "q2 (~96 kbps)", args: ["-q:a", "2"] },
      { label: "q0 (~64 kbps)", args: ["-q:a", "0"] },
    ],
    defaultQuality: 2,
  },
  opus: {
    label: "Opus",
    ext: "opus",
    // libopus crashes the tab in @ffmpeg/core 0.12.10; FFmpeg's built-in
    // encoder is marked experimental but works. It only outputs 48 kHz.
    codec: "opus",
    qualityLabel: "Bitrate",
    qualities: kbps([256, 192, 160, 128, 96, 64]),
    defaultQuality: 3,
    sampleRates: [48000],
    extraArgs: ["-strict", "experimental"],
  },
  flac: {
    label: "FLAC",
    ext: "flac",
    codec: "flac",
    qualityLabel: "Compression",
    qualities: [
      { label: "Fastest (0)", args: ["-compression_level", "0"] },
      { label: "Default (5)", args: ["-compression_level", "5"] },
      { label: "Smallest (8)", args: ["-compression_level", "8"] },
    ],
    defaultQuality: 1,
  },
  alac: {
    label: "ALAC (Apple Lossless)",
    ext: "m4a",
    codec: "alac",
    extraArgs: ["-movflags", "+faststart"],
  },
  wav: {
    label: "WAV",
    ext: "wav",
    qualityLabel: "Bit depth",
    qualities: [
      { label: "16-bit", args: ["-c:a", "pcm_s16le"] },
      { label: "24-bit", args: ["-c:a", "pcm_s24le"] },
      { label: "32-bit float", args: ["-c:a", "pcm_f32le"] },
    ],
    defaultQuality: 0,
  },
  aiff: {
    label: "AIFF",
    ext: "aiff",
    qualityLabel: "Bit depth",
    qualities: [
      { label: "16-bit", args: ["-c:a", "pcm_s16be"] },
      { label: "24-bit", args: ["-c:a", "pcm_s24be"] },
      { label: "32-bit", args: ["-c:a", "pcm_s32be"] },
    ],
    defaultQuality: 0,
  },
  wma: {
    label: "WMA",
    ext: "wma",
    codec: "wmav2",
    qualityLabel: "Bitrate",
    qualities: kbps([192, 160, 128, 96, 64]),
    defaultQuality: 2,
    sampleRates: [8000, 11025, 16000, 22050, 32000, 44100, 48000],
  },
  ac3: {
    label: "AC3 (Dolby Digital)",
    ext: "ac3",
    codec: "ac3",
    qualityLabel: "Bitrate",
    qualities: kbps([640, 448, 384, 256, 192, 128]),
    defaultQuality: 4,
    sampleRates: [32000, 44100, 48000],
  },
};

export const SAMPLE_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000];

export const CHANNELS = [
  { value: "", label: "Same as source" },
  { value: "1", label: "Mono" },
  { value: "2", label: "Stereo" },
];

// Parses "90", "1:30", "01:02:03.5" into seconds. Empty -> null, invalid -> NaN.
export function parseTime(text) {
  const value = text.trim();
  if (!value) return null;
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(value)) return NaN;
  return value.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

// Picks the sample rate actually written: the requested one, or the source's
// when it's allowed, otherwise the closest rate the encoder supports.
function outputSampleRate(format, requested, sourceRate) {
  const rate = requested || sourceRate;
  if (!rate || !format.sampleRates || format.sampleRates.includes(rate)) return rate;
  return format.sampleRates.reduce((best, r) => (Math.abs(r - rate) < Math.abs(best - rate) ? r : best));
}

// settings: { format, quality, channels, sampleRate, volume, gain, start, end }
// probe: { duration, sampleRate } from ffprobe (either may be missing).
// Returns ffmpeg args plus the expected output duration (for progress).
export function buildArgs(settings, probe, inputPath, outputPath) {
  const format = FORMATS[settings.format];
  const args = ["-hide_banner"];

  const start = settings.start ?? 0;
  if (start > 0) args.push("-ss", String(start));
  args.push("-i", inputPath);

  // First audio stream only: drops cover art and video, which most audio
  // containers can't hold, and keeps tags.
  args.push("-map", "0:a:0", "-map_metadata", "0");

  let duration = probe.duration ? Math.max(0, probe.duration - start) : null;
  if (settings.end != null) {
    const length = settings.end - start;
    args.push("-t", String(length));
    duration = duration == null ? length : Math.min(duration, length);
  }

  if (format.codec) args.push("-c:a", format.codec);
  const quality = format.qualities?.[settings.quality ?? format.defaultQuality];
  if (quality) args.push(...quality.args);

  if (settings.channels) args.push("-ac", settings.channels);

  const filters = [];
  if (settings.volume === "normalize") {
    filters.push("loudnorm=I=-16:TP=-1.5:LRA=11");
  } else if (settings.volume === "gain" && settings.gain) {
    filters.push(`volume=${settings.gain}dB`);
  }
  if (filters.length) args.push("-af", filters.join(","));

  // loudnorm resamples to 192 kHz internally, so pin the rate whenever we know it.
  const rate = outputSampleRate(format, settings.sampleRate, probe.sampleRate);
  if (rate && (settings.sampleRate || filters.length || rate !== probe.sampleRate)) {
    args.push("-ar", String(rate));
  }

  args.push(...(format.extraArgs ?? []), "-y", outputPath);
  return { args, duration };
}
