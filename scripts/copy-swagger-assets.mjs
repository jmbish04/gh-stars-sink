// Copies the minimal set of Swagger UI assets into /public/docs/
// so they’re served as static files by Wrangler (no CDNs).

import { mkdir, copyFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const src = join(__dirname, '..', 'node_modules', 'swagger-ui-dist')
const dest = join(__dirname, '..', 'public', 'docs')

await mkdir(dest, { recursive: true })

// Minimal set we need
const files = [
  'swagger-ui.css',
  'swagger-ui-bundle.js',
  'swagger-ui-standalone-preset.js',
  'favicon-16x16.png',
  'favicon-32x32.png',
]

await Promise.all(files.map(f =>
  copyFile(join(src, f), join(dest, f))
))

console.log('✅ Copied Swagger UI assets to /public/docs')
