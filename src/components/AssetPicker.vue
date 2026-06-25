<template>
  <div class="asset-panel">
    <div class="panel-header">
      <span class="panel-title">Assets</span>
      <button class="close-btn" @click="$emit('close')">✕</button>
    </div>
    <div class="tabs">
      <button v-for="t in tabs" :key="t.id" :class="['tab', { on: activeTab === t.id }]" @click="activeTab = t.id">
        {{ t.label }}
      </button>
    </div>
    <div class="tab-body">
      <!-- MAP tab -->
      <template v-if="activeTab === 'map'">
        <p class="hint">Set a battle map from your Nextcloud Files.</p>
        <button class="pick-btn" @click="pickMap">🗺 Pick Map</button>
        <button class="pick-btn secondary" @click="pickMapExtra">➕ Add Map (multi-floor)</button>
        <div v-if="recentMaps.length" class="recent">
          <p class="recent-label">Recent</p>
          <div class="thumb-grid">
            <button v-for="m in recentMaps" :key="m.url" class="thumb" @click="applyMap(m.url)" :title="m.name">
              <img :src="m.url" :alt="m.name" />
              <span>{{ m.name }}</span>
            </button>
          </div>
        </div>
      </template>
      <!-- TOKENS tab -->
      <template v-if="activeTab === 'tokens'">
        <p class="hint">Add a character or NPC token.</p>
        <div class="token-form">
          <input v-model="tokenLabel" placeholder="Token name (e.g. Goblin)" class="token-input" />
          <div class="token-color-row"><label>Colour <input type="color" v-model="tokenColor" class="color-pick" /></label></div>
          <button class="pick-btn secondary" @click="pickTokenImage">🖼 Pick Token Image</button>
          <span v-if="tokenImageUrl" class="picked-name">{{ tokenImageName }}</span>
          <button class="pick-btn" @click="addToken" :disabled="!tokenLabel.trim()">+ Add Token</button>
        </div>
      </template>
      <!-- MODELS tab -->
      <template v-if="activeTab === 'models'">
        <p class="hint">Load a glTF/GLB 3D model as a token.</p>
        <div class="token-form">
          <input v-model="modelLabel" placeholder="Model name (e.g. Dragon)" class="token-input" />
          <button class="pick-btn secondary" @click="pickModel">📦 Pick glTF/GLB</button>
          <span v-if="modelUrl" class="picked-name">{{ modelName }}</span>
          <button class="pick-btn" @click="addModel" :disabled="!modelUrl">+ Add 3D Token</button>
        </div>
      </template>
    </div>
  </div>
</template>

<script>
import { generateUrl, generateRemoteUrl } from '../lib/url.js';

/**
 * AssetPicker — uses Nextcloud's native file picker (OC.dialogs.filepicker)
 * to select files from the user's storage, then builds a direct WebDAV
 * download URL the engine can load.
 */
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];

export default {
  name: 'AssetPicker',
  emits: ['close', 'setMap', 'addMap', 'addToken', 'addModel'],
  data() {
    return {
      activeTab: 'map',
      tabs: [
        { id: 'map', label: '🗺 Maps' },
        { id: 'tokens', label: '🧙 Tokens' },
        { id: 'models', label: '📦 3D Models' },
      ],
      recentMaps: [],
      tokenLabel: '', tokenColor: '#4a90d9',
      tokenImageUrl: null, tokenImageName: '',
      modelLabel: '', modelUrl: null, modelName: '',
    };
  },
  mounted() {
    try { this.recentMaps = JSON.parse(localStorage.getItem('grimoire_recent_maps') || '[]'); } catch { this.recentMaps = []; }
  },
  methods: {
    /** Open Nextcloud's native file picker. Returns a Promise<path>. */
    openPicker(title, mimes, allowDirs = false) {
      return new Promise((resolve) => {
        if (window.OC?.dialogs?.filepicker) {
          window.OC.dialogs.filepicker(title, (path) => resolve(path), false, mimes?.length ? mimes : undefined, allowDirs, true);
        } else {
          // Fallback for the standalone demo (no Nextcloud): paste a URL.
          const url = window.prompt('Paste a direct image/model URL:');
          if (url) resolve(url); else resolve(null);
        }
      });
    },
    /** Build a direct WebDAV download URL for a path the picker returned. */
    webdavUrl(path) {
      if (/^https?:\/\//.test(path)) return path; // already absolute
      return generateRemoteUrl('dav') + path.replace(/^\//, '');
    },
    async pickMap() {
      const path = await this.openPicker('Choose a map image', IMAGE_MIMES);
      if (!path) return;
      const url = this.webdavUrl(path);
      this.applyMap(url, path.split('/').pop());
    },
    async pickMapExtra() {
      const path = await this.openPicker('Add another map', IMAGE_MIMES);
      if (!path) return;
      const url = this.webdavUrl(path);
      this.$emit('addMap', url);
    },
    async pickTokenImage() {
      const path = await this.openPicker('Choose a token image', IMAGE_MIMES);
      if (!path) return;
      this.tokenImageUrl = this.webdavUrl(path);
      this.tokenImageName = path.split('/').pop();
      if (!this.tokenLabel.trim()) this.tokenLabel = this.tokenImageName.replace(/\.[^.]+$/, '');
    },
    async pickModel() {
      const path = await this.openPicker('Choose a glTF or GLB model', []);
      if (!path) return;
      this.modelUrl = this.webdavUrl(path);
      this.modelName = path.split('/').pop();
      if (!this.modelLabel.trim()) this.modelLabel = this.modelName.replace(/\.[^.]+$/, '');
    },
    applyMap(url, name) {
      const entry = { url, name: name || url.split('/').pop() };
      this.recentMaps = [entry, ...this.recentMaps.filter((m) => m.url !== url)].slice(0, 6);
      try { localStorage.setItem('grimoire_recent_maps', JSON.stringify(this.recentMaps)); } catch { /* ignore */ }
      this.$emit('setMap', url);
    },
    addToken() {
      if (!this.tokenLabel.trim()) return;
      this.$emit('addToken', {
        id: 'token_' + Date.now(), label: this.tokenLabel.trim(),
        url: this.tokenImageUrl || null, color: this.tokenColor,
        x: 70, y: 70, size: 1, kind: 'primitive',
      });
      this.tokenLabel = ''; this.tokenImageUrl = null; this.tokenImageName = '';
    },
    addModel() {
      if (!this.modelUrl) return;
      this.$emit('addModel', {
        id: 'model_' + Date.now(), label: this.modelLabel.trim() || 'Model',
        url: this.modelUrl, kind: 'model', x: 0, z: 0, scale: 1,
      });
      this.modelLabel = ''; this.modelUrl = null; this.modelName = '';
    },
  },
};
</script>

<style scoped>
.asset-panel {
  position: absolute; left: 70px; top: 50%; transform: translateY(-50%);
  width: 280px; max-height: 480px; display: flex; flex-direction: column;
  background: var(--g-bg-dark); border: 1px solid var(--g-border);
  border-radius: var(--g-radius-large); overflow: hidden;
}
.panel-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px 10px; border-bottom: 1px solid var(--g-border); }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: .15em; text-transform: uppercase; color: var(--g-primary); }
.close-btn { background: none; border: none; color: var(--g-text-dim); cursor: pointer; font-size: 14px; }
.close-btn:hover { color: var(--g-text); }
.tabs { display: flex; border-bottom: 1px solid var(--g-border); }
.tab { flex: 1; padding: 8px 4px; font: inherit; font-size: 12px; background: none; border: none; cursor: pointer; color: var(--g-text-dim); border-bottom: 2px solid transparent; }
.tab.on { color: var(--g-primary); border-bottom-color: var(--g-primary); }
.tab:hover:not(.on) { color: var(--g-text); }
.tab-body { padding: 14px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 10px; }
.hint { font-size: 12px; color: var(--g-text-dim); margin: 0; line-height: 1.5; }
.pick-btn { padding: 9px 14px; border-radius: var(--g-radius); font: inherit; font-size: 13px; font-weight: 600; background: var(--g-primary); color: var(--g-primary-t); border: none; cursor: pointer; }
.pick-btn:hover:not(:disabled) { opacity: .88; }
.pick-btn:disabled { opacity: .35; }
.pick-btn.secondary { background: var(--g-bg-card); border: 1px solid var(--g-border); color: var(--g-text); }
.pick-btn.secondary:hover:not(:disabled) { border-color: var(--g-primary); }
.recent-label { font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: var(--g-text-dim); margin: 0 0 6px; }
.thumb-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.thumb { background: var(--g-bg-card); border: 1px solid var(--g-border); border-radius: 6px; overflow: hidden; cursor: pointer; padding: 0; text-align: left; }
.thumb img { width: 100%; aspect-ratio: 16/9; object-fit: cover; display: block; }
.thumb span { font-size: 10px; color: var(--g-text-dim); padding: 3px 5px; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.thumb:hover { border-color: var(--g-primary); }
.token-form { display: flex; flex-direction: column; gap: 8px; }
.token-input { width: 100%; box-sizing: border-box; padding: 7px 10px; font: inherit; font-size: 13px; background: var(--g-bg-card); border: 1px solid var(--g-border); border-radius: var(--g-radius); color: var(--g-text); }
.token-input:focus { outline: none; border-color: var(--g-primary); }
.token-color-row { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--g-text-dim); }
.color-pick { width: 36px; height: 24px; border: none; border-radius: 4px; cursor: pointer; background: none; padding: 0; margin-left: 6px; }
.picked-name { font-size: 11px; color: var(--g-text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; }
</style>