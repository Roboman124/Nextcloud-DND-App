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
    const manifest = await fetch(manifestUrl).then((r) => r.json());
    const id = slug(manifest.name) + '@' + manifest.version;
    if (this.addons.has(id)) return id;
    this.addons.set(id, { manifest, frame: null, permissions: new Set(manifest.permissions || []) });
    return id;
  }

  /** Mount an addon's UI into a container (popover / side panel). */
  open(id, container) {
    const a = this.addons.get(id);
    if (!a) throw new Error('Unknown addon ' + id);
    const frame = document.createElement('iframe');
    frame.src = a.manifest.main;
    // Sandboxed: scripts run, but no same-origin access to the host page.
    frame.sandbox = 'allow-scripts allow-forms allow-popups';
    frame.style.cssText = 'width:100%;height:100%;border:0;background:transparent';
    frame.dataset.addonId = id;
    container.appendChild(frame);
    a.frame = frame;
    return frame;
  }

  close(id) {
    const a = this.addons.get(id);
    if (a?.frame) { a.frame.remove(); a.frame = null; }
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
    if (!msg || msg.__grimoire !== true || msg.kind !== 'request') return;
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
