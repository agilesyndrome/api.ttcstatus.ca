/** Build-time site identity, injected by vite.config.mjs `define`. The `typeof`
 * guards keep non-Vite bundlers (unit tests, Storybook) on placeholders instead
 * of throwing on an unresolved global. */
export const siteVersion =
  typeof __SITE_VERSION__ !== 'undefined' ? __SITE_VERSION__ : 'dev';
export const siteCommit = typeof __SITE_COMMIT__ !== 'undefined' ? __SITE_COMMIT__ : '';
export const siteCommitShort =
  typeof __SITE_COMMIT_SHORT__ !== 'undefined' ? __SITE_COMMIT_SHORT__ : '';
export const siteSourceUrl =
  typeof __SITE_SOURCE_URL__ !== 'undefined'
    ? __SITE_SOURCE_URL__
    : 'https://github.com/agilesyndrome/api.ttcstatus.ca';
