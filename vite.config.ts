import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';

// Configuration follows the Cornerstone3D "React, Vue, Angular, etc." guide:
//  - dicom-parser is CommonJS, so it needs the CommonJS plugin and pre-bundling.
//  - @cornerstonejs/dicom-image-loader ships web workers and WASM codecs and
//    must NOT be pre-bundled by Vite.
//  - Workers are ES modules.
//
// Single metadata registry (fixes the black viewport in `npm run dev`):
//  @cornerstonejs/metadata keeps the metadata provider registry and caches in
//  module-level state. @cornerstonejs/core re-exports `metaData` from it, and
//  the DICOM image loader imports it directly. Because the loader is excluded
//  from pre-bundling, Vite used to serve it the raw node_modules copy of
//  @cornerstonejs/metadata, while core got a second copy inlined into its
//  pre-bundled chunk. The loader registered its providers and stored each
//  file's pixel data in one copy, then read them back through core's copy,
//  found nothing, and failed with
//    "loadImageFromNaturalizedMetadata: no pixel data in NATURALIZED".
//  Listing the shared Cornerstone packages here makes them pre-bundled entry
//  points, so core and the loader resolve to the same module instance.
//  (Production builds bundle everything once and were never affected.)
//
// Node built-in "events":
//  A dependency imports Node's `events` module (`class X extends EventEmitter`).
//  Vite does not polyfill Node built-ins, so the browser-compatible `events`
//  npm package (a direct dependency) is used instead; `node:events` is aliased
//  to it explicitly. `npm run diagnose:builtins` lists packages that need it.
// Privacy guarantee for the built app: the browser may only contact the app's own
// origin, so local DICOM files cannot be sent anywhere else. Production builds only
// (the dev server needs inline scripts and a websocket for hot reload).
// Keep in sync with public/_headers (which also sets frame-ancestors).
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data:",
  "img-src 'self' blob: data:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'nrc-content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY }, injectTo: 'head-prepend' },
    ],
  };
}

export default defineConfig({
  plugins: [react(), viteCommonjs(), contentSecurityPolicy()],
  resolve: {
    alias: [{ find: /^node:events$/, replacement: 'events' }],
  },
  optimizeDeps: {
    exclude: ['@cornerstonejs/dicom-image-loader'],
    include: ['dicom-parser', 'events', '@cornerstonejs/metadata', '@cornerstonejs/utils'],
  },
  worker: {
    format: 'es',
  },
  server: {
    // Bind to localhost only: the app processes medical images and should not
    // be exposed on the network by default.
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    // Don't watch local imaging data kept inside the project folder (see .gitignore).
    // public/sample/ must stay watched: Vite only serves public files it knows about.
    watch: {
      ignored: ['**/data/**', '**/datasets/**'],
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 6000,
  },
});
