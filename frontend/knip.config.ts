import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  // src/client is @hey-api/openapi-ts output — generated exports are
  // consumed selectively by the api.ts facade, so knip must not flag
  // the unused remainder.
  project: ['src/**/*.{ts,vue}', '!src/client/**'],
}

export default config
