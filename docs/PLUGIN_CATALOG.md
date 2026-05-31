# Submitting a Plugin to the Grimoire Catalog

The catalog ([`catalog/plugins.json`](../catalog/plugins.json)) is a single
JSON file that lists community plugins so players can discover them. Your plugin
code stays in **your** repository — the catalog only stores a pointer to your
`manifest.json` URL plus a short description.

## How to add yours

1. Host your plugin somewhere reachable by a browser (GitHub Pages, your own
   server, a Nextcloud public share, etc.) and make sure its `manifest.json` URL
   loads.
2. Fork this repository.
3. Add one object to the `plugins` array in `catalog/plugins.json`:

   ```json
   {
     "name": "Your Plugin",
     "author": "your name or handle",
     "description": "One or two sentences on what it does (10–280 chars).",
     "manifestUrl": "https://your.host/path/manifest.json",
     "homepage": "https://github.com/you/your-plugin",
     "tags": ["combat", "automation"],
     "permissions": ["scene:read", "dice"]
   }
   ```

4. Open a pull request. CI validates your entry against
   [`catalog/plugins.schema.json`](../catalog/plugins.schema.json) — make sure
   `manifestUrl` is `https://`, the description fits the length limits, and any
   `permissions` you list are real Grimoire permissions.

## Review criteria

We keep the bar light but real:

- The `manifestUrl` must load and be a valid manifest (see
  [PLUGINS.md](./PLUGINS.md)).
- `permissions` in your catalog entry should match what your manifest actually
  requests, so users can see what they're installing at a glance.
- No malicious behaviour. Plugins run sandboxed, but `broadcast` and
  `scene:write` still affect everyone's table — don't abuse them.
- Keep the description honest and free of marketing fluff.

## A note on trust

Listing in the catalog is **discovery, not endorsement**. Plugins run in your
browser in a sandboxed iframe and can only use the permissions you grant at
install time, but you should still install plugins from authors you trust, the
same as any browser extension. Review the `permissions` before installing.
