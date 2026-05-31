<?php
/**
 * Mount point for the Vue SPA.
 *
 * We pin #grimoire-app with position:fixed to the area BELOW the Nextcloud
 * header, rather than relying on a particular content-wrapper id/size (which
 * changes between Nextcloud versions). This guarantees the Vue root has real
 * full-bleed dimensions and a solid background on every NC version.
 */
?>
<style>
  /* Nextcloud's header is var(--header-height) tall (50px fallback). Fill the
     rest of the viewport regardless of how the app-content wrapper is built. */
  #grimoire-app {
    position: fixed;
    top: var(--header-height, 50px);
    left: 0;
    right: 0;
    bottom: 0;
    overflow: hidden;
    background: var(--color-main-background, #14181f);
    z-index: 1;
  }
</style>
<div id="grimoire-app"></div>
