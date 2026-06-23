<template>
  <div v-if="token" class="health-popover" :style="{ left: x + 'px', top: y + 'px' }">
    <header>
      <span class="hp-title">{{ token.label || 'Token' }}</span>
      <button class="hp-close" @click="$emit('close')">✕</button>
    </header>
    <div class="hp-row">
      <label>Current
        <input type="number" v-model.number="current" @change="emit" min="0" />
      </label>
      <label>Max
        <input type="number" v-model.number="maxHp" @change="emit" min="0" />
      </label>
    </div>
    <div class="hp-row">
      <label>Temp
        <input type="number" v-model.number="temp" @change="emit" min="0" placeholder="0" />
      </label>
      <div class="hp-quick">
        <button @click="dmg(5)" title="Take 5">−5</button>
        <button @click="dmg(1)" title="Take 1">−1</button>
        <button @click="heal(1)" title="Heal 1">+1</button>
        <button @click="heal(5)" title="Heal 5">+5</button>
      </div>
    </div>
    <p class="hp-note">DM only · changes sync to the room</p>
  </div>
</template>

<script>
/**
 * HealthEditor — a small popover the GM uses to edit a token's HP. Opens when
 * the GM double-clicks a token; emits `change` with {id, hp} on every edit.
 * Players never see this (Room only mounts it for the gm role).
 */
export default {
  name: 'HealthEditor',
  props: {
    token: { type: Object, default: null },
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
  },
  emits: ['close', 'change'],
  data() {
    return { current: 0, maxHp: 0, temp: 0 };
  },
  watch: {
    token: {
      immediate: true,
      handler(t) {
        if (!t) return;
        const hp = t.hp || {};
        this.current = hp.current ?? 0;
        this.maxHp = hp.maxHp ?? 0;
        this.temp = hp.temp ?? 0;
      },
    },
  },
  methods: {
    emit() {
      this.$emit('change', {
        id: this.token.id,
        hp: { current: this.current, maxHp: this.maxHp, temp: this.temp || 0 },
      });
    },
    dmg(n) { this.current = Math.max(0, this.current - n); this.emit(); },
    heal(n) { this.current = Math.min(this.maxHp || this.current + n, this.current + n); this.emit(); },
  },
};
</script>

<style scoped>
.health-popover {
  position: absolute; z-index: 50; width: 220px;
  background: var(--g-bg-dark, #0f1318);
  border: 1px solid var(--g-border, #2d3748); border-radius: 12px;
  padding: 10px 12px; display: flex; flex-direction: column; gap: 8px;
  box-shadow: 0 10px 30px rgba(0,0,0,.5);
}
header { display: flex; justify-content: space-between; align-items: center; }
.hp-title { font-size: 12px; font-weight: 700; color: var(--g-primary, #0082c9);
  letter-spacing: .08em; text-transform: uppercase; }
.hp-close { background: none; border: none; color: var(--g-text-dim, #8b949e);
  cursor: pointer; font-size: 13px; }
.hp-row { display: flex; gap: 8px; align-items: center; }
.hp-row label { flex: 1; font-size: 10px; color: var(--g-text-dim, #8b949e);
  text-transform: uppercase; letter-spacing: .08em; display: flex; flex-direction: column; gap: 3px; }
.hp-row input {
  width: 100%; box-sizing: border-box; padding: 6px 8px; font: inherit; font-size: 14px;
  background: var(--g-bg-card, #1e2430); border: 1px solid var(--g-border, #2d3748);
  border-radius: 6px; color: var(--g-text, #d8dde4);
}
.hp-row input:focus { outline: none; border-color: var(--g-primary, #0082c9); }
.hp-quick { display: flex; gap: 4px; }
.hp-quick button {
  flex: 1; font: inherit; font-size: 12px; font-weight: 700; padding: 6px 0;
  background: var(--g-bg-card, #1e2430); border: 1px solid var(--g-border, #2d3748);
  border-radius: 6px; color: var(--g-text, #d8dde4); cursor: pointer;
}
.hp-quick button:hover { border-color: var(--g-primary, #0082c9); color: var(--g-primary, #0082c9); }
.hp-note { font-size: 10px; color: var(--g-text-dim, #8b949e); margin: 0; text-align: center; font-style: italic; }
</style>