# Changelog

All notable changes to Grimoire are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
semantic versioning.

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
