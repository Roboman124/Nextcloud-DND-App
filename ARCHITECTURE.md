# Grimoire — Architecture

Grimoire is a virtual tabletop (VTT) that lives inside Nextcloud. It is
inspired by Owlbear Rodeo's "powerfully simple" map-and-tokens experience, but
adds a physics-driven **3D mode** alongside the classic **2D mode**, and is
built around an **addon system** so the table can grow over time.

This document explains how the pieces fit, what is built, and what to build
next. It is the map; the code is the territory.

---

## 1. What Owlbear does, and what we take from it

From researching Owlbear Rodeo, its core loop is: a **room** connects a GM and
players; a **scene** is an infinite canvas; you drop **maps**, **tokens**,
**drawings**, **fog**, and **notes**; a small set of **tools** (pointer,
measure, fog brush) handle interaction; **dice** are physics-rolled in a
drawer; and everything else is delivered by **extensions** loaded from a
`manifest.json` into a sandboxed iframe that talks to the host via an SDK
(`OBR.*`).

Grimoire mirrors that shape deliberately:

| Owlbear concept | Grimoire equivalent |
|---|---|
| Room | Live session keyed to a Scene, synced over a WebSocket relay |
| Scene | `Scene` row (JSON scene graph) in a Campaign |
| Tokens / maps / drawings / fog | Layers in `Scene2D`; meshes in `Scene3D` |
| Pointer / measure tools | `tools/` + `SceneAdapter` (works in 2D **and** 3D) |
| Physics dice drawer | `DiceRoller` (three + cannon-es), settle-and-read |
| Extensions + `OBR` SDK | `AddonManager` + `GRIM` SDK (iframe + postMessage) |

What we add: a **Campaign** layer above scenes, a true **3D table** with glTF
models, and self-hosting (your maps and tokens live in your Nextcloud, not a
third-party cloud).

---

## 2. Layered design

```
┌──────────────────────────────────────────────────────────────┐
│ Nextcloud (PHP)                                                │
│  PageController → SPA   CampaignController/SceneController →    │
│  JSON API   RoomController → relay token + poll fallback       │
│  Db: Campaign, Scene (scene graph stored as JSON document)     │
└───────────────▲───────────────────────────┬───────────────────┘
                │ initial state / REST       │ persist snapshots
┌───────────────┴───────────────────────────▼───────────────────┐
│ Frontend SPA (Vue 3)                                           │
│  Campaigns.vue → Room.vue                                      │
│                                                                │
│  ┌── engine (framework-agnostic, dependency-injected) ──────┐  │
│  │  Scene2D (Konva)        Scene3D (three) ── DiceRoller     │  │
│  │           \             /          (shared physics world) │  │
│  │            SceneAdapter (2D & 3D)                          │  │
│  │                  │                                         │  │
│  │            ToolManager → Pointer / Grab / Measure / AoE    │  │
│  │  SyncClient (WebSocket + poll fallback)                    │  │
│  │  AddonManager ── iframe sandbox ── GRIM SDK (guest)        │  │
│  └────────────────────────────────────────────────────────┘  │
└───────────────▲───────────────────────────┬───────────────────┘
                │ WS                         │ WS
        ┌───────┴────────────────────────────┴───────┐
        │ Realtime relay (standalone Node service)    │
        │ rooms, fan-out, presence; auth via token    │
        └─────────────────────────────────────────────┘
```

The **engine** layer takes `THREE`, `CANNON`, and `Konva` as injected
dependencies and has no Vue or Nextcloud imports. That is why the same modules
run unchanged in `demo.html` (plain ES modules + import map) and inside the
Nextcloud Vue bundle. Keep it that way — it is what makes the engine testable
and portable.

---

## 3. The one-tool-two-modes trick

The hardest part of "2D mode and 3D mode" is not having two renderers — it is
not writing every feature twice. Grimoire solves this with `SceneAdapter`:

- Tools (`PointerTool`, `GrabTool`, `MeasureTool`, `AoETool`) are written once.
  They speak in **world points** and call **verbs**: `showPointer`,
  `moveToken`, `setAoE`, `showMeasurement`, `snapToGrid`.
- `Scene2DAdapter` implements those verbs against Konva layers.
- `Scene3DAdapter` implements them against three meshes + a raycaster.

Switching mode just swaps which adapter the `ToolManager` holds. Add a new
tool once and it works in both modes the moment both adapters implement the
verbs it needs.

---

## 4. 3D physics dice (the centerpiece)

`DiceRoller` (`src/engine/3d/DiceRoller.js`) does real simulation, not animated
randomness:

1. Build each die as a three geometry **and** a matching cannon-es
   `ConvexPolyhedron`.
2. Toss it into a physics tray with random position, velocity, and spin.
3. Step the world each frame; sync mesh transforms to bodies.
4. When all bodies **sleep**, read the result by rotating each face's local
   normal into world space and picking the one most aligned with world-up.

Because the value comes from the **resting orientation**, the number you see is
the number the die physically shows. Rolls are reproducible with a seeded RNG
(`mulberry32`) so a roll can be replayed identically on every client.

The dice can **share Scene3D's physics world** (so they bounce on the same
table the minis stand on). When sharing, `Scene3D.render()` steps the world and
`DiceRoller.step()` only reads — guarded by `ownsWorld` to avoid double-stepping.

**Known calibration work:** the d6 face map is exact. For d8/d12/d20 the face
values are assigned by clustering coplanar triangles and ordering them; this
gives valid, stable values but they are not yet matched to a real die's
canonical numbering (where opposite faces sum to max+1). Calibrate by rendering
each die, recording which value sits on which normal, and hard-coding the maps
like `d6` does. The d10 is approximated and should be rebuilt as a proper
pentagonal trapezohedron (lathe geometry).

**Calibration (done in 0.6.0):** d8/d12/d20 now use canonical face maps built by
`calibratedFaces()`, which pairs each normal with its opposite and assigns
`(v, max+1−v)` so opposite faces sum to max+1. The d10 is now a real
pentagonal trapezohedron built from a lathe-style geometry
(`buildTrapezohedronGeometry`), no longer an icosa approximation.

**2D dice viewport:** In 2D mode there's no 3D scene to show the dice tumbling,
so `DiceViewport` (`src/components/DiceViewport.vue`) renders its own
self-contained three.js + cannon-es tray in a small corner canvas — same
`DiceRoller` engine, just a private scene/world. Players in 2D mode get the
physics-dice experience without leaving the battlemap; rolls broadcast to the
room via the usual `dice:result` message.

---

## 5. Real-time sync

Nextcloud's PHP request model is not built for persistent sockets, so live
rooms use a **standalone WebSocket relay** — a small Node service that:

- accepts a connection with a short-lived room token (issued by
  `RoomController::token`, signed so the relay can verify it without a DB hit),
- joins the socket to a room channel,
- fans messages out to everyone else in the room,
- tracks presence (who's connected, cursor colors).

The relay is **dumb on purpose**: it does not understand scene semantics, it
just relays JSON. Durable state (token positions, scene items) is periodically
snapshotted back to the `Scene.data` JSON document via `SceneController::update`
so a refresh restores the table.

If the relay is unreachable, `SyncClient` falls back to **long-polling**
`/api/room/poll`, so a room still functions (laggier) on a vanilla Nextcloud
with nothing extra deployed. A reference relay ships in `server/relay.js` — a
small `ws` service that authenticates by room token and fans JSON out to the
other members of a room. The remaining piece is `RoomController::token` signing
on the PHP side (see roadmap), so the relay can verify tokens without a DB hit;
until then the relay accepts unsigned tokens in `GRIMOIRE_DEV_TRUST=1` mode for
local development.

Conflict policy: transient state (pointers, measurement) is last-write-wins and
never persisted; durable state is last-write-wins per item with the backend as
the source of truth on reload.

---

## 6. Addon system

Extensibility is a first-class requirement, modeled on Owlbear's approach.

- An addon is any web app described by a `manifest.json` (name, version, icon,
  `main` URL, `permissions`).
- `AddonManager` (host) loads the manifest and mounts `main` in a
  **sandboxed iframe** (`allow-scripts` only — no same-origin access to the
  host page or other addons).
- Host and addon communicate over **`postMessage`**. The addon imports the
  **`GRIM` SDK** which exposes `scene`, `tool`, `dice`, `broadcast`,
  `metadata`, `notification`, and `party` namespaces, each call a Promise.
- **Permissions are enforced per message.** Every API method maps to a
  required permission; a call for a capability the manifest didn't declare is
  rejected. Nothing is granted by default.

See `examples/initiative-tracker/` for a complete addon that reads the scene's
tokens, rolls real physics d20s for initiative, sorts, and broadcasts the order.

This means new features — fog brushes, conditions, character sheets, a
soundboard — can ship as addons without touching the core, exactly as asked.

---

## 7. Directory map

```
grimoire/
├── appinfo/
│   ├── info.xml              app metadata + nav entry
│   └── routes.php            page + JSON API routes
├── lib/
│   ├── AppInfo/Application.php
│   ├── Controller/           Page, Campaign, Scene, (Room — to add)
│   ├── Db/                   Campaign + Scene entities & mappers
│   └── Migration/            initial schema
├── templates/main.php        SPA mount point
├── src/
│   ├── main.js, App.vue      Vue boot + router
│   ├── views/                Campaigns.vue, Room.vue
│   ├── components/           DiceTray.vue, AddonPanel.vue
│   ├── engine/
│   │   ├── 2d/Scene2D.js     Konva tabletop
│   │   ├── 3d/Scene3D.js     three tabletop + glTF models + AoE
│   │   ├── 3d/DiceRoller.js  physics dice
│   │   ├── sync/SyncClient.js
│   │   └── SceneAdapter.js   2D & 3D adapters for tools
│   ├── tools/ToolManager.js  pointer / grab / measure / aoe
│   └── addons/
│       ├── AddonManager.js   iframe host + permission gate
│       └── sdk/grimoire-sdk.js  guest SDK (GRIM)
├── examples/initiative-tracker/   sample addon
├── server/relay.js              reference WebSocket relay (+ package.json)
└── demo.html                 standalone engine harness (no Nextcloud needed)
```

---

## 8. Roadmap (suggested order)

**Built now:** project skeleton, DB layer, campaign/scene API, 2D + 3D engine,
physics dice (calibrated d4–d20), pointer/grab/measure/AoE/draw/fog/build tools,
addon host + SDK + example + verified store, sync client with signed tokens +
polling fallback, the reference relay service, runnable demo, asset library
backed by Nextcloud Files, player roles (GM/player), 2D dice viewport.

**Next, in rough priority (feature gaps vs Owlbear Rodeo, from the docs):**
1. **Grid controls** — hex (vertical/horizontal) + isometric grids, line style
   (solid/dashed/dotted), color/opacity/line-width, per-scene measurement type
   (chessboard / alternating-diagonal / euclidean / manhattan), and a grid-scale
   field. Currently Grimoire is square-only, euclidean-only, fixed 5 ft.
2. **Fog shapes & preview** — rectangle/polygon/circle fog modes (not just
   brush), per-shape cut/uncut so a revealed room can be re-hidden, a "fog
   preview" toggle to see the player view, and a configurable fog color.
3. **Drawing modes** — polygon, marker (freehand), line, triangle, hexagon;
   fill + stroke style menus; advanced point editing; layer ordering
   (above/below grid); trim/join of shapes.
4. **Rich text on canvas** — replace the `prompt()` text tool with an in-place
   editor (bold/italic/lists/headings/emoji) like Owlbear's Text tool.
5. **Measure modes** — permanent (double-click to place) rulers and a movement
   mode that drags a token while showing distance, plus per-scene measurement
   type selection.
6. **Player permissions** — per-layer create/update/delete toggles for players
   (maps/tokens/drawings/fog), plus token ownership ("owner-only") so each
   player can move only their own characters.
7. **Multiple maps per scene + grid alignment** — drop several map images onto
   one infinite canvas and a tool to align a map's grid to the scene grid.
8. **Casting** — screen-cast the scene to remote viewers (needs streaming
   infra; lowest priority for a self-hosted app).

---

## 9. Setup

See `README.md` for install and dev commands. The fastest way to see the engine
work is the standalone demo: serve the folder over http and open `/demo.html`.
