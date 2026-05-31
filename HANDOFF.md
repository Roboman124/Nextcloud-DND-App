# Grimoire — Handoff for Claude Code

This is a working **foundation** for a Nextcloud virtual tabletop (VTT) for D&D,
modeled on Owlbear Rodeo. The architecture, engine, tool framework, addon SDK,
and physics dice are real and runnable. Several features are deliberately
scaffolded and listed below. This doc orients you fast; read `ARCHITECTURE.md`
for design rationale and `README.md` for run/build commands.

## How to run it (verify before changing anything)

- **Standalone engine demo (fastest):** serve over HTTP and open `/demo.html`.
  `npx serve .` then visit the printed URL + `/demo.html`. It pulls
  three@0.160 / cannon-es@0.20 / konva@9.3 from jsdelivr via an import map and
  imports the real `src/engine` modules. Needs network access to jsdelivr.
  `file://` will NOT work (ES modules). There is an on-screen red error overlay
  if anything fails.
- **As a Nextcloud app:** folder MUST be named `grimoire` (matches app id in
  `appinfo/info.xml`). `npm install && npm run build` → outputs
  `js/grimoire-main.js` (Vite IIFE lib build). Then `php occ app:enable grimoire`.
  Targets Nextcloud 28–31, PHP namespace `Grimoire`, OCP API.
- **Relay (optional, for live multiplayer):** `cd server && npm install &&
  npm run dev` (runs with `GRIMOIRE_DEV_TRUST=1`, accepting unsigned tokens).

## Architecture in one paragraph

Campaign → Scene → live Room. The **engine** (`src/engine`, `src/tools`,
`src/addons`) is framework-agnostic and dependency-injected (THREE, CANNON,
Konva are passed in), so the identical modules run in both the Nextcloud Vue
bundle and `demo.html`. **2D mode** = Konva (`Scene2D`); **3D mode** = three.js
(`Scene3D`); **dice physics** = cannon-es (`DiceRoller`), sharing the 3D scene's
physics world. The key seam is `SceneAdapter` (`Scene2DAdapter` /
`Scene3DAdapter`): tools speak world-points and verbs (showPointer, moveToken,
setAoE, showMeasurement) and each mode supplies an adapter, so **one tool
codebase works in both modes**. Real-time sync is a standalone WebSocket relay
(`server/relay.js`, dumb fan-out) with a long-poll fallback to a Nextcloud
endpoint; durable scene state is JSON on the Scene DB row. Addons mirror
Owlbear: `manifest.json` → sandboxed iframe → permissioned `postMessage` bridge
exposing the `GRIM` SDK.

## File map (where to work)

- `src/views/Room.vue` — **the integration point.** Loads a scene, instantiates
  Scene2D + Scene3D + DiceRoller (shared world), both adapters, ToolManager,
  SyncClient, AddonManager. Start here to understand runtime wiring.
- `src/engine/3d/DiceRoller.js` — physics dice; see dice issue below.
- `src/engine/3d/Scene3D.js` — three renderer, glTF token loading, AoE templates.
- `src/engine/2d/Scene2D.js` — Konva stage, layers incl. a fog layer (no brush yet).
- `src/engine/SceneAdapter.js` — the one-tool-two-modes seam.
- `src/engine/sync/SyncClient.js` — WS client + polling fallback.
- `src/tools/ToolManager.js` — pointer / grab / measure / AoE tools.
- `src/addons/AddonManager.js` + `src/addons/sdk/grimoire-sdk.js` — addon host + guest SDK.
- `examples/initiative-tracker/` — complete working example addon.
- `lib/Controller/` — `PageController`, `CampaignController`, `SceneController`.
- `lib/Db/` — Campaign + Scene entities & QBMappers; `lib/Migration/` — schema.
- `server/relay.js` — reference WebSocket relay.

## Known issues / correctness gaps (read before refining)

1. **Dice face calibration (highest-value correctness fix).** In
   `DiceRoller.js`, the d6 face→value map is exact. d8/d12/d20 are derived by
   clustering coplanar triangles and are **not canonically numbered** (the
   physics and settle-detection are correct, but which number a settled face
   reports is not the standard die layout). d10 is **approximated** and needs a
   proper pentagonal trapezohedron. Fix: build correct geometry per die with
   hard-coded face→value maps like d6 has, then verify visually.
2. **`RoomController` does not exist yet**, but `appinfo/routes.php` references
   `room#token`, `room#poll`, `room#push`. Nextcloud resolves controllers
   lazily so the app still enables, but the SyncClient's polling fallback
   (`GET /api/room/poll`) will 404 until you add `lib/Controller/RoomController.php`.
   This is also what blocks genuinely-live multiplayer: the relay
   (`server/relay.js`) expects HMAC-signed `"<roomId>.<userId>.<sig>"` tokens
   minted by `RoomController::token` using a shared secret. Until then the relay
   only runs in `GRIMOIRE_DEV_TRUST=1` mode.
3. **Fog of war is scaffolded, not implemented.** `Scene2D` has a dedicated fog
   layer but there is no reveal/hide brush tool. (Owlbear's signature feature.)
4. **No asset library.** glTF/GLB models and map/token images are loaded by URL
   only; there is no Nextcloud Files picker or upload UI. This is the
   self-hosting payoff and should be early.
5. **No player sharing / roles.** Everything is owner-scoped (`ownedOr404` /
   `accessibleOr404` guards). There is no GM-vs-player permission model or
   campaign invitations yet.
6. **PHP is hand-validated, not lint-tested** (no PHP runtime in the build env
   where this was scaffolded). Run `php -l` across `lib/` and stand up a real
   Nextcloud instance to validate the backend end-to-end.
7. **Placeholders to replace:** `<author>` and the GitHub `<bugs>` URL in
   `appinfo/info.xml`.

## Suggested refinement order

1. Add `RoomController` (token signing + poll/push) so the routes resolve and
   multiplayer goes live against `server/relay.js`. Highest leverage.
2. Calibrate dice geometry + face maps (issue #1), verify visually in `demo.html`.
3. Fog of war: a paintable mask on the Scene2D fog layer + a reveal/hide tool.
4. Nextcloud Files asset library: pick/upload maps, tokens, and glTF models.
5. Player sharing & roles (GM vs player), campaign invites.
6. Drawing tools (freehand/shapes/text) and notes.
7. Addon store: a curated `extensions.json` + in-app installer browser.

## Conventions to preserve

- Keep the engine **framework-agnostic and dependency-injected** — do not import
  three/cannon/konva directly in `src/engine`; they are passed in. This is what
  lets `demo.html` and the Nextcloud bundle share code.
- New tools should go through `SceneAdapter` verbs so they work in both 2D and
  3D, rather than touching Scene2D/Scene3D directly.
- New addon capabilities must be gated in `AddonManager`'s permission map and
  declared in the addon's `manifest.json` — nothing granted by default.
- App id, folder name, and `info.xml` `<id>` must all stay `grimoire`; the built
  bundle must stay `js/grimoire-main.js` (matches `PageController` addScript and
  `vite.config.js`).
