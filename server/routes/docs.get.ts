/**
 * GET /docs
 * Self-hosted Swagger UI (no CDNs). Points at /openapi.json (your static 3.1 spec).
 * We reference assets copied into /public/docs by the build step.
 *
 * Security: We set a simple CSP that allows self-hosted JS/CSS only.
 * If you embed other fonts/scripts later, adjust the CSP accordingly.
 */
export default defineEventHandler((event) => {
  setHeader(event, 'content-type', 'text/html; charset=utf-8')
  setHeader(event, 'x-frame-options', 'DENY')
  setHeader(event, 'referrer-policy', 'no-referrer')
  setHeader(event, 'x-content-type-options', 'nosniff')
  setHeader(
    event,
    'content-security-policy',
    [
      "default-src 'none'",
      "style-src 'self'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "script-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
    ].join('; ')
  )

  const html = /* html */ `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>GH Stars API — Docs</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/png" href="/docs/favicon-32x32.png" sizes="32x32" />
    <link rel="icon" type="image/png" href="/docs/favicon-16x16.png" sizes="16x16" />
    <link rel="stylesheet" href="/docs/swagger-ui.css" />
    <style>
      html, body { margin:0; padding:0; height:100%; }
      #swagger-ui { height: 100%; }
      .topbar { display:none; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="/docs/swagger-ui-bundle.js"></script>
    <script src="/docs/swagger-ui-standalone-preset.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: '/openapi.json', // <-- canonical 3.1.0 spec
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout",
        // If you later secure endpoints with an API key, add a default here:
        // requestInterceptor: (req) => {
        //   req.headers['x-site-token'] = '...'; // for local testing only
        //   return req;
        // },
      })
    </script>
  </body>
</html>`
  return html
})
