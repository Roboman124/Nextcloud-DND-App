/**
 * URL helpers — a defensive replacement for @nextcloud/router's generateUrl.
 *
 * Why this exists: when this app is shipped as a single bundled IIFE loaded via
 * a plain <script>, @nextcloud/router can evaluate the server webroot at MODULE
 * INIT time, before Nextcloud's globals are guaranteed present. On some
 * Nextcloud versions that throws and aborts the whole bundle (blank page).
 *
 * These helpers read the webroot LAZILY (only when called) from whatever
 * Nextcloud exposes, with safe fallbacks, so a missing global degrades to a
 * sensible default instead of crashing the app before it mounts.
 */

/** Best-effort Nextcloud web root, e.g. '' or '/nextcloud'. Read lazily. */
export function getWebroot() {
  // Nextcloud exposes the webroot in a few ways across versions.
  if (typeof window !== 'undefined') {
    if (typeof window._oc_webroot === 'string') return window._oc_webroot;
    if (window.OC && typeof window.OC.webroot === 'string') return window.OC.webroot;
    if (window.OC && typeof window.OC.getRootPath === 'function') {
      try { return window.OC.getRootPath(); } catch { /* ignore */ }
    }
  }
  return '';
}

/**
 * Build an absolute path for an index.php route, mirroring generateUrl().
 * @param {string} path e.g. '/apps/grimoire/api/campaigns'
 */
export function generateUrl(path) {
  const root = getWebroot();
  const clean = path.startsWith('/') ? path : '/' + path;
  // Nextcloud routes resolve under index.php; this matches @nextcloud/router's
  // default (no pretty-URL assumption needed for API/XHR calls).
  return root + '/index.php' + clean;
}

/**
 * Build a path WITHOUT the index.php segment — used as the vue-router history
 * base so the address bar shows /apps/grimoire/... cleanly. vue-router only
 * needs a consistent base prefix; it does not need index.php.
 * @param {string} path e.g. '/apps/grimoire'
 */
export function generateRouterBase(path) {
  const root = getWebroot();
  const clean = path.startsWith('/') ? path : '/' + path;
  return root + clean;
}

/**
 * Build an absolute URL for a Nextcloud "remote" endpoint (e.g. WebDAV),
 * mirroring @nextcloud/router's generateRemoteUrl(). Returns e.g.
 *   https://cloud.example.com/remote.php/dav/
 * The caller appends `files/<user>/<path>`.
 * @param {string} service e.g. 'dav'
 */
export function generateRemoteUrl(service) {
  const root = getWebroot();
  return root + '/remote.php/' + service + '/';
}
