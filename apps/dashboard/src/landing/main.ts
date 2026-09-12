/// <reference types="vite/client" />

// The landing page's only behaviour: resolve the documentation links. It creates no wallet, no
// RPC client, and imports no records — the recorded evidence lives on the operator desk, which
// reads it from the same checked-in files.
const repository = 'https://github.com/estmcmxci/signa-arc';

function publicDocsUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return `${repository}#readme`;
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : `${repository}#readme`;
  } catch { return `${repository}#readme`; }
}

// `data-docs` points at the documentation site; `data-docs-path` adds a page within it, so a
// link survives the site moving without hard-coding its host anywhere in the markup.
document.querySelectorAll<HTMLAnchorElement>('[data-docs]').forEach((a) => {
  const base = publicDocsUrl(import.meta.env['VITE_DOCS_URL']);
  const path = a.getAttribute('data-docs-path');
  a.href = path && !base.includes('#readme') ? new URL(path, base).href : base;
});
