# Contributing to Grimoire

Thanks for helping build a self-hosted virtual tabletop! This guide covers the
dev setup and how the project is organized.

## Dev setup

```bash
git clone https://github.com/CHANGE-ME/grimoire
cd grimoire
npm install
npm run dev      # vite build --watch -> js/grimoire-main.js (+ css/)
```

Two ways to see your changes:

- **Standalone demo** (no Nextcloud): `npx serve .` then open `/demo.html`. Fast
  for engine/tool work. Note the demo loads three/cannon/konva from a CDN, so it
  needs network access.
- **In Nextcloud**: symlink the folder into `custom_apps/grimoire`, run
  `npm run build`, then `php occ app:enable grimoire`. Required for anything
  touching the PHP backend, auth, or multiplayer.

The app id, the containing folder name, and `<id>` in `appinfo/info.xml` must all
be `grimoire`. The built bundle must stay `js/grimoire-main.js` (matches
`PageController::index`'s `addScript`).

## Project layout

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design. The short version:

- `src/engine/` — framework-agnostic engine (2D Konva, 3D three.js, dice, sync).
  **Do not import three/cannon/konva directly here** — they're dependency-injected
  so the same code runs in the Nextcloud bundle and the standalone demo.
- `src/tools/` — pointer/grab/measure/AoE tools, written once via `SceneAdapter`
  so they work in both 2D and 3D.
- `src/addons/` — plugin host + the guest `GRIM` SDK.
- `src/views/Room.vue` — the integration point where it all comes together.
- `lib/` — PHP backend (controllers, DB mappers, services, migrations).
- `docs/` — plugin developer docs.

## Conventions

- Keep the engine dependency-injected and framework-agnostic.
- New tools go through `SceneAdapter` verbs, not direct scene access.
- New plugin capabilities must be gated in `AddonManager`'s permission map **and**
  documented in `docs/API.md` + `docs/PLUGINS.md`.
- Webhook URLs and other secrets must never be sent to the browser (see how
  `CampaignController` sanitizes Discord config).

## Pull requests

Run `npm run build` before opening a PR; CI will also build and validate the
plugin catalog. Keep PRs focused. If you change the SDK, update the docs in the
same PR.

## License

By contributing you agree your contributions are licensed under AGPL-3.0-or-later,
the same as the project.
