import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  project: ['src/**/*.{ts,vue}'],
  ignoreDependencies: [
    // Peer dep consumed internally by typescript-eslint — not imported directly.
    '@eslint/js',
  ],
}

export default config
