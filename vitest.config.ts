import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'
import { loadEnv } from 'vite'

export default defineWorkersConfig(({ mode }) => ({
  test: {
export default defineWorkersConfig(({ mode }) => ({
  test: {
    env: loadEnv(mode, process.cwd(), ''),
    env: loadEnv(mode, process.cwd(), ''),
    globalSetup: './tests/setup.ts',
    poolOptions: {
      workers: {
        singleWorker: true,
        isolatedStorage: false,
        wrangler: {
          configPath: './wrangler.toml',
        },
        miniflare: {
          cf: true,
        },
      },
    },
  },
}))
