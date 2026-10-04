import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Production Content-Security-Policy as a <meta> tag, so it works on any static host.
 * Directives a meta tag cannot carry (frame-ancestors, HSTS…) live in public/_headers and vercel.json.
 */
function contentSecurityPolicy(apiUrl: string): Plugin {
  const api: string[] = [];
  if (apiUrl) {
    const u = new URL(apiUrl);
    api.push(u.origin, `${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}`);
  }
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    // the UI sets CSS custom properties through inline style attributes
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    `connect-src 'self' ${api.join(' ')} data: blob:`.replace(/\s+/g, ' '),
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }],
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [contentSecurityPolicy((env.VITE_API_URL ?? '').replace(/\/+$/, ''))],
    server: {
      port: 5173,
      host: true,
      proxy: {
        '/api': 'http://localhost:3001',
        '/socket.io': { target: 'http://localhost:3001', ws: true },
      },
    },
    build: {
      target: ['es2020', 'chrome80', 'edge80', 'firefox78', 'safari14', 'ios14'],
      chunkSizeWarningLimit: 2000,
      rolldownOptions: {
        output: {
          postBanner: '/*! © 2026 Bá Khí - Trời Nam 2D. All rights reserved. Proprietary software, see LICENSE. */',
          minify: { compress: true, mangle: true },
        },
      },
    },
  };
});
