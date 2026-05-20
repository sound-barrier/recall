import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    // Composable tests need a DOM + localStorage; all tests use happy-dom
    // so the same environment is available everywhere (pure-function tests
    // are unaffected since they don't use any browser APIs).
    environment: 'happy-dom',
  },
})
