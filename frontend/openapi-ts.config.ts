import { defineConfig } from '@hey-api/openapi-ts'

// Generates frontend/src/client (committed — the gen-types drift gate
// regenerates and diffs it). The facade in src/api.ts is the only intended
// consumer; app code keeps importing named functions from @/api-client.
export default defineConfig({
  input: '../api/openapi.yaml',
  output: 'src/client',
  plugins: [
    // baseUrl: false — the spec's servers[] must never be baked into request
    // URLs: every call has to stay root-relative (/api/v1/...) for the Wails
    // asset-server origin and the e2e page.route('**/api/v1/...') mocks.
    { name: '@hey-api/client-fetch', baseUrl: false },
    '@hey-api/typescript',
    '@hey-api/sdk',
  ],
})
