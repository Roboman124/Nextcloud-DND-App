# Grimoire — Handoff for Claude Code

> **v0.7.3 note (2026-10-25).** Rooms are **2D or 3D, never both**: the scene's
> `mode` is chosen in the New Room modal (`Campaigns.vue`) and permanent;
> `Room.vue` instantiates exactly one engine + adapter and keys every mode-
> specific path off it (no toggle, no cross-mode coordinate conversion). The
> iframe addon system is gone (0.7.1) and its dead files are deleted — invites
> live on `CampaignController::players` (PUT, GM-only, validated, sends an
> invite email) and `CampaignController::permissions`; both carry raw-body
> fallbacks for the known body-binding issue on PUT. `SyncClient` degrades to
> a single built-in transport (push + 1 s poll) and takes an injected `apiUrl`.
> New dependency: `@nextcloud/dialogs`. Token docs are per-kind native
> (2D pixels / 3D world units) — old dual-mode docs are migrated best-effort
> in `Room._migrateToken`.

This is a working **foundation** for a Nextcloud virtual tabletop (VTT) for D&D,
modeled on Owlbear Rodeo. The architecture, engine, tool framework, addon SDK,
and physics dice are real and runnable. Several features are deliberately
scaffolded and listed below. This doc orients you fast; read `ARCHITECTURE.md`
for design rationale and `README.md` for run/build commands.

## How to run it (verify before changing anything)

- **As a Nextcloud app:** folder MUST be named `grimoire` (matches app id in
  `appinfo/info.xml`). `npm install && npm run build` → outputs
  `js/grimoire-main.js` (Vite IIFE build). Then `php occ app:enable grimoire`.
  Targets Nextcloud 28–35, PHP namespace `Grimoire`, OCP API. The app runs only
  inside Nextcloud — there is no standalone harness.
- **Live multiplayer is built in** — room messages go through the app's own
  push/poll endpoints backed by Nextcloud's distributed cache (Redis/APCu; AIO
  ships Redis). No relay process or shared secret to configure.

## Architecture in one paragraph

Campaign → Scene → live Room, where a room is **2D or 3D, chosen at creation**.
The **engine** (`src/engine`, `src/tools`) is framework-agnostic and
dependency-injected (THREE, CANNON, Konva are passed in). **2D** = Konva
(`Scene2D`); **3D** = three.js (`Scene3D`); **dice physics** = cannon-es
(`DiceRoller`), sharing the 3D scene's physics world in 3D rooms and using a
private viewport in 2D rooms. The key seam is `SceneAdapter`
(`Scene2DAdapter` / `Scene3DAdapter`): tools speak world-points and verbs
(showPointer, moveToken, setAoE, showMeasurement) and each mode supplies an
adapter, so **one tool codebase works in both modes**. Sync is built in:
`SyncClient` pushes to `/api/room/push` and polls `/api/room/poll` once a second;
`RoomController` enforces permissions and fans out through the cache. Durable
scene state is the JSON document on the Scene row. The sandboxed-iframe addon
system was removed in 0.7.1; features ship in the core.

## File map (where to work)

- `src/views/Room.vue` — **the integration point.** Loads a scene, instantiates
  the room's single engine + adapter, ToolManager, SyncClient, DM panel, dice
  panel. Start here to understand runtime wiring.
- `src/engine/3d/DiceRoller.js` — physics dice (geometry + face maps + settle).
- `src/engine/3d/Scene3D.js` — three renderer, glTF loading, tokens, blocks,
  fog/drawings overlays, selection ring.
- `src/engine/2d/Scene2D.js` — Konva stage, layers, fog, drawings, measurement.
- `src/engine/SceneAdapter.js` — the one-tool-two-modes seam.
- `src/engine/sync/SyncClient.js` — built-in room sync (push + 1 s poll).
- `src/tools/ToolManager.js` — pointer / grab / measure / AoE / draw / fog / build.
- `lib/Controller/` — `PageController`, `CampaignController`, `SceneController`,
  `RoomController` (sync), `SessionController`, `UserController`, `AssetController`.
- `lib/Db/` — Campaign + Scene entities & QBMappers; `lib/Migration/` — schema.

## Known issues / correctness gaps (read before refining)

1. **Dice face calibration.** d4, d6 and d10 are exact and canonical; d8/d12/d20
   still derive their face→value maps by clustering coplanar triangles — valid
   and stable, but not matched to the standard die layout. Fix: hard-code the
   face maps like d6/d4, verify visually per die.
2. **Sync is a 1 s poll** — needs a distributed cache (Redis/APCu) for
   multiplayer; without one rooms run local-only and the UI says so.
3. **PHP is hand-validated, not lint-tested** in this environment. Run `php -l`
   across `lib/` and test on the live Nextcloud instance.
4. **UI polish pending** — Owlbear-style layout pass, first-run empty state,
   token context menus (the user is reviewing redesigns).

## Suggested refinement order

1. Dice face-map calibration for d8/d12/d20 (issue #1).
2. UI polish pass (pending redesign review).
3. Casting — screen-cast the scene to remote viewers.

## Conventions to preserve

- Keep the engine **framework-agnostic and dependency-injected** — do not import
  three/cannon/konva directly in `src/engine`; they are passed in.
- New tools should go through `SceneAdapter` verbs so they work in both 2D and
  3D, rather than touching Scene2D/Scene3D directly.
- App id, folder name, and `info.xml` `<id>` must all stay `grimoire`; the built
  bundle must stay `js/grimoire-main.js` (matches `PageController` addScript and
  `vite.config.js`).
