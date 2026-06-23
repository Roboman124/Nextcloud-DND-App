<template>
  <div class="browse">
    <!-- Breadcrumb -->
    <div class="crumbs">
      <button class="crumb" @click="open('/')">📁 Home</button>
      <template v-for="(seg, i) in segments" :key="i">
        <span class="sep">/</span>
        <button class="crumb" @click="open(seg.path)">{{ seg.name }}</button>
      </template>
    </div>

    <div v-if="loading" class="state">Loading…</div>
    <div v-else-if="error" class="state err">{{ error }}</div>
    <div v-else-if="!files.length" class="state">No {{ kind }} files here.</div>

    <div v-else class="grid">
      <button v-for="f in files" :key="f.path" class="card" @click="onPick(f)">
        <img v-if="f.preview" :src="f.preview" :alt="f.name" class="thumb" />
        <span v-else class="thumb placeholder">{{ f.isModel ? '📦' : (f.type === 'folder' ? '📁' : '📄') }}</span>
        <span class="name">{{ f.name }}</span>
      </button>
    </div>
  </div>
</template>

<script>
import axios from '@nextcloud/axios';
import { generateUrl } from '../lib/url.js';

/**
 * BrowseList — a Nextcloud Files browser for the asset picker. Lists the
 * current folder (folders first), and emits `pick` with a file descriptor
 * {name, path, url, preview, isModel, isImage} when an image/model is chosen.
 * Folder clicks navigate in place.
 */
export default {
  name: 'BrowseList',
  props: {
    kind: { type: String, default: 'all' }, // 'map' | 'token' | 'model' | 'all'
  },
  emits: ['pick'],
  data() {
    return { path: '/', files: [], loading: false, error: null };
  },
  computed: {
    segments() {
      if (this.path === '/' || !this.path) return [];
      const parts = this.path.replace(/^\/+|\/+$/g, '').split('/');
      const out = [];
      let acc = '';
      for (const p of parts) {
        acc += '/' + p;
        out.push({ name: p, path: acc });
      }
      return out;
    },
  },
  mounted() { this.open('/'); },
  methods: {
    async open(path) {
      this.path = path || '/';
      this.loading = true;
      this.error = null;
      try {
        const { data } = await axios.get(generateUrl('/apps/grimoire/api/assets'), {
          params: { path: this.path, kind: this.kind },
        });
        this.files = data.files || [];
      } catch (e) {
        this.error = e?.response?.data?.error || 'Could not list files';
        this.files = [];
      } finally {
        this.loading = false;
      }
    },
    onPick(f) {
      if (f.type === 'folder') return this.open(f.path);
      this.$emit('pick', f);
    },
  },
};
</script>

<style scoped>
.browse { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
.crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; font-size: 11px; }
.crumb { background: none; border: none; color: var(--g-primary, #0082c9);
  cursor: pointer; padding: 2px 4px; border-radius: 4px; font: inherit; font-size: 11px; }
.crumb:hover { text-decoration: underline; }
.sep { color: var(--g-text-dim, #8b949e); }
.state { font-size: 12px; color: var(--g-text-dim, #8b949e); padding: 10px 0; text-align: center; }
.state.err { color: #e0998c; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; max-height: 280px; overflow-y: auto; }
.card { background: var(--g-bg-card, #1e2430); border: 1px solid var(--g-border, #2d3748);
  border-radius: 6px; overflow: hidden; cursor: pointer; padding: 0; text-align: center; }
.card:hover { border-color: var(--g-primary, #0082c9); }
.thumb { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; }
.thumb.placeholder { display: flex; align-items: center; justify-content: center; font-size: 24px;
  background: #14110d; color: #c9a227; }
.name { font-size: 10px; color: var(--g-text-dim, #8b949e); padding: 3px 4px; display: block;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>