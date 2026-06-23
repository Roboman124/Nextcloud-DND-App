<template>
  <div class="grid-settings">
    <header>
      <span class="gs-title">Grid</span>
      <button class="gs-close" @click="$emit('close')">✕</button>
    </header>
    <label class="gs-row">Type
      <select v-model="cfg.type" @change="emit">
        <option value="square">Square</option>
        <option value="hex-v">Hex (pointy)</option>
        <option value="hex-h">Hex (flat)</option>
      </select>
    </label>
    <label class="gs-row">Size (px)
      <input type="number" min="20" max="200" v-model.number="cfg.size" @change="emit" />
    </label>
    <label class="gs-row">Line width
      <input type="range" min="0.5" max="6" step="0.5" v-model.number="cfg.lineWidth" @input="emit" />
      <span class="gs-val">{{ cfg.lineWidth }}</span>
    </label>
    <label class="gs-row">Opacity
      <input type="range" min="0" max="1" step="0.1" v-model.number="cfg.opacity" @input="emit" />
      <span class="gs-val">{{ cfg.opacity }}</span>
    </label>
    <label class="gs-row">Line style
      <select v-model="cfg.lineStyle" @change="emit">
        <option value="solid">Solid</option>
        <option value="dashed">Dashed</option>
        <option value="dotted">Dotted</option>
      </select>
    </label>
    <label class="gs-row">Colour
      <input type="color" v-model="cfg.color" @change="emit" class="gs-color" />
    </label>
    <label class="gs-row">Scale (ft/square)
      <input type="number" min="1" max="100" v-model.number="cfg.feetPerSquare" @change="emit" />
    </label>
  </div>
</template>

<script>
/**
 * GridSettings — a popover to configure the scene grid: type (square / hex
 * pointy / hex flat), size, line width/opacity/style/colour, and the
 * per-scene measurement scale (feet per square). Emits `change` with the
 * full config on every edit; Room applies it to Scene2D + the measure tool.
 */
export default {
  name: 'GridSettings',
  emits: ['close', 'change'],
  props: { config: { type: Object, default: () => ({}) } },
  data() {
    return {
      cfg: {
        type: 'square',
        size: 70,
        lineWidth: 1,
        opacity: 1,
        lineStyle: 'solid',
        color: '#3a3228',
        feetPerSquare: 5,
        ...this.config,
      },
    };
  },
  methods: {
    emit() { this.$emit('change', { ...this.cfg }); },
  },
};
</script>

<style scoped>
.grid-settings {
  position: absolute; left: 70px; top: 70px; z-index: 45; width: 220px;
  background: var(--g-bg-dark, #0f1318); border: 1px solid var(--g-border, #2d3748);
  border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px;
  box-shadow: 0 10px 30px rgba(0,0,0,.5);
}
header { display: flex; justify-content: space-between; align-items: center; }
.gs-title { font-size: 11px; font-weight: 700; letter-spacing: .15em; text-transform: uppercase; color: var(--g-primary, #0082c9); }
.gs-close { background: none; border: none; color: var(--g-text-dim, #8b949e); cursor: pointer; font-size: 13px; }
.gs-row { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--g-text-dim, #8b949e); }
.gs-row select, .gs-row input[type=number] {
  flex: 1; background: var(--g-bg-card, #1e2430); border: 1px solid var(--g-border, #2d3748);
  border-radius: 6px; color: var(--g-text, #d8dde4); font: inherit; font-size: 12px; padding: 4px 6px;
}
.gs-row input[type=range] { flex: 1; }
.gs-val { min-width: 24px; text-align: right; color: var(--g-text, #d8dde4); font-variant-numeric: tabular-nums; }
.gs-color { width: 34px; height: 24px; border: none; background: none; cursor: pointer; padding: 0; }
</style>