import {fileURLToPath} from 'node:url'
import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
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
