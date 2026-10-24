# Grimoire

A self-hosted virtual tabletop (VTT) for D&D and other tabletop RPGs, built as a
Nextcloud app. Think Owlbear Rodeo, but running inside your own Nextcloud:
campaigns, rooms and scene state live in your own storage, sessions are
real-time, and everything your players see is themed by your instance.

## What it does

- **Campaigns → Rooms.** A campaign holds rooms; each room is created as
  **2D or 3D** (the choice is permanent) and hosts live sessions. Invite players
  (they get an email), schedule sessions, send reminders, and mirror events to
  a Discord webhook.
- **2D rooms** — the classic battlemap: multiple floor maps, image tokens,
  drawings (pen/marker/shapes/text), square or hex grids, fog of war, and the
  pointer/grab/measure/AoE tool set (Konva-based).
- **3D rooms** — glTF/GLB character models as tokens, terrain building
  (walls, floors, pillars, ramps), physics dice that roll on the actual table
  and read their result off how they land (three.js + cannon-es).
- **Dice everywhere** — 3D rooms roll on the table; 2D rooms get a private
  physics dice viewport in the dice panel.
- **Measurement** — transient rulers, permanent rulers, and movement mode, in
  four measure types (euclidean, chessboard, alternating-diagonal, manhattan),
  with a per-scene feet-per-square scale and ft/m units.
- **GM tools** — a DM control panel (scene rename, grid settings, layer
  visibility, per-layer player permissions, invites, reminders, fog control),
  a token health system (HP bars in 2D + billboards in 3D, GM-only editing),
  and a built-in initiative tracker (orders physics d20s, synced to the room).
- **Real-time multiplayer** — a standalone WebSocket relay fans out moves,
  pointers, dice and drawings; without it, the client long-polls the Nextcloud
  API so a room still works. Durable state persists to the scene's JSON
  document so a refresh restores the table.

## Two ways to run it

### 1. Standalone demo (fastest — no Nextcloud needed)

The engine modules under `src/engine` and `src/tools` are
framework-agnostic. `demo.html` wires them together with CDN copies of three,
cannon-es, and Konva so you can try the table immediately.

It uses ES module imports, so it must be served over HTTP (not opened as a
`file://` URL):

```bash
cd grimoire
npx serve .
# then open the printed URL and add /demo.html, e.g. http://localhost:3000/demo.html
```

### 2. As a Nextcloud app

The app id is `grimoire`, and **the containing folder must be named `grimoire`**
to match `appinfo/info.xml`. Requires Nextcloud 28–35.

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
tables via the migrations.

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
`GRIMOIRE_RELAY_SECRET=<secret> node relay.js`. Room tokens are HMAC-signed on
the PHP side (`RoomController::token`) against the same secret; set it on the
Nextcloud side with `php occ config:app:set grimoire relay_secret --value
<secret>` (or the `GRIMOIRE_RELAY_SECRET` env var). Signed tokens are
short-lived (2 min) and verified by the relay without a DB hit. Without a
secret configured, the relay still works in `GRIMOIRE_DEV_TRUST=1` mode for
local development.

---

## Project layout

```
grimoire/
├── appinfo/            Nextcloud app metadata (info.xml) + routes
├── lib/                PHP backend (controllers, DB entities/mappers, migrations)
│   └── Controller/     Page, Campaign, Scene, Room (sync), Session, User, Asset
├── templates/          Server-rendered SPA host page
├── src/
│   ├── engine/         Framework-agnostic engine (the heart of the app)
│   │   ├── 2d/         Scene2D (Konva)
│   │   ├── 3d/         Scene3D + DiceRoller (three.js + cannon-es)
│   │   ├── sync/       SyncClient (WebSocket + polling fallback)
│   │   └── SceneAdapter.js   one-tool-two-modes seam
│   ├── tools/          ToolManager + pointer/grab/measure/AoE/draw/fog/build
│   ├── components/     Vue components (dice panel, DM panel, health editor…)
│   ├── views/          Vue views (Campaigns list, Room — the integration point)
│   └── App.vue, main.js
├── server/             Reference WebSocket relay
├── demo.html           Standalone, no-Nextcloud harness
├── ARCHITECTURE.md     Design doc (read this next)
└── README.md
```

`src/views/Room.vue` is where everything comes together: it loads a scene,
instantiates the room's engine (2D or 3D — never both), builds its adapter,
registers the tools, and connects sync.

---

## Documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — design, data model, and roadmap
- [`CHANGELOG.md`](CHANGELOG.md) — version history
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — dev setup and conventions
- [`HANDOFF.md`](HANDOFF.md) — working notes for the next development session

---

## License

AGPL-3.0-or-later. See [`LICENSE`](LICENSE).