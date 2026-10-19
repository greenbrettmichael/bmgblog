---
title: Media example
date: 2026-10-19
description: Reference for every kind of media a post can hold. Drafts never ship.
draft: true
---

A post is a folder: `src/posts/<slug>/index.md` plus any media files next to it.

## Images

Plain Markdown. The build resizes the image, converts it to AVIF/WebP and adds width/height:

![A blue-to-amber gradient](gradient.jpg)

With a caption, or wider than the text column:

<figure class="wide">
  <img src="gradient.jpg" alt="The same gradient, wide">
  <figcaption>Captions go in a figure.</figcaption>
</figure>

## Video and audio

Small files (under 25 MiB) go in the post folder and are referenced relatively:

```html
<video src="clip.mp4" controls playsinline preload="metadata"></video>
<audio src="voice.mp3" controls></audio>
```

Larger files go to R2 with `npm run r2:put -- ./big.mp4 media/big.mp4`:

```html
<video src="/media/big.mp4" controls playsinline preload="metadata"></video>
```

## WebAssembly apps

Link to an app uploaded under `apps/`: [launch the demo](/apps/demo/).

Apps that don't use threads can also be embedded inline:

```html
<iframe src="/apps/demo/" title="Demo" loading="lazy"></iframe>
```
