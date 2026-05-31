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

function boot() {
  try {
    const router = createRouter({
      history: createWebHistory(generateRouterBase('/apps/grimoire')),
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
