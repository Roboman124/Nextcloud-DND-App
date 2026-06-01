/**
 * Grimoire SDK (guest side) — `GRIM`.
 *
 * Addon developers import this inside their iframe app to talk to the host.
 * Mirrors the ergonomics of Owlbear's `OBR.*` namespaces. Every call returns a
 * Promise that resolves when the host replies. The host enforces permissions,
 * so a rejected promise usually means a missing permission in your manifest.
 *
 * Usage inside an addon:
 *   import { GRIM } from './grimoire-sdk.js';
 *   await GRIM.ready();
 *   const tool = await GRIM.tool.create({ id:'init', name:'Initiative', icon:'...' });
 *   GRIM.scene.onChange((items) => render(items));
 *   await GRIM.dice.roll('1d20');
 */
const pending = new Map();
let seq = 0;
const eventHandlers = new Map(); // event -> Set<fn>
let readyResolve;
const readyPromise = new Promise((r) => (readyResolve = r));

function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = 'r' + ++seq;
    pending.set(id, { resolve, reject });
    parent.postMessage({ __grimoire: true, kind: 'request', id, method, params }, '*');
  });
}

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (!msg || msg.__grimoire !== true) return;
  if (msg.kind === 'response') {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result);
  } else if (msg.kind === 'event') {
    if (msg.event === 'ready') readyResolve();
    const set = eventHandlers.get(msg.event);
    if (set) for (const fn of set) fn(msg.data);
  }
});

function on(event, fn) {
  if (!eventHandlers.has(event)) eventHandlers.set(event, new Set());
  eventHandlers.get(event).add(fn);
  return () => eventHandlers.get(event)?.delete(fn);
}

// Announce we're alive so the host can flush the initial 'ready' event.
parent.postMessage({ __grimoire: true, kind: 'hello' }, '*');

export const GRIM = {
  /** Resolves once the host has acknowledged this addon. */
  ready: () => readyPromise,

  scene: {
    getItems: () => request('scene.getItems'),
    addItem: (item) => request('scene.addItem', item),
    updateItem: (id, patch) => request('scene.updateItem', { id, patch }),
    deleteItem: (id) => request('scene.deleteItem', { id }),
    onChange: (fn) => on('scene:change', fn),
  },

  tool: {
    create: (def) => request('tool.create', def),
    /** Host calls back through events when your tool is activated/clicked. */
    onClick: (toolId, fn) => on('tool:click:' + toolId, fn),
  },

  /** Add a button to the app sidebar that opens this addon's panel. */
  action: {
    create: (def) => request('action.create', def),
    onOpen: (fn) => on('action:open', fn),
  },

  dice: {
    roll: (notation, opts) => request('dice.roll', { notation, ...opts }),
    onResult: (fn) => on('dice:result', fn),
  },

  broadcast: {
    send: (channel, payload) => request('broadcast.send', { channel, payload }),
    on: (channel, fn) => on('broadcast:' + channel, fn),
  },

  /** Per-addon persisted key/value store (scoped & namespaced by the host). */
  metadata: {
    get: (key) => request('metadata.get', { key }),
    set: (key, value) => request('metadata.set', { key, value }),
  },

  notification: {
    show: (text, variant = 'info') => request('notification.show', { text, variant }),
  },

  party: {
    onChange: (fn) => on('party:change', fn),
  },
};

export default GRIM;
