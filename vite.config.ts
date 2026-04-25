import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ command }) => ({
  base: command === 'build' && process.env.GITHUB_ACTIONS ? '/mbta-rail-pwa/' : '/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      devOptions: { enabled: true },
      manifest: {
        name: 'MBTA Commuter Rail',
        short_name: 'MBTA Rail',
        description: 'Real-time MBTA Commuter Rail tracker with favorites and track numbers',
        theme_color: '#7B388C',
        background_color: '#F7F0FB',
        start_url: '/mbta-rail-pwa/',
        scope: '/mbta-rail-pwa/',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api-v3\.mbta\.com\//,
            handler: 'NetworkFirst',
            options: { cacheName: 'mbta-api', networkTimeoutSeconds: 10 },
          },
        ],
      },
    }),
  ],
}));
