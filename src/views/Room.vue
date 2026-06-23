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
        <button class="tool" :class="{on: showGrid}" title="Grid settings" @click="showGrid = !showGrid">⊞</button>
        <button v-if="role === 'gm'" class="tool" :class="{on: showPerms}" title="Player permissions" @click="showPerms = !showPerms">🔒</button>
        <div class="tool-divider" />
        <button class="tool" :class="{on: snapEnabled}" :title="snapEnabled ? 'Snap to grid (on)' : 'Free movement (snap off)'" @click="toggleSnap">
          {{ snapEnabled ? '🧲' : '✥' }}
        </button>
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
        <span v-if="mode === '3d'">Right-click drag: orbit · Scroll: zoom · Left-click: {{ activeTool }}<span v-if="role === 'gm'"> · Double-click a token: edit HP</span></span>
        <span v-else>Right-click drag: pan · Scroll: zoom · Left-click: {{ activeTool }} · 🎲 3D dice in the corner<span v-if="role === 'gm'"> · Double-click a token: edit HP</span></span>
      </div>

      <!-- Contextual controls for the active tool -->
      <div v-if="activeTool === 'measure'" class="tool-options">
        <span class="opt-label">Mode</span>
        <button v-for="m in ['ruler','permanent','movement']" :key="m"
          :class="{on: measureMode===m}" @click="setMeasureMode(m)">{{ m }}</button>
        <span class="opt-sep" />
        <span class="opt-label">Type</span>
        <button v-for="t in ['euclidean','chessboard','alternating','manhattan']" :key="t"
          :class="{on: measureType===t}" @click="setMeasureType(t)" :title="t">{{ t.slice(0,4) }}</button>
        <span class="opt-sep" />
        <span class="opt-label">Units</span>
        <button :class="{on: measureUnit==='ft'}" @click="setMeasureUnit('ft')">ft</button>
        <button :class="{on: measureUnit==='m'}" @click="setMeasureUnit('m')">m</button>
        <span v-if="measureMode === 'permanent'" class="opt-sep" />
        <button v-if="measureMode === 'permanent'" class="danger" @click="clearMeasurements" title="Remove your permanent rulers">Clear</button>
        <span class="opt-hint" v-if="measureMode === 'permanent'">right-click a ruler to delete</span>
      </div>
      <div v-else-if="activeTool === 'aoe'" class="tool-options">
        <span class="opt-label">Shape</span>
        <button v-for="s in ['circle','square','cone','line']" :key="s"
          :class="{on: aoeShape===s}" @click="setAoeShape(s)">{{ s }}</button>
        <span class="opt-sep" />
        <button class="danger" @click="clearAoe" title="Remove all your AoE templates">Clear</button>
        <span class="opt-hint">right-click a template to delete</span>
      </div>
      <div v-else-if="activeTool === 'build'" class="tool-options build-palette">
        <span class="opt-label">Block</span>
        <button v-for="s in ['box','cylinder','sphere','cone','ramp']" :key="s"
          :class="{on: buildShape===s}" @click="setBuildShape(s)">{{ s }}</button>
        <span class="opt-sep" />
        <label class="opt-label">Colour <input type="color" v-model="buildColor" @change="setBuildColor" class="build-color" /></label>
        <span class="opt-sep" />
        <label class="opt-label">H<input type="range" min="0.25" max="6" step="0.25" v-model.number="buildHeight" @input="setBuildSize" class="build-range" />{{ buildHeight }}</label>
        <span class="opt-hint">left-click place · right-click delete</span>
      </div>
      <div v-else-if="activeTool === 'draw'" class="tool-options">
        <span class="opt-label">Mode</span>
        <button v-for="s in ['pen','marker','line','rect','ellipse','triangle','hexagon','polygon','text']" :key="s"
          :class="{on: drawSub===s}" @click="setDrawSub(s)">{{ s }}</button>
        <span class="opt-sep" />
        <label class="opt-label">Stroke <input type="color" v-model="drawColor" @change="setDrawColor" class="build-color" /></label>
        <label class="opt-label">Fill <input type="color" v-model="drawFill" @change="setDrawFill" class="build-color" /></label>
        <span class="opt-sep" />
        <label class="opt-label">W<input type="range" min="1" max="20" step="1" v-model.number="drawWidth" @input="setDrawWidth" class="build-range" />{{ drawWidth }}</label>
        <span class="opt-hint" v-if="drawSub === 'polygon'">click to add points · double-click to close</span>
      </div>
      <div v-else-if="activeTool === 'fog'" class="tool-options">
        <span class="opt-label">Fog</span>
        <button v-for="s in ['brush','eraser','rect','circle','polygon']" :key="s"
          :class="{on: fogSub===s}" @click="setFogSub(s)">{{ s }}</button>
        <span class="opt-sep" />
        <label class="opt-label" title="Cut: subtract from existing fog (reveal)">Cut<input type="checkbox" v-model="fogCut" @change="setFogCut" class="fog-check" /></label>
        <span class="opt-sep" />
        <label class="opt-label">Colour <input type="color" v-model="fogColor" @change="setFogColor" class="build-color" /></label>
        <span class="opt-sep" />
        <button :class="{on: fogPreview}" @click="toggleFogPreview" title="See the player's view">{{ fogPreview ? '👁 Preview' : '👁‍🗨 Preview' }}</button>
        <button class="danger" @click="fogRevealAll" title="Reveal the whole map">Reveal all</button>
        <button @click="fogHideAll" title="Hide the whole map">Hide all</button>
        <span class="opt-hint" v-if="fogSub === 'polygon'">click to add points · double-click to close</span>
        <span class="opt-hint" v-else>GM only</span>
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

      <!-- 2D dice viewport: a small 3D render of the physics dice so 2D
           players can roll and see the result without switching modes. -->
      <DiceViewport v-if="mode === '2d'" @roll="onViewportRoll" />

      <!-- Asset picker -->
      <AssetPicker
        v-if="showAssets"
        @close="showAssets = false"
        @setMap="onSetMap"
        @addMap="onAddMap"
        @addToken="onAddToken"
        @addModel="onAddModel"
      />

      <!-- Grid settings (GM) -->
      <GridSettings
        v-if="showGrid && role === 'gm'"
        :config="gridConfig"
        @change="onGridChange" @close="showGrid = false" />

      <!-- Player permissions (GM) -->
      <PermissionsPanel
        v-if="showPerms && role === 'gm'"
        :permissions="permissions"
        @change="onPermsChange" @close="showPerms = false" />

      <!-- Addon panel -->
      <AddonPanel v-if="showAddons" ref="addonPanel" :manager="addonManager" @close="showAddons=false" />

      <!-- GM health editor (double-click a token) -->
      <HealthEditor
        v-if="healthToken && role === 'gm'"
        :token="healthToken" :x="healthX" :y="healthY"
        @change="onHealthChange" @close="healthToken = null" />

      <!-- Rich text on canvas (HTML overlay layer) -->
      <div class="rich-text-layer">
        <div v-for="rt in richTexts" :key="rt.id" class="rich-text-item"
          :style="{ left: rt.screenX + 'px', top: rt.screenY + 'px', color: rt.color }"
          v-html="rt.html"></div>
      </div>

      <!-- In-place rich text editor (text tool) -->
      <TextEditor
        v-if="textEditor"
        :x="textEditor.x" :y="textEditor.y" :color="drawColor"
        @commit="onTextCommit" @cancel="textEditor = null" />
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
import DiceViewport from '../components/DiceViewport.vue';
import HealthEditor from '../components/HealthEditor.vue';
import GridSettings from '../components/GridSettings.vue';
import PermissionsPanel from '../components/PermissionsPanel.vue';
import TextEditor from '../components/TextEditor.vue';

import { Scene2D } from '../engine/2d/Scene2D.js';
import { Scene3D } from '../engine/3d/Scene3D.js';
import { DiceRoller } from '../engine/3d/DiceRoller.js';
import { ToolManager } from '../tools/ToolManager.js';
import { Scene2DAdapter, Scene3DAdapter } from '../engine/SceneAdapter.js';
import { SyncClient } from '../engine/sync/SyncClient.js';
import { AddonManager } from '../addons/AddonManager.js';

export default {
  name: 'Room',
  components: { DiceTray, AddonPanel, AssetPicker, DiceViewport, HealthEditor, GridSettings, PermissionsPanel, TextEditor },
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
      snapEnabled: true,
      buildShape: 'box', buildColor: '#6b5d4f', buildHeight: 1,
      role: 'gm', drawSub: 'pen', drawColor: '#e0c068', drawWidth: 4, drawFill: '#e0c068',
      fogSub: 'brush', fogRadius: 36,
      measureMode: 'ruler', measureType: 'euclidean',
      showGrid: false, gridConfig: { type: 'square', size: 70, lineWidth: 1, opacity: 1, lineStyle: 'solid', color: '#3a3228', feetPerSquare: 5 },
      showPerms: false, permissions: { maps:{create:true,update:true,delete:true}, tokens:{create:true,update:true,delete:true,ownerOnly:false}, drawings:{create:true,update:true,delete:true}, fog:{create:true,update:true,delete:true} },
      fogSub: 'brush', fogRadius: 36, fogColor: '#0a0a0a', fogCut: false, fogPreview: false,
      textEditor: null, // {x, y} when open
      richTexts: [],     // [{id, x, y, html, text, color}] persisted overlays
      healthToken: null, healthX: 0, healthY: 0,
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
      return { pointer: '➤', grab: '✋', measure: '📏', aoe: '✸', build: '🧱', draw: '✏️', fog: '🌫' }[id] || '•';
    },

    hydrate(doc) {
      if (!doc) return;
      if (doc.mapUrl) {
        this.scene2d.setMap(doc.mapUrl);
        this.scene3d.setMapTexture(doc.mapUrl);
      }
      // Additional maps (multi-floor): reload each beyond the first.
      for (const m of (doc.maps || []).slice(1)) {
        this.scene2d.addMap(m.url, m);
      }
      for (const t of doc.tokens || []) {
        this.scene2d.upsertToken(t);
        this.scene3d.upsertToken({ ...t, kind: t.url ? 'model' : 'primitive', z: t.y });
      }
      for (const b of doc.blocks || []) {
        this.scene3d.addBlock?.(b);
      }
      // Replay fog + drawings (2D-only persisted layers).
      for (const s of doc.fog || []) {
        if (s.tool === 'cover') this.scene2d.hideAll();
        else this.scene2d.applyFogStroke(s);
      }
      for (const d of doc.drawings || []) {
        if (d.points) this.scene2d._addLine?.(d);
        else if (d.shape) this.scene2d._addShape?.(d);
        else if (d.text && d.html) this.richTexts.push({ ...d });
        else if (d.text) this.scene2d._addText?.(d);
      }
      this.projectRichTexts();
      for (const ms of doc.measurements || []) {
        this.scene2d.applyMeasurement?.(ms);
        this.scene3d.addMeasurement?.(ms);
      }
      if (doc.gridConfig) {
        this.gridConfig = doc.gridConfig;
        this.scene2d.setGridConfig?.(doc.gridConfig);
        const mt = this.tools?.tools?.get('measure');
        if (mt) mt.feetPerSquare = doc.gridConfig.feetPerSquare || 5;
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
          maps: s2.maps || [],
          map2d: s2.mapUrl || null,
          map3d: s3.mapUrl || null,
          tokens: [...byId.values()],
          blocks: s3.blocks || [],
          fog: s2.fog || null,
          drawings: [...(s2.drawings || []), ...this.richTexts.map((r) => ({ id: r.id, x: r.x, y: r.y, html: r.html, text: r.text, color: r.color }))],
          measurements: s2.measurements || [],
          gridConfig: s2.gridConfig || this.gridConfig || null,
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
        if (data.role) this.role = data.role;
        if (data.permissions) {
          this.permissions = data.permissions;
          this.applyPermissionGating();
        }
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
      if (m.type === 'token:hp') {
        this.scene2d.updateHp?.(m.payload.id, m.payload.hp);
        this.scene3d.updateHp?.(m.payload.id, m.payload.hp);
        if (this.healthToken?.id === m.payload.id) this.healthToken.hp = m.payload.hp;
      }
      if (m.type === 'map:set') {
        this.scene2d.setMap(m.payload.url);
        this.scene3d.setMapTexture(m.payload.url);
      }
      if (m.type === 'map:add') this.scene2d.addMap(m.payload.url, m.payload);
      if (m.type === 'map:move') {
        const node = this.scene2d.layers?.map?.findOne?.('#' + m.payload.id);
        if (node) { node.position({ x: m.payload.x, y: m.payload.y }); this.scene2d.layers.map.batchDraw(); }
      }
      if (m.type === 'map:scale') {
        const node = this.scene2d.layers?.map?.findOne?.('#' + m.payload.id);
        if (node) { node.scale({ x: m.payload.scale, y: m.payload.scale }); this.scene2d.layers.map.batchDraw(); }
      }
      if (m.type === 'map:remove') this.scene2d.removeMap(m.payload.id);
      if (m.type === 'aoe:set') this.scene3d.setAoE(m.payload.id, m.payload);
      if (m.type === 'block:set') this.scene3d.addBlock(m.payload);
      if (m.type === 'block:remove') this.scene3d.removeBlock(m.payload.id);
      if (m.type === 'aoe:remove') {
        this.scene3d.clearAoE?.(m.payload.id);
        this.adapters['2d'].removeAoE?.(m.payload.id);
      }
      if (m.type === 'fog:stroke') this.scene2d.applyFogStroke(m.payload);
      if (m.type === 'fog:shape') this.scene2d.applyFogShape(m.payload);
      if (m.type === 'fog:shape:remove') {
        const node = this.scene2d.layers?.fog?.findOne?.('#' + m.payload.id);
        if (node) { node.destroy(); this.scene2d.layers.fog.batchDraw(); }
        this.scene2d.fogStrokes = this.scene2d.fogStrokes.filter((s) => s.id !== m.payload.id);
      }
      if (m.type === 'fog:clear') this.scene2d.clearFog();
      if (m.type === 'fog:hideall') this.scene2d.hideAll();
      if (m.type === 'draw:line') this.scene2d._addLine?.(m.payload);
      if (m.type === 'draw:shape') this.scene2d._addShape?.(m.payload);
      if (m.type === 'draw:text') {
        const p = m.payload;
        if (p.html) {
          // Rich text overlay (HTML).
          if (!this.richTexts.some((r) => r.id === p.id)) this.richTexts.push({ ...p });
          this.projectRichTexts();
        } else {
          // Plain Konva text (legacy / from older clients).
          this.scene2d._addText?.(p);
        }
      }
      if (m.type === 'measure:add') {
        this.scene2d.applyMeasurement?.(m.payload);
        this.scene3d.addMeasurement?.(m.payload);
      }
      if (m.type === 'measure:remove') {
        this.scene2d.removeMeasurement?.(m.payload.id);
        this.scene3d.clearMeasurement?.(m.payload.id);
      }
      if (m.type === 'grid:config') {
        this.gridConfig = m.payload;
        this.scene2d.setGridConfig?.(m.payload);
        const mt = this.tools?.tools?.get('measure');
        if (mt) mt.feetPerSquare = m.payload.feetPerSquare || 5;
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
      this.tools.tools.get('measure')?.setMode?.(this.measureMode);
      this.tools.tools.get('measure')?.setMeasureType?.(this.measureType);
      this.tools.tools.get('aoe')?.setShape?.(this.aoeShape);
      const bt = this.tools.tools.get('build');
      if (bt) { bt.setShape(this.buildShape); bt.setColor(this.buildColor); bt.setSize({ h: this.buildHeight }); }
      const dt = this.tools.tools.get('draw');
      if (dt) { dt.setSub(this.drawSub); dt.setColor(this.drawColor); dt.setWidth(this.drawWidth); }
      const ft = this.tools.tools.get('fog');
      if (ft) { ft.setSub(this.fogSub); ft.setRadius(this.fogRadius); ft.setColor(this.fogColor); ft.setCut(this.fogCut); }
      // Hide GM-only tools (fog) from players.
      if (this.role !== 'gm') this.tools.tools.delete('fog');
      this.toolList = this.tools.list();
      this.activeTool = this.tools.active?.id;
      this.applyPermissionGating();
      this.bindPointer();
      this.resize();
    },
    setMode(m) { if (m === this.mode) return; this.mode = m; this.applyMode(); },
    activate(id) { this.tools.activate(id); this.activeTool = id; },

    toggleSnap() {
      this.snapEnabled = !this.snapEnabled;
      this.adapters['2d'].snapEnabled = this.snapEnabled;
      this.adapters['3d'].snapEnabled = this.snapEnabled;
      this.scene2d.snapEnabled = this.snapEnabled;
    },

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
    setMeasureMode(m) {
      this.measureMode = m;
      this.tools.tools.get('measure')?.setMode?.(m);
    },
    setMeasureType(t) {
      this.measureType = t;
      this.tools.tools.get('measure')?.setMeasureType?.(t);
    },
    clearMeasurements() {
      this.tools.tools.get('measure')?.clearAll?.();
    },
    onGridChange(cfg) {
      this.gridConfig = cfg;
      this.scene2d.setGridConfig?.(cfg);
      const mt = this.tools.tools.get('measure');
      if (mt) { mt.feetPerSquare = cfg.feetPerSquare || 5; }
      this.sync?.send({ type: 'grid:config', payload: cfg });
    },
    async onPermsChange(perms) {
      this.permissions = perms;
      try {
        await axios.put(generateUrl(`/apps/grimoire/api/campaigns/${this.campaignId}/permissions`), { permissions: perms });
      } catch (e) {
        this._notify('Could not save permissions — server rejected them.');
      }
      this.applyPermissionGating();
    },
    /** Hide/disable tools the player isn't allowed to use. */
    applyPermissionGating() {
      if (this.role === 'gm') return; // GM bypasses
      const p = this.permissions || {};
      const can = (layer, action) => p[layer]?.[action] !== false;
      // Remove tools whose layer the player can't create with.
      if (!can('drawings', 'create')) this.tools.tools.delete('draw');
      if (!can('fog', 'create')) this.tools.tools.delete('fog');
      if (!can('maps', 'create')) this.tools.tools.delete('build');
      this.toolList = this.tools.list();
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
    setBuildShape(s) { this.buildShape = s; this.tools.tools.get('build')?.setShape?.(s); },
    setBuildColor() { this.tools.tools.get('build')?.setColor?.(this.buildColor); },
    setBuildSize() {
      const t = this.tools.tools.get('build');
      t?.setSize?.({ h: this.buildHeight });
    },
    setDrawSub(s) {
      this.drawSub = s;
      this.tools.tools.get('draw')?.setSub?.(s);
    },
    setDrawColor() { this.tools.tools.get('draw')?.setColor?.(this.drawColor); },
    setDrawFill() {
      // Convert the hex fill picker to a translucent rgba so shapes aren't solid.
      const hex = this.drawFill;
      const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
      const fill = `rgba(${r},${g},${b},0.18)`;
      this.tools.tools.get('draw')?.setFill?.(fill);
    },
    setDrawWidth() { this.tools.tools.get('draw')?.setWidth?.(this.drawWidth); },
    setFogSub(s) {
      this.fogSub = s;
      this.tools.tools.get('fog')?.setSub?.(s);
    },
    setFogColor() { this.tools.tools.get('fog')?.setColor?.(this.fogColor); },
    setFogCut() { this.tools.tools.get('fog')?.setCut?.(this.fogCut); },
    toggleFogPreview() {
      this.fogPreview = this.tools.tools.get('fog')?.togglePreview?.() ?? !this.fogPreview;
    },
    fogRevealAll() { this.tools.tools.get('fog')?.revealAll?.(); },
    fogHideAll() { this.tools.tools.get('fog')?.hideAll?.(); },

    bindPointer() {
      const el = this.mode === '2d' ? this.$refs.stage2d : this.$refs.canvas3d;
      const adapter = this.adapters[this.mode];
      const world = (e) => this.mode === '2d'
        ? adapter.worldPointFromEvent()
        : adapter.worldPointFromEvent(this.ndc(e));
      // Only left-click (button 0) goes to tools; right-click is used for orbit/pan.
      el.onpointerdown = (e) => {
        if (e.button === 0) {
          // The text tool opens an in-place rich text editor instead of a
          // prompt; intercept it here so we get screen coords for the overlay.
          if (this.activeTool === 'draw' && this.drawSub === 'text') {
            this.openTextEditor(e);
            return;
          }
          this.tools.handle('onPointerDown', world(e));
        }
      };
      el.onpointermove = (e) => this.tools.handle('onPointerMove', world(e));
      window.onpointerup = (e) => { if (e.button === 0) this.tools.handle('onPointerUp', world(e)); };
      el.oncontextmenu = (e) => {
        e.preventDefault();
        // When the AoE or Build tool is active, right-click deletes the item
        // under the cursor. Otherwise right-click is left for camera orbit/pan.
        if (this.activeTool === 'aoe' || this.activeTool === 'build' || this.activeTool === 'measure') this.tools.handle('onContext', world(e));
      };
      // GM double-click on a token opens the health editor.
      el.ondblclick = (e) => {
        if (e.button !== 0) return;
        const w = world(e);
        // Fog polygon mode: double-click closes the polygon.
        if (this.activeTool === 'fog') {
          this.tools.handle('onDoubleClick', w);
          return;
        }
        // Draw polygon mode: double-click closes the polygon.
        if (this.activeTool === 'draw') {
          this.tools.handle('onDoubleClick', w);
          return;
        }
        if (this.role !== 'gm') return;
        const hit = this.adapters[this.mode].pickToken?.(w);
        if (!hit) return;
        this.openHealthEditor(hit.id, e);
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
      this.projectRichTexts();
      this._raf = requestAnimationFrame(this.loop);
    },

    // --- Asset picker handlers ---

    async onSetMap(url) {
      this.scene2d.setMap(url);
      this.scene3d.setMapTexture(url);
      this.sync?.send({ type: 'map:set', payload: { url } });
    },

    /** Add a second+ map to the scene (multi-floor / side-by-side). */
    async onAddMap(url) {
      const entry = await this.scene2d.addMap(url, { x: 200, y: 200 });
      this.sync?.send({ type: 'map:add', payload: entry });
    },

    async onAddToken(t) {
      // Place in both 2D and 3D scenes.
      const token = { ...t, owner: this.userId };
      await this.scene2d.upsertToken(token);
      await this.scene3d.upsertToken({ ...token, kind: 'primitive', z: t.y || 0 });
      this.sync?.send({ type: 'token:upsert', payload: token });
    },

    async onAddModel(t) {
      // Guard: if the chosen file is actually an image (not a glTF/GLB), treat
      // it as a flat image token instead of feeding it to the glTF loader
      // (which would fail trying to JSON-parse a PNG).
      const url = (t.url || '').toLowerCase().split('?')[0];
      const isImage = /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(url);
      if (isImage) {
        this._notify('That looks like an image — added as a flat token. Use a .glb/.gltf file for a 3D model.');
        await this.onAddToken({ ...t, url: t.url });
        return;
      }
      const isModel = /\.(glb|gltf)$/.test(url);
      if (url && !isModel) {
        this._notify('Unrecognised model file — expected .glb or .gltf.');
      }
      this.scene3d.onModelError = (data, err) => {
        this._notify(`Model failed to load: ${err?.message || 'check the URL is a direct .glb/.gltf link'}`);
      };
      this.setMode('3d');
      const token = { ...t, owner: this.userId };
      try {
        await this.scene3d.upsertToken({ ...token, kind: 'model' });
        await this.scene2d.upsertToken({ ...token, x: t.x || 70, y: t.y || 70, size: 1, color: '#4a90d9' });
        this.sync?.send({ type: 'token:upsert', payload: token });
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

    /** A roll from the 2D dice viewport — broadcast it to the room. */
    onViewportRoll(result) {
      this.sync?.send({ type: 'dice:result', payload: result });
      this.addonManager?.emit('dice:result', result);
    },

    // --- Health system (GM controls) ---

    /** Open the HP editor for a token near the cursor (GM only). */
    openHealthEditor(id, e) {
      const byId = new Map();
      for (const t of this.scene2d.tokens.values()) byId.set(t.data.id, t.data);
      for (const t of this.scene3d.tokens.values()) if (!byId.has(t.data.id)) byId.set(t.data.id, t.data);
      const token = byId.get(id);
      if (!token) return;
      this.healthToken = token;
      this.healthX = e.clientX;
      this.healthY = e.clientY;
    },

    /** Apply an HP edit locally + to both scenes, then broadcast. */
    onHealthChange({ id, hp }) {
      this.scene2d.updateHp?.(id, hp);
      this.scene3d.updateHp?.(id, hp);
      this.sync?.send({ type: 'token:hp', payload: { id, hp } });
      // Keep the editor's token in sync so quick +/- buttons reflect.
      if (this.healthToken) this.healthToken.hp = hp;
    },

    // --- Rich text on canvas ---

    openTextEditor(e) {
      // Place the editor at the click, in screen coords.
      this.textEditor = { x: e.clientX, y: e.clientY };
      this._textWorld = this.adapters[this.mode].worldPointFromEvent(
        this.mode === '2d' ? undefined : this.ndc(e));
      // For 2D we need the world point too (the stage transform gives it).
      if (this.mode === '2d') this._textWorld = this.adapters['2d'].worldPointFromEvent();
    },

    onTextCommit({ html, text }) {
      const id = 'text_' + Date.now();
      const w = this._textWorld || { x: 0, y: 0 };
      const rt = { id, x: w.x, y: w.y, html, text, color: this.drawColor };
      this.richTexts.push(rt);
      this.projectRichTexts();
      this.sync?.send({ type: 'draw:text', payload: rt });
      this.textEditor = null;
    },

    /** Project world coords of rich text overlays to screen each frame. */
    projectRichTexts() {
      if (this.mode !== '2d') return;
      const stage = this.scene2d.stage;
      const tr = stage.getAbsoluteTransform();
      const rect = stage.container().getBoundingClientRect();
      for (const rt of this.richTexts) {
        const p = tr.point({ x: rt.x, y: rt.y });
        rt.screenX = rect.left + p.x;
        rt.screenY = rect.top + p.y;
      }
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
.build-color { width: 28px; height: 22px; border: none; background: none; vertical-align: middle; cursor: pointer; padding: 0; }
.build-range { width: 70px; vertical-align: middle; margin: 0 4px; }
.fog-check { margin-left: 4px; vertical-align: middle; cursor: pointer; }
.build-palette { flex-wrap: wrap; max-width: 92vw; }

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
.rich-text-layer { position: absolute; inset: 0; pointer-events: none; z-index: 15; }
.rich-text-item {
  position: fixed; transform: translate(0, -50%);
  font-family: "Iowan Old Style","Palatino Linotype",Georgia,serif;
  font-size: 18px; line-height: 1.35; text-shadow: 0 1px 3px rgba(0,0,0,.8);
  white-space: pre-wrap; max-width: 340px;
}
.rich-text-item :deep(h1) { font-size: 1.4em; margin: 2px 0; }
.rich-text-item :deep(h2) { font-size: 1.15em; margin: 2px 0; }
.rich-text-item :deep(ul), .rich-text-item :deep(ol) { margin: 2px 0 2px 18px; }
</style>
