import {fileURLToPath} from 'node:url'
import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],

  server: {
    // Bind loopback IPv4 explicitly. Vite's default host is `localhost`,
    // which Node >=17 resolves to ::1 first, so the dev server ends up
    // listening on [::1] ONLY. Wails' ExternalAssetHandler proxy dials
    // tcp4 127.0.0.1, so it gets ECONNREFUSED and `task dev` opens an
    // empty window with:
    //   ERR [ExternalAssetHandler] Proxy error
    //   error=dial tcp4 127.0.0.1:<port>: connect: connection refused
    // It reads like a port conflict and isn't — nothing else holds the
    // port, the two sides just disagree on address family.
    host: '127.0.0.1',

    // Bare `npm run dev` (browser at :9245, no Wails window) has no
    // /api/v1 of its own — every call is a fetch now that the RPC branch
    // is gone, so proxy the API + screenshot routes to a `recall -s`
    // server (RECALL_SERVER_ADDR, default 127.0.0.1:7000). Inert under
    // `task dev`: there the webview loads the Wails origin and the
    // asset-server middleware short-circuits /api/v1 before Vite ever
    // sees it.
    proxy: {
      '/api/v1': { target: `http://${process.env.RECALL_SERVER_ADDR ?? '127.0.0.1:7000'}`, changeOrigin: true },
      '/_screenshot': { target: `http://${process.env.RECALL_SERVER_ADDR ?? '127.0.0.1:7000'}`, changeOrigin: true },
      // Attachments. Without this an <img> falls through to the SPA and gets
      // index.html back with a 200 — a broken picture with no error anywhere,
      // in dev only.
      '/_moment-image': { target: `http://${process.env.RECALL_SERVER_ADDR ?? '127.0.0.1:7000'}`, changeOrigin: true },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // Inline source maps ONLY for the e2e-coverage build (E2E_COVERAGE=1):
    // Playwright collects V8 coverage of the bundled JS, and monocart remaps
    // it to the original .ts/.vue source via the source map embedded in each
    // script's text. Production builds keep this off — inline maps would bloat
    // the shipped bundle and leak source.
    sourcemap: process.env.E2E_COVERAGE ? 'inline' : false,
    rolldownOptions: {
      output: {
        // Third-party code gets its own `vendor-*` chunks so the bundle gate
        // (scripts/ci/check-bundle-size.sh) can budget it apart from ours: a
        // library patch release should not fail a gate whose job is to catch
        // OUR regressions. One group per library family, never one catch-all
        // vendor chunk, because a catch-all would drag the lazy editor and
        // chart libraries into the first-paint graph alongside Vue. A package
        // no group names stays in the app chunks and counts as app code.
        codeSplitting: {
          groups: [
            {name: 'vendor-vue', test: /[\\/]node_modules[\\/](@vue|vue|pinia|@tanstack)[\\/]/},
            {name: 'vendor-wails', test: /[\\/]node_modules[\\/]@wailsio[\\/]/},
            {
              name: 'vendor-editor',
              test: /[\\/]node_modules[\\/](@tiptap|prosemirror-[^\\/]+|orderedmap|rope-sequence|w3c-keyname|linkifyjs)[\\/]/,
            },
            {name: 'vendor-charts', test: /[\\/]node_modules[\\/](echarts|zrender|vue-echarts|tslib)[\\/]/},
          ],
        },
      },
    },
  },
})
