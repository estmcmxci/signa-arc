# Hosting the Signa Covenant docs

Preparation only. Nothing here has been deployed, no DNS record has been changed, and no hosting
project exists yet. Choosing the provider, the project and the domain needs credentials that this
work does not have; everything below is what to hand whoever has them.

## What is being hosted

A static site, and nothing else. `pnpm --filter @signa/docs build` writes
`apps/docs/dist/public`: HTML, assets, the per-page Markdown routes, `llms.txt` and
`llms-full.txt`. There is no server, no API route, no database and no runtime configuration, so
**the deployment needs no environment variables and holds no secrets.** Anything asking for one is
a sign something has gone wrong.

## The three settings any provider needs

| | |
|---|---|
| Root directory | the repository root, so the pnpm workspace resolves |
| Install command | `pnpm install --frozen-lockfile` |
| Build command | `pnpm --filter @signa/docs build` |
| Output directory | `apps/docs/dist/public` |
| Node | 22 or later |

`apps/docs/vercel.json` encodes exactly these, plus response headers. It is committed as a worked
example; the equivalent on Netlify is `netlify.toml` with `command`/`publish`, and on Cloudflare
Pages the same two fields in the dashboard. Nothing about the site depends on the provider.

## No rewrite rules are needed

The docs tell agents to fetch `/<page>.md`. Vocs' dev server answers those, but its static output
only writes the Markdown under `/assets/md/`, so a hosted site would 404 on precisely the routes
the docs advertise.

Rather than paper over that with provider-specific rewrites, which cannot be tested from here,
`scripts/agent-routes.ts` copies each twin to its own route at build time. `/quickstart.md` and
`/guides/send-and-reconcile.md` are real files in `dist/public`, so they work on any static host,
and the local preview serves what production would. `scripts/verify-build.ts` fails the build if
any route is missing.

## Headers

The header block in `vercel.json` does three things, none of them required for the site to work:

- serves `.md` routes as `text/markdown` and the `llms` indexes as `text/plain`, so an agent
  fetching them gets text rather than a download;
- caches `/assets/*` immutably, since those filenames are content-hashed, and revalidates the
  Markdown and text routes, which are not;
- sets `nosniff`, a referrer policy and HSTS.

## Preview it locally first

```bash
pnpm docs:build
pnpm docs:preview
```

That serves the real build output, including the agent routes. It is the closest thing to the
hosted site that can be checked without deploying, and it is what was checked.

## Still to decide, by someone with the credentials

- **The provider and project.** `vercel.json` is an example, not a decision.
- **The domain**, and its DNS. No record has been created or changed.
- **Whether a preview deployment should be public**, since the site describes a testnet deployment
  with labelled mock data.
