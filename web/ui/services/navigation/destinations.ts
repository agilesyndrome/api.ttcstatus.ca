/** Only our own app routes can be opened by a share link or notification. */
export function internalDestination(
  input: string,
  currentOrigin: string,
  siteOrigin: string,
): string | undefined {
  try {
    const current = new URL(currentOrigin);
    const site = new URL(siteOrigin);
    const url = new URL(input, current);
    // Custom WKWebView schemes can have an opaque URL.origin. Compare scheme
    // and host instead of treating every opaque origin as the same application.
    const sameHost = (base: URL) =>
      url.protocol === base.protocol && url.host === base.host;
    if (url.username || url.password || (!sameHost(current) && !sameHost(site))) return;
    const path = url.pathname.replace(/\/$/, '') || '/';
    if (
      !['/', '/settings', '/profile', '/sla', '/snake', '/snake/v2'].includes(path) &&
      !/^\/u\/[^/]+$/.test(path)
    )
      return;
    return `${path}${url.search}${url.hash}`;
  } catch {
    return;
  }
}
