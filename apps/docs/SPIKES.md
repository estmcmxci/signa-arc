# Vocs spike: first P0 slice

Pinned: `vocs` 2.9.0, `vite` 8.3.0, `waku` 1.0.0-rc.0, `react` and `react-dom` 19.2.8. Node 24.1.0, pnpm 10.17.1.

| Area | Result |
|---|---|
| Runtime requirements | Vocs 2.9.0 lists `vite` and `waku` as optional peers but imports `waku` at runtime: without it, `vocs --help` fails with `ERR_MODULE_NOT_FOUND`. `waku` 1.0.0-rc.0 requires React `~19.2.4`, so React is pinned to 19.2.8 rather than the latest 19.3.0. |
| Workspace isolation | `apps/docs` installs its own vite 8.3.0. The dashboard keeps vite 7.3.6 and builds unchanged. The docs have their own `tsconfig.json`, and the root configuration excludes `apps/docs/**`. |
| Configuration | `vocs.config.ts`, using `defineConfig` from `vocs/config`. Pages live in `src/pages`: the defaults are `srcDir: "src"` and `pagesDir: "pages"`. `renderStrategy` defaults to `dynamic`, so the site sets `full-static`. |
| Build output | `vocs build` writes the static site to `apps/docs/dist/public`, about 12 MB, mostly syntax-highlighting assets. It also writes an SSR bundle to `dist/server`, which static hosting does not need. `dist/` is gitignored. A local build takes about 10 s. |
| Preview | `vocs preview [--port <n>]` serves the build from a Node server. |
| `llms.txt` | Generated from each page's frontmatter `title` and `description`, one line per page. `llms-full.txt` contains every page as Markdown. |
| Markdown routes | The static build writes each page's Markdown to `/assets/md/<page>.md`. The Vocs server serves `/<page>.md` from those files, and serves Markdown for page routes when the user agent is a terminal or an AI agent, or asks for `text/markdown`. `vocs preview` showed this for `/evidence.md`, `/index.md`, `/` and `/evidence`. A static host needs a rewrite from `/<page>.md` to `/assets/md/<page>.md`: a P2 hosting decision. Vocs also ships a Vercel adapter (`vocs/waku/internal/patches/adapters/vercel`), not tested here. |
| Local paths | Vocs 2.9.0 writes build-machine paths into the static output. Each search document's `id` is the page's absolute file path, and the client bundle serializes the resolved config, whose `rootDir` and `cacheDir` are always absolute. No option controls either. `scripts/relativize-build.ts` rewrites them relative to the repository root as part of `build`. `verify-build.ts` fails if any text asset still holds the repository root, the home directory, `/Users/` or `/home/`. The one exception is the literal `/home/user/`, in the bundled OpenAPI playground chunk only: those are the library's file-picker examples, and this site loads no OpenAPI pages. |
| Directives | `:::warning` stays a literal directive in the generated Markdown. |
| Search | A MiniSearch index is built into `assets/search-index-*.json`. |
| Checks | `pnpm docs:check` typechecks the docs and builds them. It then runs `scripts/verify-build.ts`, which checks that every page and its Markdown twin exist, checks both llms files, and scans the text output for secret-shaped strings and private document names. |
