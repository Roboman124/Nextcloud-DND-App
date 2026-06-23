<template>
  <div class="dice-viewport" :class="{ open: open }">
    <button class="vp-tab" @click="toggle">
      <span class="vp-tab-icon">🎲</span>
      <span class="vp-tab-label">3D Dice</span>
    </button>
    <div v-if="open" class="vp-body">
      <canvas ref="canvas" class="vp-canvas"></canvas>
      <div class="vp-controls">
        <div class="vp-dice-pick">
          <button v-for="d in dice" :key="d"
            :class="['vp-chip', { on: counts[d] > 0 }]"
            @click="inc(d)" @contextmenu.prevent="zero(d)"
            :title="counts[d] ? counts[d] + '× ' + d : 'add a ' + d">{{ d }}<sub v-if="counts[d]">×{{ counts[d] }}</sub></button>
        </div>
        <div class="vp-actions">
          <button class="vp-roll" :disabled="totalDice === 0" @click="roll">Roll{{ totalDice ? ' ' + totalDice : '' }}</button>
          <button class="vp-clear" title="Clear dice" @click="clear">✕</button>
        </div>
        <div class="vp-result" v-if="display">
          <span class="vp-total">{{ total }}</span>
          <span class="vp-breakdown">{{ display }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { DiceRoller } from '../engine/3d/DiceRoller.js';

/**
 * DiceViewport — a self-contained 3D physics dice tray that renders in a tiny
 * embedded viewport, so 2D mode players see the dice tumble without switching
 * to the full 3D scene. It owns its own THREE scene + cannon world + render
 * loop (a scaled-down version of the 3D-room setup), so it works anywhere.
 *
 * Click a die type to add one (right-click to clear that type), then Roll.
 * The main room still broadcasts the result for multiplayer sync.
 */
export default {
  name: 'DiceViewport',
  emits: ['roll'],
  data() {
    return {
      open: false,
      dice: ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'],
      counts: { d4: 0, d6: 0, d8: 0, d10: 0, d12: 0, d20: 0 },
      display: '',
      total: '',
    };
  },
  computed: {
    totalDice() { return Object.values(this.counts).reduce((s, n) => s + n, 0); },
  },
  methods: {
    toggle() {
      this.open = !this.open;
      if (this.open) this.$nextTick(() => this.ensureScene());
    },
    inc(d) { if (this.counts[d] < 12) this.counts[d]++; },
    zero(d) { this.counts[d] = 0; },
    clear() {
      for (const d of this.dice) this.counts[d] = 0;
      this.display = '';
      this.total = '';
      this.roller?.clear();
    },
    roll() {
      if (this.totalDice === 0) return;
      this.ensureScene();
      const spec = this.dice.filter((d) => this.counts[d] > 0).map((d) => ({ type: d, count: this.counts[d] }));
      this.display = 'rolling…';
      this.total = '';
      this.roller.rollAsync(spec).then((results) => {
        const sum = results.reduce((s, x) => s + (x.value || 0), 0);
        this.total = String(sum);
        this.display = results.map((x) => `${x.type}:${x.value}`).join('  ');
        this.$emit('roll', { rolls: results, total: sum, notation: results.map((r) => r.type).join(' + ') });
      });
    },
    ensureScene() {
      if (this.roller) return;
      this._initScene();
    },
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

      // A felt-coloured floor for the tray so dice read against a surface.
      const floor = new THREE.Mesh(
        new THREE.CircleGeometry(14, 48),
        new THREE.MeshStandardMaterial({ color: 0x2b2620, roughness: 1 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      scene.add(floor);

      const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -38, 0) });
      world.broadphase = new CANNON.SAPBroadphase(world);
      world.allowSleep = true;

      this.THREE = THREE;
      this.renderer = renderer;
      this.scene3d = scene;
      this.camera = camera;
      this.world = world;

      this.roller = new DiceRoller({
        THREE, CANNON,
        scene, world,
        onSettle: (results) => {
          const sum = results.reduce((s, x) => s + (x.value || 0), 0);
          this.total = String(sum);
          this.display = results.map((x) => `${x.type}:${x.value}`).join('  ');
          this.$emit('roll', { rolls: results, total: sum, notation: results.map((r) => r.type).join(' + ') });
        },
      });

      // Build the tray walls inside the shared world (DiceRoller owns the floor
      // only when it owns the world; here it doesn't, so add a floor plane).
      const C = CANNON;
      const floorBody = new C.Body({ mass: 0, shape: new C.Plane() });
      floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
      world.addBody(floorBody);
      const S = 12;
      for (const w of [
        { p: [0,0,-S], r:[0,0,0] }, { p: [0,0,S], r:[0,Math.PI,0] },
        { p: [-S,0,0], r:[0,Math.PI/2,0] }, { p: [S,0,0], r:[0,-Math.PI/2,0] },
      ]) {
        const b = new C.Body({ mass: 0, shape: new C.Plane() });
        b.quaternion.setFromEuler(...w.r); b.position.set(...w.p);
        world.addBody(b);
      }

      this._resize();
      this._loop();
      window.addEventListener('resize', this._resize);
    },
    _resize() {
      const el = this.$el.querySelector('.vp-canvas');
      if (!el || !this.renderer) return;
      const w = el.clientWidth || 200, h = el.clientHeight || 160;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h, false);
    },
    _loop() {
      if (!this.renderer) return;
      const dt = 1 / 60;
      this.world.step(1 / 60, dt, 3);
      this.roller.step(dt);
      this.renderer.render(this.scene3d, this.camera);
      this._raf = requestAnimationFrame(this._loop);
    },
  },
  beforeUnmount() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._resize);
    this.roller?.clear();
    this.renderer?.dispose();
  },
};
</script>

<style scoped>
.dice-viewport {
  position: absolute; right: 14px; bottom: 14px; z-index: 25;
  display: flex; flex-direction: column; align-items: flex-end;
}
.vp-tab {
  display: flex; align-items: center; gap: 6px;
  background: var(--g-bg-dark, #0f1318); border: 1px solid var(--g-border, #2d3748);
  border-radius: 999px; padding: 7px 14px; cursor: pointer; color: var(--g-text, #d8dde4);
  font: inherit; font-size: 12px; font-weight: 600;
  box-shadow: 0 4px 14px rgba(0,0,0,.4);
}
.vp-tab:hover { border-color: var(--g-primary, #0082c9); color: var(--g-primary, #0082c9); }
.vp-tab-icon { font-size: 15px; }

.vp-body {
  margin-bottom: 8px;
  width: 260px; background: var(--g-bg-dark, #0f1318);
  border: 1px solid var(--g-border, #2d3748); border-radius: 14px;
  overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,.5);
  display: flex; flex-direction: column;
}
.vp-canvas { width: 100%; height: 170px; display: block; background: #0a0805; }

.vp-controls { padding: 9px 10px; display: flex; flex-direction: column; gap: 8px; }
.vp-dice-pick { display: flex; flex-wrap: wrap; gap: 5px; }
.vp-chip {
  font: inherit; font-size: 12px; font-weight: 700;
  background: var(--g-bg-card, #1e2430); color: var(--g-text-dim, #8b949e);
  border: 1px solid var(--g-border, #2d3748); border-radius: 999px;
  padding: 4px 10px; cursor: pointer; line-height: 1;
}
.vp-chip:hover { border-color: var(--g-primary, #0082c9); color: var(--g-text, #d8dde4); }
.vp-chip.on { background: var(--g-primary, #0082c9); color: #fff; border-color: var(--g-primary, #0082c9); }
.vp-chip sub { font-size: 9px; font-weight: 700; margin-left: 2px; }

.vp-actions { display: flex; gap: 6px; align-items: center; }
.vp-roll {
  flex: 1; font: inherit; font-weight: 700; font-size: 13px;
  background: var(--g-primary, #0082c9); color: #fff; border: none;
  border-radius: var(--g-radius, 8px); padding: 8px; cursor: pointer;
}
.vp-roll:hover:not(:disabled) { opacity: .88; }
.vp-roll:disabled { opacity: .35; cursor: default; }
.vp-clear {
  background: var(--g-bg-card, #1e2430); border: 1px solid var(--g-border, #2d3748);
  color: var(--g-text-dim, #8b949e); border-radius: var(--g-radius, 8px);
  width: 34px; height: 34px; cursor: pointer;
}
.vp-clear:hover { color: #e0998c; border-color: #e0998c; }

.vp-result { text-align: center; }
.vp-total { display: block; font-size: 26px; font-weight: 800; color: var(--g-primary, #0082c9); line-height: 1.1; }
.vp-breakdown { display: block; font-size: 10px; color: var(--g-text-dim, #8b949e); margin-top: 1px; }
</style>