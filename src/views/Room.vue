<template>
  <div class="room">
    <div class="topbar">
      <button class="topbar-btn back" @click="$router.push('/')">
        <span>←</span> Campaigns
      </button>
      <div class="seg">
        <button :class="{on: mode==='2d'}" @click="setMode('2d')">2D</button>
        <button :class="{on: mode==='3d'}" @click="setMode('3d')">3D</button>
      </div>
      <span class="scene-title">{{ scene?.name }}</span>
      <span class="spacer" />
      <span v-if="party.length" class="party-pill" :title="party.join(', ')">
        👥 {{ party.length }}
      </span>
      <button class="topbar-btn save" :disabled="saving" @click="saveScene">
        {{ saving ? 'Saving…' : (saved ? '✓ Saved' : '💾 Save') }}
      </button>
      <button class="topbar-btn" @click="showAddons = !showAddons">Extensions</button>
    </div>

    <div class="surface">
      <div ref="stage2d" class="stage2d" v-show="mode==='2d'" />
      <canvas ref="canvas3d" class="canvas3d" v-show="mode==='3d'" />

      <!-- Toolbar -->
      <div class="tools">
        <button
          v-for="t in toolList" :key="t.id"
          :class="{tool: true, on: activeTool === t.id}"
          :title="t.name"
          @click="activate(t.id)">{{ icon(t.id) }}</button>
        <div class="tool-divider" />
        <button class="tool" :class="{on: showAssets}" title="Assets" @click="showAssets = !showAssets">📂</button>
        <template v-if="addonActions.length">
          <div class="tool-divider" />
          <button
            v-for="act in addonActions" :key="act.id"
            class="tool addon-action" :title="act.label"
            @click="openAddonAction(act)">{{ act.icon }}</button>
        </template>
      </div>

      <!-- Hint bar -->
      <div class="hint-bar">
        <span v-if="mode === '3d'">Right-click drag: orbit &nbsp;·&nbsp; Scroll: zoom &nbsp;·&nbsp; Left-click: {{ activeTool }}</span>
        <span v-else>Right-click drag: pan &nbsp;·&nbsp; Scroll: zoom &nbsp;·&nbsp; Left-click: {{ activeTool }}</span>
      </div>

      <!-- Contextual controls for the active tool -->
      <div v-if="activeTool === 'measure'" class="tool-options">
        <span class="opt-label">Units</span>
        <button :class="{on: measureUnit==='ft'}" @click="setMeasureUnit('ft')">ft</button>
        <button :class="{on: measureUnit==='m'}" @click="setMeasureUnit('m')">m</button>
      </div>
      <div v-else-if="activeTool === 'aoe'" class="tool-options">
        <span class="opt-label">Shape</span>
        <button v-for="s in ['circle','square','cone','line']" :key="s"
          :class="{on: aoeShape===s}" @click="setAoeShape(s)">{{ s }}</button>
        <span class="opt-sep" />
        <button class="danger" @click="clearAoe" title="Remove all your AoE templates">Clear</button>
        <span class="opt-hint">right-click a template to delete</span>
      </div>

      <!-- Transient toast (model load errors etc.) -->
      <div v-if="toast" class="toast">{{ toast }}</div>

      <!-- Measurement label (screen space, follows the ruler midpoint) -->
      <div
        v-if="measureLabel"
        class="measure-label"
        :style="{ left: measureLabel.screenX + 'px', top: measureLabel.screenY + 'px' }">
        {{ measureLabel.label }}
      </div>

      <!-- Dice tray -->
      <DiceTray :roller="diceRoller" @ensure3d="setMode('3d')" />

      <!-- Asset picker -->
      <AssetPicker
        v-if="showAssets"
        @close="showAssets = false"
        @setMap="onSetMap"
        @addToken="onAddToken"
        @addModel="onAddModel"
      />

      <!-- Addon panel -->
      <AddonPanel v-if="showAddons" ref="addonPanel" :manager="addonManager" @close="showAddons=false" />
    </div>
  </div>
</template>

<script>
import axios from '@nextcloud/axios';
import { generateUrl } from '../lib/url.js';
import { loadState } from '@nextcloud/initial-state';
import DiceTray from '../components/DiceTray.vue';
import AddonPanel from '../components/AddonPanel.vue';
import AssetPicker from '../components/AssetPicker.vue';

import { Scene2D } from '../engine/2d/Scene2D.js';
import { Scene3D } from '../engine/3d/Scene3D.js';
import { DiceRoller } from '../engine/3d/DiceRoller.js';
import { ToolManager } from '../tools/ToolManager.js';
import { Scene2DAdapter, Scene3DAdapter } from '../engine/SceneAdapter.js';
import { SyncClient } from '../engine/sync/SyncClient.js';
import { AddonManager } from '../addons/AddonManager.js';

export default {
  name: 'Room',
  components: { DiceTray, AddonPanel, AssetPicker },
  props: { campaignId: [String, Number], sceneId: [String, Number] },
  data() {
    return {
      scene: null, mode: '2d', activeTool: 'pointer', toolList: [],
      showAddons: false, showAssets: false,
      diceRoller: null, addonManager: null,
      toast: null, measureUnit: 'ft', aoeShape: 'circle',
      party: [], saving: false, saved: false, syncReady: false, remoteDice: null,
      measureLabel: null,
      addonActions: [],
    };
  },
  async mounted() {
    this.userId = loadState('grimoire', 'userId', 'anon');
    const { data } = await axios.get(generateUrl(`/apps/grimoire/api/scenes/${this.sceneId}`));
    this.scene = data;
    this.mode = data.mode || '2d';

    this.THREE = await import('three');
    this.CANNON = await import('cannon-es');
    const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const Konva = (await import('konva')).default;

    this.scene2d = new Scene2D({
      Konva, container: this.$refs.stage2d, gridSize: 70,
      onChange: (c) => this.sync?.send(c),
    });
    this.scene3d = new Scene3D({
      THREE: this.THREE, CANNON: this.CANNON, GLTFLoader, OrbitControls,
      canvas: this.$refs.canvas3d,
    });
    this.diceRoller = new DiceRoller({
      THREE: this.THREE, CANNON: this.CANNON,
      scene: this.scene3d.scene, world: this.scene3d.world,
      onSettle: (r) => {
        const rolls = Array.isArray(r) ? r : [];
        const total = rolls.reduce((sum, d) => sum + (d.value || 0), 0);
        const notation = rolls.map((d) => d.type).join(' + ');
        this.sync?.send({ type: 'dice:result', payload: { rolls, total, notation } });
      },
    });

    this.adapters = {
      '2d': new Scene2DAdapter(this.scene2d, { THREE: this.THREE }),
      '3d': new Scene3DAdapter(this.scene3d, { THREE: this.THREE }),
    };
    // Measurement labels render as a screen-space HTML overlay (works in both
    // 2D and 3D regardless of zoom/camera).
    const onMeasure = (m) => { this.measureLabel = m; };
    this.adapters['2d'].onMeasure = onMeasure;
    this.adapters['3d'].onMeasure = onMeasure;

    await this.connectSync();
    this.setupAddons();
    this.hydrate(data.data);
    this.applyMode();
    this.loop();
    window.addEventListener('resize', this.resize);
  },
  beforeUnmount() {
    this.sync?.disconnect();
    this.addonManager?.destroy();
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this.resize);
  },
  methods: {
    icon(id) {
      return { pointer: '➤', grab: '✋', measure: '📏', aoe: '✸' }[id] || '•';
    },

    hydrate(doc) {
      if (!doc) return;
      if (doc.mapUrl) {
        this.scene2d.setMap(doc.mapUrl);
        this.scene3d.setMapTexture(doc.mapUrl);
      }
      for (const t of doc.tokens || []) {
        this.scene2d.upsertToken(t);
        this.scene3d.upsertToken({ ...t, kind: t.url ? 'model' : 'primitive', z: t.y });
      }
      for (const b of doc.blocks || []) {
        this.scene3d.addBlock?.(b);
      }
    },

    /** Persist both 2D and 3D scene state to the scene's data column. */
    async saveScene() {
      this.saving = true;
      try {
        const s2 = this.scene2d.serialize();
        const s3 = this.scene3d.serialize();
        // Merge into one document. Tokens are shared across modes; keep the
        // union keyed by id, and store each mode's map + 3D blocks.
        const byId = new Map();
        for (const t of [...s2.tokens, ...s3.tokens]) byId.set(t.id, { ...byId.get(t.id), ...t });
        const doc = {
          mapUrl: s2.mapUrl || s3.mapUrl || null,
          map2d: s2.mapUrl || null,
          map3d: s3.mapUrl || null,
          tokens: [...byId.values()],
          blocks: s3.blocks || [],
        };
        await axios.put(generateUrl(`/apps/grimoire/api/scenes/${this.sceneId}`), {
          name: this.scene?.name,
          data: doc,
        });
        this.saved = true;
        setTimeout(() => { this.saved = false; }, 2500);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[grimoire] save failed', e);
        this._notify('Save failed — check you have access to this scene.');
      } finally {
        this.saving = false;
      }
    },

    async connectSync() {
      try {
        const { data } = await axios.post(
          generateUrl(`/apps/grimoire/api/scenes/${this.sceneId}/room-token`));
        this.sync = new SyncClient({
          url: data.relayUrl, roomToken: data.token, userId: this.userId,
          sceneId: this.sceneId,
          onMessage: (m) => this.onRemote(m),
          onPresence: (players) => { this.party = players || []; },
        });
        this.sync.connect();
        this.syncReady = true;
        if (data.syncBackend === 'none' && !data.relayUrl) {
          this._notify('Multiplayer needs a memory cache (Redis/APCu) configured in Nextcloud — running local-only for now.');
        }
      } catch (e) {
        // Token endpoint missing or access denied — local-only mode.
        // eslint-disable-next-line no-console
        console.warn('[grimoire] sync unavailable, running local-only', e);
        this.syncReady = false;
      }
    },

    onRemote(m) {
      if (m.from === this.userId) return;
      this.scene2d.applyRemote(m);
      if (m.type === 'token:move')
        this.scene3d.upsertToken({ id: m.payload.id, x: m.payload.x, z: m.payload.y });
      if (m.type === 'token:upsert') {
        this.scene2d.upsertToken(m.payload);
        this.scene3d.upsertToken({ ...m.payload, kind: m.payload.url ? 'model' : 'primitive', z: m.payload.y });
      }
      if (m.type === 'token:remove') {
        this.scene2d.removeToken(m.payload.id);
        this.scene3d.removeToken(m.payload.id);
      }
      if (m.type === 'map:set') {
        this.scene2d.setMap(m.payload.url);
        this.scene3d.setMapTexture(m.payload.url);
      }
      if (m.type === 'aoe:set') this.scene3d.setAoE(m.payload.id, m.payload);
      if (m.type === 'aoe:remove') {
        this.scene3d.clearAoE?.(m.payload.id);
        this.adapters['2d'].removeAoE?.(m.payload.id);
      }
      if (m.type === 'dice:result') {
        // Show other players' rolls in the tray.
        this.remoteDice = m.payload;
        setTimeout(() => { if (this.remoteDice === m.payload) this.remoteDice = null; }, 5000);
      }
      this.addonManager?.emit('scene:change', m);
      if (m.type === 'dice:result') this.addonManager?.emit('dice:result', m.payload);
    },

    setupAddons() {
      this.addonManager = new AddonManager({
        host: this,
        capabilities: {
          sceneRead: () => {
            // Union of tokens across both scenes so addons see everything on
            // the table regardless of which mode placed them.
            const byId = new Map();
            for (const e of this.scene2d.tokens.values()) byId.set(e.data.id, e.data);
            for (const e of this.scene3d.tokens.values()) if (!byId.has(e.data.id)) byId.set(e.data.id, e.data);
            return [...byId.values()];
          },
          sceneWrite: (op, p) => {
            if (op === 'add' || op === 'update') {
              this.scene2d.upsertToken(p);
              this.scene3d.upsertToken({ ...p, z: p.y });
            }
            if (op === 'delete') { this.scene2d.removeToken(p.id); this.scene3d.removeToken(p.id); }
          },
          createTool: (addon, def) =>
            this.tools.register(makeAddonTool(addon, def, this.addonManager)),
          createAction: (addon, def) => {
            // Register a sidebar button that opens this addon's panel.
            const action = { id: def.id || addon.manifest.name, label: def.name || def.label || addon.manifest.name, icon: def.icon || '🧩', addonId: [...this.addonManager.addons.entries()].find(([, x]) => x === addon)?.[0] };
            this.addonActions = this.addonActions.filter((x) => x.id !== action.id).concat(action);
            return true;
          },
          broadcast: (p) => this.sync?.send({ type: 'broadcast:' + p.channel, payload: p.payload }),
          metadataGet: () => ({}),
          metadataSet: () => true,
          diceRoll: async (p) => {
            this.setMode('3d');
            const rolls = await this.diceRoller.rollAsync(p.notation);
            const total = (rolls || []).reduce((s, d) => s + (d.value || 0), 0);
            // Broadcast so other players see the addon's roll too.
            this.sync?.send({ type: 'dice:result', payload: { rolls, total, notation: p.notation } });
            return { rolls, total };
          },
          notify: (p) => console.info('[addon]', p.text),
        },
      });
    },

    applyMode() {
      this.tools = new ToolManager(this.adapters[this.mode], { sync: this.sync });
      // Re-apply user tool preferences onto the fresh tool instances.
      this.tools.tools.get('measure')?.setUnit?.(this.measureUnit);
      this.tools.tools.get('aoe')?.setShape?.(this.aoeShape);
      this.toolList = this.tools.list();
      this.activeTool = this.tools.active?.id;
      this.bindPointer();
      this.resize();
    },
    setMode(m) { if (m === this.mode) return; this.mode = m; this.applyMode(); },
    activate(id) { this.tools.activate(id); this.activeTool = id; },

    openAddonAction(act) {
      // Open the extensions panel and tell the addon its action was invoked.
      this.showAddons = true;
      this.addonManager?.emit('action:open', { id: act.id });
      // Defer so the panel exists, then mount the addon's UI.
      this.$nextTick(() => {
        if (act.addonId) this.$refs.addonPanel?.openById?.(act.addonId);
      });
    },

    setMeasureUnit(u) {
      this.measureUnit = u;
      const t = this.tools.tools.get('measure');
      t?.setUnit?.(u);
    },
    setAoeShape(s) {
      this.aoeShape = s;
      const t = this.tools.tools.get('aoe');
      t?.setShape?.(s);
    },
    clearAoe() {
      const t = this.tools.tools.get('aoe');
      t?.clearAll?.();
    },

    bindPointer() {
      const el = this.mode === '2d' ? this.$refs.stage2d : this.$refs.canvas3d;
      const adapter = this.adapters[this.mode];
      const world = (e) => this.mode === '2d'
        ? adapter.worldPointFromEvent()
        : adapter.worldPointFromEvent(this.ndc(e));
      // Only left-click (button 0) goes to tools; right-click is used for orbit/pan.
      el.onpointerdown = (e) => { if (e.button === 0) this.tools.handle('onPointerDown', world(e)); };
      el.onpointermove = (e) => this.tools.handle('onPointerMove', world(e));
      window.onpointerup = (e) => { if (e.button === 0) this.tools.handle('onPointerUp', world(e)); };
      el.oncontextmenu = (e) => {
        e.preventDefault();
        // When the AoE tool is active, right-click deletes the template under
        // the cursor. Otherwise right-click is left for camera orbit/pan.
        if (this.activeTool === 'aoe') this.tools.handle('onContext', world(e));
      };
    },

    ndc(e) {
      const r = this.$refs.canvas3d.getBoundingClientRect();
      return {
        x: ((e.clientX - r.left) / r.width) * 2 - 1,
        y: -((e.clientY - r.top) / r.height) * 2 + 1,
      };
    },

    resize() {
      const el = this.$refs.canvas3d.parentElement;
      const w = el.clientWidth, h = el.clientHeight;
      this.scene2d.resize(w, h);
      this.scene3d.resize(w, h);
    },

    loop() {
      const dt = this.scene3d.render();
      this.diceRoller.step(dt);
      this._raf = requestAnimationFrame(this.loop);
    },

    // --- Asset picker handlers ---

    async onSetMap(url) {
      this.scene2d.setMap(url);
      this.scene3d.setMapTexture(url);
      this.sync?.send({ type: 'map:set', payload: { url } });
    },

    async onAddToken(t) {
      // Place in both 2D and 3D scenes.
      await this.scene2d.upsertToken(t);
      await this.scene3d.upsertToken({ ...t, kind: 'primitive', z: t.y || 0 });
      this.sync?.send({ type: 'token:upsert', payload: t });
    },

    async onAddModel(t) {
      // A glTF/GLB lives in 3D. Switch to 3D mode so it's actually visible,
      // and surface any load failure instead of silently doing nothing.
      this.scene3d.onModelError = (data, err) => {
        this._notify(`Model failed to load: ${err?.message || 'check the URL is a direct .glb/.gltf link'}`);
      };
      this.setMode('3d');
      try {
        await this.scene3d.upsertToken({ ...t, kind: 'model' });
        // Stand-in marker in the 2D scene so the token exists in both views.
        await this.scene2d.upsertToken({ ...t, x: t.x || 70, y: t.y || 70, size: 1, color: '#4a90d9' });
        this.sync?.send({ type: 'token:upsert', payload: t });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[grimoire] add model failed', err);
        this._notify(`Could not add model: ${err?.message || err}`);
      }
    },

    _notify(msg) {
      // Lightweight transient toast; replace with @nextcloud/dialogs later.
      // eslint-disable-next-line no-console
      console.warn('[grimoire]', msg);
      this.toast = msg;
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => { this.toast = null; }, 6000);
    },
  },
};

function makeAddonTool(addon, def, manager) {
  return {
    id: def.id, name: def.name, icon: def.icon,
    onActivate() { manager.emit('tool:click:' + def.id, {}); },
  };
}
</script>

<style scoped>
.room { position: absolute; inset: 0; display: flex; flex-direction: column; }

.topbar {
  display: flex; align-items: center; gap: 12px; padding: 8px 16px;
  border-bottom: 1px solid var(--g-border, #2d3748);
  background: var(--g-bg-dark, #0f1318);
  flex-shrink: 0;
}
.scene-title { color: var(--g-primary, #0082c9); font-weight: 600; font-size: 14px; }
.spacer { flex: 1; }

.seg {
  display: flex; border: 1px solid var(--g-border, #2d3748); border-radius: 6px; overflow: hidden;
}
.seg button {
  background: transparent; color: var(--g-text-dim, #8b949e); border: 0;
  padding: 5px 14px; cursor: pointer; font: inherit; font-size: 13px;
}
.seg button.on { background: var(--g-primary, #0082c9); color: #fff; font-weight: 700; }

.topbar-btn {
  font: inherit; font-size: 13px; color: var(--g-text, #d8dde4);
  background: var(--g-bg-card, #1e2430); border: 1px solid var(--g-border, #2d3748);
  border-radius: var(--g-radius, 8px); padding: 5px 12px; cursor: pointer;
}
.topbar-btn:hover { border-color: var(--g-primary, #0082c9); }
.topbar-btn.save { background: var(--g-primary, #0082c9); color: #fff; border-color: var(--g-primary, #0082c9); }
.topbar-btn.save:disabled { opacity: .6; cursor: default; }
.party-pill { font-size: 12px; color: var(--g-text-dim, #8b949e); padding: 4px 10px;
  border: 1px solid var(--g-border, #2d3748); border-radius: 20px; margin-right: 8px; }
.topbar-btn.back { color: var(--g-text-dim, #8b949e); }

.surface { position: relative; flex: 1; overflow: hidden; }
.stage2d, .canvas3d { position: absolute; inset: 0; width: 100%; height: 100%; }

/* Left toolbar */
.tools {
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
  display: flex; flex-direction: column; gap: 4px; padding: 8px;
  border-radius: 12px;
  background: var(--g-bg-dark, #0f1318);
  border: 1px solid var(--g-border, #2d3748);
}
.tool {
  width: 40px; height: 40px; border-radius: 8px;
  border: 1px solid transparent;
  background: transparent; color: var(--g-text-dim, #8b949e);
  cursor: pointer; font-size: 17px; display: flex; align-items: center; justify-content: center;
}
.tool:hover { background: var(--g-bg-card, #1e2430); color: var(--g-text, #d8dde4); }
.tool.on { border-color: var(--g-primary, #0082c9); color: var(--g-primary, #0082c9);
  background: color-mix(in srgb, var(--g-primary, #0082c9) 12%, transparent); }
.tool-divider { height: 1px; background: var(--g-border, #2d3748); margin: 2px 0; }

/* Bottom hint bar */
.hint-bar {
  position: absolute; bottom: 0; left: 0; right: 0; padding: 5px 14px;
  background: var(--g-bg-dark, #0f1318); border-top: 1px solid var(--g-border, #2d3748);
  font-size: 11px; color: var(--g-text-dim, #8b949e); text-align: center;
  pointer-events: none;
}

/* Contextual tool options (measure units, AoE shape) */
.tool-options {
  position: absolute; bottom: 32px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 6px; padding: 6px 10px;
  background: var(--g-bg-dark, #0f1318); border: 1px solid var(--g-border, #2d3748);
  border-radius: 10px; z-index: 5;
}
.tool-options .opt-label { font-size: 11px; color: var(--g-text-dim, #8b949e);
  text-transform: uppercase; letter-spacing: .08em; margin-right: 2px; }
.tool-options button {
  background: var(--g-bg-card, #1e2430); color: var(--g-text-dim, #8b949e);
  border: 1px solid var(--g-border, #2d3748); border-radius: 6px;
  padding: 4px 10px; font: inherit; font-size: 12px; cursor: pointer; text-transform: capitalize;
}
.tool-options button:hover { color: var(--g-text, #d8dde4); border-color: var(--g-primary, #0082c9); }
.tool-options button.on { background: var(--g-primary, #0082c9); color: #fff; border-color: var(--g-primary, #0082c9); font-weight: 600; }
.tool-options button.danger { color: #e74c3c; }
.tool-options button.danger:hover { color: #fff; background: #e74c3c; border-color: #e74c3c; }
.tool-options .opt-sep { width: 1px; height: 18px; background: var(--g-border, #2d3748); margin: 0 2px; }
.tool-options .opt-hint { font-size: 10px; color: var(--g-text-dim, #8b949e); font-style: italic; }

/* Transient toast */
.measure-label {
  position: fixed; transform: translate(-50%, -140%);
  background: rgba(20,24,31,.92); color: #ffe9a8; font-weight: 700;
  font-size: 14px; padding: 4px 10px; border-radius: 8px;
  border: 1px solid #e0c068; pointer-events: none; z-index: 30; white-space: nowrap;
}
.toast {
  position: absolute; top: 16px; left: 50%; transform: translateX(-50%);
  background: #2a0f0c; border: 1px solid #b3402f; color: #f3d9a0;
  padding: 10px 16px; border-radius: 8px; font-size: 13px; z-index: 20;
  max-width: 80%; box-shadow: 0 6px 24px rgba(0,0,0,.4);
}
</style>
