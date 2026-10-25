# Changelog

All notable changes to Grimoire are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
semantic versioning.

## [0.7.6] - 2026-10-25

The d10 die was geometrically wrong, 3D fog only appeared on mouse release and
stuttered, and the draw tool was inert in 3D rooms.

### Fixed — dice
- **d10 rebuilt as a true pentagonal trapezohedron.** The old construction was
  built with n=10 (a twenty-faced decagonal solid whose 0–9 values cycled
  across 20 faces, several doubled and mislabelled) and placed labels far off
  the faces. The new builder is exact: two apices, a 2n ring staggered between
  heights ±e, and the kite faces are provably planar for the exact stagger
  e = h(1−cos(π/n))/(1+cos(π/n)) — verified numerically (10 faces, each with an
  exact antipodal face, opposite values pairing to 0+9…4+5, labels sitting on
  the surface).

### Fixed — 3D drawing & fog feel
- **Strokes preview live in 3D.** Fog brushes and the pencil now draw while you
  drag onto a live overlay canvas, instead of appearing only after the left
  button released.
- **Laggy fog gone.** Overlay textures upload at most once per frame via a
  dirty flag (a live stroke used to trigger a full 1024² texture re-upload per
  mouse-move); committed strokes redraw the canvas incrementally.
- **The draw tool works in 3D rooms.** Scene3D gained a drawings layer
  (pen/marker freehand, line/rect/ellipse/triangle/hexagon, polygon, and plain
  text notes) over the ground, in the same shared pixel stroke space and
  message formats as 2D — saves and live sync carry both room kinds' drawings.
- Rich text notes anchor and project correctly in 3D rooms (camera projection
  instead of the 2D stage transform).

## [0.7.5] - 2026-10-25

Three user-reported issues on the 0.7.4-era build: the file picker opening
twice (first instance without a Choose button), 3D tokens/model clicks doing
nothing, and fog of war not working in 3D rooms.

### Fixed
- **File picker no longer opens twice.** The modern `@nextcloud/dialogs`
  picker was tried first and its `pick()` rejects when the user CANCELS — the
  old code treated that as "modern picker unavailable" and opened the legacy
  core dialog on top, so every pick showed two windows and the first had no
  usable select affordance. The proven legacy core picker is now primary
  (its argument fix from 0.7.4 stands), and the modern builder is only a
  fallback for servers without the legacy global — where a cancel now simply
  closes with no result instead of spawning a second dialog.
- **3D tokens/models were unclickable while a model streamed in.** The 3D
  scene now pre-registers tokens before the async glTF load (so a save mid-load
  can't drop them), but the grab tool's picker indexed every token's mesh
  position without a null guard — one still-loading model made the whole pick
  call throw, breaking selection and dragging of EVERY token. Loading models
  are now skipped until their mesh exists, and the grab radius grew slightly
  (1.5 units) to cover a normalised model's ~2-unit footprint.
- **Old dual-mode tokens landed off the 3D table.** Legacy saves mixed
  coordinate spaces (x sometimes 2D pixels, z world units); tokens with
  pixel-scale x landed far outside the 40-unit ground and could not be clicked
  or dragged. Migration now recognises pixel-scale coordinates and rescales.

### Added
- **Fog of war works in 3D rooms.** Scene3D gained a fog overlay: a canvas
  texture laid just above the ground plane, driven by the same FogTool and the
  same stroke store/format as the 2D fog (brush/eraser/rect/circle/polygon,
  cut/reveal, reveal-all/hide-all, colour). Strokes are centre-anchored in the
  shared 2D-pixel stroke space (70px per square), so saved and remote fog
  stays cross-compatible between room kinds. Brushed fog also honours the
  tool's colour/size now (shapes already did; brushes used to hardcode both).

## [0.7.4] - 2026-10-25

Hotfix for two user-reported issues (against the 0.7.2 appstore build).

**Credit: thanks to DJ-Key for pinpointing the blank-page root cause** (the
doubled `index.php` app path in the menu link) — that observation led to the
router-base fix below.

### Fixed
- **White page when opening Grimoire from the app menu; "Page not found" on
  reload.** The Vue router base was hardcoded to the pretty web path
  (`<webroot>/apps/grimoire`), but servers reach the SPA two ways: pretty URLs
  or the front-controller path (`/<webroot>/index.php/apps/grimoire/…`). On
  front-controller servers the base never matched, no route resolved, and the
  app rendered an empty page; router-pushed paths also 404ed on reload. The
  base is now derived at boot from the URL the page was actually served at, so
  both serving modes — and subdirectory webroots — work, and deep links
  (`/c/{campaignId}/s/{sceneId}`) reload correctly.
- **glb files visible but not pickable in the 3D model picker.** The legacy
  `OC.dialogs.filepicker` signature on NC 28+ is
  `(title, callback, multiselect, mimetype, _modal, type, path, options)` —
  the call filled the trailing slots positionally as
  `(false, undefined, null, true)`, putting `null` in the `type` slot; with
  `type !== Choose`, NC never shows the dialog's Choose button, so model files
  were listed but could not be selected. The deprecated trailing slots
  (`_modal`, `type`, `path`) are now left empty so the picker opens in its
  default Choose mode.

## [0.7.3] - 2026-10-25

Room-kind rework, invite hardening, Nextcloud 35, and a port of the sync /
3D / files-loading fixes verified in code review.

### Changed — rooms are 2D or 3D, never both
- **Room creation reworked.** The `prompt()`/`confirm('3D?')` flow is replaced
  by a New Room modal with an explicit 2D/3D kind picker; the choice is set on
  the scene row at creation and permanent. Room.vue now instantiates exactly
  one engine (Scene2D *or* Scene3D) and one adapter — the 2D/3D toggle inside a
  room is gone (a campaign can still hold rooms of both kinds).
- Scene docs are per-room-kind native (2D: pixels; 3D: world units); tokens
  saved by the old dual-mode rooms are migrated best-effort on load.
- Asset picker adapts to the room kind: multi-map + image-token tabs in 2D, a
  3D models tab in 3D; token spawn positions use the room's native units.

### Fixed — sync
- **Dice rolls broadcast in one copy.** DicePanel drove the main roller's
  `onSettle` *and* the room's own handler re-broadcast the roll — every roll
  reached the room twice. Panel results no longer re-emit for the shared roller.
- **Other players' rolls display.** `remoteDice` was received but never
  rendered; the dice panel shows a "someone else rolled" block now.
- **SyncClient transport fixes.** Leaving a room no longer leaves the client
  reconnecting forever; an unreachable relay now degrades to long-polling
  (documented behaviour that was never implemented); polling endpoints are no
  longer hardcoded to `/index.php/…` (works in subdirectory webroots);
  malformed relay frames no longer throw; high-frequency `pointer:move` is
  coalesced (~12/s) instead of one POST per mouse-move.
- **Remote pointers render** (pointer:show/move/hide were broadcast but never
  handled) and **remote AoE templates render in 2D** (only 3D got them).
- **AoE radius measures in grid squares** at the tool, matching both adapters'
  expectations — dragging a template in 2D no longer explodes its size.

### Fixed — 3D
- **Models rest on the ground again** (regressed during 0.7.x): tokens are
  bottom-baked at load time, so a model's placement is y = height, not
  half-height for everything.
- **glTF load races**: updates during a load no longer clobber fresher data;
  removing a token while its model streams in no longer leaves a ghost mesh.
- **Model scale honoured** (silently ignored before — only primitives scaled).
- **Token positions persist after moves**: `dragend` and the adapters' moves now
  stamp `entry.data`, and 3D serialize() reports live mesh positions (used to
  save stale positions).
- Map textures are disposed on swap (no more VRAM leak).

### Fixed — Nextcloud files
- **Asset WebDAV URLs fixed for real.** `generateRemoteUrl('dav') + <path>`
  resolves against the server DAV root, not the user's files — those URLs
  401/404. Uses the `webdav` alias (current user's files root) with per-segment
  URL encoding for names containing spaces/umlauts/`#`.
- **File picker prefers the current API.** Legacy `OC.dialogs.filepicker` is
  deprecated (apps are flagged for it); the picker now opens via
  `@nextcloud/dialogs` FilePickerBuilder (tolerating its v5–v7 shapes) and
  falls back to the legacy global. New dependency: `@nextcloud/dialogs`.
- **Map load failures are visible** (toast) instead of unhandled rejections.

### Fixed — backend
- **Invite/remove validates users** and rejects inviting the owner; the roster
  can no longer hold dead uids.
- **Invitations email the player** (best-effort; a missing address doesn't
  block the invite).
- **Raw-body fallbacks** on the players and permissions PUT endpoints — the
  body-binding miss pattern behind the invite saga returned 200 and silently
  dropped changes; permissions now also refuse to overwrite the saved table
  with all-defaults when the body never arrived.
- Permanent 3D rulers persist in the scene document.

### Removed
- Dead code left behind by the 0.7.1 addon consolidation: the iframe addon
  host (`src/addons/`), AddonPanel, BrowseList, DiceViewport (superseded by the
  DicePanel's own viewport), and the superseded DiceTray, GridSettings and
  PermissionsPanel popovers, plus the plugin docs and the example addon.

### Changed
- `info.xml`: version 0.7.3, Nextcloud support through 35.
- README rewritten to describe the current feature set (it still said 0.3.0).

## [0.7.2] - 2026-06-25

### Fixed
- **File picker now works.** Fixed `OC.dialogs.filepicker` call to use the
  correct 7-arg signature for Nextcloud 28+ — the picker shows a "Choose"
  button and the callback fires with the selected path.
- **Permanent rulers no longer snap horizontal.** In 3D the ruler stored
  y=0 (ground height) instead of z (depth), so all rulers appeared as flat
  horizontal lines. Now stores both y and z so the ruler renders at the
  correct depth in 3D mode.
- **Render loop no longer steps dice in 2D mode.** The 3D DiceRoller was
  stepping even in 2D mode; now only steps when mode is 3D (the DicePanel
  manages its own world in 2D).

### Added
- **DM Control Panel.** A comprehensive left-side sidebar (🛠 in the toolbar,
  GM only) consolidating all DM controls:
  - Scene: rename, grid type/size/line-width/opacity/style/colour, scale
  - Layers: toggle visibility for grid, drawings, fog, fog preview
  - Player permissions: per-layer create/update/delete/owner-only table
  - Players: search Nextcloud users, invite, remove
  - Session: send reminders, reveal all fog, delete scene
  Replaces the separate GridSettings and PermissionsPanel popovers.

## [0.7.1] - 2026-06-25

### Changed
- **Consolidated dice UI.** Replaced the separate floating DiceTray and
  DiceViewport with a single DicePanel sidebar. In 2D mode it shows a mini 3D
  canvas with the physics dice; in 3D mode it drives the main scene's
  DiceRoller. One panel, mode-appropriate behavior.
- **Asset picker fixed.** Rewrote AssetPicker to use Nextcloud's native
  `OC.dialogs.filepicker` and proper WebDAV URLs via `generateRemoteUrl('dav')`,
  so maps/tokens/models load with session auth. Removed the broken custom
  BrowseList.
- **Addons inlined.** Removed the iframe-based addon system. The initiative
  tracker is now a built-in Vue component toggled from the topbar (⚔).
- **Nextcloud theming.** All colors now use Nextcloud CSS variables
  (--color-primary-element, --color-main-background, --color-main-text,
  --color-border, etc.) so the app follows the user's light/dark theme and
  the admin's accent color automatically. No more hardcoded gold/blue.

## [0.7.0] - 2026-06-23

### Added
- **Token health system.** DM-controlled HP bars on every token (2D bar + 3D
  billboard). GM double-clicks a token to edit HP; quick ±1/±5 buttons.
  Synced + persisted; GM-only server-side.
- **Measure modes.** Transient ruler, permanent rulers (synced/persisted,
  right-click to delete), and movement mode (drag a token with a live ruler).
  Four measurement types: euclidean, chessboard, alternating-diagonal,
  manhattan. Per-scene ft/square scale.
- **Grid controls.** Square / hex-pointy / hex-flat grids, line style
  (solid/dashed/dotted), colour, opacity, width, per-scene scale. Grid
  settings popover (⊞ in the toolbar, GM only).
- **Player permissions.** Per-layer create/update/delete toggles for
  maps/tokens/drawings/fog, plus owner-only tokens. Enforced server-side on
  the room relay; GM bypasses. Permissions panel (🔒, GM only).
- **Fog shapes & preview.** Rect/circle/polygon fog modes (plus
  brush/eraser), cut/uncut toggle, fog preview (GM sees player view),
  configurable fog colour.
- **Drawing modes.** Pen, marker (closed freehand), line, rect, ellipse,
  triangle, hexagon, polygon (click-to-add, double-click to close), text.
  Separate stroke + fill colour pickers and width slider. Synced + persisted.
- **Rich text on canvas.** In-place contentEditable editor (bold/italic/
  lists/headings/emoji) replacing the prompt() dialog; HTML overlay that
  tracks pan/zoom.
- **Multiple maps per scene.** Add maps without replacing (multi-floor /
  side-by-side), lock/unlock + scale each map for grid alignment. Synced +
  persisted.
- **2D dice viewport.** A self-contained 3D physics dice tray in a corner
  canvas in 2D mode, so players roll and see the result without leaving the
  battlemap. Rolls broadcast to the room.
- **Signed room tokens.** HMAC-signed short-lived tokens; the relay verifies
  signature + expiry against a shared secret. Live multiplayer no longer
  needs DEV_TRUST.
- **Nextcloud 34 support.** Dependency max-version bumped to 34.
- **Asset library.** AssetController browses Nextcloud Files (folders,
  thumbnails, direct file serving) with a BrowseList picker.
- **Addon store verification.** Catalog entries validated server-side;
  verified badge in the UI; warns on non-catalog installs.
- **Dice calibration.** d8/d12/d20 canonical face maps (opposites sum to
  max+1); d10 rebuilt as a true pentagonal trapezohedron.
- **App Store-ready metadata.** info.xml now includes website, repository,
  documentation links, and uses the SPDX licence identifier
  (AGPL-3.0-or-later).

## [0.6.1] - 2026-06-23

### Added
- **2D dice viewport.** A small embedded 3D render of the physics dice tray
  (`DiceViewport`) now shows in 2D mode — open it from the "3D Dice" tab in the
  corner, pick dice, and roll. The dice tumble in their own self-contained 3D
  scene, so players in 2D mode get the physics-dice experience without leaving
  the battlemap. Rolls broadcast to the room like any other.

## [0.6.0] - 2026-06-23

### Added
- **Nextcloud 34 support.** The `nextcloud` dependency in `info.xml` now allows
  up to 34 (was capped at 33).
- **Signed room tokens** for the WebSocket relay. `RoomController::token` now
  mints HMAC-signed short-lived tokens (`<roomId>.<userId>.<sig>.<exp>`), and
  `server/relay.js` verifies them against a shared secret — live multiplayer no
  longer needs `GRIMOIRE_DEV_TRUST=1`.
- **Fog of war** (2D). A paintable mask layer in `Scene2D` with a Fog tool:
  brush to hide, eraser to reveal, plus "reveal all"/"hide all". GM-only; synced
  to the room and saved with the scene.
- **Asset library backed by Nextcloud Files.** The asset picker now browses your
  own Nextcloud storage (folders, thumbnails) instead of only a URL prompt.
- **glTF upload + placement UI.** Models picked from Nextcloud Files are placed
  in the 3D scene at the cursor; a thumbnail is generated for the asset panel.
- **Player roles (GM vs player).** Invited players are marked `player`; the
  owner is `gm`. GM-only actions (fog, scene delete, manage players) are gated
  server-side and hidden in the UI for players.
- **Dice calibration.** d8/d12/d20/d10 face maps are now hand-matched to real
  die numbering (opposite faces sum to max+1 for d8/d12/d20; d10 rebuilt as a
  proper pentagonal trapezohedron via lathe geometry).
- **Drawing tools.** Freehand pen, rectangle, ellipse, and text notes on the 2D
  canvas, with colour and stroke width. Synced and persisted.
- **Addon store verification.** Catalog entries are checked against the schema
  before listing; the in-app store shows a "verified" badge and warns on
  unverified installs.

## [0.5.3] - 2026-06-01

### Fixed
- **Grab now works on 3D models.** The 3D token picker expected normalized
  device coords but the grab tool passes a world point, so raycasting missed
  every model (and primitive). Rewritten to select the nearest token to the
  clicked ground point, which also handles multi-mesh glTF model groups.
- **Large dice rolls now resolve.** The result only computed once every die
  reached the physics SLEEPING state; with many dice they jostle each other and
  never all sleep, so the total never appeared. Added a velocity-based settle
  fallback and a hard timeout so a roll always produces a result.
## [0.5.2] - 2026-06-01

### Fixed
- **Addon proxy regex crash.** The URL-rewriter used '#' as the regex delimiter
  while the pattern also contained '#', producing "Unknown modifier ')'" and a
  null that crashed the second replace — every addon load 500-ed. Switched to a
  '~' delimiter and guarded both replaces against null.
- **Multiplayer dropped moves.** push() did a non-atomic read-modify-write on a
  shared cache buffer, so simultaneous updates (e.g. two players dragging
  tokens) clobbered each other. Rewritten to an atomic per-message scheme using
  the cache's atomic counter, so concurrent pushes can't lose messages.
- **Sync recovery after a session ends.** poll() now detects a cleared/expired
  cache buffer and tells the client to resync its cursor instead of stalling.
- **Invites silently failing.** Saving a campaign (used by invite/remove player)
  had no error handling, so a failed save looked like a player was added when it
  wasn't. Failures now surface, and local state syncs to what the server stored.
## [0.5.1] - 2026-06-01

### Fixed
- **Addon proxy no longer 500s.** Hardened AddonProxyController: it no longer
  reads the remote Content-Type header (inferring type from the file extension
  instead), every CSP method call is guarded against removal across Nextcloud
  versions, and any unexpected error now returns a readable message inside the
  addon frame instead of Nextcloud's generic Internal Server Error page.

## [0.5.0] - 2026-06-01

### Added
- **Map building in 3D.** New Build tool: place box / cylinder / sphere / cone /
  ramp primitives to construct maps, with a colour and height palette.
  Left-click places, right-click deletes; placements sync to the room and are
  saved with the scene.
- **Addons persist server-side.** Installed addons are stored per user
  (grimoire_addons table) and reload automatically — they no longer vanish on
  refresh and follow your account across devices.
- **Addon store.** A Store tab in Extensions lists the community catalog
  (served from /api/addons/store) with one-click install.
- Free-movement vs snap toggle (from 0.4.7) now also governs placed blocks.

### Notes
- Environment/terrain upload is intentionally deferred to a focused follow-up.

## [0.4.7] - 2026-06-01

### Fixed
- **Addons finally run** — served same-origin through a new addon proxy
  (AddonProxyController) with a per-response relaxed CSP, instead of fighting
  Nextcloud's strict nonce CSP via blob/srcdoc (which the browser kept blocking).
  The proxy fetches the third-party addon files server-side and rewrites their
  relative URLs (and the SDK import) to stay proxied. Hosts are allowlisted.
- **Measurement tool now measures vertical distance too.** In 3D it was reading
  the height axis (≈0) instead of depth, so only horizontal movement counted.
- **Images added via the model picker no longer error** — a PNG/JPG is now
  placed as a flat token instead of being fed to the glTF loader.

### Added
- **Free-movement toggle** (🧲/✥ in the toolbar): switch between snap-to-grid
  and free token placement, in both 2D and 3D.

## [0.4.6] - 2026-06-01

### Fixed
- **Addons now execute under Nextcloud's CSP.** A srcdoc iframe inherited the
  host's strict nonce-based Content-Security-Policy, which blocked the addon's
  inline script (and the injected <base>) entirely. Addon UIs are now loaded as
  a blob: URL carrying their own permissive CSP meta tag, and the page CSP
  allows blob: frames. This is what was actually stopping the initiative
  tracker's script from running.

## [0.4.5] - 2026-06-01

### Fixed
- **Addons now actually run.** The host ignored the SDK's `hello` handshake and
  never sent `ready`, so every addon hung on `await GRIM.ready()` before wiring
  up its UI — the initiative tracker's button did nothing. The host now answers
  the handshake (and re-sends `ready` on frame load to avoid a srcdoc timing
  race), so addon calls (getItems, dice.roll, broadcast) work end to end.

## [0.4.4] - 2026-06-01

### Fixed
- **Reminder emails now actually send.** The code called a non-existent mail
  method (`setPlainTextBody`), which 500-ed every reminder. Corrected to
  Nextcloud's `setPlainBody`. (The From-address fix from 0.4.2 remains.)

## [0.4.3] - 2026-06-01

### Fixed
- **Shared campaigns now appear for invited players.** The campaign list only
  queried by owner; it now also returns campaigns where you're a listed player
  (marked "shared with you"), and players can list and open those scenes.
  Create/delete/manage remain owner-only.
- **Addon dice rolls now return a value.** `GRIM.dice.roll()` resolved before the
  physics dice settled, so the example tracker scored everyone 0 and appeared to
  do nothing. Added `rollAsync` so the SDK awaits the settled result; addons also
  now see tokens from both 2D and 3D scenes.
- Reminder failures in the UI now show the HTTP status to aid diagnosis.

## [0.4.2] - 2026-06-01

### Fixed
- **Reminder emails now set a From address** (system mail_from, or a no-reply
  derived from the instance URL). A missing sender is the most common reason
  Nextcloud silently fails to send, even when the admin's test email works.
- **Email failures now report the real reason** in the reminder result and the
  Nextcloud log, instead of a generic "(send error)".

### Added
- The room-token response reports whether a distributed cache backs multiplayer;
  if not, the room shows a one-time notice and runs local-only, so a missing
  memory cache no longer fails silently.

## [0.4.1] - 2026-06-01

### Fixed
- **Measure tool now shows the distance** as a screen-space label that stays
  legible at any zoom, in both 2D and 3D (the 3D label was never rendered).
- **Extensions load locally** — addon UIs are now fetched and mounted via iframe
  `srcdoc` with the SDK inlined, so plugins hosted on GitHub (which sends
  `X-Frame-Options: deny` on raw files, causing "refused to connect") work.

### Added
- **Addon sidebar actions** — plugins can call `GRIM.action.create({id,name,icon})`
  to add a button to the room toolbar that opens their panel. The example
  initiative tracker now registers one.

## [0.4.0] - 2026-05-31

### Added
- **Real-time multiplayer** via a `RoomController` relay over Nextcloud's
  distributed cache — token positions, maps, AoE templates, and dice now sync
  between players in a room with no extra service to deploy (long-poll
  transport; point `GRIMOIRE_RELAY_URL` at the WS relay for lower latency).
- **Save button** persisting both 2D and 3D scene state (map + tokens + blocks).
- **Delete campaign** button (with confirmation).
- **Player presence indicator** in the room topbar.
- Discord **dice-roll and player-join events** now fire when those messages
  flow through the room relay (previously dormant).

### Fixed
- **Inviting a player now shows a confirmation** instead of silent success.
- **Extensions "Add" button** now reports success/failure (was failing silently
  on unreachable/CORS-blocked manifest URLs) and supports removing extensions.

## [0.3.0] - 2026-05-31

### Added
- **Player roster** with display names and per-player email status.
- **Individual session reminders** — send a reminder to one player, not just all.
- **Discord webhooks** per campaign, with configurable events (session
  reminders wired; dice-roll and player-join events save but fire once the
  real-time room layer lands). Webhook URL is stored server-side only and never
  sent to the browser; an SSRF guard restricts it to real Discord URLs.
- **Plugin developer documentation** (`docs/PLUGINS.md`, `docs/API.md`) and a
  **community plugin catalog** (`catalog/plugins.json` + submission flow).
- GitHub scaffolding: CI (build + catalog validation), tagged release packaging,
  issue/PR templates, `CONTRIBUTING.md`, `LICENSE`, `.gitignore`.

### Fixed
- **Invite players** now works — replaced the admin-only, mis-pathed
  provisioning API call with a dedicated `/api/users/search` endpoint usable by
  any logged-in user.
- **glTF/GLB models** now surface load errors (with a visible placeholder and
  toast) instead of silently failing, auto-switch to 3D so the model is visible,
  and auto-scale to a sensible size.
- **Measure tool** can toggle between feet and meters.
- **Area-of-effect templates** can be deleted (right-click one, or "Clear all"),
  with deletions broadcast to the room.
- **2D grab** hit-testing fixed (it previously mixed screen and world
  coordinates so clicks rarely landed on a token).

## [0.2.0] - 2026-05-31

### Fixed
- App no longer renders blank on Nextcloud 30+ — the bundle crashed on a
  `process is not defined` reference; Vite now defines `process.env.NODE_ENV`.
- The compiled stylesheet is now actually loaded (`Util::addStyle`), fixing the
  unstyled / left-collapsed layout.
- App root is pinned below the Nextcloud header so it fills the content area on
  any Nextcloud version.
- Router no longer depends on `@nextcloud/router` resolving the webroot at
  module-init time (a separate blank-page cause).

## [0.1.0] - 2026-05-31

### Added
- Initial foundation: Nextcloud app structure, campaign/scene model, 2D (Konva)
  and 3D (three.js) modes sharing one tool set via `SceneAdapter`, physics dice
  (cannon-es), pointer/grab/measure/AoE tools, sandboxed plugin system with the
  `GRIM` SDK, a sync client with polling fallback, a reference WebSocket relay,
  and a standalone demo harness.
