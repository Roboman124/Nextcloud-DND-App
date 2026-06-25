<template>
  <aside class="dice-panel" :class="{ collapsed: !open }">
    <button class="dp-toggle" @click="open = !open" :title="open ? 'Hide dice' : 'Show dice'">
      <span class="dp-toggle-icon">🎲</span>
      <span v-if="!open" class="dp-badge" v-show="lastResult">{{ lastResult }}</span>
    </button>
    <div v-if="open" class="dp-body">
      <header class="dp-header">
        <h3>Dice</h3>
        <button class="dp-close" @click="open = false">✕</button>
      </header>

      <!-- 3D viewport: in 2D mode this shows a mini 3D render; in 3D mode it's hidden (dice roll in the main scene) -->
      <div v-if="mode === '2d'" class="dp-viewport-wrap">
        <canvas ref="canvas" class="dp-canvas"></canvas>
      </div>

      <!-- Dice picker -->
      <div class="dp-pick">
        <button v-for="d in dice" :key="d"
          :class="['dp-chip', { on: counts[d] > 0 }]"
          @click="inc(d)" @contextmenu.prevent="zero(d)"
          :title="counts[d] ? counts[d] + '× ' + d : 'add ' + d">{{ d }}<sub v-if="counts[d]">×{{ counts[d] }}</sub></button>
      </div>

      <div class="dp-actions">
        <button class="dp-roll" :disabled="totalDice === 0" @click="roll">
          Roll{{ totalDice ? ' ' + totalDice : '' }}
        </button>
        <button class="dp-clear" title="Clear" @click="clear">✕</button>
      </div>

      <div class="dp-result" v-if="display">
        <span class="dp-total">{{ total }}</span>
        <span class="dp-breakdown">{{ display }}</span>
      </div>
      <div class="dp-result dp-empty" v-else-if="open">
        <span class="dp-hint">Pick dice, then roll</span>
      </div>
    </div>
  </aside>
</template>

<script>
import { DiceRoller } from '../engine/3d/DiceRoller.js';

/**
 * DicePanel — the single consolidated dice UI. Lives in a right-side sidebar
 * (Nextcloud-style) and shows the mode-appropriate dice experience:
 *
 *  - 2D mode: a mini 3D canvas at the top renders the physics dice tumbling,
 *    so 2D players get the 3D dice without leaving the battlemap.
 *  - 3D mode: no mini canvas (dice roll in the main 3D scene); the panel just
 *    drives the main DiceRoller and shows results.
 *
 * Emits `roll` with {rolls, total, notation} on every settle so the room
 * stays in sync. Receives the main 3D DiceRoller via prop when in 3D mode;
 * builds its own private DiceRoller for 2D mode.
 */
export default {
  name: 'DicePanel',
  props: {
    /** The main scene's DiceRoller (used in 3D mode). Null in 2D mode. */
    roller: { type: Object, default: null },
    /** Current map mode: '2d' or '3d'. */
    mode: { type: String, default: '2d' },
    /** Initial open state. */
    startOpen: { type: Boolean, default: true },
  },
  emits: ['roll'],
  data() {
    return {
      open: this.startOpen,
      dice: ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'],
      counts: { d4: 0, d6: 0, d8: 0, d10: 0, d12: 0, d20: 0 },
      display: '',
      total: '',
      lastResult: '',
    };
  },
  computed: {
    totalDice() { return Object.values(this.counts).reduce((s, n) => s + n, 0); },
  },
  watch: {
    mode: { immediate: true, handler() { this.syncRoller(); } },
    roller: { immediate: true, handler() { this.syncRoller(); } },
    open(v) { if (v && this.mode === '2d') this.$nextTick(() => this.ensureScene()); },
  },
  methods: {
    syncRoller() {
      // In 3D mode, hook the main roller's settle to our result display.
      if (this.mode === '3d' && this.roller) {
        const prev = this.roller.onSettle;
        this.roller.onSettle = (results) => {
          this.showResults(results);
          try { prev?.(results); } catch { /* ignore */ }
        };
      }
    },
    inc(d) { if (this.counts[d] < 12) this.counts[d]++; },
    zero(d) { this.counts[d] = 0; },
    clear() {
      for (const d of this.dice) this.counts[d] = 0;
      this.display = ''; this.total = ''; this.lastResult = '';
      this.viewportRoller?.clear();
    },
    roll() {
      if (this.totalDice === 0) return;
      const spec = this.dice.filter((d) => this.counts[d] > 0).map((d) => ({ type: d, count: this.counts[d] }));
      this.display = 'rolling…'; this.total = '';
      const r = this.mode === '3d' ? this.roller : this.viewportRoller;
      if (!r) return;
      r.rollAsync(spec).then((results) => this.showResults(results));
    },
    showResults(results) {
      const sum = results.reduce((s, x) => s + (x.value || 0), 0);
      this.total = String(sum);
      this.display = results.map((x) => `${x.type}:${x.value}`).join('  ');
      this.lastResult = String(sum);
      this.$emit('roll', { rolls: results, total: sum, notation: results.map((r) => r.type).join(' + ') });
    },
    // --- 2D mode: private 3D scene ---
    ensureScene() { if (!this.viewportRoller) this._initScene(); },
    async _initScene() {
      const THREE = await import('three');
      const CANNON = await import('cannon-es');
      const canvas = this.$refs.canvas;
      if (!canvas) return;
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      const scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x12100c, 0.025);
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      camera.position.set(0, 14, 16);
      camera.lookAt(0, 0, 0);
      scene.add(new THREE.AmbientLight(0xffe9c4, 0.5));
      const key = new THREE.DirectionalLight(0xfff0d0, 1.4);
      key.position.set(10, 20, 8); key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.left = -16; key.shadow.camera.right = 16;
      key.shadow.camera.top = 16; key.shadow.camera.bottom = -16;
      scene.add(key);
      scene.add(new THREE.HemisphereLight(0x556699, 0x221a10, 0.4));
      const floor = new THREE.Mesh(
        new THREE.CircleGeometry(14, 48),
        new THREE.MeshStandardMaterial({ color: 0x2b2620, roughness: 1 })
      );
      floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
      const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -38, 0) });
      world.broadphase = new CANNON.SAPBroadphase(world); world.allowSleep = true;
      this.THREE = THREE; this.renderer = renderer;
      this.scene3d = scene; this.camera = camera; this.world = world;
      this.viewportRoller = new DiceRoller({
        THREE, CANNON, scene, world,
        onSettle: (r) => this.showResults(r),
      });
      const C = CANNON;
      const floorBody = new C.Body({ mass: 0, shape: new C.Plane() });
      floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0); world.addBody(floorBody);
      const S = 12;
      for (const w of [{ p:[0,0,-S],r:[0,0,0] },{ p:[0,0,S],r:[0,Math.PI,0] },{ p:[-S,0,0],r:[0,Math.PI/2,0] },{ p:[S,0,0],r:[0,-Math.PI/2,0] }]) {
        const b = new C.Body({ mass: 0, shape: new C.Plane() });
        b.quaternion.setFromEuler(...w.r); b.position.set(...w.p); world.addBody(b);
      }
      this._resize(); this._loop();
      window.addEventListener('resize', this._resize);
    },
    _resize() {
      const el = this.$el.querySelector('.dp-canvas');
      if (!el || !this.renderer) return;
      const w = el.clientWidth || 220, h = el.clientHeight || 170;
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h, false);
    },
    _loop() {
      if (!this.renderer) return;
      const dt = 1 / 60;
      this.world.step(1 / 60, dt, 3);
      this.viewportRoller.step(dt);
      this.renderer.render(this.scene3d, this.camera);
      this._raf = requestAnimationFrame(this._loop);
    },
  },
  beforeUnmount() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._resize);
    this.viewportRoller?.clear();
    this.renderer?.dispose();
  },
};
</script>

<style scoped>
.dice-panel {
  position: absolute; right: 0; top: 0; bottom: 0; z-index: 30;
  display: flex; align-items: flex-start;
}
.dp-toggle {
  margin: 14px 14px 0 0; width: 44px; height: 44px; border-radius: 50%;
  background: var(--g-bg-dark); border: 1px solid var(--g-border);
  cursor: pointer; font-size: 20px; display: flex; align-items: center; justify-content: center;
  box-shadow: var(--g-shadow); position: relative; flex-shrink: 0;
}
.dp-toggle:hover { border-color: var(--g-primary); }
.dp-badge {
  position: absolute; top: -4px; right: -4px; background: var(--g-primary); color: var(--g-primary-t);
  font-size: 11px; font-weight: 700; border-radius: 10px; padding: 1px 6px; min-width: 18px; text-align: center;
}
.dp-body {
  width: 280px; height: calc(100% - 28px); margin: 14px 14px 14px 0;
  background: var(--g-bg-dark); border: 1px solid var(--g-border);
  border-radius: var(--g-radius-large); overflow: hidden;
  display: flex; flex-direction: column; box-shadow: var(--g-shadow);
}
.dp-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--g-border); }
.dp-header h3 { margin: 0; font-size: 12px; font-weight: 700; letter-spacing: .15em; text-transform: uppercase; color: var(--g-primary); }
.dp-close { background: none; border: none; color: var(--g-text-dim); cursor: pointer; font-size: 14px; }
.dp-close:hover { color: var(--g-text); }
.dp-viewport-wrap { background: #0a0805; }
.dp-canvas { width: 100%; height: 180px; display: block; }
.dp-pick { display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 14px 8px; }
.dp-chip {
  font: inherit; font-size: 12px; font-weight: 700;
  background: var(--g-bg-card); color: var(--g-text-dim);
  border: 1px solid var(--g-border); border-radius: 999px;
  padding: 5px 11px; cursor: pointer; line-height: 1;
}
.dp-chip:hover { border-color: var(--g-primary); color: var(--g-text); }
.dp-chip.on { background: var(--g-primary); color: var(--g-primary-t); border-color: var(--g-primary); }
.dp-chip sub { font-size: 9px; font-weight: 700; margin-left: 2px; }
.dp-actions { display: flex; gap: 6px; padding: 0 14px 8px; }
.dp-roll {
  flex: 1; font: inherit; font-weight: 700; font-size: 13px;
  background: var(--g-primary); color: var(--g-primary-t); border: none;
  border-radius: var(--g-radius); padding: 9px; cursor: pointer;
}
.dp-roll:hover:not(:disabled) { opacity: .88; }
.dp-roll:disabled { opacity: .35; cursor: default; }
.dp-clear {
  background: var(--g-bg-card); border: 1px solid var(--g-border);
  color: var(--g-text-dim); border-radius: var(--g-radius);
  width: 36px; cursor: pointer;
}
.dp-clear:hover { color: var(--g-error); border-color: var(--g-error); }
.dp-result { text-align: center; padding: 8px 14px; }
.dp-total { display: block; font-size: 28px; font-weight: 800; color: var(--g-primary); line-height: 1.1; }
.dp-breakdown { display: block; font-size: 11px; color: var(--g-text-dim); margin-top: 2px; }
.dp-empty { color: var(--g-text-dim); }
.dp-hint { font-size: 12px; font-style: italic; }
</style>