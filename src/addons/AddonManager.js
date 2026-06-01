/**
 * AddonManager (host side).
 *
 * Grimoire's extensibility, modeled on Owlbear Rodeo's approach: an addon is a
 * web app described by a manifest.json. The host loads each addon in a
 * sandboxed <iframe> and talks to it over postMessage. This isolates third-
 * party code (it can't touch the DOM or other addons) while still letting it
 * add tools, draw on the scene, store metadata, and react to events through a
 * narrow, audited API surface.
 *
 * Manifest shape (hosted anywhere, loaded by URL):
 * {
 *   "name": "Initiative Tracker",
 *   "version": "1.0.0",
 *   "author": "you",
 *   "icon": "https://.../icon.svg",
 *   "main": "https://.../index.html",     // popover / panel UI
 *   "background": "https://.../bg.html",  // optional headless logic
 *   "permissions": ["scene:read","scene:write","tool","broadcast","metadata","dice"]
 * }
 *
 * Security: every capability an addon uses must be declared in `permissions`.
 * The host enforces them on each incoming message. Nothing is granted by
 * default.
 */
export class AddonManager {
  constructor({ host, capabilities }) {
    // `host` implements the real operations (scene access, dice, etc.).
    // `capabilities` is the bridge between addon requests and host actions.
    this.host = host;
    this.capabilities = capabilities; // { sceneRead, sceneWrite, broadcast, ... }
    this.addons = new Map();          // id -> { manifest, frame, permissions }
    this._onMessage = this._onMessage.bind(this);
    window.addEventListener('message', this._onMessage);
  }

  async install(manifestUrl) {
    const manifest = await fetch(manifestUrl).then((r) => {
      if (!r.ok) throw new Error(`manifest fetch ${r.status}`);
      return r.json();
    });
    const id = slug(manifest.name) + '@' + manifest.version;
    if (this.addons.has(id)) return id;
    // Resolve the manifest's own URL so we can fetch sibling files (main, sdk).
    manifest._baseUrl = new URL('.', manifestUrl).href;
    this.addons.set(id, { manifest, frame: null, permissions: new Set(manifest.permissions || []) });
    return id;
  }

  /**
   * Mount an addon's UI. We do NOT point the iframe.src at the remote URL —
   * many hosts (GitHub raw, etc.) send X-Frame-Options/CSP that forbid framing,
   * which is what causes "refused to connect". Instead we FETCH the addon's HTML
   * as text and load it via `srcdoc`, which runs as an opaque-origin document
   * not subject to the remote server's framing headers. The SDK import is
   * rewritten to an absolute URL (or inlined) so it still resolves.
   */
  async open(id, container) {
    const a = this.addons.get(id);
    if (!a) throw new Error('Unknown addon ' + id);
    const frame = document.createElement('iframe');
    frame.sandbox = 'allow-scripts allow-forms allow-popups';
    frame.style.cssText = 'width:100%;height:100%;border:0;background:transparent';
    frame.dataset.addonId = id;

    let html;
    try {
      html = await fetch(a.manifest.main).then((r) => {
        if (!r.ok) throw new Error(`main fetch ${r.status}`);
        return r.text();
      });
    } catch (e) {
      throw new Error(`couldn't load addon UI: ${e.message}. Host it somewhere fetchable (CORS-enabled).`);
    }

    // The SDK is normally imported with `import { GRIM } from './grimoire-sdk.js'`.
    // A cross-origin import (e.g. from GitHub raw) fails on MIME type, so we
    // fetch the SDK text and INLINE it: strip the import line and prepend the
    // SDK source (with its `export`s removed) so `GRIM` is just in scope.
    let sdkSource = '';
    try {
      const sdkUrl = new URL('grimoire-sdk.js', a.manifest._baseUrl).href;
      sdkSource = await fetch(sdkUrl).then((r) => (r.ok ? r.text() : ''));
    } catch { /* fall through; addon may not use the SDK */ }
    if (sdkSource) {
      // Remove ES export keywords so the source can be inlined into a module.
      sdkSource = sdkSource
        .replace(/export\s+const\s+GRIM/g, 'const GRIM')
        .replace(/export\s+default\s+GRIM\s*;?/g, '');
      // Drop the addon's own import of the SDK; GRIM will already be in scope.
      html = html.replace(
        /import\s*\{?\s*GRIM\s*\}?\s*from\s*['"](\.\/)?grimoire-sdk\.js['"]\s*;?/g,
        ''
      );
      // Prepend the SDK into the first module script.
      html = html.replace(
        /<script\s+type=["']module["']\s*>/i,
        (m) => `${m}\n/* --- inlined Grimoire SDK --- */\n${sdkSource}\n/* --- end SDK --- */\n`
      );
    }

    // Give the addon document its OWN permissive CSP. A sandboxed iframe would
    // otherwise inherit Nextcloud's strict nonce-based CSP, which blocks the
    // addon's inline <script> (and a <base> tag) entirely. We load the HTML as
    // a blob: URL so it's a real document with an opaque origin that honours
    // this meta CSP instead of the host page's.
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; img-src * data: blob:; connect-src *;">`;
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head([^>]*)>/i, `<head$1>${csp}`);
    } else {
      html = csp + html;
    }

    const blob = new Blob([html], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(blob);
    a._blobUrl = blobUrl;
    // Sandboxed but WITHOUT allow-same-origin, so the frame's origin is opaque
    // and cannot reach the user's Nextcloud session; scripts still run.
    frame.src = blobUrl;
    a.frame = frame;
    container.appendChild(frame);
    frame.addEventListener('load', () => {
      try {
        frame.contentWindow?.postMessage({ __grimoire: true, kind: 'event', event: 'ready' }, '*');
      } catch { /* ignore */ }
    });
    return frame;
  }

  close(id) {
    const a = this.addons.get(id);
    if (a?.frame) { a.frame.remove(); a.frame = null; }
    if (a?._blobUrl) { URL.revokeObjectURL(a._blobUrl); a._blobUrl = null; }
  }

  uninstall(id) { this.close(id); this.addons.delete(id); }

  /** Push a scene/dice/party event out to every addon that may care. */
  emit(event, data) {
    for (const [id, a] of this.addons) {
      if (!a.frame) continue;
      a.frame.contentWindow?.postMessage(
        { __grimoire: true, kind: 'event', event, data }, '*'
      );
    }
  }

  _addonForFrame(source) {
    for (const a of this.addons.values()) {
      if (a.frame && a.frame.contentWindow === source) return a;
    }
    return null;
  }

  async _onMessage(e) {
    const msg = e.data;
    if (!msg || msg.__grimoire !== true) return;

    // Handshake: an addon announces itself with `hello`; reply with `ready` so
    // its `await GRIM.ready()` resolves. Without this every addon hangs on the
    // first await and never wires up its UI.
    if (msg.kind === 'hello') {
      const a = this._addonForFrame(e.source);
      if (a) {
        e.source.postMessage({ __grimoire: true, kind: 'event', event: 'ready' }, '*');
        a._ready = true;
      }
      return;
    }

    if (msg.kind !== 'request') return;
    const addon = this._addonForFrame(e.source);
    if (!addon) return; // message not from a known addon frame

    const { id, method, params } = msg;
    const reply = (result, error) =>
      e.source.postMessage({ __grimoire: true, kind: 'response', id, result, error }, '*');

    // Map API method -> required permission.
    const PERM = {
      'scene.getItems': 'scene:read',
      'scene.addItem': 'scene:write',
      'scene.updateItem': 'scene:write',
      'scene.deleteItem': 'scene:write',
      'tool.create': 'tool',
      'action.create': 'tool',
      'broadcast.send': 'broadcast',
      'metadata.get': 'metadata',
      'metadata.set': 'metadata',
      'dice.roll': 'dice',
      'notification.show': '*', // always allowed
    };
    const needed = PERM[method];
    if (needed === undefined) return reply(null, 'Unknown method ' + method);
    if (needed !== '*' && !addon.permissions.has(needed)) {
      return reply(null, `Permission denied: ${method} requires "${needed}"`);
    }

    try {
      const result = await this._dispatch(addon, method, params);
      reply(result);
    } catch (err) {
      reply(null, String(err?.message || err));
    }
  }

  _dispatch(addon, method, params) {
    const c = this.capabilities;
    switch (method) {
      case 'scene.getItems': return c.sceneRead();
      case 'scene.addItem': return c.sceneWrite('add', params);
      case 'scene.updateItem': return c.sceneWrite('update', params);
      case 'scene.deleteItem': return c.sceneWrite('delete', params);
      case 'tool.create': return c.createTool(addon, params);
      case 'action.create': return c.createAction(addon, params);
      case 'broadcast.send': return c.broadcast(params);
      case 'metadata.get': return c.metadataGet(addon, params);
      case 'metadata.set': return c.metadataSet(addon, params);
      case 'dice.roll': return c.diceRoll(params);
      case 'notification.show': return c.notify(params);
      default: throw new Error('Unhandled ' + method);
    }
  }

  destroy() { window.removeEventListener('message', this._onMessage); }
}

function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
