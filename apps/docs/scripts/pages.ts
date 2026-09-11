/**
 * The allowlist of pages the site publishes (ERD §9, P2).
 *
 * This is the single list the build verifier, the hosting configuration and the docs tests all
 * read, so a page cannot appear in one and be missing from another. Nothing outside it is
 * published: Vocs is pointed at `src/pages` only, and repository Markdown is never ingested.
 */

export type Page = {
  /** The route the site serves, without an extension. */
  route: string;
  /** The rendered HTML in the static build. */
  html: string;
  /** The Markdown twin the static build writes, which agents read. */
  markdown: string;
  /** The source file under `src/pages`. */
  source: string;
};

const page = (route: string, source: string): Page => ({
  route,
  html: route === "/index" ? "index.html" : `${route.replace(/^\//, "")}/index.html`,
  markdown: `assets/md${route}.md`,
  source,
});

export const PAGES: readonly Page[] = [
  page("/index", "index.md"),
  page("/run-locally", "run-locally.md"),
  page("/quickstart", "quickstart.md"),
  page("/install", "install.md"),
  page("/agents", "agents.md"),
  page("/guides/inspect-a-facility", "guides/inspect-a-facility.md"),
  page("/guides/explain-a-refused-draw", "guides/explain-a-refused-draw.md"),
  page("/guides/submit-a-credential", "guides/submit-a-credential.md"),
  page("/guides/send-and-reconcile", "guides/send-and-reconcile.md"),
  page("/reference/commands", "reference/commands.md"),
  page("/reference/errors", "reference/errors.md"),
  page("/reference/envelope", "reference/envelope.md"),
  page("/reference/deployment", "reference/deployment.md"),
  page("/evidence", "evidence.md"),
];

/** The plain-text indexes agents fetch alongside the pages. */
export const AGENT_FILES = ["llms.txt", "llms-full.txt"] as const;
