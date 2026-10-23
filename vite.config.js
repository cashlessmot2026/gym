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
      includeAssets: ['favicon.png', 'apple-touch-icon.png', 'logo.png', 'models/*', 'tfjs-wasm/*'],
      manifest: {
        name: 'Mercury Fitness Club',
        short_name: 'Mercury',
        description: 'Gestión de gimnasio, entrenamientos y progreso',
        theme_color: '#070707',
        background_color: '#070707',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        importScripts: ['push-sw.js'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,png,json,bin,wasm,woff2}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/privacypolicy.html$/, /acerca.html$/, /google[0-9a-f]+.html$/],
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
