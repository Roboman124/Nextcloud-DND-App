<template>
  <div class="grimoire">
    <router-view />
  </div>
</template>

<script>
export default { name: 'GrimoireApp' };
</script>

<style>
/* Use Nextcloud CSS variables with dark-theme fallbacks. */
:root {
  --g-bg:        var(--color-main-background,    #14181f);
  --g-bg-dark:   var(--color-background-dark,    #0f1318);
  --g-bg-card:   var(--color-background-hover,   #1e2430);
  --g-primary:   var(--color-primary,            #0082c9);
  --g-primary-t: var(--color-primary-text,       #ffffff);
  --g-text:      var(--color-main-text,          #d8dde4);
  --g-text-dim:  var(--color-text-maxcontrast,   #8b949e);
  --g-border:    var(--color-border,             #2d3748);
  --g-border-dk: var(--color-border-dark,        #1e2a3a);
  --g-radius:    8px;
  --g-font:      var(--font-face, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
}
/* #grimoire-app is a fixed, fully-sized box (see templates/main.php), so the
   wrapper simply fills it 100%. No viewport hacks needed. */
.grimoire {
  position: absolute; inset: 0;
  background: var(--g-bg); color: var(--g-text); font-family: var(--g-font);
}
</style>
