<template>
  <aside class="dm-panel" :class="{ collapsed: !open }">
    <button class="dm-toggle" @click="open = !open" title="DM Controls">
      <span>🛠</span>
    </button>
    <div v-if="open" class="dm-body">
      <header class="dm-header">
        <h3>DM Controls</h3>
        <button class="dm-close" @click="open = false">✕</button>
      </header>

      <div class="dm-scroll">
        <!-- Scene settings -->
        <section class="dm-section">
          <h4>Scene</h4>
          <label class="dm-row">Name
            <input type="text" :value="sceneName" @change="$emit('rename', $event.target.value)" class="dm-input" />
          </label>
          <label class="dm-row">Grid type
            <select v-model="gridCfg.type" @change="emitGrid" class="dm-input">
              <option value="square">Square</option>
              <option value="hex-v">Hex (pointy)</option>
              <option value="hex-h">Hex (flat)</option>
            </select>
          </label>
          <label class="dm-row">Grid size
            <input type="number" min="20" max="200" v-model.number="gridCfg.size" @change="emitGrid" class="dm-input" />
          </label>
          <label class="dm-row">Line width
            <input type="range" min="0.5" max="6" step="0.5" v-model.number="gridCfg.lineWidth" @input="emitGrid" class="dm-range" />
            <span class="dm-val">{{ gridCfg.lineWidth }}</span>
          </label>
          <label class="dm-row">Grid opacity
            <input type="range" min="0" max="1" step="0.1" v-model.number="gridCfg.opacity" @input="emitGrid" class="dm-range" />
            <span class="dm-val">{{ gridCfg.opacity }}</span>
          </label>
          <label class="dm-row">Line style
            <select v-model="gridCfg.lineStyle" @change="emitGrid" class="dm-input">
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
            </select>
          </label>
          <label class="dm-row">Grid colour
            <input type="color" v-model="gridCfg.color" @change="emitGrid" class="dm-color" />
          </label>
          <label class="dm-row">Scale (ft/sq)
            <input type="number" min="1" max="100" v-model.number="gridCfg.feetPerSquare" @change="emitGrid" class="dm-input" />
          </label>
        </section>

        <!-- Layer visibility -->
        <section class="dm-section">
          <h4>Layers</h4>
          <label class="dm-check-row">
            <input type="checkbox" v-model="layers.grid" @change="$emit('layer', { layer: 'grid', on: $event.target.checked })" />
            Grid
          </label>
          <label class="dm-check-row">
            <input type="checkbox" v-model="layers.drawings" @change="$emit('layer', { layer: 'drawings', on: $event.target.checked })" />
            Drawings
          </label>
          <label class="dm-check-row">
            <input type="checkbox" v-model="layers.fog" @change="$emit('layer', { layer: 'fog', on: $event.target.checked })" />
            Fog visible (GM)
          </label>
          <label class="dm-check-row">
            <input type="checkbox" v-model="layers.fogPreview" @change="$emit('layer', { layer: 'fogPreview', on: $event.target.checked })" />
            Fog preview (player view)
          </label>
        </section>

        <!-- Player permissions -->
        <section class="dm-section">
          <h4>Player permissions</h4>
          <table class="dm-table">
            <thead>
              <tr><th>Layer</th><th>Create</th><th>Update</th><th>Delete</th><th>Owner</th></tr>
            </thead>
            <tbody>
              <tr v-for="layer in permLayers" :key="layer.key">
                <td>{{ layer.label }}</td>
                <td><input type="checkbox" v-model="perms[layer.key].create" @change="emitPerms" /></td>
                <td><input type="checkbox" v-model="perms[layer.key].update" @change="emitPerms" /></td>
                <td><input type="checkbox" v-model="perms[layer.key].delete" @change="emitPerms" /></td>
                <td><input type="checkbox" v-model="perms[layer.key].ownerOnly" @change="emitPerms" :disabled="layer.key !== 'tokens'" /></td>
              </tr>
            </tbody>
          </table>
        </section>

        <!-- Player management -->
        <section class="dm-section">
          <h4>Players</h4>
          <div class="dm-player-search">
            <input type="text" v-model="playerQuery" placeholder="Search users…" class="dm-input" @input="searchPlayers" />
          </div>
          <ul class="dm-player-list" v-if="searchResults.length">
            <li v-for="u in searchResults" :key="u.uid">
              <span>{{ u.displayName }}</span>
              <button @click="$emit('invite', u.uid)">+ Invite</button>
            </li>
          </ul>
          <ul class="dm-player-list">
            <li v-for="p in players" :key="p.uid">
              <span>{{ p.displayName || p.uid }}</span>
              <button class="dm-kick" @click="$emit('removePlayer', p.uid)">✕</button>
            </li>
          </ul>
          <p v-if="!players.length" class="dm-empty">No players invited.</p>
        </section>

        <!-- Session tools -->
        <section class="dm-section">
          <h4>Session</h4>
          <button class="dm-btn" @click="$emit('remind')">📧 Send reminders</button>
          <button class="dm-btn" @click="$emit('clearFog')">🌫 Reveal all fog</button>
          <button class="dm-btn danger" @click="$emit('deleteScene')">🗑 Delete scene</button>
        </section>
      </div>
    </div>
  </aside>
</template>

<script>
import axios from '@nextcloud/axios';
import { generateUrl } from '../lib/url.js';

/**
 * DMPanel — a comprehensive DM control sidebar (Owlbear-level). Consolidates:
 *  - Scene/grid settings (type, size, line style, colour, scale)
 *  - Layer visibility toggles (grid, drawings, fog, fog preview)
 *  - Player permissions (per-layer create/update/delete, owner-only)
 *  - Player management (search, invite, remove)
 *  - Session tools (reminders, reveal fog, delete scene)
 */
export default {
  name: 'DMPanel',
  props: {
    sceneName: String,
    gridConfig: Object,
    permissions: Object,
    players: { type: Array, default: () => [] },
  },
  emits: ['rename', 'grid', 'layer', 'perms', 'invite', 'removePlayer', 'remind', 'clearFog', 'deleteScene'],
  data() {
    const def = (o = {}) => ({ create: true, update: true, delete: true, ownerOnly: false, ...o });
    return {
      open: true,
      gridCfg: { type: 'square', size: 70, lineWidth: 1, opacity: 1, lineStyle: 'solid', color: '#3a3228', feetPerSquare: 5, ...this.gridConfig },
      layers: { grid: true, drawings: true, fog: true, fogPreview: false },
      perms: {
        maps: def(this.permissions?.maps),
        tokens: def(this.permissions?.tokens),
        drawings: def(this.permissions?.drawings),
        fog: def(this.permissions?.fog),
      },
      permLayers: [
        { key: 'maps', label: 'Maps' },
        { key: 'tokens', label: 'Tokens' },
        { key: 'drawings', label: 'Drawings' },
        { key: 'fog', label: 'Fog' },
      ],
      playerQuery: '',
      searchResults: [],
    };
  },
  methods: {
    emitGrid() { this.$emit('grid', { ...this.gridCfg }); },
    emitPerms() { this.$emit('perms', { ...this.perms }); },
    async searchPlayers() {
      if (this.playerQuery.length < 2) { this.searchResults = []; return; }
      try {
        const { data } = await axios.get(generateUrl('/apps/grimoire/api/users/search'), { params: { q: this.playerQuery } });
        this.searchResults = data;
      } catch { this.searchResults = []; }
    },
  },
};
</script>

<style scoped>
.dm-panel { position: absolute; left: 0; top: 0; bottom: 0; z-index: 30; display: flex; align-items: flex-start; }
.dm-toggle {
  margin: 14px 0 0 14px; width: 44px; height: 44px; border-radius: 50%;
  background: var(--g-bg-dark); border: 1px solid var(--g-border);
  cursor: pointer; font-size: 18px; display: flex; align-items: center; justify-content: center;
  box-shadow: var(--g-shadow); flex-shrink: 0;
}
.dm-toggle:hover { border-color: var(--g-primary); }
.dm-body {
  width: 300px; height: calc(100% - 28px); margin: 14px 0 14px 8px;
  background: var(--g-bg-dark); border: 1px solid var(--g-border);
  border-radius: var(--g-radius-large); overflow: hidden;
  display: flex; flex-direction: column; box-shadow: var(--g-shadow);
}
.dm-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--g-border); }
.dm-header h3 { margin: 0; font-size: 12px; font-weight: 700; letter-spacing: .15em; text-transform: uppercase; color: var(--g-primary); }
.dm-close { background: none; border: none; color: var(--g-text-dim); cursor: pointer; }
.dm-close:hover { color: var(--g-text); }
.dm-scroll { overflow-y: auto; flex: 1; padding: 0 14px 14px; }
.dm-section { padding: 12px 0; border-bottom: 1px solid var(--g-border); }
.dm-section:last-child { border-bottom: none; }
.dm-section h4 { margin: 0 0 8px; font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--g-text-dim); }
.dm-row { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--g-text-dim); margin-bottom: 6px; }
.dm-row label { flex: 1; }
.dm-input { flex: 1; background: var(--g-bg-card); border: 1px solid var(--g-border); border-radius: var(--g-radius); color: var(--g-text); font: inherit; font-size: 12px; padding: 5px 8px; }
.dm-input:focus { outline: none; border-color: var(--g-primary); }
.dm-range { flex: 1; }
.dm-val { min-width: 24px; text-align: right; color: var(--g-text); font-variant-numeric: tabular-nums; }
.dm-color { width: 34px; height: 24px; border: none; background: none; cursor: pointer; padding: 0; }
.dm-check-row { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--g-text); margin-bottom: 4px; cursor: pointer; }
.dm-check-row input { cursor: pointer; }
.dm-table { width: 100%; border-collapse: collapse; font-size: 11px; color: var(--g-text); }
.dm-table th { text-align: left; font-size: 10px; text-transform: uppercase; color: var(--g-text-dim); padding: 4px 2px; border-bottom: 1px solid var(--g-border); }
.dm-table td { padding: 5px 2px; border-bottom: 1px solid var(--g-border); }
.dm-table input[type=checkbox] { cursor: pointer; }
.dm-player-list { list-style: none; padding: 0; margin: 6px 0 0; }
.dm-player-list li { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; font-size: 12px; color: var(--g-text); }
.dm-player-list button { font: inherit; font-size: 11px; padding: 3px 8px; border-radius: var(--g-radius); background: var(--g-primary); color: var(--g-primary-t); border: none; cursor: pointer; }
.dm-player-list .dm-kick { background: var(--g-bg-card); color: var(--g-error); border: 1px solid var(--g-border); }
.dm-empty { font-size: 11px; color: var(--g-text-dim); font-style: italic; }
.dm-btn { width: 100%; margin-bottom: 6px; padding: 8px; font: inherit; font-size: 12px; border-radius: var(--g-radius); background: var(--g-bg-card); border: 1px solid var(--g-border); color: var(--g-text); cursor: pointer; }
.dm-btn:hover { border-color: var(--g-primary); color: var(--g-primary); }
.dm-btn.danger { color: var(--g-error); }
.dm-btn.danger:hover { background: var(--g-error); color: #fff; border-color: var(--g-error); }
</style>