# Writing Grimoire Plugins

Grimoire is extensible the same way Owlbear Rodeo is: a **plugin** (we use
"plugin", "addon", and "extension" interchangeably) is just a small web page,
described by a `manifest.json`, that Grimoire loads inside a sandboxed iframe.
Your plugin talks to the table through a permissioned message bridge exposed as
a global `GRIM` object. It can read and change the scene, add toolbar tools,
roll real physics dice, broadcast messages to everyone in the room, store its
own data, and react to events — but only the capabilities it declares in its
manifest, and nothing else.

This guide is everything you need to ship one. For the exact method signatures
see [`API.md`](./API.md); for a complete working plugin see
[`examples/initiative-tracker/`](../examples/initiative-tracker/).

---

## How plugins work (the model)

```
┌─────────────────────────── Grimoire (host page) ───────────────────────────┐
│                                                                             │
│   AddonManager                                                              │
│     • fetches your manifest.json                                            │
│     • mounts manifest.main in a sandboxed <iframe>                          │
│     • routes postMessage requests, enforcing your declared permissions      │
│     • pushes scene / dice / party events to your plugin                     │
│                                                                             │
│   ┌──────────────── your plugin (sandboxed iframe) ────────────────┐        │
│   │  import { GRIM } from './grimoire-sdk.js'                       │        │
│   │  await GRIM.ready()                                             │        │
│   │  GRIM.scene.getItems()  ─ request ─▶  host checks "scene:read"  │        │
│   │  GRIM.scene.onChange(fn) ◀─ event ──  host emits "scene:change" │        │
│   └────────────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
```

Key properties that follow from this design:

- **Isolation.** Your plugin runs in a sandboxed iframe with
  `allow-scripts allow-forms allow-popups`. It cannot read Grimoire's DOM, other
  plugins, cookies, or the user's Nextcloud session. The only channel out is the
  `GRIM` bridge.
- **Least privilege.** Every API call maps to a permission. The host checks the
  permission on *every* message. If your manifest doesn't declare it, the call's
  promise rejects with `Permission denied`. Nothing is granted by default.
- **Host-agnostic UI.** Your plugin is your own HTML/CSS/JS. Use any framework
  or none. Grimoire just gives it a frame to live in.

---

## Quick start

A plugin is three things: a manifest, an entry HTML page, and the SDK.

### 1. `manifest.json`

```json
{
  "name": "Initiative Tracker",
  "version": "1.0.0",
  "author": "you",
  "icon": "https://your.host/icon.svg",
  "main": "https://your.host/index.html",
  "background": "https://your.host/bg.html",
  "permissions": ["scene:read", "tool", "broadcast", "metadata", "dice"]
}
```

| Field         | Required | Meaning                                                        |
| ------------- | -------- | -------------------------------------------------------------- |
| `name`        | yes      | Display name. Combined with `version` to form the plugin id.   |
| `version`     | yes      | Semver string. Bump it to force a reinstall of a new build.    |
| `main`        | yes      | URL of the page mounted when the user opens your plugin.       |
| `author`      | no       | Shown in the plugin list.                                      |
| `icon`        | no       | URL of an icon shown in the list / toolbar.                    |
| `background`  | no       | Optional headless page for logic that should run without UI.   |
| `permissions` | no       | Array of capability strings (see below). Omitted = none.       |

> All URLs are absolute and can be hosted anywhere reachable by the browser —
> GitHub Pages, your own server, a Nextcloud public share, etc. Grimoire's
> Content-Security-Policy is deliberately widened to allow third-party frames.

### 2. `index.html` (your `main`)

```html
<!doctype html>
<html>
  <body style="margin:0;font-family:system-ui;color:#eee;background:#14181f">
    <h3>Initiative</h3>
    <button id="roll">Roll initiative for all tokens</button>
    <ol id="order"></ol>

    <script type="module">
      import { GRIM } from './grimoire-sdk.js';

      await GRIM.ready();

      document.getElementById('roll').onclick = async () => {
        const tokens = await GRIM.scene.getItems();        // needs scene:read
        const rolls = [];
        for (const t of tokens) {
          const r = await GRIM.dice.roll('1d20');           // needs dice
          rolls.push({ name: t.label || t.id, value: r.total });
        }
        rolls.sort((a, b) => b.value - a.value);

        const ol = document.getElementById('order');
        ol.innerHTML = '';
        for (const r of rolls) {
          const li = document.createElement('li');
          li.textContent = `${r.name}: ${r.value}`;
          ol.appendChild(li);
        }

        GRIM.broadcast.send('initiative', { order: rolls }); // needs broadcast
      };
    </script>
  </body>
</html>
```

### 3. Ship the SDK alongside it

Copy [`src/addons/sdk/grimoire-sdk.js`](../src/addons/sdk/grimoire-sdk.js) next
to your `index.html` (or import it from a URL you control). It's a single file
with no dependencies.

### 4. Install it

In a room, open **Extensions → Install** and paste the URL of your
`manifest.json`. Grimoire fetches it, registers the plugin, and you can open it
from the panel.

---

## Permissions

Declare only what you use. Each maps to one or more API calls:

| Permission     | Unlocks                                                            |
| -------------- | ------------------------------------------------------------------ |
| `scene:read`   | `GRIM.scene.getItems()`                                            |
| `scene:write`  | `GRIM.scene.addItem/updateItem/deleteItem`                         |
| `tool`         | `GRIM.tool.create()` — add a toolbar tool                          |
| `broadcast`    | `GRIM.broadcast.send()` — message everyone in the room             |
| `metadata`     | `GRIM.metadata.get/set` — your plugin's private key/value store    |
| `dice`         | `GRIM.dice.roll()` — roll real physics dice                        |
| *(none needed)*| `GRIM.notification.show()` is always allowed                       |

Event subscriptions (`onChange`, `onResult`, `broadcast.on`, `party.onChange`)
don't require a permission — they only deliver data the host chooses to emit.
But to *read* the scene snapshot those events reference, you still want
`scene:read`.

---

## The `GRIM` API at a glance

Every method returns a Promise (resolving when the host replies) except the
`on*` subscription helpers, which return an unsubscribe function.

```js
await GRIM.ready();                       // wait until the host acknowledges you

// Scene
const items = await GRIM.scene.getItems();
await GRIM.scene.addItem({ id, x, y, label, ... });
await GRIM.scene.updateItem(id, { x, y });
await GRIM.scene.deleteItem(id);
const off = GRIM.scene.onChange((change) => { /* ... */ });

// Tools
await GRIM.tool.create({ id: 'init', name: 'Initiative', icon: '⚔' });
GRIM.tool.onClick('init', (world) => { /* user used your tool at {x,y} */ });

// Dice (real cannon-es physics; result read off the settled die)
const r = await GRIM.dice.roll('2d20+1d6');   // -> { total, rolls: [...] }
GRIM.dice.onResult((r) => { /* any dice settled in the room */ });

// Broadcast (room-wide messaging on a channel you name)
GRIM.broadcast.send('initiative', { order });
GRIM.broadcast.on('initiative', (payload) => { /* ... */ });

// Metadata (private, persisted, namespaced to your plugin)
await GRIM.metadata.set('lastOrder', order);
const last = await GRIM.metadata.get('lastOrder');

// Notifications (always allowed)
GRIM.notification.show('Initiative rolled!', 'success');

// Party presence
GRIM.party.onChange((players) => { /* who's in the room */ });
```

See [`API.md`](./API.md) for parameter and return-value detail.

---

## Patterns & tips

**Always `await GRIM.ready()` first.** The bridge buffers nothing before the
host has acknowledged your frame; calls made before `ready()` resolves may be
lost.

**Handle rejected promises.** A rejection almost always means a missing
permission — the message is explicit (`requires "scene:write"`). Add it to your
manifest and bump the version.

**Use `background` for headless logic.** If your plugin needs to react to events
even when its panel is closed (e.g. auto-post dice results to a log), put that
logic in the `background` page. The `main` page is for UI the user opens.

**Keep the SDK file in sync.** The SDK is versioned with Grimoire. If you target
a specific Grimoire release, pin the SDK file from that release's tag rather than
copying `main`.

**Test locally.** Serve your plugin folder over HTTP (`npx serve .`) and install
the local URL. The browser console inside the iframe is your friend — errors in
your plugin show up there, host-side permission rejections come back as the
rejected promise's message.

---

## Publishing to the community catalog

Grimoire's repository hosts a community plugin catalog so players can discover
extensions in one place. To list yours, see
[`docs/PLUGIN_CATALOG.md`](./PLUGIN_CATALOG.md) — in short, you open a pull
request adding one entry (name, author, description, manifest URL) to
`catalog/plugins.json`. Your code stays in your own repo; the catalog only
points at your manifest URL.

---

## Reference plugin

[`examples/initiative-tracker/`](../examples/initiative-tracker/) is a complete,
working plugin: it reads every token on the table, rolls a real physics d20 for
each, sorts them into initiative order, and broadcasts the result to the whole
room. Copy it as a starting point.
