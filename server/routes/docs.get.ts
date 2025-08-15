/**
 * /docs — Self-hosted Swagger UI (no extra files in repo)
 * =============================================================================
 * GOAL
 *   Serve a complete Swagger UI page **without** committing `swagger-ui-dist`
 *   assets to your repo and **without** copying to /public. This route inlines
 *   the CSS and JS at build time using Vite’s `?raw` imports.
 *
 * WHY THIS APPROACH
 *   - Works in Cloudflare Workers (no Node fs at runtime).
 *   - No asset copy step and no repo churn.
 *   - Single deployable route. Zero CDN calls.
 *
 * HOW IT WORKS
 *   - `import '...css?raw'` / `import '...js?raw'` tells Vite/Nitro to bundle
 *     file contents as strings. We then inject them into `<style>`/`<script>`.
 *   - We set a tight but permissive-enough CSP for inline CSS/JS on this page
 *     only. (It does NOT affect your API routes.)
 *
 * CONTRACT
 *   - The UI loads your canonical OpenAPI **3.1.0** at `/openapi.json`.
 *   - Update that file to reflect your API; this page just renders it.
 *
 * SECURITY NOTES
 *   - `script-src 'self' 'unsafe-inline'` and `style-src 'self' 'unsafe-inline'`
 *     are required because we inline the JS/CSS. Scope is limited to this route
 *     via per-response headers. If you later externalize the scripts, you can
 *     remove `'unsafe-inline'`.
 *
 * REQUIREMENTS
 *   pnpm add -D swagger-ui-dist
 *
 * TEST
 *   - Visit /docs and confirm the UI renders your endpoints.
 *   - `curl -I https://<domain>/docs` should return `content-type: text/html`.
 */

import SWAGGER_UI_CSS from 'swagger-ui-dist/swagger-ui.css?raw'
import SWAGGER_UI_BUNDLE from 'swagger-ui-dist/swagger-ui-bundle.js?raw'
import SWAGGER_UI_STANDALONE from 'swagger-ui-dist/swagger-ui-standalone-preset.js?raw'

export default defineEventHandler((event) => {
  // Tight, page-scoped security headers
  setHeader(event, 'content-type', 'text/html; charset=utf-8')
  setHeader(event, 'x-frame-options', 'DENY')
  setHeader(event, 'referrer-policy', 'no-referrer')
  setHeader(event, 'x-content-type-options', 'nosniff')
  setHeader(
    event,
    'content-security-policy',
    [
      "default-src 'none'",
      // inline CSS/JS only for this page:
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      // UI loads /openapi.json from same origin
      "connect-src 'self'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "frame-ancestors 'none'",
    ].join('; ')
  )

  // Inline page (no external asset fetches)
  const html = /* html */ `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>GH Stars API — Docs</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>${SWAGGER_UI_CSS}</style>
    <style>
      html, body { margin:0; padding:0; height:100%; }
      #swagger-ui { height: 100%; }
      .topbar { display:none; } /* cleaner look */
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script>${SWAGGER_UI_BUNDLE}</script>
    <script>${SWAGGER_UI_STANDALONE}</script>
    <script>
      // Boot the UI against your canonical 3.1.0 spec
      window.ui = SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: 'BaseLayout',
        // For local testing of secured endpoints, you can add a request interceptor:
        // requestInterceptor: (req) => { req.headers['x-site-token'] = '...'; return req }
      })
    </script>
  </body>
</html>`

  return html
})
