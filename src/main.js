/**
 * Frontend entry. Boots the Vue SPA into #grimoire-app. Uses a locally-computed
 * router base (see src/lib/url.js) so we never depend on @nextcloud/router
 * resolving the webroot at module-init time, which can crash the bundle.
 */
import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import Campaigns from './views/Campaigns.vue';
import Room from './views/Room.vue';
import { generateRouterBase } from './lib/url.js';

function showFatal(err) {
  // Make a mount failure visible instead of a blank Nextcloud content area.
  const el = document.getElementById('grimoire-app') || document.body;
  const msg = (err && (err.stack || err.message)) || String(err);
  el.innerHTML =
    '<div style="position:absolute;inset:0;display:flex;align-items:center;' +
    'justify-content:center;padding:32px;background:#14181f;color:#f3d9a0;' +
    'font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;' +
    'overflow:auto;z-index:9999">Grimoire failed to start:\n\n' +
    msg.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;')) +
    '</div>';
  // eslint-disable-next-line no-console
  console.error('[grimoire] boot failed', err);
}

/**
 * The router base is the app path as THIS browser actually sees it, not an
 * assumed web path. Servers differ in how the SPA is reached: pretty URLs
 * serve /<webroot>/apps/grimoire/… while front-controller installs serve
 * /<webroot>/index.php/apps/grimoire/…. The previously hardcoded
 * '/apps/grimoire' base never matched on front-controller instances — no
 * route resolved, the app rendered blank, and router-pushed paths (with the
 * base spliced in) 404ed on reload.
 */
function computeRouterBase() {
  const marker = '/apps/grimoire';
  if (typeof window !== 'undefined' && window.location) {
    const path = window.location.pathname.toLowerCase();
    const pos = path.indexOf(marker);
    if (pos !== -1) {
      // Keep whatever serving prefix the server actually used (including an
      // /index.php front-controller prefix or a deeper webroot).
      return window.location.pathname.slice(0, pos) + marker;
    }
  }
  return generateRouterBase(marker);
}

function boot() {
  try {
    const router = createRouter({
      history: createWebHistory(computeRouterBase()),
      routes: [
        { path: '/', name: 'campaigns', component: Campaigns },
        { path: '/c/:campaignId/s/:sceneId', name: 'room', component: Room, props: true },
      ],
    });
    createApp(App).use(router).mount('#grimoire-app');
  } catch (err) {
    showFatal(err);
  }
}

// The bundle is an IIFE and may execute before the DOM is parsed.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
