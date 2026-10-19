// Scaffolds a post or project folder.
//   npm run new -- "Post title"
//   npm run new -- --project "Project title"
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
const isProject = args[0] === "--project";
const title = (isProject ? args.slice(1) : args).join(" ").trim();
if (!title) {
  console.error('Usage: npm run new -- [--project] "Title"');
  process.exit(1);
}

const slug = title
  .toLowerCase()
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");
const date = new Date().toISOString().slice(0, 10);
const dir = `src/${isProject ? "projects" : "posts"}/${slug}`;

if (existsSync(dir)) {
  console.error(`${dir} already exists`);
  process.exit(1);
}

const frontMatter = [
  "---",
  `title: ${JSON.stringify(title)}`,
  `date: ${date}`,
  ...(isProject ? ['description: ""', `app: /apps/${slug}/`] : []),
  "draft: true",
  "---",
  "",
  "",
].join("\n");

mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/index.md`, frontMatter);
console.log(`${dir}/index.md`);
if (isProject) {
  console.log(`Upload the build with: npm run r2:put -- <build-dir> apps/${slug}`);
}
