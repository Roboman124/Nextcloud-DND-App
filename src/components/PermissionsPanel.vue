<template>
  <div class="perms">
    <header>
      <span class="p-title">Player Permissions</span>
      <button class="p-close" @click="$emit('close')">✕</button>
    </header>
    <p class="p-hint">Control what players can do on each layer. GMs are never restricted.</p>
    <table class="p-table">
      <thead>
        <tr><th>Layer</th><th>Create</th><th>Update</th><th>Delete</th><th>Owner only</th></tr>
      </thead>
      <tbody>
        <tr v-for="layer in layers" :key="layer.key">
          <td>{{ layer.label }}</td>
          <td><input type="checkbox" v-model="cfg[layer.key].create" @change="emit" /></td>
          <td><input type="checkbox" v-model="cfg[layer.key].update" @change="emit" /></td>
          <td><input type="checkbox" v-model="cfg[layer.key].delete" @change="emit" /></td>
          <td><input type="checkbox" v-model="cfg[layer.key].ownerOnly" @change="emit" :disabled="layer.key !== 'tokens'" :title="layer.key === 'tokens' ? 'Players can only move their own tokens' : 'Owner-only applies to tokens'" /></td>
        </tr>
      </tbody>
    </table>
    <p v-if="saved" class="p-saved">Saved</p>
  </div>
</template>

<script>
/**
 * PermissionsPanel — GM-only popover to set per-layer player permissions
 * (create/update/delete for maps/tokens/drawings/fog) and owner-only tokens.
 * Emits `change` with the full config; Room persists it to the campaign.
 */
export default {
  name: 'PermissionsPanel',
  emits: ['close', 'change'],
  props: { permissions: { type: Object, default: () => ({}) } },
  data() {
    const def = (o = {}) => ({ create: true, update: true, delete: true, ownerOnly: false, ...o });
    return {
      layers: [
        { key: 'maps', label: 'Maps' },
        { key: 'tokens', label: 'Tokens' },
        { key: 'drawings', label: 'Drawings' },
        { key: 'fog', label: 'Fog' },
      ],
      cfg: {
        maps: def(this.permissions?.maps),
        tokens: def(this.permissions?.tokens),
        drawings: def(this.permissions?.drawings),
        fog: def(this.permissions?.fog),
      },
      saved: false,
    };
  },
  methods: {
    emit() {
      this.$emit('change', { ...this.cfg });
      this.saved = true;
      setTimeout(() => { this.saved = false; }, 1500);
    },
  },
};
</script>

<style scoped>
.perms {
  position: absolute; right: 14px; top: 14px; z-index: 45; width: 360px;
  background: var(--g-bg-dark, #0f1318); border: 1px solid var(--g-border, #2d3748);
  border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px;
  box-shadow: 0 10px 30px rgba(0,0,0,.5);
}
header { display: flex; justify-content: space-between; align-items: center; }
.p-title { font-size: 11px; font-weight: 700; letter-spacing: .15em; text-transform: uppercase; color: var(--g-primary, #0082c9); }
.p-close { background: none; border: none; color: var(--g-text-dim, #8b949e); cursor: pointer; font-size: 13px; }
.p-hint { font-size: 11px; color: var(--g-text-dim, #8b949e); margin: 0; }
.p-table { width: 100%; border-collapse: collapse; font-size: 12px; color: var(--g-text, #d8dde4); }
.p-table th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: var(--g-text-dim, #8b949e); padding: 4px 6px; border-bottom: 1px solid var(--g-border, #2d3748); }
.p-table td { padding: 6px; border-bottom: 1px solid var(--g-border, #2d3748); }
.p-table input[type=checkbox] { cursor: pointer; }
.p-saved { font-size: 11px; color: #9ed8a8; margin: 0; text-align: right; }
</style>