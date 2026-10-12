export interface ClientConfig {
  apiOrigin: string;
  siteOrigin: string;
}

/** Web keeps same-origin requests. Installed bundles explicitly configure HTTPS origins. */
export function clientConfig(): ClientConfig {
  return {
    apiOrigin: import.meta.env?.VITE_API_ORIGIN ?? '',
    siteOrigin: import.meta.env?.VITE_SITE_ORIGIN ?? 'https://ttcstatus.ca',
  };
}

export function apiUrl(path: string, origin = clientConfig().apiOrigin) {
  if (!/^\/api\//.test(path) || path.includes('\\'))
    throw new Error('Expected an API-relative path');
  if (!origin) return path;
  const base = new URL(origin);
  if (
    base.protocol !== 'https:' &&
    !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))
  )
    throw new Error('API origin must use HTTPS');
  return new URL(path, base.origin).href;
}
