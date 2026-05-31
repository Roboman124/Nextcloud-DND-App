import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

/**
 * Nextcloud loads a single bundle named like the addScript() call in
 * PageController: grimoire-main. We output to js/ where Nextcloud serves it.
 * three/cannon/konva are bundled in (not externalised) so the app is
 * self-contained on the server.
 */
export default defineConfig({
  plugins: [vue()],
  // Vue and some deps reference process.env.NODE_ENV. In Vite *library* mode
  // these are NOT auto-replaced for an IIFE <script> the way an app build is,
  // so `process` leaks into the browser and throws "process is not defined"
  // on the first line, before any app code runs. Define it statically here.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': '{}',
    'process.platform': '""',
    'process.version': '""',
    global: 'globalThis',
  },
  build: {
    outDir: 'js',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/main.js'),
      formats: ['iife'],
      name: 'Grimoire',
      fileName: () => 'grimoire-main.js',
    },
    rollupOptions: {
      // Emits js/grimoire-style.css; the build script then copies it to
      // css/grimoire-style.css where Util::addStyle expects it.
      output: { assetFileNames: 'grimoire-[name][extname]' },
    },
  },
});
