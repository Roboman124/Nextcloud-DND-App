# Grimoire

A self-hosted virtual tabletop (VTT) for D&D and other tabletop RPGs, built as a
Nextcloud app. Think Owlbear Rodeo, but running inside your own Nextcloud:
campaigns and scenes live in your storage, sessions are real-time, and the table
extends through a sandboxed addon system.

Grimoire has **two modes that share one set of tools**:

- **2D mode** — an infinite canvas with maps, image tokens, drawings, grid, and
  fog of war (Konva-based), the classic battlemap experience.
- **3D mode** — load glTF/GLB character models, build maps in three dimensions,
  and orbit the camera (three.js), with a real physics dice tray (cannon-es)
  that tosses dice and reads the result off how they actually land.

The pointer, grab, measurement, and area-of-effect tools are written once and
work in both modes through a small adapter seam, so switching modes never
changes how the table behaves.

> **Status: 0.3.0 (early but usable).** The structure, engine, tool framework,
> physics dice, plugin SDK, and campaign/session management (invites, reminders,
> Discord webhooks) are working. Real-time multiplayer and a few features are
> still scaffolded — see `ARCHITECTURE.md` for the roadmap and `CHANGELOG.md` for
> what landed when.

---

## Two ways to run it

### 1. Standalone demo (fastest — no Nextcloud needed)

The engine modules under `src/engine`, `src/tools`, and `src/addons` are
framework-agnostic. `demo.html` wires them together with CDN copies of three,
cannon-es, and Konva so you can try the table immediately.

It uses ES module imports, so it must be served over HTTP (not opened as a
`file://` URL):

```bash
cd grimoire
npx serve .
# then open the printed URL and add /demo.html, e.g. http://localhost:3000/demo.html
```

You get the 2D/3D toggle, the toolbar (pointer / grab / measure / AoE), the
physics dice tray, and an "add token" control — all driven by the same engine
code the Nextcloud app uses.

### 2. As a Nextcloud app

The app id is `grimoire`, and **the containing folder must be named `grimoire`**
to match `appinfo/info.xml`.

```bash
# 1. Place this folder in your server's apps directory:
#    <nextcloud>/apps/grimoire   (or a custom apps path)

# 2. Build the frontend bundle (outputs js/grimoire-main.js):
cd grimoire
npm install
npm run build

# 3. Enable it:
php occ app:enable grimoire
```

Open **Grimoire** from the Nextcloud app navigation. The first run creates the
`grimoire_campaigns` and `grimoire_scenes` tables via the migration.

During frontend development, rebuild on change with:

```bash
npm run dev      # vite build --watch -> js/grimoire-main.js
```

### Live multiplayer (optional)

Real-time rooms use a tiny standalone WebSocket relay; if it isn't reachable the
client automatically degrades to long-polling the Nextcloud API, so a room still
works (just laggier). To run the relay locally:

```bash
cd grimoire/server
npm install
npm run dev      # GRIMOIRE_DEV_TRUST=1 node relay.js  (accepts unsigned dev tokens)
```

For production, run it with a shared secret instead:
`GRIMOIRE_RELAY_SECRET=<secret> node relay.js`. The signing of room tokens on the
PHP side is roadmap item #1 in `ARCHITECTURE.md`.

---

## Project layout

```
grimoire/
├── appinfo/            Nextcloud app metadata (info.xml) + routes
├── lib/                PHP backend (controllers, DB entities/mappers, migration)
├── templates/          Server-rendered SPA host page
├── src/
│   ├── engine/         Framework-agnostic engine (the heart of the app)
│   │   ├── 2d/         Scene2D (Konva)
│   │   ├── 3d/         Scene3D + DiceRoller (three.js + cannon-es)
│   │   ├── sync/       SyncClient (WebSocket + polling fallback)
│   │   └── SceneAdapter.js   one-tool-two-modes seam
│   ├── tools/          ToolManager + pointer/grab/measure/AoE tools
│   ├── addons/         Addon host + the guest GRIM SDK
│   ├── components/     Vue components (dice tray, addon panel)
│   ├── views/          Vue views (Campaigns list, Room — the integration point)
│   ├── App.vue, main.js
├── examples/           A working example addon (initiative tracker)
├── server/             Reference WebSocket relay
├── demo.html           Standalone, no-Nextcloud harness
├── ARCHITECTURE.md     Design doc + roadmap (read this next)
└── README.md
```

`src/views/Room.vue` is where everything comes together: it loads a scene,
instantiates the 2D and 3D scenes against a shared physics world, builds both
adapters, registers the tools, connects sync, and bridges the addon host's
permissions to the live scene.

---

## Addons

Grimoire's addon system mirrors Owlbear's: an addon is just a web page described
by a `manifest.json`, loaded by URL into a sandboxed iframe, talking to the host
through a permissioned `postMessage` bridge. Addons never touch the DOM of the
main app and only get the capabilities their manifest declares.

A guest addon imports the SDK and calls into the namespaced `GRIM` API:

```js
import { GRIM } from './grimoire-sdk.js';

await GRIM.ready();
const tokens = await GRIM.scene.getItems();        // needs "scene:read"
const result = await GRIM.dice.roll('1d20');       // needs "dice"
GRIM.broadcast.send('initiative', { order: [...] });// needs "broadcast"
```

Its manifest declares identity and permissions:

```json
{
  "name": "Initiative Tracker",
  "version": "0.1.0",
  "main": "index.html",
  "permissions": ["scene:read", "tool", "broadcast", "metadata", "dice"]
}
```

See `examples/initiative-tracker/` for a complete, working addon that reads the
tokens on the table, rolls a real physics d20 for each, sorts them, and
broadcasts the initiative order to everyone in the room. Install it from the
addon panel by pointing at its `manifest.json` URL.

**Full plugin docs:** [`docs/PLUGINS.md`](docs/PLUGINS.md) (developer guide) and
[`docs/API.md`](docs/API.md) (SDK reference). To list a plugin in the community
catalog, see [`docs/PLUGIN_CATALOG.md`](docs/PLUGIN_CATALOG.md).

---

## Documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — design, data model, and roadmap
- [`docs/PLUGINS.md`](docs/PLUGINS.md) — write a plugin
- [`docs/API.md`](docs/API.md) — `GRIM` SDK reference
- [`docs/PLUGIN_CATALOG.md`](docs/PLUGIN_CATALOG.md) — submit a plugin
- [`CHANGELOG.md`](CHANGELOG.md) — version history
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — dev setup and conventions

---

## License

AGPL-3.0-or-later. See [`LICENSE`](LICENSE).
