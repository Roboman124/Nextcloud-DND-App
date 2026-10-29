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
| Room | Live session keyed to a Scene, synced through the Nextcloud room API |
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
│  JSON API   RoomController → room handshake + message sync     │
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
│  │  SyncClient (built-in room sync: push + 1 s poll)          │  │
│  └────────────────────────────────────────────────────────┘  │
└───────────────────────────┬───────────────────────────────────┘
                            │ HTTPS (push / poll)
                ┌───────────┴─────────────────┐
                │ Nextcloud room endpoints     │
                │ (distributed cache fan-out)  │
                └──────────────────────────────┘
```

The **engine** layer takes `THREE`, `CANNON`, and `Konva` as injected
dependencies and has no Vue or Nextcloud imports. Keep it that way — it is what
makes the engine testable and portable.

---

## 3. The one-tool-two-modes trick

The hardest part of "2D mode and 3D mode" is not having two renderers — it is
not writing every feature twice. Grimoire solves this with `SceneAdapter`:

- Tools (`PointerTool`, `GrabTool`, `MeasureTool`, `AoETool`) are written once.
  They speak in **world points** and call **verbs**: `showPointer`,
  `moveToken`, `setAoE`, `showMeasurement`, `snapToGrid`.
- `Scene2DAdapter` implements those verbs against Konva layers.
- `Scene3DAdapter` implements them against three meshes + a raycaster.

A **room is one mode or the other, chosen at creation** (see `Room.vue`): one
engine is instantiated, one adapter serves the tools, and the scene document
and sync messages use that engine's native units. Mode-specific tools are
registered accordingly — `FogTool` only in 2D rooms, `BuildTool` only in 3D
rooms — and a campaign can hold rooms of both kinds; a room never switches.
Add a new tool once and it works in both kinds of room the moment both
adapters implement the verbs it needs.

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

Rooms use **one transport: the Nextcloud app itself** — nothing extra to
deploy. `SyncClient` POSTs small JSON messages (token moved, pointer at X, dice
rolled, fog/draw strokes) to `/api/room/push` and polls `/api/room/poll` once a
second. `RoomController` fans messages out through Nextcloud's distributed
cache (Redis/APCu) and **enforces every permission check before accepting a
push** — GM-only fog and HP edits, per-layer create/update/delete, and
`ownerOnly` token ownership resolved from the persisted scene document.
Presence is derived client-side from recent traffic plus a 30 s heartbeat, so
the party list works without a server-side session registry.

Durable state (token positions, scene items) is snapshotted back to the
`Scene.data` JSON document via `SceneController::update`, so a refresh restores
the table. A room handshake (`POST /api/scenes/{id}/room-token`) returns the
caller's role, the campaign permissions and whether a distributed cache is
available; without a cache the room runs local-only and the UI says so.

Trade-off: poll sync lands updates within about a second — fine for a
click-to-move table, and it needs no ports, processes or shared secrets.

Conflict policy: transient state (pointers, measurement) is last-write-wins and
never persisted; durable state is last-write-wins per item with the backend as
the source of truth on reload.

---

## 6. Extensions

Grimoire has no third-party extension runtime. The earlier sandboxed-iframe
system (manifest.json + `GRIM` SDK + `postMessage` permission bridge) was
removed in 0.7.1: it widened the app's attack surface (third-party HTML served
on the Nextcloud origin) far more than it added value, and the features the
roadmap once called "extensions" — the initiative tracker, for example — ship
as regular built-in UI instead. New capabilities belong in the core.

---

## 7. Directory map

```
grimoire/
├── appinfo/
│   ├── info.xml              app metadata + nav entry
│   └── routes.php            page + JSON API routes
├── lib/
│   ├── AppInfo/Application.php
│   ├── Controller/           Page, Campaign, Scene, Room (sync), Session, User, Asset
│   ├── Db/                   Campaign + Scene entities & mappers
│   └── Migration/            schema migrations
├── templates/main.php        SPA mount point
├── src/
│   ├── main.js, App.vue      Vue boot + router
│   ├── views/                Campaigns.vue, Room.vue
│   ├── components/           DicePanel, DMPanel, HealthEditor, InitiativeTracker…
│   ├── engine/
│   │   ├── 2d/Scene2D.js     Konva tabletop
│   │   ├── 3d/Scene3D.js     three tabletop + glTF models + AoE + fog
│   │   ├── 3d/DiceRoller.js  physics dice
│   │   ├── sync/SyncClient.js  built-in room sync
│   │   └── SceneAdapter.js   2D & 3D adapters for tools
│   └── tools/ToolManager.js  pointer / grab / measure / aoe / draw / fog / build
└── README.md, ARCHITECTURE.md, CHANGELOG.md
```

---

## 8. Roadmap

**Built:** campaigns/rooms with 2D-or-3D rooms, the 2D and 3D engines, physics
dice (d4–d20, canonical settles), grid controls (square/hex, styles, per-scene
scale), fog of war in both room kinds (brush/eraser/shapes, preview), drawing
modes, rich text, measure modes (transient/permanent/movement, four measure
types), token health, player roles and per-layer permissions with owner-only
tokens, multiple maps per scene, the built-in sync, the Nextcloud Files asset
library, the DM control panel, and the built-in initiative tracker.

**Next, in rough priority:**
1. **Dice calibration polish** — canonical face numbering for d8/d12/d20 face
   maps and a proper d10 (the d4/d8/d10 geometry is exact now; the value
   labelling for the remaining solids is stable but not canonical).
2. **Casting** — screen-cast the scene to remote viewers (needs streaming infra;
   lowest priority for a self-hosted app).
3. **UI polish** — Owlbear-style layout, first-run empty state, token context
   menus.

---

## 9. Setup

See `README.md` — Grimoire runs as a Nextcloud app (Nextcloud 28–35). Live
multiplayer is built in and needs a distributed memory cache (Redis or APCu);
Nextcloud AIO ships Redis by default.
