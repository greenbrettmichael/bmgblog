# bmgblog

Personal blog. Eleventy builds static HTML from `src/`; Cloudflare Workers serves it; large files
(WebAssembly apps, big videos) live in R2 and are served under `/apps/` and `/media/`.
See `CLAUDE.md` for day-to-day commands.

## One-time setup

1. Install Node 24 (`nvm install` reads `.nvmrc`), then `npm install`.
2. `npx wrangler login`
3. `npx wrangler r2 bucket create bmgblog-files`
4. `npm run deploy` for the first deploy; it prints the `*.workers.dev` URL.
5. Custom domain: uncomment `routes` in `wrangler.jsonc` with your hostname and deploy again.
6. GitHub Actions deploys: create a Cloudflare API token from the "Edit Cloudflare Workers" template
   (it includes Workers Scripts and Workers R2 Storage edit permissions), then add repository secrets
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
