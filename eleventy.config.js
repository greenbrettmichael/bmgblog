import { eleventyImageTransformPlugin } from "@11ty/eleventy-img";

// Non-image media that sits next to a post's index.md and is copied as-is.
// Images are handled by the image transform below (resized + avif/webp).
const MEDIA_EXTENSIONS = "mp4,webm,mov,mp3,ogg,wav,pdf,glb,gltf,zip";

export default function (eleventyConfig) {
  // `draft: true` pages show up in `npm run dev` but are left out of production builds.
  eleventyConfig.addPreprocessor("drafts", "*", (data) => {
    if (data.draft && process.env.ELEVENTY_RUN_MODE === "build") {
      return false;
    }
  });

  // Every <img> in the output is resized and re-encoded. Relative srcs resolve
  // against the source file, so `![alt](photo.jpg)` in a post folder just works.
  eleventyConfig.addPlugin(eleventyImageTransformPlugin, {
    formats: ["avif", "webp", "auto"],
    widths: [720, 1440, "auto"],
    svgShortCircuit: true,
    sharpOptions: { animated: true },
    htmlOptions: {
      imgAttributes: {
        loading: "lazy",
        decoding: "async",
        sizes: "(min-width: 46rem) 44rem, 100vw",
      },
    },
  });

  eleventyConfig.addPassthroughCopy("src/assets");
  eleventyConfig.addPassthroughCopy(`src/{posts,projects}/**/*.{${MEDIA_EXTENSIONS}}`);

  eleventyConfig.addFilter("head", (array, n) => array.slice(0, n));
  eleventyConfig.addFilter("isoDate", (date) => date.toISOString().slice(0, 10));
  eleventyConfig.addFilter("longDate", (date) =>
    date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }),
  );

  return {
    dir: { input: "src", includes: "_includes", data: "_data" },
    markdownTemplateEngine: "njk",
  };
}
