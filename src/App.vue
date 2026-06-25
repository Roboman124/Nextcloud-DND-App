<template>
  <div class="grimoire">
    <router-view />
  </div>
</template>

<script>
export default { name: 'GrimoireApp' };
</script>

<style>
/*
 * Bridge Nextcloud's theme CSS variables into Grimoire's --g-* tokens.
 * Nextcloud sets these on :root/body and flips them automatically for
 * light/dark/high-contrast. We only fall back to dark defaults if the
 * Nextcloud vars are absent (e.g. standalone demo.html without the host).
 */
:root {
  --g-bg:        var(--color-main-background,     #14181f);
  --g-bg-dark:   var(--color-background-dark,     #0f1318);
  --g-bg-card:   var(--color-background-hover,    #1e2430);
  --g-bg-darker: var(--color-background-darker,  #14181f);
  --g-primary:   var(--color-primary-element,     #0082c9);
  --g-primary-t: var(--color-primary-element-text,#ffffff);
  --g-primary-hover: var(--color-primary-element-hover, #0a74b0);
  --g-primary-light: var(--color-primary-element-light, rgba(0,130,201,.12));
  --g-text:      var(--color-main-text,          #d8dde4);
  --g-text-dim:  var(--color-text-maxcontrast,   #8b949e);
  --g-border:    var(--color-border,             #2d3748);
  --g-border-dk: var(--color-border-dark,        #1e2a3a);
  --g-radius:    var(--border-radius-element,     8px);
  --g-radius-large: var(--border-radius-container,12px);
  --g-font:      var(--font-face, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
  --g-shadow:    var(--color-box-shadow, 0 0 6px rgba(0,0,0,.4));
  --g-error:     var(--color-text-error, #e74c3c);
  --g-success:   var(--color-text-success,#3fb950);
  --g-warning:   var(--color-text-warning, #e0c068);
}
/* #grimoire-app is a fixed, fully sized box (see templates/main.php), so the
   wrapper simply fills it 100%. No viewport hacks needed. */
.grimoire {
  position: absolute; inset: 0;
  background: var(--g-bg); color: var(--g-text); font-family: var(--g-font);
}
/* Reset Nextcloud's default body padding for app content areas */
.grimoire * { box-sizing: border-box; }
</style>
