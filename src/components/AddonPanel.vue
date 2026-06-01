<template>
  <div class="panel">
    <header>
      <h3>Extensions</h3>
      <button @click="$emit('close')">✕</button>
    </header>

    <div class="tabs">
      <button :class="{on: tab==='installed'}" @click="tab='installed'">Installed</button>
      <button :class="{on: tab==='store'}" @click="openStore">Store</button>
    </div>

    <!-- INSTALLED TAB -->
    <template v-if="tab==='installed'">
      <div class="add">
        <input v-model="url" placeholder="manifest.json URL" @keyup.enter="install" />
        <button @click="install" :disabled="busy">{{ busy ? '…' : 'Add' }}</button>
      </div>
      <p v-if="status" class="status" :class="status.ok ? 'ok' : 'err'">{{ status.msg }}</p>
      <ul>
        <li v-for="a in installed" :key="a.id">
          <span>{{ a.name }} <em>v{{ a.version }}</em></span>
          <span class="row-actions">
            <button @click="open(a)">Open</button>
            <button class="danger" @click="remove(a)">✕</button>
          </span>
        </li>
      </ul>
      <p v-if="!installed.length" class="empty">No extensions installed yet. Add a manifest URL above, or browse the Store.</p>
    </template>

    <!-- STORE TAB -->
    <template v-else>
      <p v-if="storeStatus" class="status" :class="storeStatus.ok ? 'ok' : 'err'">{{ storeStatus.msg }}</p>
      <ul class="store-list">
        <li v-for="p in store" :key="p.manifestUrl" class="store-item">
          <div class="store-meta">
            <strong>{{ p.name }}</strong> <span class="dim">by {{ p.author }}</span>
            <p class="desc">{{ p.description }}</p>
            <p v-if="p.permissions" class="perms">needs: {{ p.permissions.join(', ') }}</p>
          </div>
          <button :disabled="isInstalled(p.manifestUrl) || busy"
            @click="installFromStore(p)">
            {{ isInstalled(p.manifestUrl) ? 'Installed' : 'Install' }}
          </button>
        </li>
      </ul>
      <p v-if="!store.length" class="empty">No addons in the catalog yet.</p>
    </template>

    <div ref="mount" class="mount" />
  </div>
</template>

<script>
import axios from '@nextcloud/axios';
import { generateUrl } from '../lib/url.js';

/**
 * Extensions panel. Installs persist server-side (per user) via /api/addons, so
 * they survive reloads and follow the account across devices. A Store tab lists
 * the community catalog and installs with one click.
 */
export default {
  name: 'AddonPanel',
  props: { manager: Object },
  data() {
    return {
      tab: 'installed',
      url: '', busy: false, status: null,
      installed: [],          // [{id, name, version, manifestUrl}]
      store: [], storeStatus: null, storeLoaded: false,
    };
  },
  methods: {
    api(p) { return generateUrl('/apps/grimoire/api' + p); },

    /** Load persisted installs from the server and register them in the manager. */
    async loadInstalled() {
      try {
        const { data } = await axios.get(this.api('/addons'));
        this.installed = data;
        // Register each with the in-memory manager so Open works immediately.
        for (const a of data) {
          try { await this.manager.install(a.manifestUrl); } catch { /* skip unreachable */ }
        }
        // Surface any sidebar actions the addons declare by briefly priming them
        // is out of scope here; actions register when the addon UI is opened.
      } catch {
        this.installed = [];
      }
    },

    isInstalled(manifestUrl) {
      return this.installed.some((a) => a.manifestUrl === manifestUrl);
    },

    async install() {
      const url = this.url.trim();
      if (!url) return;
      await this._doInstall(url);
      this.url = '';
    },

    async installFromStore(p) {
      await this._doInstall(p.manifestUrl);
    },

    async _doInstall(url) {
      this.busy = true;
      this.status = null;
      try {
        let parsed;
        try { parsed = new URL(url); } catch { throw new Error('That is not a valid URL.'); }
        if (parsed.protocol !== 'https:') throw new Error('URL must start with https://');
        // Persist server-side (also validates the manifest is fetchable).
        const { data } = await axios.post(this.api('/addons'), { manifestUrl: url });
        // Register in the live manager so it can be opened now.
        await this.manager.install(url);
        if (!this.installed.some((a) => a.id === data.id)) this.installed.push(data);
        this.status = { ok: true, msg: `Installed ${data.name || url}.` };
        this.storeStatus = this.tab === 'store' ? { ok: true, msg: `Installed ${data.name}.` } : null;
      } catch (e) {
        const msg = e?.response?.data?.error || e.message || 'install failed';
        this.status = { ok: false, msg: `Couldn't install: ${msg}` };
        this.storeStatus = this.tab === 'store' ? this.status : null;
      } finally {
        this.busy = false;
        setTimeout(() => { this.status = null; this.storeStatus = null; }, 7000);
      }
    },

    async remove(a) {
      try {
        await axios.delete(this.api('/addons/' + a.id));
        this.installed = this.installed.filter((x) => x.id !== a.id);
        // Best-effort: also drop from the in-memory manager.
        for (const [id, x] of this.manager.addons) {
          if (x.manifest && x.manifest._installUrl === a.manifestUrl) this.manager.uninstall(id);
        }
      } catch {
        this.status = { ok: false, msg: 'Could not uninstall.' };
      }
    },

    async openStore() {
      this.tab = 'store';
      if (this.storeLoaded) return;
      try {
        const { data } = await axios.get(this.api('/addons/store'));
        this.store = data.plugins || [];
        this.storeLoaded = true;
      } catch {
        this.storeStatus = { ok: false, msg: 'Could not load the store.' };
      }
    },

    async open(a) {
      this.$refs.mount.innerHTML = '';
      try {
        // Find the manager id for this manifest URL.
        let mid = null;
        for (const [id, x] of this.manager.addons) {
          if (x.manifest && (x.manifest.main && a.manifestUrl)) {
            // match by install url stored on the manifest
          }
        }
        mid = await this.manager.install(a.manifestUrl); // idempotent; returns id
        await this.manager.open(mid, this.$refs.mount);
      } catch (e) {
        this.status = { ok: false, msg: `Couldn't open: ${e.message || e}` };
        setTimeout(() => { this.status = null; }, 7000);
      }
    },

    /** Programmatic open used by addon sidebar actions (by manager id). */
    async openById(id) {
      try { await this.manager.open(id, this.$refs.mount); } catch { /* ignore */ }
    },
  },
  mounted() { this.loadInstalled(); },
};
</script>

<style scoped>
.panel { position: absolute; right: 14px; top: 14px; width: 380px; max-height: 82%;
  display: flex; flex-direction: column; padding: 14px; border-radius: 16px;
  background: rgba(18,14,10,.97); border: 1px solid #3a3024; z-index: 40; }
header { display: flex; justify-content: space-between; align-items: center; }
h3 { color: #c9a227; letter-spacing: .15em; text-transform: uppercase; font-size: 12px; }
.tabs { display: flex; gap: 6px; margin: 10px 0; }
.tabs button { flex: 1; background: #1a140d; color: #8a7d63; border: 1px solid #3a3024;
  border-radius: 8px; padding: 6px; cursor: pointer; }
.tabs button.on { background: #c9a227; color: #120e0a; border-color: #c9a227; font-weight: 600; }
.add { display: flex; gap: 6px; margin: 8px 0; }
.add input { flex: 1; background: #120e0a; border: 1px solid #3a3024; color: #e9dfc4;
  border-radius: 8px; padding: 8px; }
button { font: inherit; background: #231c13; color: #e9dfc4; border: 1px solid #3a3024;
  border-radius: 8px; padding: 6px 12px; cursor: pointer; }
button:disabled { opacity: .5; cursor: default; }
ul { list-style: none; padding: 0; margin: 0; overflow-y: auto; }
li { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; }
li em { color: #c9a227; font-size: 11px; }
.store-item { align-items: flex-start; gap: 10px; border-bottom: 1px solid #2a2218; padding: 10px 0; }
.store-meta { flex: 1; }
.store-meta .dim { color: #8a7d63; font-size: 11px; }
.store-meta .desc { margin: 4px 0 2px; font-size: 12px; color: #cbbfa3; }
.store-meta .perms { margin: 0; font-size: 10px; color: #8a7d63; font-style: italic; }
.mount { flex: 1; min-height: 200px; margin-top: 10px; border-radius: 10px; overflow: hidden; }
.status { font-size: 12px; margin: 4px 0; padding: 6px 8px; border-radius: 6px; }
.status.ok { color: #9ed8a8; background: rgba(40,90,50,.4); }
.status.err { color: #f0b6ac; background: rgba(120,40,30,.4); }
.empty { color: #8a7d63; font-size: 12px; font-style: italic; }
.row-actions { display: flex; gap: 4px; }
.row-actions .danger { color: #e0998c; }
</style>
