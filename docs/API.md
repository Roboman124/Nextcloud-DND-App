# Grimoire Plugin SDK — API Reference

The SDK is a single dependency-free module
([`src/addons/sdk/grimoire-sdk.js`](../src/addons/sdk/grimoire-sdk.js)) exposing
a global `GRIM` object. Import it inside your plugin's iframe:

```js
import { GRIM } from './grimoire-sdk.js';
```

All request methods return a `Promise`. All `on*` subscription methods return an
**unsubscribe function**. The host enforces permissions per call; a rejected
promise's message names the permission you're missing.

---

## `GRIM.ready()`

```js
await GRIM.ready();
```

Resolves once the host has acknowledged your plugin frame. Call it before any
other API call. No permission required.

---

## `GRIM.scene`

The scene is the set of items (tokens, etc.) on the current table. Item shapes
are whatever Grimoire stores per token — at minimum an `id`; commonly `x`, `y`,
`label`, `size`, `color`, and (for 3D) `url`/`z`.

| Method | Permission | Returns | Notes |
| --- | --- | --- | --- |
| `scene.getItems()` | `scene:read` | `Promise<Item[]>` | Snapshot of all items. |
| `scene.addItem(item)` | `scene:write` | `Promise<Item>` | Adds to both 2D and 3D scenes. |
| `scene.updateItem(id, patch)` | `scene:write` | `Promise<Item>` | Shallow-merges `patch`. |
| `scene.deleteItem(id)` | `scene:write` | `Promise<void>` | Removes from both scenes. |
| `scene.onChange(fn)` | — | `() => void` | `fn(change)` on any scene mutation (local or remote). |

```js
const tokens = await GRIM.scene.getItems();
await GRIM.scene.addItem({ id: 'goblin1', x: 5, y: 3, label: 'Goblin', color: '#3a3' });
await GRIM.scene.updateItem('goblin1', { x: 6 });
const off = GRIM.scene.onChange((c) => console.log('scene changed', c));
// later: off();
```

---

## `GRIM.tool`

Register a tool that appears in the room toolbar. When the user activates it and
clicks the canvas, the host calls your click handler with the world coordinate.

| Method | Permission | Returns |
| --- | --- | --- |
| `tool.create(def)` | `tool` | `Promise<void>` |
| `tool.onClick(toolId, fn)` | — | `() => void` |

`def` = `{ id, name, icon }`. `fn(world)` receives `{ x, y }` (2D) or
`{ x, y, z }` (3D).

```js
await GRIM.tool.create({ id: 'ping', name: 'Ping', icon: '📍' });
GRIM.tool.onClick('ping', (world) => {
  GRIM.broadcast.send('ping', world);
});
```

---

## `GRIM.dice`

Rolls use Grimoire's real cannon-es physics dice — the value is read off how the
die actually settles, not `Math.random()`.

| Method | Permission | Returns |
| --- | --- | --- |
| `dice.roll(notation, opts?)` | `dice` | `Promise<{ total, rolls }>` |
| `dice.onResult(fn)` | — | `() => void` |

`notation` is standard dice notation, e.g. `'1d20'`, `'2d6+3'`, `'4d8'`.
`onResult(fn)` fires for any dice settled in the room, including other players'.

```js
const r = await GRIM.dice.roll('2d20+1d6');
console.log(r.total, r.rolls);
GRIM.dice.onResult((r) => console.log('someone rolled', r.total));
```

---

## `GRIM.broadcast`

Room-wide messaging on a channel name you choose. Use it to coordinate state
between every copy of your plugin in the room.

| Method | Permission | Returns |
| --- | --- | --- |
| `broadcast.send(channel, payload)` | `broadcast` | `Promise<void>` |
| `broadcast.on(channel, fn)` | — | `() => void` |

```js
GRIM.broadcast.send('initiative', { order: [...] });
const off = GRIM.broadcast.on('initiative', (payload) => render(payload.order));
```

---

## `GRIM.metadata`

A private, persisted key/value store, namespaced to your plugin. Other plugins
can't read it.

| Method | Permission | Returns |
| --- | --- | --- |
| `metadata.get(key)` | `metadata` | `Promise<any>` |
| `metadata.set(key, value)` | `metadata` | `Promise<void>` |

```js
await GRIM.metadata.set('config', { autoRoll: true });
const cfg = await GRIM.metadata.get('config');
```

---

## `GRIM.notification`

Show a transient notification in the host UI. **Always allowed** — no permission
needed.

```js
GRIM.notification.show('Initiative rolled!', 'success'); // variant: info|success|warning|error
```

---

## `GRIM.party`

| Method | Permission | Returns |
| --- | --- | --- |
| `party.onChange(fn)` | — | `() => void` |

`fn(players)` fires when the room roster changes.

```js
GRIM.party.onChange((players) => console.log('in room:', players));
```

---

## Errors & permissions

When a call needs a permission your manifest doesn't declare, the host rejects
the promise:

```js
try {
  await GRIM.scene.addItem({ id: 'x' });
} catch (e) {
  // e.message === 'Permission denied: scene.addItem requires "scene:write"'
}
```

Add the permission to `manifest.json`, bump `version`, and reinstall.

## Message protocol (for reference)

Under the hood the SDK speaks a tiny JSON protocol over `postMessage`. You don't
need this to write a plugin, but it's documented for transparency and for anyone
porting the SDK to another language/runtime:

- Plugin → host: `{ __grimoire: true, kind: 'request', id, method, params }`
- Host → plugin: `{ __grimoire: true, kind: 'response', id, result, error }`
- Host → plugin (events): `{ __grimoire: true, kind: 'event', event, data }`
- On load the SDK sends `{ __grimoire: true, kind: 'hello' }`; the host replies
  with a `ready` event.
