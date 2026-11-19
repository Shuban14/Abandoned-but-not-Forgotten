/**
 * Security headers.
 *
 * `X-Frame-Options: SAMEORIGIN` keeps the existing same-origin iframes working
 * (the Moon/Mars explorers and Launch Lab are embedded from `/space/`).
 *
 * The Content-Security-Policy is shipped in **report-only** mode on purpose:
 * the app uses three.js/WebGL, NASA imagery, Google-hosted fonts through
 * `next/font`, Vercel Analytics, Web Audio and inline styles. Report-only lets
 * the policy be validated against real traffic before anything is enforced.
 */
const isProduction = process.env.NODE_ENV === 'production'

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' https:",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "form-action 'self'",
].join('; ')

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Content-Security-Policy-Report-Only', value: contentSecurityPolicy },
  ...(isProduction
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
    : []),
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // The embedded PostgreSQL used for local runs ships WASM; keep it out of the
  // server bundle so it is loaded from node_modules at runtime instead.
  serverExternalPackages: ['@electric-sql/pglite'],
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      // API responses are JSON only. Sealing them with their own policy means a
      // sniffed payload can never be rendered as HTML (§XSSI / content-sniffing
      // leaks are the classic way a JSON body ends up executing in a browser),
      // and mission data — which is session-scoped — is additionally marked
      // same-origin so no other site can load or embed it.
      // Later rules win, so the narrow session-scoped rule is listed after the
      // general API rule and tightens the policy for mission data only.
      {
        source: '/api/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'none'; sandbox" },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-site' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        ],
      },
      {
        source: '/api/missions',
        headers: [
          { key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'none'; sandbox" },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        ],
      },
      {
        source: '/api/missions/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'none'; sandbox" },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        ],
      },
      { source: '/:path*', headers: securityHeaders },
    ]
  },
}

export default nextConfig
