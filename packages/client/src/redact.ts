/**
 * An RPC URL fit for output and diagnostics (ERD C-02). Credentials, query values and path
 * segments that look like API keys are replaced with `redacted`.
 */
export function redactRpcUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "<unparseable URL>";
  }
  if (url.username) url.username = "redacted";
  if (url.password) url.password = "redacted";
  for (const key of new Set(url.searchParams.keys())) url.searchParams.set(key, "redacted");
  url.pathname = url.pathname
    .split("/")
    .map((segment) => (/^[A-Za-z0-9_-]{16,}$/.test(segment) ? "redacted" : segment))
    .join("/");
  url.hash = "";
  const text = url.toString();
  return url.pathname === "/" && !url.search ? text.replace(/\/$/, "") : text;
}
