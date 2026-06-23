<template>
  <div class="text-editor" :style="{ left: x + 'px', top: y + 'px' }">
    <div class="te-bar" @mousedown.stop>
      <button @click="exec('bold')" title="Bold (Ctrl+B)"><b>B</b></button>
      <button @click="exec('italic')" title="Italic (Ctrl+I)"><i>I</i></button>
      <button @click="exec('insertUnorderedList')" title="Bulleted list">•</button>
      <button @click="exec('insertOrderedList')" title="Numbered list">1.</button>
      <button @click="heading('h1')" title="Heading 1">H1</button>
      <button @click="heading('h2')" title="Heading 2">H2</button>
      <button @click="emoji" title="Emoji">😀</button>
      <span class="te-spacer" />
      <button class="te-done" @click="done" title="Done (Shift+Enter)">✓</button>
    </div>
    <div ref="area" class="te-area" contenteditable="true" @input="onInput" @keydown="onKey"
      :style="{ color, fontSize: size + 'px' }"></div>
  </div>
</template>

<script>
/**
 * TextEditor — an in-place rich text editor for the canvas. Opens where the
 * user clicks with the text tool; supports bold/italic/lists/headings/emoji
 * via contentEditable + execCommand (simple, dependency-free). On "done"
 * (✓ or Shift+Enter) it emits `commit` with the HTML + plain text; Room
 * renders that as an HTML overlay on the scene and syncs it.
 */
export default {
  name: 'TextEditor',
  props: { x: Number, y: Number, color: { type: String, default: '#f0e6cc' }, size: { type: Number, default: 18 } },
  emits: ['commit', 'cancel'],
  mounted() {
    this.$refs.area.focus();
    // Close on outside click / Escape.
    this._outside = (e) => { if (!this.$el.contains(e.target)) this.done(); };
    setTimeout(() => document.addEventListener('mousedown', this._outside), 0);
  },
  beforeUnmount() { document.removeEventListener('mousedown', this._outside); },
  methods: {
    exec(cmd) { document.execCommand(cmd, false, null); this.$refs.area.focus(); },
    heading(tag) {
      document.execCommand('formatBlock', false, tag);
      this.$refs.area.focus();
    },
    emoji() {
      // Lightweight: a small set of common dice/tabletop emoji inserted at cursor.
      const pick = window.prompt('Pick an emoji:', '🎲');
      if (pick) document.execCommand('insertText', false, pick);
    },
    onInput() { this.html = this.$refs.area.innerHTML; this.text = this.$refs.area.innerText; },
    onKey(e) {
      if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); this.done(); }
      if (e.key === 'Escape') { this.$emit('cancel'); }
    },
    done() {
      const html = (this.$refs.area.innerHTML || '').trim();
      const text = (this.$refs.area.innerText || '').trim();
      if (text) this.$emit('commit', { html, text });
      else this.$emit('cancel');
    },
  },
};
</script>

<style scoped>
.text-editor {
  position: absolute; z-index: 60; min-width: 200px; max-width: 340px;
  background: rgba(18,14,10,.97); border: 1px solid #c9a227; border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0,0,0,.5); overflow: hidden;
}
.te-bar { display: flex; align-items: center; gap: 2px; padding: 4px 6px; border-bottom: 1px solid #3a3024; cursor: default; }
.te-bar button { background: #231c13; color: #e9dfc4; border: 1px solid #3a3024; border-radius: 6px;
  padding: 3px 7px; cursor: pointer; font: inherit; font-size: 12px; }
.te-bar button:hover { border-color: #c9a227; color: #c9a227; }
.te-spacer { flex: 1; }
.te-done { color: #9ed8a8 !important; }
.te-area { padding: 8px 10px; min-height: 40px; outline: none; line-height: 1.35;
  font-family: "Iowan Old Style","Palatino Linotype",Georgia,serif; }
.te-area :deep(h1) { font-size: 1.4em; margin: 2px 0; }
.te-area :deep(h2) { font-size: 1.15em; margin: 2px 0; }
.te-area :deep(ul), .te-area :deep(ol) { margin: 2px 0 2px 18px; padding: 0; }
</style>