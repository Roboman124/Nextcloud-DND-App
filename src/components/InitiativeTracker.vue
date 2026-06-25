<template>
  <div class="init-tracker">
    <header class="it-header">
      <h3>⚔ Initiative</h3>
      <button class="it-close" @click="$emit('close')">✕</button>
    </header>
    <button class="it-roll" :disabled="rolling" @click="rollAll">
      {{ rolling ? 'Rolling…' : 'Roll for all' }}
    </button>
    <ol class="it-list">
      <li v-for="(o, i) in order" :key="o.id" class="it-item" :class="{ active: i === 0 }">
        <span class="it-pos">{{ i + 1 }}</span>
        <span class="it-label">{{ o.label || o.id }}</span>
        <span class="it-init">{{ o.init }}</span>
      </li>
    </ol>
    <p v-if="!order.length" class="it-empty">No initiative rolled yet.</p>
    <div class="it-controls">
      <button @click="next" :disabled="!order.length" title="Next turn">▸ Next</button>
      <button @click="clear" :disabled="!order.length" title="Clear">Clear</button>
    </div>
  </div>
</template>

<script>
import axios from '@nextcloud/axios';
import { generateUrl } from '../lib/url.js';

/**
 * InitiativeTracker — a built-in (no-iframe) initiative tracker. Reads the
 * tokens on the table, rolls a physics d20 for each via the host's DiceRoller,
 * sorts, and broadcasts the order to the room so everyone's tracker stays
 * synced. This replaces the iframe-based addon with a first-class panel.
 */
export default {
  name: 'InitiativeTracker',
  props: {
    /** The host DiceRoller (or DicePanel's viewportRoller) for physics rolls. */
    roller: { type: Object, default: null },
    /** SyncClient to broadcast the order. */
    sync: { type: Object, default: null },
    /** The Scene2D + Scene3D instances (to read tokens). */
    scene2d: { type: Object, default: null },
    scene3d: { type: Object, default: null },
  },
  emits: ['close'],
  data() { return { order: [], rolling: false, current: 0 }; },
  methods: {
    getTokens() {
      const byId = new Map();
      for (const e of (this.scene2d?.tokens?.values() || [])) byId.set(e.data.id, e.data);
      for (const e of (this.scene3d?.tokens?.values() || [])) if (!byId.has(e.data.id)) byId.set(e.data.id, e.data);
      return [...byId.values()];
    },
    async rollAll() {
      const tokens = this.getTokens();
      if (!tokens.length) return;
      this.rolling = true;
      try {
        const order = [];
        for (const t of tokens) {
          let init = 0;
          if (this.roller?.rollAsync) {
            const r = await this.roller.rollAsync('1d20');
            init = r?.[0]?.value || r?.total || 0;
          } else { init = Math.floor(Math.random() * 20) + 1; }
          order.push({ id: t.id, label: t.label || t.id, init });
        }
        order.sort((a, b) => b.init - a.init);
        this.order = order; this.current = 0;
        this.sync?.send({ type: 'broadcast:initiative', payload: order });
      } finally { this.rolling = false; }
    },
    next() { if (this.order.length) this.current = (this.current + 1) % this.order.length; },
    clear() { this.order = []; this.current = 0; },
    /** Receive a remote initiative broadcast. */
    applyRemote(order) { this.order = order; this.current = 0; },
  },
};
</script>

<style scoped>
.init-tracker {
  position: absolute; right: 0; top: 0; width: 280px; height: 100%; z-index: 35;
  background: var(--g-bg-dark); border-left: 1px solid var(--g-border);
  display: flex; flex-direction: column; box-shadow: var(--g-shadow);
}
.it-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--g-border); }
.it-header h3 { margin: 0; font-size: 12px; font-weight: 700; letter-spacing: .15em; text-transform: uppercase; color: var(--g-primary); }
.it-close { background: none; border: none; color: var(--g-text-dim); cursor: pointer; }
.it-close:hover { color: var(--g-text); }
.it-roll { margin: 12px 14px; padding: 9px; border: none; border-radius: var(--g-radius); font: inherit; font-weight: 700; font-size: 13px; background: var(--g-primary); color: var(--g-primary-t); cursor: pointer; }
.it-roll:disabled { opacity: .4; cursor: default; }
.it-list { list-style: none; padding: 0; margin: 0; overflow-y: auto; flex: 1; }
.it-item { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-bottom: 1px solid var(--g-border); }
.it-item.active { background: var(--g-primary-light); }
.it-pos { width: 22px; height: 22px; border-radius: 50%; background: var(--g-bg-card); color: var(--g-text-dim); font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
.it-item.active .it-pos { background: var(--g-primary); color: var(--g-primary-t); }
.it-label { flex: 1; font-size: 13px; color: var(--g-text); }
.it-init { font-size: 16px; font-weight: 800; color: var(--g-primary); }
.it-empty { color: var(--g-text-dim); font-size: 12px; text-align: center; padding: 20px; font-style: italic; }
.it-controls { display: flex; gap: 6px; padding: 10px 14px; border-top: 1px solid var(--g-border); }
.it-controls button { flex: 1; font: inherit; font-size: 12px; padding: 7px; border-radius: var(--g-radius); background: var(--g-bg-card); border: 1px solid var(--g-border); color: var(--g-text); cursor: pointer; }
.it-controls button:hover:not(:disabled) { border-color: var(--g-primary); color: var(--g-primary); }
.it-controls button:disabled { opacity: .4; }
</style>