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
  },
})
