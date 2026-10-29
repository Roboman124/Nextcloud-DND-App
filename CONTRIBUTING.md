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

To see your changes: symlink the folder into `custom_apps/grimoire`, run
`npm run build` (or keep `npm run dev` running), then `php occ app:enable
grimoire` and hard-refresh the browser. The app runs only inside Nextcloud —
backend, auth, multiplayer and the UI are all part of the same app.

The app id, the containing folder name, and `<id>` in `appinfo/info.xml` must all
be `grimoire`. The built bundle must stay `js/grimoire-main.js` (matches
`PageController::index`'s `addScript`).

## Project layout

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design. The short version:

- `src/engine/` — framework-agnostic engine (2D Konva, 3D three.js, dice, sync).
  **Do not import three/cannon/konva directly here** — they're dependency-injected
  so the engine stays testable and portable without a bundler.
- `src/tools/` — pointer/grab/measure/AoE tools, written once via `SceneAdapter`
  so they work in both 2D and 3D.
- `src/views/Room.vue` — the integration point where it all comes together.
- `lib/` — PHP backend (controllers, DB mappers, services, migrations).

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
