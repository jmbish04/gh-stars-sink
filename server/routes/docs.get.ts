// server/routes/docs.get.ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pkg from 'swagger-ui-dist'

const distPath = pkg.getAbsoluteFSPath() // resolves to node_modules/swagger-ui-dist

function getAsset(path: string) {
  return readFileSync(join(distPath, path), 'utf-8')
}

/**
 * GET /docs
 * Serve Swagger UI fully bundled (no CDNs, no asset copies).
 */
export default defineEventHandler((event) => {
  setHeader(event, 'content-type', 'text/html; charset=utf-8')
  return /* html */ `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>GH Stars API Docs</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>${getAsset('swagger-ui.css')}</style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script>${getAsset('swagger-ui-bundle.js')}</script>
    <script>${getAsset('swagger-ui-standalone-preset.js')}</script>
    <script>
      window.ui = SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: "BaseLayout"
      })
    </script>
  </body>
</html>`
})
