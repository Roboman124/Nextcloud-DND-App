<template>
  <div class="asset-panel">
    <div class="panel-header">
      <span class="panel-title">Assets</span>
      <button class="close-btn" @click="$emit('close')">✕</button>
    </div>

    <!-- Tabs -->
    <div class="tabs">
      <button v-for="t in tabs" :key="t.id"
        :class="['tab', { on: activeTab === t.id }]"
        @click="activeTab = t.id">
        {{ t.label }}
      </button>
    </div>

    <!-- MAP tab -->
    <div v-if="activeTab === 'map'" class="tab-body">
      <p class="hint">Set the battle map, or add additional maps to the same scene (e.g. multiple floors).</p>
      <button class="pick-btn" @click="pickFile('map', IMAGE_TYPES)">
        🗺 Set Map Image
      </button>
      <button class="pick-btn secondary" @click="pickFile('map-add', IMAGE_TYPES)">
        ➕ Add Map (multi-floor)
      </button>
      <div v-if="recentMaps.length" class="recent">
        <p class="recent-label">Recent</p>
        <div class="thumb-grid">
          <button v-for="m in recentMaps" :key="m.url" class="thumb" @click="applyMap(m.url)" :title="m.name">
            <img :src="m.url" :alt="m.name" />
            <span>{{ m.name }}</span>
          </button>
        </div>
      </div>
      <BrowseList kind="map" @pick="applyMap" />
    </div>

    <!-- TOKENS tab -->
    <div v-if="activeTab === 'tokens'" class="tab-body">
      <p class="hint">Add a character or NPC token. Pick an image, then set a label.</p>
      <div class="token-form">
        <input v-model="tokenLabel" placeholder="Token name (e.g. Goblin)" class="token-input" />
        <div class="token-color-row">
          <label>Colour <input type="color" v-model="tokenColor" class="color-pick" /></label>
        </div>
        <div class="pick-row">
          <button class="pick-btn secondary" @click="pickFile('token-image', IMAGE_TYPES)">
            🖼 Pick Image
          </button>
          <span v-if="tokenImageUrl" class="picked-name">{{ tokenImageName }}</span>
        </div>
        <button class="pick-btn" @click="addToken" :disabled="!tokenLabel.trim()">
          + Add Token
        </button>
      </div>
      <BrowseList kind="token" @pick="onPickTokenImage" />
    </div>

    <!-- MODELS tab -->
    <div v-if="activeTab === 'models'" class="tab-body">
      <p class="hint">Load a glTF / GLB 3D model as a token in the 3D scene.</p>
      <div class="token-form">
        <input v-model="modelLabel" placeholder="Model name (e.g. Dragon)" class="token-input" />
        <div class="pick-row">
          <button class="pick-btn secondary" @click="pickFile('model', MODEL_TYPES)">
            📦 Pick glTF/GLB
          </button>
          <span v-if="modelUrl" class="picked-name">{{ modelName }}</span>
        </div>
        <button class="pick-btn" @click="addModel" :disabled="!modelLabel.trim() || !modelUrl">
          + Add 3D Token
        </button>
      </div>
      <BrowseList kind="model" @pick="onPickModel" />
    </div>
  </div>
</template>

<script>
import { generateUrl } from '../lib/url.js';
import { loadState } from '@nextcloud/initial-state';
import BrowseList from './BrowseList.vue';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
// GLB/GLTF don't have standard mimetypes; pass empty to show all files.
const MODEL_TYPES = [];

export default {
  name: 'AssetPicker',
  components: { BrowseList },
  emits: ['close', 'setMap', 'addToken', 'addModel', 'addMap'],
  data() {
    return {
      IMAGE_TYPES,
      MODEL_TYPES,
      activeTab: 'map',
      tabs: [
        { id: 'map',    label: '🗺 Maps' },
        { id: 'tokens', label: '🧙 Tokens' },
        { id: 'models', label: '📦 3D Models' },
      ],
      recentMaps: [],
      tokenLabel: '',
      tokenColor: '#4a90d9',
      tokenImageUrl: null,
      tokenImageName: '',
      modelLabel: '',
      modelUrl: null,
      modelName: '',
    };
  },
  mounted() {
    this.userId = loadState('grimoire', 'userId', '');
    try {
      this.recentMaps = JSON.parse(localStorage.getItem('grimoire_recent_maps') || '[]');
    } catch { this.recentMaps = []; }
  },
  methods: {
    /** Open Nextcloud's native file picker. Works inside Nextcloud at runtime. */
    pickFile(target, mimetypes) {
      if (!window.OC?.dialogs?.filepicker) {
        alert('File picker is only available inside Nextcloud. In the demo, paste a URL directly.');
        const url = prompt('Paste a direct image/model URL:');
        if (url) this._applyPickedUrl(target, url, url.split('/').pop());
        return;
      }
      const title = target === 'map' ? 'Choose a map image'
                  : target === 'token-image' ? 'Choose a token image'
                  : 'Choose a glTF or GLB model';
      window.OC.dialogs.filepicker(title, (path) => {
        // Build a WebDAV URL the browser can load directly.
        const url = generateUrl('/remote.php/webdav') + path;
        const name = path.split('/').pop();
        this._applyPickedUrl(target, url, name);
      }, false, mimetypes.length ? mimetypes : undefined, true);
    },

    _applyPickedUrl(target, url, name) {
      if (target === 'map') {
        this.applyMap(url, name);
      } else if (target === 'map-add') {
        this.addMap(url, name);
      } else if (target === 'token-image') {
        this.tokenImageUrl = url;
        this.tokenImageName = name;
      } else if (target === 'model') {
        this.modelUrl = url;
        this.modelName = name;
      }
    },

    applyMap(url, name) {
      // Save to recent list (capped at 6).
      const entry = { url, name: name || url.split('/').pop() };
      this.recentMaps = [entry, ...this.recentMaps.filter((m) => m.url !== url)].slice(0, 6);
      try { localStorage.setItem('grimoire_recent_maps', JSON.stringify(this.recentMaps)); } catch {}
      this.$emit('setMap', url);
    },

    /** Add a second+ map to the scene (multi-floor / side-by-side). */
    addMap(url, name) {
      const entry = { url, name: name || url.split('/').pop() };
      this.recentMaps = [entry, ...this.recentMaps.filter((m) => m.url !== url)].slice(0, 6);
      try { localStorage.setItem('grimoire_recent_maps', JSON.stringify(this.recentMaps)); } catch {}
      this.$emit('addMap', url);
    },

    addToken() {
      if (!this.tokenLabel.trim()) return;
      const id = 'token_' + Date.now();
      this.$emit('addToken', {
        id,
        label: this.tokenLabel.trim(),
        url: this.tokenImageUrl || null,
        color: this.tokenColor,
        x: 70, y: 70, size: 1,
        kind: 'primitive',
      });
      this.tokenLabel = '';
      this.tokenImageUrl = null;
      this.tokenImageName = '';
    },

    addModel() {
      if (!this.modelLabel.trim() || !this.modelUrl) return;
      const id = 'model_' + Date.now();
      this.$emit('addModel', {
        id,
        label: this.modelLabel.trim(),
        url: this.modelUrl,
        kind: 'model',
        x: 0, z: 0, scale: 1,
      });
      this.modelLabel = '';
      this.modelUrl = null;
      this.modelName = '';
    },

    /** A file was picked from the Nextcloud Files browser (map tab). */
    applyMapFromFile(file) {
      this.applyMap(file.url, file.name);
    },

    /** An image picked from the browser (tokens tab): prefill the form. */
    onPickTokenImage(file) {
      this.tokenImageUrl = file.url;
      this.tokenImageName = file.name;
      if (!this.tokenLabel.trim()) this.tokenLabel = file.name.replace(/\.[^.]+$/, '');
    },

    /** A model picked from the browser (models tab): place it immediately. */
    onPickModel(file) {
      const id = 'model_' + Date.now();
      this.$emit('addModel', {
        id,
        label: file.name.replace(/\.[^.]+$/, ''),
        url: file.url,
        kind: 'model',
        x: 0, z: 0, scale: 1,
      });
    },
  },
};
</script>

<style scoped>
.asset-panel {
  position: absolute; left: 70px; top: 50%; transform: translateY(-50%);
  width: 280px; max-height: 480px; display: flex; flex-direction: column;
  background: var(--g-bg-dark, #0f1318);
  border: 1px solid var(--g-border, #2d3748);
  border-radius: 12px; overflow: hidden;
}
.panel-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 14px 10px; border-bottom: 1px solid var(--g-border, #2d3748);
}
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: .15em;
  text-transform: uppercase; color: var(--g-primary, #0082c9); }
.close-btn { background: none; border: none; color: var(--g-text-dim, #8b949e);
  cursor: pointer; font-size: 14px; padding: 2px 4px; border-radius: 4px; line-height:1; }
.close-btn:hover { color: var(--g-text, #d8dde4); }

.tabs { display: flex; border-bottom: 1px solid var(--g-border, #2d3748); }
.tab { flex: 1; padding: 8px 4px; font: inherit; font-size: 12px;
  background: none; border: none; cursor: pointer;
  color: var(--g-text-dim, #8b949e); border-bottom: 2px solid transparent; }
.tab.on { color: var(--g-primary, #0082c9); border-bottom-color: var(--g-primary, #0082c9); }
.tab:hover:not(.on) { color: var(--g-text, #d8dde4); }

.tab-body { padding: 14px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 10px; }
.hint { font-size: 12px; color: var(--g-text-dim, #8b949e); margin: 0; line-height: 1.5; }

.pick-btn {
  padding: 9px 14px; border-radius: var(--g-radius, 8px); font: inherit; font-size: 13px;
  font-weight: 600; background: var(--g-primary, #0082c9);
  color: var(--g-primary-t, #fff); border: none; cursor: pointer; transition: opacity .15s;
}
.pick-btn:hover:not(:disabled) { opacity: .88; }
.pick-btn:disabled { opacity: .35; cursor: default; }
.pick-btn.secondary {
  background: var(--g-bg-card, #1e2430);
  border: 1px solid var(--g-border, #2d3748);
  color: var(--g-text, #d8dde4);
}
.pick-btn.secondary:hover:not(:disabled) { border-color: var(--g-primary, #0082c9); }

.recent-label { font-size: 11px; text-transform: uppercase; letter-spacing: .1em;
  color: var(--g-text-dim, #8b949e); margin: 0 0 6px; }
.thumb-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.thumb { background: var(--g-bg-card, #1e2430); border: 1px solid var(--g-border, #2d3748);
  border-radius: 6px; overflow: hidden; cursor: pointer; padding: 0; text-align: left; }
.thumb img { width: 100%; aspect-ratio: 16/9; object-fit: cover; display: block; }
.thumb span { font-size: 10px; color: var(--g-text-dim, #8b949e); padding: 3px 5px; display: block;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.thumb:hover { border-color: var(--g-primary, #0082c9); }

.token-form { display: flex; flex-direction: column; gap: 8px; }
.token-input {
  width: 100%; box-sizing: border-box; padding: 7px 10px; font: inherit; font-size: 13px;
  background: var(--g-bg-card, #1e2430); border: 1px solid var(--g-border, #2d3748);
  border-radius: var(--g-radius, 8px); color: var(--g-text, #d8dde4);
}
.token-input:focus { outline: none; border-color: var(--g-primary, #0082c9); }
.token-color-row { display: flex; align-items: center; gap: 8px; font-size: 13px;
  color: var(--g-text-dim, #8b949e); }
.color-pick { width: 36px; height: 24px; border: none; border-radius: 4px;
  cursor: pointer; background: none; padding: 0; margin-left: 6px; }
.pick-row { display: flex; align-items: center; gap: 8px; }
.picked-name { font-size: 11px; color: var(--g-text-dim, #8b949e);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px; }
</style>
