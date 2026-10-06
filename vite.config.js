import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const base = process.env.BASE_PATH || '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'models/*', 'tfjs-wasm/*'],
      manifest: {
        name: 'IronYellow Gym',
        short_name: 'IronYellow',
        description: 'Gestión de gimnasio, entrenamientos y progreso',
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
        ]
      },
      workbox: {
        importScripts: ['push-sw.js'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,png,json,bin,wasm,woff2}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname.endsWith('supabase.co'),
            handler: 'NetworkFirst',
            options: { cacheName: 'supabase', networkTimeoutSeconds: 6 }
          },
          {
            urlPattern: ({ url }) => url.hostname === 'wger.de',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'wger' }
          }
        ]
      }
    })
  ],
  build: { chunkSizeWarningLimit: 4000 }
})
