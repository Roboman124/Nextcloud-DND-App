<template>
  <div class="panel">
    <header>
      <h3>Extensions</h3>
      <button @click="$emit('close')">✕</button>
    </header>
    <div class="add">
      <input v-model="url" placeholder="manifest.json URL" />
      <button @click="install">Add</button>
    </div>
    <ul>
      <li v-for="a in installed" :key="a.id">
        <span>{{ a.name }} <em>v{{ a.version }}</em></span>
        <button @click="open(a.id)">Open</button>
      </li>
    </ul>
    <div ref="mount" class="mount" />
  </div>
</template>

<script>
/** Lists installed addons and mounts a selected one's sandboxed iframe UI. */
export default {
  name: 'AddonPanel',
  props: { manager: Object },
  data() { return { url: '', installed: [] }; },
  methods: {
    refresh() {
      this.installed = [...this.manager.addons.entries()].map(([id, a]) => ({
        id, name: a.manifest.name, version: a.manifest.version,
      }));
    },
    async install() {
      if (!this.url) return;
      await this.manager.install(this.url);
      this.url = '';
      this.refresh();
    },
    open(id) { this.$refs.mount.innerHTML = ''; this.manager.open(id, this.$refs.mount); },
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
</style>
