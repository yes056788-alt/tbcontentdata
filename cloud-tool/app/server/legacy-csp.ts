const INLINE_STYLE_LEGACY_PAGES = new Set([
  "data.html",
  "report-view.html",
]);

export function legacyContentSecurityPolicy(filename = "") {
  const styleSource = INLINE_STYLE_LEGACY_PAGES.has(filename)
    ? "style-src 'self' 'unsafe-inline'"
    : "style-src 'self'";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self'",
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "img-src 'self' data: blob:",
    "object-src 'none'",
    "script-src 'self'",
    styleSource,
  ].join("; ");
}
