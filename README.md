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
- **Real-time multiplayer** — built into the app itself: moves, pointers, dice
  and drawings sync through the Nextcloud room endpoints (no extra service to
  deploy). Durable state persists to the scene's JSON document so a refresh
  restores the table.

## Install on Nextcloud

The app id is `grimoire`, and **the containing folder must be named `grimoire`**
to match `appinfo/info.xml`. Requires Nextcloud 28–35.

```bash
# 1. Place this folder in your server's apps directory:
#    <nextcloud>/custom_apps/grimoire   (or your apps path)

# 2. Build the frontend bundle (outputs js/grimoire-main.js):
cd grimoire
npm install
npm run build

# 3. Enable it:
php occ app:enable grimoire
```

Open **Grimoire** from the Nextcloud app navigation. The first run creates the
tables via the migrations. During frontend development, rebuild on change with:

```bash
npm run dev      # vite build --watch -> js/grimoire-main.js
```

### Live multiplayer

Rooms sync through the app's own endpoints, backed by Nextcloud's distributed
cache. No separate process, relay or shared secret is needed — but the instance
must have a distributed memory cache configured (**Redis or APCu**; Nextcloud
AIO ships Redis by default). Without one, rooms run local-only and the app says
so when you join. Sync is a 1-second poll, so updates land within about a second.

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
│   │   ├── sync/       SyncClient (built-in room sync)
│   │   └── SceneAdapter.js   one-tool-two-modes seam
│   ├── tools/          ToolManager + pointer/grab/measure/AoE/draw/fog/build
│   ├── components/     Vue components (dice panel, DM panel, health editor…)
│   ├── views/          Vue views (Campaigns list, Room — the integration point)
│   └── App.vue, main.js
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