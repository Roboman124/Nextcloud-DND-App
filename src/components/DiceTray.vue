<template>
  <div class="dice-tray">
    <div class="tray-header">
      <span class="tray-title">Dice</span>
      <button class="clear-btn" title="Clear" @click="clear">✕</button>
    </div>

    <div class="die-rows">
      <div v-for="d in dice" :key="d" class="die-row">
        <span class="die-label">{{ d }}</span>
        <div class="counter">
          <button @click="dec(d)" :disabled="counts[d] <= 0">−</button>
          <span class="count">{{ counts[d] }}</span>
          <button @click="inc(d)" :disabled="counts[d] >= 20">+</button>
        </div>
        <button class="roll-one" :disabled="counts[d] === 0" @click="rollSingle(d)">Roll</button>
      </div>
    </div>

    <button class="roll-all" :disabled="totalDice === 0" @click="rollAll">
      Roll {{ totalDice > 0 ? totalDice + ' dice' : 'all' }}
    </button>

    <div class="result" v-if="display">
      <span class="total">{{ total }}</span>
      <span class="breakdown">{{ display }}</span>
    </div>
  </div>
</template>

<script>
export default {
  name: 'DiceTray',
  props: { roller: Object },
  emits: ['ensure3d'],
  data() {
    return {
      dice: ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'],
      counts: { d4: 0, d6: 0, d8: 0, d10: 0, d12: 0, d20: 0 },
      display: '',
      total: '',
    };
  },
  computed: {
    totalDice() { return Object.values(this.counts).reduce((s, n) => s + n, 0); },
  },
  watch: {
    roller: {
      immediate: true,
      handler(r) {
        if (!r) return;
        r.onSettle = (results) => {
          const sum = results.reduce((s, x) => s + x.value, 0);
          this.total = String(sum);
          this.display = results.map((x) => `${x.type}:${x.value}`).join('  ');
        };
      },
    },
  },
  methods: {
    inc(d) { if (this.counts[d] < 20) this.counts[d]++; },
    dec(d) { if (this.counts[d] > 0) this.counts[d]--; },
    clear() {
      for (const d of this.dice) this.counts[d] = 0;
      this.display = '';
      this.total = '';
    },
    rollSingle(d) {
      this.$emit('ensure3d');
      this.display = 'rolling…';
      this.total = '';
      this.roller.roll([{ type: d, count: this.counts[d] || 1 }]);
    },
    rollAll() {
      if (this.totalDice === 0) return;
      this.$emit('ensure3d');
      this.display = 'rolling…';
      this.total = '';
      const spec = this.dice
        .filter((d) => this.counts[d] > 0)
        .map((d) => ({ type: d, count: this.counts[d] }));
      this.roller.roll(spec);
    },
  },
};
</script>

<style scoped>
.dice-tray {
  position: absolute; right: 14px; bottom: 14px; width: 240px;
  background: var(--g-bg-dark, #0f1318);
  border: 1px solid var(--g-border, #2d3748);
  border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 10px;
}
.tray-header { display: flex; justify-content: space-between; align-items: center; }
.tray-title { font-size: 11px; font-weight: 700; letter-spacing: .15em;
  text-transform: uppercase; color: var(--g-primary, #0082c9); }
.clear-btn { background: none; border: none; color: var(--g-text-dim, #8b949e);
  cursor: pointer; font-size: 13px; padding: 2px 4px; border-radius: 4px; line-height: 1; }
.clear-btn:hover { color: var(--g-text, #d8dde4); }

.die-rows { display: flex; flex-direction: column; gap: 5px; }
.die-row { display: flex; align-items: center; gap: 6px; }
.die-label { width: 30px; font-size: 12px; font-weight: 700;
  color: var(--g-text, #d8dde4); }
.counter { display: flex; align-items: center; gap: 4px; flex: 1; }
.counter button {
  width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--g-border, #2d3748);
  background: var(--g-bg-card, #1e2430); color: var(--g-text, #d8dde4);
  cursor: pointer; font-size: 14px; line-height: 1; display: flex; align-items: center; justify-content: center;
}
.counter button:hover:not(:disabled) { border-color: var(--g-primary, #0082c9); color: var(--g-primary, #0082c9); }
.counter button:disabled { opacity: .3; cursor: default; }
.count { min-width: 20px; text-align: center; font-weight: 700; font-size: 14px;
  color: var(--g-text, #d8dde4); }
.roll-one {
  font-size: 11px; padding: 3px 8px; border-radius: var(--g-radius, 8px);
  background: var(--g-bg-card, #1e2430); border: 1px solid var(--g-border, #2d3748);
  color: var(--g-text-dim, #8b949e); cursor: pointer;
}
.roll-one:hover:not(:disabled) { border-color: var(--g-primary, #0082c9);
  color: var(--g-primary, #0082c9); }
.roll-one:disabled { opacity: .3; cursor: default; }

.roll-all {
  padding: 9px; border-radius: var(--g-radius, 8px); font: inherit; font-weight: 700;
  background: var(--g-primary, #0082c9); color: var(--g-primary-t, #fff);
  border: none; cursor: pointer; transition: opacity .15s;
}
.roll-all:hover:not(:disabled) { opacity: .88; }
.roll-all:disabled { opacity: .35; cursor: default; }

.result { text-align: center; }
.total { display: block; font-size: 28px; font-weight: 700; color: var(--g-primary, #0082c9); line-height: 1.1; }
.breakdown { display: block; font-size: 11px; color: var(--g-text-dim, #8b949e); margin-top: 2px; }
</style>
