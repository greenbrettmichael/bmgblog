---
title: Audio Converter
date: 2026-10-19
description: Convert audio between MP3, AAC, FLAC, WAV, Opus and more, entirely in your browser. Nothing is uploaded.
app: /apps/audio-converter/
---

Online converters work by uploading your file to someone else's server, converting it there and
sending it back. That's slow for big files, and it means handing your recordings to a stranger.
This one runs [FFmpeg](https://ffmpeg.org/) compiled to WebAssembly inside the page, so the
conversion happens on your own machine and your files never leave it.

## What it does

- **Formats:** MP3, M4A/AAC, raw AAC, OGG Vorbis, Opus, FLAC, ALAC, WAV, AIFF, WMA and AC3 out; anything FFmpeg can read in, including the audio track of video files.
- **Options:** bitrate or quality, channels, sample rate, loudness normalization (EBU R128) or a fixed gain, and trimming.
- **Batches:** drop in a stack of files, convert them all with the same settings, and download them one by one or as a zip.

## How it works

The page loads [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) into a Web Worker. Input files
are mounted into its virtual filesystem straight from disk rather than copied into memory, then a
normal `ffmpeg` command line runs against them. The output is handed back to the page as a download.

The FFmpeg build is about 31 MB of WebAssembly. It's stored Brotli-compressed, so the first visit
downloads about 7 MB, and later visits revalidate it from the browser cache.

## Limits

- Everything runs in one browser tab, so very large files (several GB) can run out of memory.
- Opus uses FFmpeg's built-in encoder, because libopus crashes in the current ffmpeg.wasm build. It's
  good at normal bitrates but weaker than libopus at very low ones.

The source is in [apps/audio-converter](https://github.com/greenbrettmichael/bmgblog/tree/main/apps/audio-converter).
