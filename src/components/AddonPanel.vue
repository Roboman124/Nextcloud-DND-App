<template>
  <div class="panel">
    <header>
      <h3>Extensions</h3>
      <button @click="$emit('close')">✕</button>
    </header>
    <div class="add">
      <input v-model="url" placeholder="manifest.json URL" @keyup.enter="install" />
      <button @click="install" :disabled="busy">{{ busy ? '…' : 'Add' }}</button>
    </div>
    <p v-if="status" class="status" :class="status.ok ? 'ok' : 'err'">{{ status.msg }}</p>
    <ul>
      <li v-for="a in installed" :key="a.id">
        <span>{{ a.name }} <em>v{{ a.version }}</em></span>
        <span class="row-actions">
          <button @click="open(a.id)">Open</button>
          <button class="danger" @click="remove(a.id)">✕</button>
        </span>
      </li>
    </ul>
    <p v-if="!installed.length" class="empty">No extensions installed yet. Paste a manifest URL above.</p>
    <div ref="mount" class="mount" />
  </div>
</template>

<script>
/** Lists installed addons and mounts a selected one's sandboxed iframe UI. */
export default {
  name: 'AddonPanel',
  props: { manager: Object },
  data() { return { url: '', installed: [], busy: false, status: null }; },
  methods: {
    refresh() {
      this.installed = [...this.manager.addons.entries()].map(([id, a]) => ({
        id, name: a.manifest.name, version: a.manifest.version,
      }));
    },
    async install() {
      const url = this.url.trim();
      if (!url) return;
      this.busy = true;
      this.status = null;
      try {
        // Validate it looks like a URL before fetching, for a clearer error.
        let parsed;
        try { parsed = new URL(url); } catch { throw new Error('That is not a valid URL.'); }
        if (!/^https?:$/.test(parsed.protocol)) throw new Error('URL must start with http(s)://');
        const id = await this.manager.install(url);
        this.url = '';
        this.refresh();
        const a = this.manager.addons.get(id);
        this.status = { ok: true, msg: `Installed ${a?.manifest?.name || id}.` };
      } catch (e) {
        // Common real causes: CORS block, 404, or non-JSON response.
        this.status = { ok: false, msg: `Couldn't install: ${e.message || e}. The manifest URL must be reachable and return JSON (CORS-enabled).` };
      } finally {
        this.busy = false;
        setTimeout(() => { this.status = null; }, 7000);
      }
    },
    remove(id) {
      this.manager.uninstall(id);
      this.refresh();
    },
    async open(id) {
      this.$refs.mount.innerHTML = '';
      try {
        await this.manager.open(id, this.$refs.mount);
      } catch (e) {
        this.status = { ok: false, msg: `Couldn't open: ${e.message || e}` };
        setTimeout(() => { this.status = null; }, 7000);
      }
    },
    /** Programmatic open used by addon sidebar actions. */
    async openById(id) {
      this.refresh();
      await this.open(id);
    },
  },
  mounted() { this.refresh(); },
};
</script>

<style scoped>
.panel { position: absolute; right: 14px; top: 14px; width: 360px; max-height: 80%;
  display: flex; flex-direction: column; padding: 14px; border-radius: 16px;
  background: rgba(18,14,10,.96); border: 1px solid #3a3024; }
header { display: flex; justify-content: space-between; align-items: center; }
h3 { color: #c9a227; letter-spacing: .15em; text-transform: uppercase; font-size: 12px; }
.add { display: flex; gap: 6px; margin: 10px 0; }
.add input { flex: 1; background: #120e0a; border: 1px solid #3a3024; color: #e9dfc4;
  border-radius: 8px; padding: 8px; }
button { font: inherit; background: #231c13; color: #e9dfc4; border: 1px solid #3a3024;
  border-radius: 8px; padding: 6px 12px; cursor: pointer; }
ul { list-style: none; padding: 0; }
li { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; }
li em { color: #c9a227; font-size: 11px; }
.mount { flex: 1; min-height: 200px; margin-top: 10px; border-radius: 10px; overflow: hidden; }
.status { font-size: 12px; margin: 4px 0; padding: 6px 8px; border-radius: 6px; }
.status.ok { color: #9ed8a8; background: rgba(40,90,50,.4); }
.status.err { color: #f0b6ac; background: rgba(120,40,30,.4); }
.empty { color: #8a7d63; font-size: 12px; font-style: italic; }
.row-actions { display: flex; gap: 4px; }
.row-actions .danger { color: #e0998c; }
</style>
